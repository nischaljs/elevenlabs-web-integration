import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Appointment } from '../models/appointment.model';

export const listAppointments = async (req: Request, res: Response): Promise<void> => {
    try {
        const appointments = await Appointment.find().limit(100);
        res.status(200).json({ results: appointments });
    } catch (error) {
        console.error('[AppointmentController] Error listing appointments:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};

export const getAppointment = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            res.status(400).json({ detail: 'Invalid ObjectId' });
            return;
        }

        const appointment = await Appointment.findById(id);
        
        if (!appointment) {
            res.status(404).json({ detail: 'Appointment not found' });
            return;
        }

        res.status(200).json(appointment);
    } catch (error) {
        console.error('[AppointmentController] Error getting appointment:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};

export const createAppointment = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const appointment = await Appointment.create(req.body);
        res.status(201).json(appointment);
    } catch (error) {
        next(error);
    }
}; 