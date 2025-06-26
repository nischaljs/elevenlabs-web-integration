import { Router } from 'express';
import {
    getFirstAvailablePractitioner,
    createPatientAndBookAppointment
} from '../controllers/elevenlabs.controller';
import { apiKeyAuthMiddleware } from '../utils/apiKeyAuth';

const router = Router();

// Route 1: Get first available practitioner for a given time, duration, and service
router.post('/practitioners/available', apiKeyAuthMiddleware, getFirstAvailablePractitioner);

// Route 2: Create patient and book appointment in one step
router.post('/create-patient-and-book-appointment', apiKeyAuthMiddleware, createPatientAndBookAppointment);

export default router; 