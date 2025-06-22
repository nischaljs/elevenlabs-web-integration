import { Router } from 'express';
import {
    getPractitioners,
    checkAvailableTime,
    createAppointment,
    getFirstAvailablePractitioner,
    createPatientAndBookAppointment
} from '../controllers/elevenlabs.controller';
import { appointmentCreateSchema } from '../schemas/appointment.schema';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// Routes matching FastAPI implementation exactly
router.get('/practitioners', getPractitioners);
router.get('/check-available-time/:practitioner_id/:start_time/:finish_time/:duration', checkAvailableTime);
router.post('/create-appointment', validate(appointmentCreateSchema), createAppointment);
router.post('/practitioners/available', getFirstAvailablePractitioner);
router.post('/create-patient-and-book-appointment', createPatientAndBookAppointment);

export default router; 