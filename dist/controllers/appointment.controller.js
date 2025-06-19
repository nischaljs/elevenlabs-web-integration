"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAppointment = exports.getAppointment = exports.listAppointments = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const appointment_model_1 = require("../models/appointment.model");
const listAppointments = async (req, res) => {
    try {
        const appointments = await appointment_model_1.Appointment.find().limit(100);
        res.status(200).json({ results: appointments });
    }
    catch (error) {
        console.error('[AppointmentController] Error listing appointments:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};
exports.listAppointments = listAppointments;
const getAppointment = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            res.status(400).json({ detail: 'Invalid ObjectId' });
            return;
        }
        const appointment = await appointment_model_1.Appointment.findById(id);
        if (!appointment) {
            res.status(404).json({ detail: 'Appointment not found' });
            return;
        }
        res.status(200).json(appointment);
    }
    catch (error) {
        console.error('[AppointmentController] Error getting appointment:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};
exports.getAppointment = getAppointment;
const createAppointment = async (req, res, next) => {
    try {
        const appointment = await appointment_model_1.Appointment.create(req.body);
        res.status(201).json(appointment);
    }
    catch (error) {
        next(error);
    }
};
exports.createAppointment = createAppointment;
