"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const dentally_controller_1 = require("../controllers/dentally.controller");
const validation_middleware_1 = require("../middleware/validation.middleware");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)();
// Simple Zod schema for file upload validation
const fileUploadSchema = zod_1.z.object({
    file: zod_1.z.any()
});
// Routes matching FastAPI implementation exactly
router.get('/fetch-all-dentally-appointments/:date', dentally_controller_1.getAllDentallyAppointments);
router.post('/upload-practitioners-excel-file/', upload.single('file'), (0, validation_middleware_1.validate)(fileUploadSchema), dentally_controller_1.uploadPractitionerExcel);
router.post('/upload-practitioners-mapping-excel-file/', upload.single('file'), (0, validation_middleware_1.validate)(fileUploadSchema), dentally_controller_1.uploadMappingExcel);
router.post('/sync/payment-plans', dentally_controller_1.syncPaymentPlans);
exports.default = router;
