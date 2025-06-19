import { Router } from 'express';
import multer from 'multer';
import {
    getAllDentallyAppointments,
    uploadPractitionerExcel,
    uploadMappingExcel,
    syncPaymentPlans
} from '../controllers/dentally.controller';
import { validate } from '../middleware/validation.middleware';
import { z } from 'zod';

const router = Router();
const upload = multer();

// Simple Zod schema for file upload validation
const fileUploadSchema = z.object({
  file: z.any()
});

// Routes matching FastAPI implementation exactly
router.get('/fetch-all-dentally-appointments/:date', getAllDentallyAppointments);
router.post('/upload-practitioners-excel-file/', upload.single('file'), validate(fileUploadSchema), uploadPractitionerExcel);
router.post('/upload-practitioners-mapping-excel-file/', upload.single('file'), validate(fileUploadSchema), uploadMappingExcel);
router.post('/sync/payment-plans', syncPaymentPlans);

export default router; 