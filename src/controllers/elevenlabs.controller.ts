import { Request, Response } from 'express';
import { Practitioner } from '../models/practitioner.model';
import { OpenAIModel } from '../utils/chatgpt';
import { createAppointmentAndStore, createPatientAndStore, getAvailabilityFromDentally } from '../utils/dentally';
import { verifyElevenLabsWebhookSignature } from '../utils/elevenlabs';
import { createStripePaymentLink, sendSMS } from '../utils/sms';
import { startWebSocketConnection, stopWebSocketConnection, sendToElevenlabs } from '../utils/websockets';
import { IAppointment } from '../models/appointment.model';
import logger from '../utils/logger';

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
        logger.error('[ElevenLabsController] Error getting practitioners:', error);
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

    // Robust date parsing and correction
    let start = new Date(start_time);
    if (isNaN(start.getTime())) {
        // Try parsing as local date, fallback to now
        start = new Date(Date.parse(start_time) || Date.now());
    }
    let finish = new Date(finish_time);
    if (isNaN(finish.getTime()) || (finish.getTime() - start.getTime()) < 24 * 60 * 60 * 1000) {
        // If finish_time is invalid or window < 24h, set finish_time to start_time + 25h
        finish = new Date(start.getTime() + 25 * 60 * 60 * 1000);
    }
    // Convert both to ISO8601 with timezone (toISOString gives Zulu/UTC)
    const startISO = start.toISOString();
    const finishISO = finish.toISOString();

    try {
        const availabilityData = await getAvailabilityFromDentally(
            [practitionerId],
            startISO,
            finishISO,
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
    if (process.env.NODE_ENV === 'development') {
        logger.info('[ElevenLabsController] ENTER createAppointment');
        logger.info('[ElevenLabsController] Incoming request to create-appointment:', { headers: req.headers, body: req.body });
    }
    const signature = req.headers['x-elevenlabs-signature'] as string | undefined;
    
    // Match FastAPI's raw body handling
    const rawBody = JSON.stringify(req.body);
    if (signature && !verifyElevenLabsWebhookSignature(rawBody, signature)) {
        res.status(401).json({ detail: 'Invalid signature' });
        return;
    }

    try {
        const event = req.body;
        if (process.env.NODE_ENV === 'development') {
            logger.info('[ElevenLabsController] Event body:', JSON.stringify(event));
        }
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
        const response :any = await OpenAIModel(transcriptData);
        if (process.env.NODE_ENV === 'development') {
            logger.info('[ElevenLabsController] GPT response:', JSON.stringify(response));
        }
        if (!response) {
            logger.warn('[ElevenLabsController] WARNING: GPT response is empty for transcript:', transcriptData);
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

        logger.info('[ElevenLabsController] Formatted Patient Data:', patientData);

        if (process.env.NODE_ENV === 'development') {
            logger.info('[ElevenLabsController] About to call createPatientAndStore with:', JSON.stringify(patientData));
        }
        let createdPatient: any;
        try {
            createdPatient = await createPatientAndStore(patientData);
            if (process.env.NODE_ENV === 'development') {
                logger.info('[ElevenLabsController] Created patient in Dentally:', JSON.stringify(createdPatient));
            }
        } catch (dentallyPatientError) {
            if (process.env.NODE_ENV === 'development') {
                if (dentallyPatientError) {
                    logger.error('[ElevenLabsController] Error from Dentally (patient creation):', JSON.stringify(dentallyPatientError));
                } else {
                    logger.error('[ElevenLabsController] Error from DB or other (patient creation):', dentallyPatientError);
                }
            }
            throw dentallyPatientError;
        }
        let createdAppointment: IAppointment | null = null;

        if (createdPatient && createdPatient.id) {
            appointmentData.appointment.patient_id = createdPatient.id;

            if (process.env.NODE_ENV === 'development') {
                logger.info('[ElevenLabsController] About to call createAppointmentAndStore with:', JSON.stringify(appointmentData));
            }
            try {
                createdAppointment = await createAppointmentAndStore(appointmentData);
                if (process.env.NODE_ENV === 'development') {
                    logger.info('[ElevenLabsController] Created appointment in Dentally:', JSON.stringify(createdAppointment));
                }
            } catch (dentallyAppointmentError) {
                if (process.env.NODE_ENV === 'development') {
                    if (dentallyAppointmentError) {
                        logger.error('[ElevenLabsController] Error from Dentally (appointment creation):', JSON.stringify(dentallyAppointmentError));
                    } else {
                        logger.error('[ElevenLabsController] Error from DB or other (appointment creation):', dentallyAppointmentError);
                    }
                }
                throw dentallyAppointmentError;
            }
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
                            logger.info('[ElevenLabsController] SMS Message:', smsMessage);
                            await sendSMS(patientPhone, smsMessage);
                            logger.info('[ElevenLabsController] Appointment and payment SMS sent successfully.');
                        }
                    }
                } catch (error) {
                    logger.error('[ElevenLabsController] Error processing payment:', error);
                }
            } else {
                logger.error('[ElevenLabsController] Failed to create appointment.');
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

        if (process.env.NODE_ENV === 'development') {
            logger.info('[ElevenLabsController] Final response to client:', { received: true });
        }
        res.json({ received: true });
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            logger.error('[ElevenLabsController] Error in createAppointment:', error);
        }
        // Match FastAPI's HTTPException format
        if (error instanceof Error) {
            res.status(500).json({ detail: error.message });
        } else {
            res.status(500).json({ detail: 'An unexpected error occurred' });
        }
    }
}; 