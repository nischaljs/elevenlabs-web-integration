import { Request, Response } from 'express';
import { OpenAIModel } from '../utils/chatgpt';
import { createAppointmentAndStore, createPatientAndStore, getAvailabilityFromDentally } from '../utils/dentally';
import { verifyElevenLabsWebhookSignature } from '../utils/elevenlabs';
import { createStripePaymentLink, sendSMS } from '../utils/sms';
import { startWebSocketConnection, stopWebSocketConnection, sendToElevenlabs } from '../utils/websockets';
import { IAppointment } from '../models/appointment.model';
import logForDev from '../utils/logger';
import {
  fetchActivePractitioners,
  shufflePractitioners,
  batchCheckAvailability,
  findFirstAvailableOrRecommend
} from '../utils/availabilityUtils';

const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

interface AvailabilitySlot {
    start_time: string;
    finish_time: string;
}

export const getPractitioners = async (req: Request, res: Response): Promise<void> => {
    try {
        logForDev('[getPractitioners] Fetching practitioners...');
        const practitionersRaw = await fetchActivePractitioners();
        logForDev('[getPractitioners] Practitioners fetched:', practitionersRaw.length);
        if (!practitionersRaw || practitionersRaw.length === 0) {
            res.json({ text: "Sorry, no active practitioners are currently available." });
            return;
        }
        // Log the first 10 practitioners' names and IDs
        practitionersRaw.slice(0, 10).forEach((doc: any, i: number) => {
            logForDev(`[getPractitioners] Practitioner #${i}:`, doc.user?.first_name, doc.user?.last_name, 'ID:', doc.id);
        });
        const formatted = practitionersRaw
            .map((doc: any) => `${doc.user?.first_name || ''} ${doc.user?.last_name || ''} (${doc.id})`)
            .join('; ');
        res.json({ text: `Here are the available practitioners: ${formatted}` });
    } catch (error) {
        logForDev('[getPractitioners] Error:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};

export const checkAvailableTime = async (req: Request, res: Response): Promise<void> => {
    const { practitioner_id, start_time, finish_time, duration } = req.params;
    logForDev(`[checkAvailableTime] Called with practitioner_id=${practitioner_id}, start_time=${start_time}, finish_time=${finish_time}, duration=${duration}`);
    // FastAPI-style parameter validation
    const practitionerId = parseInt(practitioner_id);
    if (isNaN(practitionerId)) {
        logForDev('[checkAvailableTime] practitioner_id must be a number');
        res.status(400).json({ detail: 'practitioner_id must be a number' });
        return;
    }
    const durationNum = parseInt(duration);
    if (isNaN(durationNum)) {
        logForDev('[checkAvailableTime] duration must be a number');
        res.status(400).json({ detail: 'duration must be a number' });
        return;
    }
    // Robust date parsing and correction
    let start = new Date(start_time);
    if (isNaN(start.getTime())) {
        logForDev('[checkAvailableTime] Invalid start_time, parsing fallback');
        start = new Date(Date.parse(start_time) || Date.now());
    }
    let finish = new Date(finish_time);
    if (isNaN(finish.getTime()) || (finish.getTime() - start.getTime()) < 24 * 60 * 60 * 1000) {
        logForDev('[checkAvailableTime] Invalid or too short finish_time, setting to start + 25h');
        finish = new Date(start.getTime() + 25 * 60 * 60 * 1000);
    }
    const startISO = start.toISOString();
    const finishISO = finish.toISOString();
    logForDev(`[checkAvailableTime] Parsed startISO=${startISO}, finishISO=${finishISO}`);
    try {
        const availabilityData = await getAvailabilityFromDentally(
            [practitionerId],
            startISO, 
            finishISO,
            durationNum
        );
        logForDev('[checkAvailableTime] Dentally availabilityData:', JSON.stringify(availabilityData));
        const slots = (availabilityData as any).availability || [];
        if (slots.length === 0) {
            logForDev('[checkAvailableTime] No available slots for this practitioner.');
            res.json({
                available_slots: '',
                message: 'No available slots for this practitioner in the requested window.'
            });
            return;
        }
        // Check if requested time is available
        const requestedStart = new Date(start_time).getTime();
        let requestedSlot = slots.find((slot: any) => new Date(slot.start_time).getTime() === requestedStart);
        if (requestedSlot) {
            logForDev('[checkAvailableTime] Requested time is available.');
            const slotTimes = slots.map((slot: AvailabilitySlot) => `${slot.start_time} to  ${slot.finish_time}`);
            const slotString = slotTimes.join(',');
            res.json({
                available_slots: slotString,
                message: 'Available time slots are'
            });
            return;
        }
        // If not available, recommend the closest slot
        let closestSlot = null;
        let minDiff = Infinity;
        for (const slot of slots) {
            const slotStart = new Date(slot.start_time).getTime();
            const diff = Math.abs(slotStart - requestedStart);
            if (diff < minDiff) {
                minDiff = diff;
                closestSlot = slot;
            }
        }
        logForDev('[checkAvailableTime] Requested time not available, recommending closest slot:', JSON.stringify(closestSlot));
        const slotTimes = slots.map((slot: AvailabilitySlot) => `${slot.start_time} to  ${slot.finish_time}`);
        const slotString = slotTimes.join(',');
        res.json({
            available_slots: slotString,
            message: 'Requested time not available. Here are other available slots.',
            recommended_slot: closestSlot ? {
                start_time: closestSlot.start_time,
                finish_time: closestSlot.finish_time
            } : null
        });
    } catch (error) {
        logForDev('[checkAvailableTime] Error:', error);
        res.status(500).json({ available_slots: " ", message: 'Something Went Wrong in Backend' });
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
    logForDev('--- createAppointment called ---');
    if (process.env.NODE_ENV === 'development') {
        logForDev('ENTER createAppointment');
        logForDev('Incoming request to create-appointment:', { headers: req.headers, body: req.body });
    }
    const signature = req.headers['x-elevenlabs-signature'] as string | undefined;
    const rawBody = JSON.stringify(req.body);
    logForDev('Signature:', signature);
    if (signature && !verifyElevenLabsWebhookSignature(rawBody, signature)) {
        logForDev('Invalid webhook signature');
        res.status(401).json({ detail: 'Invalid signature' });
        logForDev('Returned 401 for invalid signature');
        return;
    }

    const event = req.body;
    logForDev('Parsed event:', event);

    // --- Webhook path ---
    if (event?.type === 'post_call_transcription') {
        logForDev('Webhook path triggered');
        try {
            if (process.env.NODE_ENV === 'development') {
                logForDev('Event body:', JSON.stringify(event));
            }
            const data = event?.data ?? {};
            logForDev('Webhook data:', data);
            if (data?.agent_id !== ELEVENLABS_AGENT_ID) {
                logForDev('Agent ID mismatch:', data?.agent_id, ELEVENLABS_AGENT_ID);
                res.json({ received: true });
                logForDev('Returned early for agent ID mismatch');
                return;
            }
            // Start WebSocket connection for this conversation
            const conversationId = data?.conversation_id;
            if (conversationId) {
                logForDev('Starting WebSocket connection for conversation:', conversationId);
                startWebSocketConnection(conversationId);
            }
            const transcriptData = data?.transcript ?? '';
            logForDev('Transcript data:', transcriptData);
            const response :any = await OpenAIModel(transcriptData);
            logForDev('GPT response:', JSON.stringify(response));
            if (!response) {
                logForDev('WARNING: GPT response is empty for transcript:', transcriptData);
                res.json({ received: true });
                logForDev('Returned early for empty GPT response');
                return;
            }
            // Log missing required fields for appointment creation
            const requiredFields = ['appointment_start_time', 'appointment_finish_time', 'booked_practitioner_id'];
            const missingFields = requiredFields.filter(f => !response[f]);
            if (missingFields.length > 0) {
                logForDev('Missing required fields for appointment creation:', missingFields);
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
            logForDev('Formatted Patient Data:', patientData);
            if (process.env.NODE_ENV === 'development') {
                logForDev('About to call createPatientAndStore with:', JSON.stringify(patientData));
            }
            let createdPatient: any;
            try {
                createdPatient = await createPatientAndStore(patientData);
                logForDev('Created patient in Dentally:', JSON.stringify(createdPatient));
            } catch (dentallyPatientError) {
                logForDev('Error from Dentally (patient creation):', dentallyPatientError);
                throw dentallyPatientError;
            }
            let createdAppointment: IAppointment | null = null;
            const patientId = createdPatient?.id || createdPatient?.patient?.id;
            logForDev('Resolved patientId for appointment:', patientId);
            if (createdPatient && patientId) {
                const appointmentData = {
                    appointment: {
                        start_time: response?.appointment_start_time ?? '',
                        finish_time: response?.appointment_finish_time ?? '',
                        patient_id: patientId,
                        practitioner_id: response?.booked_practitioner_id ?? '',
                        reason: response?.appointment_reason ?? ''
                    }
                };
                logForDev('About to call createAppointmentAndStore with:', JSON.stringify(appointmentData));
                try {
                    createdAppointment = await createAppointmentAndStore(appointmentData);
                    logForDev('Created appointment in Dentally:', JSON.stringify(createdAppointment));
                } catch (dentallyAppointmentError) {
                    logForDev('Error from Dentally (appointment creation):', dentallyAppointmentError);
                    throw dentallyAppointmentError;
                }
                if (createdAppointment) {
                    try {
                        const usdtAmount = await getUsdtAmount(
                            response.patient_status,
                            response.consultation_type
                        );
                        logForDev('USDT amount:', usdtAmount);
                        if (usdtAmount) {
                            const patientPhone = response.patient_phone_number;
                            const patientName = response.patient_first_name || 'Client';
                            const paymentUrl = createStripePaymentLink(usdtAmount);
                            logForDev('Payment URL:', paymentUrl);
                            if (paymentUrl) {
                                const smsMessage = `Hi ${patientName}, thank you for booking appointment with Wonder of Wellness, kindly pay on the link below to confirm your appointment ${paymentUrl}`;
                                logForDev('SMS Message:', smsMessage);
                                await sendSMS(patientPhone, smsMessage);
                                logForDev('Appointment and payment SMS sent successfully.');
                            }
                        }
                    } catch (error) {
                        logForDev('Error processing payment:', error);
                    }
                } else {
                    logForDev('Failed to create appointment.');
                }
            } else {
                logForDev('No valid patientId, skipping appointment creation.');
            }
            // After successful appointment creation, send confirmation via WebSocket
            if (conversationId && createdAppointment) {
                logForDev('Sending appointment confirmation via WebSocket');
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
            logForDev('Final response to client:', { received: true, createdAppointment });
            if (createdAppointment) {
                res.json({ received: true, appointment: createdAppointment });
                logForDev('Returned appointment details to client');
            } else {
                res.json({ received: true, appointment: null });
                logForDev('Returned null appointment to client');
            }
        } catch (error) {
            logForDev('Error in createAppointment:', error);
            if (error instanceof Error) {
                res.status(500).json({ received: false, appointment: null, error: error.message });
                logForDev('Returned 500 error to client:', error.message);
            } else {
                res.status(500).json({ received: false, appointment: null, error: 'An unexpected error occurred' });
                logForDev('Returned 500 error to client: An unexpected error occurred');
            }
        }
        logForDev('Exiting webhook path');
        return;
    }

    // --- Direct API call path ---
    if (event?.patient_first_name && event?.booked_practitioner_id && event?.appointment_start_time) {
        logForDev('Direct API call path triggered');
        try {
            // Build patientData and appointmentData from event
            const patientData = {
                patient: {
                    title: event.patient_title ?? 'Mr',
                    first_name: event.patient_first_name ?? '',
                    last_name: event.patient_last_name ?? '',
                    date_of_birth: event.patient_dob ?? '',
                    gender: event.patient_gender ?? true,
                    ethnicity: event.patient_ethnicity ?? '',
                    address_line_1: event.patient_address_line_1 ?? '',
                    postcode: event.patient_postcode ?? '',
                    payment_plan_id: parseInt(event.patient_payment_plan_id ?? '0'),
                    payment_plan: [parseInt(event.patient_payment_plan_id ?? '0')],
                    email_address: event.patient_email ?? '',
                    mobile_phone: event.patient_phone_number ?? ''
                }
            };
            logForDev('Formatted Patient Data (direct):', patientData);
            let createdPatient: any;
            try {
                createdPatient = await createPatientAndStore(patientData);
                logForDev('Created patient in Dentally (direct):', JSON.stringify(createdPatient));
            } catch (dentallyPatientError) {
                logForDev('Error from Dentally (patient creation, direct):', dentallyPatientError);
                throw dentallyPatientError;
            }
            let createdAppointment: IAppointment | null = null;
            const patientIdDirect = createdPatient?.id || createdPatient?.patient?.id;
            logForDev('Resolved patientId for appointment (direct):', patientIdDirect);
            if (createdPatient && patientIdDirect) {
                const appointmentData = {
                    appointment: {
                        start_time: event.appointment_start_time ?? '',
                        finish_time: event.appointment_finish_time ?? '',
                        patient_id: patientIdDirect,
                        practitioner_id: event.booked_practitioner_id ?? '',
                        reason: event.appointment_reason ?? ''
                    }
                };
                logForDev('About to call createAppointmentAndStore (direct) with:', JSON.stringify(appointmentData));
                try {
                    createdAppointment = await createAppointmentAndStore(appointmentData);
                    logForDev('Created appointment in Dentally (direct):', JSON.stringify(createdAppointment));
                } catch (dentallyAppointmentError) {
                    logForDev('Error from Dentally (appointment creation, direct):', dentallyAppointmentError);
                    throw dentallyAppointmentError;
                }
                if (createdAppointment) {
                    try {
                        const usdtAmount = await getUsdtAmount(
                            event.patient_status,
                            event.consultation_type
                        );
                        logForDev('USDT amount (direct):', usdtAmount);
                        if (usdtAmount) {
                            const patientPhone = event.patient_phone_number;
                            const patientName = event.patient_first_name || 'Client';
                            const paymentUrl = createStripePaymentLink(usdtAmount);
                            logForDev('Payment URL (direct):', paymentUrl);
                            if (paymentUrl) {
                                const smsMessage = `Hi ${patientName}, thank you for booking appointment with Wonder of Wellness, kindly pay on the link below to confirm your appointment ${paymentUrl}`;
                                logForDev('SMS Message (direct):', smsMessage);
                                await sendSMS(patientPhone, smsMessage);
                                logForDev('Appointment and payment SMS sent successfully (direct).');
                            }
                        }
                    } catch (error) {
                        logForDev('Error processing payment (direct):', error);
                    }
                } else {
                    logForDev('Failed to create appointment (direct).');
                }
            } else {
                logForDev('No valid patientId (direct), skipping appointment creation.');
            }
            logForDev('Final response to client (direct):', { received: true, createdAppointment });
            if (createdAppointment) {
                res.json({ received: true, appointment: createdAppointment });
                logForDev('Returned appointment details to client (direct)');
            } else {
                res.json({ received: true, appointment: null });
                logForDev('Returned null appointment to client (direct)');
            }
        } catch (error) {
            logForDev('Error in createAppointment (direct):', error);
            if (error instanceof Error) {
                res.status(500).json({ received: false, appointment: null, error: error.message });
                logForDev('Returned 500 error to client (direct):', error.message);
            } else {
                res.status(500).json({ received: false, appointment: null, error: 'An unexpected error occurred' });
                logForDev('Returned 500 error to client (direct): An unexpected error occurred');
            }
        }
        logForDev('Exiting direct API call path');
        return;
    }

    logForDev('Invalid payload format, returning 400');
    res.status(400).json({ received: false, error: 'Invalid payload format' });
};

// New: Get first available practitioner for a given time, duration, and service
export const getFirstAvailablePractitioner = async (req: Request, res: Response): Promise<void> => {
    let { start_time, duration, service_id } = req.body;
    if (!start_time || !service_id) {
        res.status(400).json({ detail: 'Missing required fields: start_time, service_id' });
        return;
    }
    // Validate that start_time is in the future
    const now = new Date();
    const startDate = new Date(start_time);
    if (isNaN(startDate.getTime())) {
        res.status(400).json({ detail: 'Invalid start_time format' });
        return;
    }
    if (startDate <= now) {
        res.status(400).json({ detail: 'start_time must be in the future' });
        return;
    }
    // Default duration to 60 if not provided
    if (!duration) {
        duration = 60;
        logForDev('[getFirstAvailablePractitioner] duration not provided, defaulting to 60 minutes');
    }
    // Always set finish_time to 25 hours after start_time, ignore frontend value
    let finish_time = new Date(startDate.getTime() + 25 * 60 * 60 * 1000).toISOString();
    logForDev('[getFirstAvailablePractitioner] finish_time is set to 25 hours after start_time:', finish_time);
    try {
        logForDev('[getFirstAvailablePractitioner] Fetching practitioners...');
        let practitionersRaw = await fetchActivePractitioners();
        if (!practitionersRaw || practitionersRaw.length === 0) {
            res.status(404).json({ detail: 'No active practitioners found.' });
            return;
        }
        practitionersRaw = shufflePractitioners(practitionersRaw);
        const practitionerIds = practitionersRaw.map((doc: any) => doc.id);
        const availableSlots = await batchCheckAvailability(practitionerIds, start_time, finish_time, parseInt(duration));
        let result = findFirstAvailableOrRecommend(availableSlots, practitionersRaw, start_time);
        if (result.practitioner_id) {
            res.json({
                practitioner_id: result.practitioner_id,
                practitioner_name: result.practitioner_name,
                available_slots: result.available_slots,
                services: [1, 2, 3], // All services for now
            });
            return;
        }
        // If no slots, expand window by 7 days and try again
        if (!result.recommended_slot) {
            logForDev('[getFirstAvailablePractitioner] No slots in window, expanding by 7 days...');
            const widerFinish = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
            const widerSlots = await batchCheckAvailability(practitionerIds, start_time, widerFinish, parseInt(duration));
            result = findFirstAvailableOrRecommend(widerSlots, practitionersRaw, start_time);
        }
        if (result.recommended_slot) {
            res.status(404).json({
                detail: 'No available slots for any practitioner in the requested window.',
                recommended_slot: result.recommended_slot
            });
            return;
        }
        res.status(404).json({ detail: 'No available slots for any practitioner in the requested window.' });
    } catch (error) {
        logForDev('Error in getFirstAvailablePractitioner:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};

// New: Create patient and book appointment in one step
export const createPatientAndBookAppointment = async (req: Request, res: Response): Promise<void> => {
    let { patient, appointment } = req.body;

    // If not nested, try to transform from flat structure
    if (!patient || !appointment) {
        const flat = req.body;
        // Check for flat keys
        const hasFlatPatient = Object.keys(flat).some(key => key.startsWith('patient_'));
        const hasFlatAppointment = Object.keys(flat).some(key => key.startsWith('appointment_'));
        if (hasFlatPatient && hasFlatAppointment) {
            patient = {
                first_name: flat.patient_first_name,
                last_name: flat.patient_last_name,
                date_of_birth: flat.patient_date_of_birth,
                address_line_1: flat.patient_address_line_1,
                postcode: flat.patient_postcode,
                mobile_phone: flat.patient_mobile_phone,
                email_address: flat.patient_email_address,
                title: flat.patient_title
            };
            appointment = {
                practitioner_id: flat.appointment_practitioner_id,
                start_time: flat.appointment_start_time,
                finish_time: flat.appointment_finish_time,
                reason: flat.appointment_reason,
                service_id: flat.appointment_service_id
            };
        }
    }
    if (!patient || !appointment) {
        res.status(400).json({ detail: 'Missing required fields: patient, appointment' });
        return;
    }
    // Only require these fields from user (gender is NOT required)
    const {
        first_name,
        last_name,
        date_of_birth,
        address_line_1,
        postcode,
        mobile_phone
    } = patient;
    if (!first_name || !last_name || !date_of_birth || !address_line_1 || !postcode || !mobile_phone) {
        res.status(400).json({ detail: 'Missing required patient fields: first_name, last_name, date_of_birth, address_line_1, postcode, mobile_phone' });
        return;
    }
    // Fill defaults for other fields, always set gender to true (male), ethnicity to '99', payment_plan_id and payment_plan to 1
    const planId = 44651;
    const patientPayload = {
        title: patient.title || 'Mr',
        first_name,
        last_name,
        date_of_birth,
        gender: true, // always set to true (male)
        ethnicity: '99', // default as requested
        address_line_1,
        postcode,
        payment_plan_id: planId,
        email_address: patient.email_address || '',
        mobile_phone,
    };
    try {
        // 1. Create patient in Dentally
        const createdPatient = await createPatientAndStore({ patient: patientPayload });
        const patientId = createdPatient?.id || createdPatient?.patient?.id;
        if (!patientId) {
            res.status(500).json({ detail: 'Failed to create patient or retrieve patient_id.' });
            return;
        }
        // 2. Book appointment with patient_id
        const appointmentData = {
            appointment: {
                ...appointment,
                patient_id: patientId
            }
        };
        const createdAppointment = await createAppointmentAndStore(appointmentData);
        if (!createdAppointment) {
            res.status(500).json({ detail: 'Failed to create appointment.' });
            return;
        }
        res.status(201).json({ appointment: createdAppointment });
    } catch (error) {
        logForDev('Error in createPatientAndBookAppointment:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
}; 