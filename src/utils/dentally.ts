import axios from 'axios';
import { Patient } from '../models/patient.model';
import { Appointment, IAppointment } from '../models/appointment.model';

const DENTALLY_API_KEY = process.env.DENTALLY_API_KEY;
const DENTALLY_BASE_URL = process.env.DENTALLY_BASE_URL;

const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DENTALLY_API_KEY}`
};

export const createPatientAndStore = async (patientData: any): Promise<any> => {
    const url = `${DENTALLY_BASE_URL}/patients`;
    try {
        const response = await axios.post(url, patientData, { headers });
        const apiResponse = response.data;
        const patient = apiResponse.patient;

        if (!patient) {
            console.error(" API response does not contain 'patient' key.");
            return false;
        }

        // Save to MongoDB
        await Patient.create(patient);
        console.log(" Patient created and stored in MongoDB.");
        return patient;
    } catch (error) {
        console.error(" Failed to create patient:", error);
        return false;
    }
};

export const createAppointmentAndStore = async (appointmentData: any): Promise<IAppointment | null> => {
    const url = `${DENTALLY_BASE_URL}/appointments`;
    try {
        const response = await axios.post(url, appointmentData, { headers });
        const apiResponse = response.data;
        const appointment = apiResponse.appointment;

        if (!appointment) {
            console.error(" API response does not contain 'appointment' key.");
            return null;
        }

        // Save to MongoDB
        const createdAppointment = await Appointment.create(appointment);
        console.log(" Appointment created and stored in MongoDB.");
        return createdAppointment;
    } catch (error) {
        console.error(" Failed to create appointment:", error);
        return null;
    }
};

export const getAvailabilityFromDentally = async (
    practitionerIds: number[],
    startTime: string,
    finishTime: string,
    duration: number = 60
) => {
    try {
        const response = await axios.get(`${DENTALLY_BASE_URL}/appointments/availability`, {
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
    } catch (error) {
        console.error('[DentallyUtils] Error fetching availability:', error);
        return [];
    }
}; 