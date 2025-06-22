import { Request, Response } from 'express';
import { Practitioner } from '../models/practitioner.model';
import { OpenAIModel } from '../utils/chatgpt';
import { createAppointmentAndStore, createPatientAndStore, getAvailabilityFromDentally } from '../utils/dentally';
import { verifyElevenLabsWebhookSignature } from '../utils/elevenlabs';
import { createStripePaymentLink, sendSMS } from '../utils/sms';
import { startWebSocketConnection, stopWebSocketConnection, sendToElevenlabs } from '../utils/websockets';
import { IAppointment } from '../models/appointment.model';
import logForDev from '../utils/logger';
import axios from 'axios';

const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

interface AvailabilitySlot {
    start_time: string;
    finish_time: string;
}

export const getPractitioners = async (req: Request, res: Response): Promise<void> => {
    try {
        // Fetch practitioners from Dentally API
        const dentallyApiKey = process.env.DENTALLY_API_KEY;
        const dentallyBaseUrl = process.env.DENTALLY_BASE_URL || 'https://api.dentally.co/v1';
        const siteId = process.env.DENTALLY_SITE_ID; // Use env variable for site ID
        const response = await axios.get(`${dentallyBaseUrl}/practitioners`, {
            headers: {
                'Authorization': `Bearer ${dentallyApiKey}`,
                'User-Agent': 'MyApp/1.0',
            },
            params: { site_id: siteId }
        });
        const practitionersRaw = response.data.practitioners || [];
        logForDev('Practitioners from Dentally:', JSON.stringify(practitionersRaw.slice(0, 5)));

        // Log the total number of practitioners received
        logForDev('Total practitioners from Dentally:', practitionersRaw.length);

        // Filter for active practitioners
        const activePractitioners = practitionersRaw.filter((doc: any) => doc.active === true);
        logForDev('Active practitioners count:', activePractitioners.length);

        // Log the first 10 active practitioners' names and IDs
        activePractitioners.slice(0, 10).forEach((doc: any, i: number) => {
          logForDev(`Active Practitioner #${i}:`, doc.user?.first_name, doc.user?.last_name, 'ID:', doc.id);
        });

        if (activePractitioners.length === 0) {
           // Fallback: fetch from local MongoDB
           const dbPractitioners = await Practitioner.find({ active: true }).lean();
           logForDev('Fetched active practitioners from DB:', dbPractitioners.length);
           if (dbPractitioners.length === 0) {
             res.json({ text: "Sorry, no active practitioners are currently available." });
             return;
           }
           const formattedDb = dbPractitioners
             .map((doc: any) => `${doc.user?.first_name || ''} ${doc.user?.last_name || ''} (${doc.id})`)
             .join('; ');
           res.json({ text: `Here are the available practitioners: ${formattedDb}` });
           return;
        }

        const formatted = activePractitioners
          .map((doc: any) => `${doc.user?.first_name || ''} ${doc.user?.last_name || ''} (${doc.id})`)
          .join('; ');

        res.json({ text: `Here are the available practitioners: ${formatted}` });
    } catch (error) {
        logForDev('Error getting practitioners from Dentally:', error);
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
        res.status(500).json({ available_slots: " ",message: 'Something Went Wrong in Backend' });
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
    const { start_time, finish_time, duration, service_id } = req.body;
    if (!start_time || !finish_time || !duration || !service_id) {
        res.status(400).json({ detail: 'Missing required fields: start_time, finish_time, duration, service_id' });
        return;
    }
    try {
        // 1. Fetch all active practitioners from Dentally
        const dentallyApiKey = process.env.DENTALLY_API_KEY;
        const dentallyBaseUrl = process.env.DENTALLY_BASE_URL || 'https://api.dentally.co/v1';
        const siteId = process.env.DENTALLY_SITE_ID;
        const response = await axios.get(`${dentallyBaseUrl}/practitioners`, {
            headers: {
                'Authorization': `Bearer ${dentallyApiKey}`,
                'User-Agent': 'MyApp/1.0',
            },
            params: { site_id: siteId }
        });
        let practitionersRaw = response.data.practitioners || [];
        // Filter for active practitioners
        practitionersRaw = practitionersRaw.filter((doc: any) => doc.active === true);
        if (practitionersRaw.length === 0) {
            res.status(404).json({ detail: 'No active practitioners found.' });
            return;
        }
        // 2. Shuffle the list
        for (let i = practitionersRaw.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [practitionersRaw[i], practitionersRaw[j]] = [practitionersRaw[j], practitionersRaw[i]];
        }
        // 3. Call getAvailabilityFromDentally with all IDs
        const practitionerIds = practitionersRaw.map((doc: any) => doc.id);
        const availabilityData = await getAvailabilityFromDentally(
            practitionerIds,
            start_time,
            finish_time,
            parseInt(duration)
        );
        // 4. Find the first available practitioner in the shuffled list
        const availableSlots = availabilityData.availability || [];
        // Map practitioner_id to available slot
        const availablePractitionerIds = new Set(availableSlots.map((slot: any) => slot.practitioner_id));
        const firstAvailable = practitionersRaw.find((doc: any) => availablePractitionerIds.has(doc.id));
        if (!firstAvailable) {
            res.status(404).json({ detail: 'No practitioners available at the requested time.' });
            return;
        }
        // 5. Return their ID and name
        res.json({
            practitioner_id: firstAvailable.id,
            practitioner_name: `${firstAvailable.user?.first_name || ''} ${firstAvailable.user?.last_name || ''}`.trim(),
            // For future extensibility:
            services: [1, 2, 3], // All services for now
        });
    } catch (error) {
        logForDev('Error in getFirstAvailablePractitioner:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};

// New: Create patient and book appointment in one step
export const createPatientAndBookAppointment = async (req: Request, res: Response): Promise<void> => {
    const { patient, appointment } = req.body;
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
    // Fill defaults for other fields, always set gender to true
    const patientPayload = {
        title: patient.title || 'Mr',
        first_name,
        last_name,
        date_of_birth,
        gender: true, // always set to true (male)
        ethnicity: '99', // default as requested
        address_line_1,
        postcode,
        payment_plan_id: patient.payment_plan_id || 1,
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