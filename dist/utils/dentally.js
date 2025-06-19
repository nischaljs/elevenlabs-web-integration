"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailabilityFromDentally = exports.createAppointmentAndStore = exports.createPatientAndStore = void 0;
const axios_1 = __importDefault(require("axios"));
const patient_model_1 = require("../models/patient.model");
const appointment_model_1 = require("../models/appointment.model");
const DENTALLY_API_KEY = process.env.DENTALLY_API_KEY;
const DENTALLY_BASE_URL = process.env.DENTALLY_BASE_URL;
const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DENTALLY_API_KEY}`
};
const createPatientAndStore = async (patientData) => {
    const url = `${DENTALLY_BASE_URL}/patients`;
    try {
        const response = await axios_1.default.post(url, patientData, { headers });
        const apiResponse = response.data;
        const patient = apiResponse.patient;
        if (!patient) {
            console.error(" API response does not contain 'patient' key.");
            return false;
        }
        // Save to MongoDB
        await patient_model_1.Patient.create(patient);
        console.log(" Patient created and stored in MongoDB.");
        return patient;
    }
    catch (error) {
        console.error(" Failed to create patient:", error);
        return false;
    }
};
exports.createPatientAndStore = createPatientAndStore;
const createAppointmentAndStore = async (appointmentData) => {
    const url = `${DENTALLY_BASE_URL}/appointments`;
    try {
        const response = await axios_1.default.post(url, appointmentData, { headers });
        const apiResponse = response.data;
        const appointment = apiResponse.appointment;
        if (!appointment) {
            console.error(" API response does not contain 'appointment' key.");
            return null;
        }
        // Save to MongoDB
        const createdAppointment = await appointment_model_1.Appointment.create(appointment);
        console.log(" Appointment created and stored in MongoDB.");
        return createdAppointment;
    }
    catch (error) {
        console.error(" Failed to create appointment:", error);
        return null;
    }
};
exports.createAppointmentAndStore = createAppointmentAndStore;
const getAvailabilityFromDentally = async (practitionerIds, startTime, finishTime, duration = 60) => {
    try {
        const response = await axios_1.default.get(`${DENTALLY_BASE_URL}/appointments/availability`, {
            headers,
            params: {
                'practitioner_ids[]': practitionerIds,
                start_time: startTime,
                duration,
                finish_time: finishTime
            }
        });
        if (response.status === 200) {
            return response.data;
        }
        console.error('[DentallyUtils] Error fetching availability:', response.status, response.data);
        return [];
    }
    catch (error) {
        console.error('[DentallyUtils] Error fetching availability:', error);
        return [];
    }
};
exports.getAvailabilityFromDentally = getAvailabilityFromDentally;
