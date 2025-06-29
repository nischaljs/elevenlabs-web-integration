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
    } catch (error: any) {
        if (error.response && error.response.data) {
            logger.error('[DentallyUtils] Error from Dentally patient creation:', error.response.data);
        } else {
            logger.error('[DentallyUtils] Error from Dentally patient creation:', error);
        }
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
            logger.error("API response does not contain 'appointment' key.");
            return null;
        }

        // Save to MongoDB
        const createdAppointment = await Appointment.create(appointment);
        logger.info('Appointment created and stored in MongoDB.');
        return createdAppointment;
    } catch (error: any) {
        // Human-readable error logging
        if (error.response && error.response.data && error.response.data.error) {
            const dentallyError = error.response.data.error;
            if (dentallyError.params && dentallyError.params.practitioner_id && Array.isArray(dentallyError.params.practitioner_id)) {
                if (dentallyError.params.practitioner_id.some((msg: string) => msg.includes('existing appointment'))) {
                    logger.error('Dentally: Practitioner already has an appointment in this period.');
                } else {
                    logger.error(`Dentally: Practitioner error: ${JSON.stringify(dentallyError.params.practitioner_id)}`);
                }
            } else {
                logger.error(`Dentally: ${dentallyError.message || 'Unknown error from Dentally.'}`);
            }
        } else if (error.message) {
            logger.error(`Dentally: ${error.message}`);
        } else {
            logger.error('Dentally: Unknown error occurred during appointment creation.');
        }
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
        // Build query string with repeated practitioner_ids[]
        const params = new URLSearchParams();
        practitionerIds.forEach(id => params.append('practitioner_ids[]', id.toString()));
        params.append('start_time', startTime);
        params.append('finish_time', finishTime);
        params.append('duration', duration.toString());
        const url = `${DENTALLY_BASE_URL}/appointments/availability?${params.toString()}`;
        logger.info('[DentallyUtils] Fetching availability with URL:', url);
        const response = await fetch(url, {
            method: 'GET',
            headers
        });
        if (!response.ok) {
            const errorText = await response.text();
            logger.error('[DentallyUtils] Error fetching availability:', response.status, errorText);
            return [];
        }
        const data = await response.json();
        logger.info('[Dentally response for availability check]', data);
        return data;
    } catch (error) {
        logger.error('[DentallyUtils] Error fetching availability:', error);
        return [];
    }
}; 