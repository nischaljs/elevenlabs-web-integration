"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const elevenlabs_controller_1 = require("../controllers/elevenlabs.controller");
const appointment_schema_1 = require("../schemas/appointment.schema");
const validation_middleware_1 = require("../middleware/validation.middleware");
const router = (0, express_1.Router)();
// Routes matching FastAPI implementation exactly
router.get('/practitioners', elevenlabs_controller_1.getPractitioners);
router.get('/check-available-time/:practitioner_id/:start_time/:finish_time/:duration', elevenlabs_controller_1.checkAvailableTime);
router.post('/create-appointment', (0, validation_middleware_1.validate)(appointment_schema_1.appointmentCreateSchema), elevenlabs_controller_1.createAppointment);
exports.default = router;
