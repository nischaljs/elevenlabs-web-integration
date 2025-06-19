import { Router } from 'express';
import { listAppointments, getAppointment } from '../controllers/appointment.controller';

const router = Router();

// Routes matching FastAPI implementation exactly
router.get('/appointmentss', listAppointments);
router.get('/appointments/:id', getAppointment);

export default router; 