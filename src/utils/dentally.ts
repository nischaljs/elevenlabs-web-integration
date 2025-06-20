import axios from 'axios';
import { Patient } from '../models/patient.model';
import { Appointment, IAppointment } from '../models/appointment.model';
import logger from './logger';

const DENTALLY_API_KEY = process.env.DENTALLY_API_KEY;
const DENTALLY_BASE_URL = process.env.DENTALLY_BASE_URL;

const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DENTALLY_API_KEY}`,
    'User-Agent': 'MyApp/1.0' // Custom User-Agent required by Dentally
};

export const createPatientAndStore = async (patientData: any): Promise<any> => {
    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyUtils] Sending patient creation payload to Dentally:', JSON.stringify(patientData));
    }
    const url = `${DENTALLY_BASE_URL}/patients`;
    try {
        const response = await axios.post(url, patientData, { headers });
        if (process.env.NODE_ENV === 'development') {
            logger.info('[DentallyUtils] Dentally patient creation response:', JSON.stringify(response.data));
        }
        const apiResponse = response.data;
        const patient = apiResponse.patient;

        if (!patient) {
            logger.error(" API response does not contain 'patient' key.");
            return false;
        }

        // Save to MongoDB
        await Patient.create(patient);
        logger.info(" Patient created and stored in MongoDB.");
        return response.data;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            logger.error('[DentallyUtils] Error from Dentally patient creation:', error || error);
        }
        logger.error(" Failed to create patient:", error);
        throw error;
    }
};

export const createAppointmentAndStore = async (appointmentData: any): Promise<IAppointment | null> => {
    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyUtils] Sending appointment creation payload to Dentally:', JSON.stringify(appointmentData));
    }
    const url = `${DENTALLY_BASE_URL}/appointments`;
    try {
        const response = await axios.post(url, appointmentData, { headers });
        if (process.env.NODE_ENV === 'development') {
            logger.info('[DentallyUtils] Dentally appointment creation response:', JSON.stringify(response.data));
        }
        const apiResponse = response.data;
        const appointment = apiResponse.appointment;

        if (!appointment) {
            logger.error(" API response does not contain 'appointment' key.");
            return null;
        }

        // Save to MongoDB
        const createdAppointment = await Appointment.create(appointment);
        logger.info(" Appointment created and stored in MongoDB.");
        return createdAppointment;
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            logger.error('[DentallyUtils] Error from Dentally appointment creation:', error);
        }
        logger.error(" Failed to create appointment:", error);
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
        logger.error('[DentallyUtils] Error fetching availability:', response.status, response.data);
        return [];
    } catch (error) {
        logger.error('[DentallyUtils] Error fetching availability:', error);
        return [];
    }
}; 