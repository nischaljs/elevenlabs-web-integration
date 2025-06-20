import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Appointment } from '../models/appointment.model';
import logger from '../utils/logger';

export const listAppointments = async (req: Request, res: Response): Promise<void> => {
    try {
        const appointments = await Appointment.find().limit(100);
        if (process.env.NODE_ENV === 'development') {
            logger.info('[AppointmentController] Final response to client:', { results: appointments });
        }
        res.status(200).json({ results: appointments });
    } catch (error) {
        logger.error('[AppointmentController] Error listing appointments:', error);
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

        if (process.env.NODE_ENV === 'development') {
            logger.info('[AppointmentController] Final response to client:', appointment);
        }
        res.status(200).json(appointment);
    } catch (error) {
        logger.error('[AppointmentController] Error getting appointment:', error);
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
        if (process.env.NODE_ENV === 'development') {
            logger.info('[AppointmentController] Final response to client:', appointment);
        }
        res.status(201).json(appointment);
    } catch (error) {
        next(error);
    }
}; 