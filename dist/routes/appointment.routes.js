"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const appointment_controller_1 = require("../controllers/appointment.controller");
const router = (0, express_1.Router)();
// Routes matching FastAPI implementation exactly
router.get('/appointmentss', appointment_controller_1.listAppointments);
router.get('/appointments/:id', appointment_controller_1.getAppointment);
exports.default = router;
