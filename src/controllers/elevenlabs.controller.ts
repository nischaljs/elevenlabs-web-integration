import { Request, Response } from 'express';
import { Practitioner } from '../models/practitioner.model';
import { OpenAIModel } from '../utils/chatgpt';
import { createAppointmentAndStore, createPatientAndStore, getAvailabilityFromDentally } from '../utils/dentally';
import { verifyElevenLabsWebhookSignature } from '../utils/elevenlabs';
import { createStripePaymentLink, sendSMS } from '../utils/sms';
import { startWebSocketConnection, stopWebSocketConnection, sendToElevenlabs } from '../utils/websockets';
import { IAppointment } from '../models/appointment.model';

const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

interface AvailabilitySlot {
    start_time: string;
    finish_time: string;
}

export const getPractitioners = async (req: Request, res: Response): Promise<void> => {
    try {
        const practitioners = await Practitioner.find({ active: true }).limit(15);

        const lines = practitioners.map(doc => {
            const user = doc.user || {};
            const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
            const practitionerId = doc.id;
            return fullName && practitionerId ? `${fullName} (${practitionerId})` : null;
        }).filter(Boolean);

        if (lines.length === 0) {
            res.json({ text: 'Sorry, no active practitioners are currently available.' });
            return;
        }

        const spokenText = 'Here are the available practitioners: ' + lines.join('; ');
        res.json({ text: spokenText });
    } catch (error) {
        console.error('[ElevenLabsController] Error getting practitioners:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};

export const checkAvailableTime = async (req: Request, res: Response): Promise<void> => {
    const { practitioner_id, start_time, finish_time, duration } = req.params;
    
    // FastAPI-style parameter validation
    const practitionerId = parseInt(practitioner_id);
    if (isNaN(practitionerId)) {
        res.status(400).json({ detail: 'practitioner_id must be a number' });
        return;
    }
    
    const durationNum = parseInt(duration);
    if (isNaN(durationNum)) {
        res.status(400).json({ detail: 'duration must be a number' });
        return;
    }

    try {
        const availabilityData = await getAvailabilityFromDentally(
            [practitionerId],
            start_time,
            finish_time,
            durationNum
        );

        if (!availabilityData.availability) {
            res.json({
                available_slots: '',
                message: 'You can book an appointment with this practitioner at any time slot.You Want'
            });
            return;
        }

        const slotTimes = availabilityData.availability.map((slot: AvailabilitySlot) => 
            `${slot.start_time} to  ${slot.finish_time}`
        );
        const slotString = slotTimes.join(',');

        res.json({
            available_slots: slotString,
            message: 'Available time slots are'
        });
    } catch (error) {
        // Match FastAPI's error response format
        res.status(500).json({ detail: 'Something Went Wrong in Backend' });
    }
};

const getUsdtAmount = async (patientType: string, consultation: string): Promise<number> => {
    if (patientType === 'New') {
        if (consultation === 'Biological Consultation') return 75;
        if (consultation === 'General Consultation') return 50;
        if (consultation === 'Hygiene Appointment') return 50;
        return 75;
    } else if (patientType === 'Existing') {
        if (consultation === 'Biological Consultation') return 50;
        if (consultation === 'General Consultation') return 50;
        if (consultation === 'Hygiene Appointment') return 50;
        return 50;
    }
    return 50;
};

export const createAppointment = async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['x-elevenlabs-signature'] as string | undefined;
    
    // Match FastAPI's raw body handling
    const rawBody = JSON.stringify(req.body);
    if (signature && !verifyElevenLabsWebhookSignature(rawBody, signature)) {
        res.status(401).json({ detail: 'Invalid signature' });
        return;
    }

    try {
        const event = req.body;
        if (event?.type !== 'post_call_transcription') {
            res.json({ received: true });
            return;
        }

        const data = event?.data ?? {};
        if (data?.agent_id !== ELEVENLABS_AGENT_ID) {
            res.json({ received: true });
            return;
        }

        // Start WebSocket connection for this conversation
        const conversationId = data?.conversation_id;
        if (conversationId) {
            startWebSocketConnection(conversationId);
        }

        const transcriptData = data?.transcript ?? '';
        const response = await OpenAIModel(transcriptData);

        if (!response) {
            res.json({ received: true });
            return;
        }

        const patientData = {
            patient: {
                title: response?.patient_title ?? 'Mr',
                first_name: response?.patient_first_name ?? '',
                last_name: response?.patient_last_name ?? '',
                date_of_birth: response?.patient_dob ?? '',
                gender: response?.patient_gender ?? true,
                ethnicity: response?.patient_ethnicity ?? '',
                address_line_1: response?.patient_address_line_1 ?? '',
                postcode: response?.patient_postcode ?? '',
                payment_plan_id: parseInt(response?.patient_payment_plan_id ?? '0'),
                payment_plan: [parseInt(response?.patient_payment_plan_id ?? '0')],
                email_address: response?.patient_email ?? '',
                mobile_phone: response?.patient_phone_number ?? ''
            }
        };

        const appointmentData = {
            appointment: {
                start_time: response?.appointment_start_time ?? '',
                finish_time: response?.appointment_finish_time ?? '',
                patient_id: response?.appointment_patient_id ?? '',
                practitioner_id: response?.booked_practitioner_id ?? '',
                reason: response?.appointment_reason ?? ''
            }
        };

        console.log('[ElevenLabsController] Formatted Patient Data:', patientData);

        const createdPatient = await createPatientAndStore(patientData);
        let createdAppointment: IAppointment | null = null;

        if (createdPatient && createdPatient.id) {
            appointmentData.appointment.patient_id = createdPatient.id;

            createdAppointment = await createAppointmentAndStore(appointmentData);
            if (createdAppointment) {
                try {
                    const usdtAmount = await getUsdtAmount(
                        response.patient_status,
                        response.consultation_type
                    );

                    if (usdtAmount) {
                        const patientPhone = response.patient_phone_number;
                        const patientName = response.patient_first_name || 'Client';

                        const paymentUrl = createStripePaymentLink(usdtAmount);
                        if (paymentUrl) {
                            const smsMessage = `Hi ${patientName}, thank you for booking appointment with Wonder of Wellness, kindly pay on the link below to confirm your appointment ${paymentUrl}`;
                            console.log('[ElevenLabsController] SMS Message:', smsMessage);
                            await sendSMS(patientPhone, smsMessage);
                            console.log('[ElevenLabsController] Appointment and payment SMS sent successfully.');
                        }
                    }
                } catch (error) {
                    console.error('[ElevenLabsController] Error processing payment:', error);
                }
            } else {
                console.error('[ElevenLabsController] Failed to create appointment.');
            }
        }

        // After successful appointment creation, send confirmation via WebSocket
        if (conversationId && createdAppointment) {
            await sendToElevenlabs(conversationId, {
                type: 'appointment_confirmation',
                data: {
                    appointment_id: createdAppointment._id.toString(),
                    start_time: createdAppointment.start_time?.toISOString(),
                    finish_time: createdAppointment.finish_time?.toISOString(),
                    practitioner_id: createdAppointment.practitioner_id
                }
            });
        }

    } catch (error) {
        // Match FastAPI's HTTPException format
        if (error instanceof Error) {
            res.status(500).json({ detail: error.message });
        } else {
            res.status(500).json({ detail: 'An unexpected error occurred' });
        }
        return;
    }

    res.json({ received: true });
}; 