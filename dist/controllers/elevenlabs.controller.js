"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAppointment = exports.checkAvailableTime = exports.getPractitioners = void 0;
const practitioner_model_1 = require("../models/practitioner.model");
const chatgpt_1 = require("../utils/chatgpt");
const dentally_1 = require("../utils/dentally");
const elevenlabs_1 = require("../utils/elevenlabs");
const sms_1 = require("../utils/sms");
const websockets_1 = require("../utils/websockets");
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const getPractitioners = async (req, res) => {
    try {
        const practitioners = await practitioner_model_1.Practitioner.find({ active: true }).limit(15);
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
    }
    catch (error) {
        console.error('[ElevenLabsController] Error getting practitioners:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};
exports.getPractitioners = getPractitioners;
const checkAvailableTime = async (req, res) => {
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
        const availabilityData = await (0, dentally_1.getAvailabilityFromDentally)([practitionerId], start_time, finish_time, durationNum);
        if (!availabilityData.availability) {
            res.json({
                available_slots: '',
                message: 'You can book an appointment with this practitioner at any time slot.You Want'
            });
            return;
        }
        const slotTimes = availabilityData.availability.map((slot) => `${slot.start_time} to  ${slot.finish_time}`);
        const slotString = slotTimes.join(',');
        res.json({
            available_slots: slotString,
            message: 'Available time slots are'
        });
    }
    catch (error) {
        // Match FastAPI's error response format
        res.status(500).json({ detail: 'Something Went Wrong in Backend' });
    }
};
exports.checkAvailableTime = checkAvailableTime;
const getUsdtAmount = async (patientType, consultation) => {
    if (patientType === 'New') {
        if (consultation === 'Biological Consultation')
            return 75;
        if (consultation === 'General Consultation')
            return 50;
        if (consultation === 'Hygiene Appointment')
            return 50;
        return 75;
    }
    else if (patientType === 'Existing') {
        if (consultation === 'Biological Consultation')
            return 50;
        if (consultation === 'General Consultation')
            return 50;
        if (consultation === 'Hygiene Appointment')
            return 50;
        return 50;
    }
    return 50;
};
const createAppointment = async (req, res) => {
    const signature = req.headers['x-elevenlabs-signature'];
    // Match FastAPI's raw body handling
    const rawBody = JSON.stringify(req.body);
    if (signature && !(0, elevenlabs_1.verifyElevenLabsWebhookSignature)(rawBody, signature)) {
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
            (0, websockets_1.startWebSocketConnection)(conversationId);
        }
        const transcriptData = data?.transcript ?? '';
        const response = await (0, chatgpt_1.OpenAIModel)(transcriptData);
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
        const createdPatient = await (0, dentally_1.createPatientAndStore)(patientData);
        let createdAppointment = null;
        if (createdPatient && createdPatient.id) {
            appointmentData.appointment.patient_id = createdPatient.id;
            createdAppointment = await (0, dentally_1.createAppointmentAndStore)(appointmentData);
            if (createdAppointment) {
                try {
                    const usdtAmount = await getUsdtAmount(response.patient_status, response.consultation_type);
                    if (usdtAmount) {
                        const patientPhone = response.patient_phone_number;
                        const patientName = response.patient_first_name || 'Client';
                        const paymentUrl = (0, sms_1.createStripePaymentLink)(usdtAmount);
                        if (paymentUrl) {
                            const smsMessage = `Hi ${patientName}, thank you for booking appointment with Wonder of Wellness, kindly pay on the link below to confirm your appointment ${paymentUrl}`;
                            console.log('[ElevenLabsController] SMS Message:', smsMessage);
                            await (0, sms_1.sendSMS)(patientPhone, smsMessage);
                            console.log('[ElevenLabsController] Appointment and payment SMS sent successfully.');
                        }
                    }
                }
                catch (error) {
                    console.error('[ElevenLabsController] Error processing payment:', error);
                }
            }
            else {
                console.error('[ElevenLabsController] Failed to create appointment.');
            }
        }
        // After successful appointment creation, send confirmation via WebSocket
        if (conversationId && createdAppointment) {
            await (0, websockets_1.sendToElevenlabs)(conversationId, {
                type: 'appointment_confirmation',
                data: {
                    appointment_id: createdAppointment._id.toString(),
                    start_time: createdAppointment.start_time?.toISOString(),
                    finish_time: createdAppointment.finish_time?.toISOString(),
                    practitioner_id: createdAppointment.practitioner_id
                }
            });
        }
    }
    catch (error) {
        // Match FastAPI's HTTPException format
        if (error instanceof Error) {
            res.status(500).json({ detail: error.message });
        }
        else {
            res.status(500).json({ detail: 'An unexpected error occurred' });
        }
        return;
    }
    res.json({ received: true });
};
exports.createAppointment = createAppointment;
