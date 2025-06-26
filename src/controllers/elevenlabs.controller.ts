import { Request, Response } from 'express';
import { createAppointmentAndStore, createPatientAndStore, getAvailabilityFromDentally } from '../utils/dentally';
import logger from '../utils/logger';
import {
  fetchActivePractitioners,
  shufflePractitioners,
  batchCheckAvailability,
  findFirstAvailableOrRecommend
} from '../utils/availabilityUtils';

// Get first available practitioner for a given time, duration, and service
export const getFirstAvailablePractitioner = async (req: Request, res: Response): Promise<void> => {
    let { start_time, duration, service_id } = req.body;
    if (!start_time || !service_id) {
        res.status(400).json({ detail: 'Missing required fields: start_time, service_id' });
        return;
    }
    const now = new Date();
    const startDate = new Date(start_time);
    if (isNaN(startDate.getTime())) {
        res.status(400).json({ detail: 'Invalid start_time format' });
        return;
    }
    if (startDate <= now) {
        res.status(400).json({ detail: 'start_time must be in the future' });
        return;
    }
    if (!duration) {
        duration = 60;
        logger.info('[getFirstAvailablePractitioner] duration not provided, defaulting to 60 minutes');
    }
    try {
        logger.info('[getFirstAvailablePractitioner] Fetching practitioners...');
        let practitionersRaw = await fetchActivePractitioners();
        let practitionersFiltered = [];
        let source = 'dentally';
        if (!practitionersRaw || practitionersRaw.length === 0) {
            logger.info('[getFirstAvailablePractitioner] No active practitioners from Dentally, falling back to MongoDB...');
            const { Practitioner } = require('../models/practitioner.model');
            practitionersRaw = await Practitioner.find({ active: true, services: service_id }).lean();
            source = 'db';
        } else {
            // Cross-reference Dentally practitioners with DB to get their services
            const { Practitioner } = require('../models/practitioner.model');
            const dentallyIds = practitionersRaw.map((doc: any) => doc.id);
            const dbPractitioners = await Practitioner.find({ id: { $in: dentallyIds } }).lean();
            const dbPractitionerMap = new Map(dbPractitioners.map((p: any) => [p.id, p]));
            practitionersFiltered = practitionersRaw.filter((doc: any) => {
                const dbDoc = dbPractitionerMap.get(doc.id) as { services?: number[] } | undefined;
                return dbDoc && Array.isArray(dbDoc.services) && dbDoc.services.includes(Number(service_id));
            }).map((doc: any) => {
                const dbDoc = dbPractitionerMap.get(doc.id) as { services?: number[] } | undefined;
                return { ...doc, services: dbDoc?.services };
            });
            logger.info(`[getFirstAvailablePractitioner] Practitioners from Dentally cross-referenced with DB and filtered by service_id=${service_id}:`, practitionersFiltered.map((p: any) => ({ id: p.id, name: p.user?.first_name + ' ' + p.user?.last_name, services: p.services })));
        }
        if (source === 'dentally') {
            if (!practitionersFiltered || practitionersFiltered.length === 0) {
                logger.info(`[getFirstAvailablePractitioner] No practitioners from Dentally provide service_id=${service_id}, falling back to DB...`);
                const { Practitioner } = require('../models/practitioner.model');
                practitionersFiltered = await Practitioner.find({ active: true, services: service_id }).lean();
                source = 'db';
            }
        } else {
            practitionersFiltered = practitionersRaw;
            logger.info(`[getFirstAvailablePractitioner] Practitioners from DB filtered by service_id=${service_id}:`, practitionersFiltered.map((p: any) => ({ id: p.id, name: p.user?.first_name + ' ' + p.user?.last_name, services: p.services })));
        }
        if (!practitionersFiltered || practitionersFiltered.length === 0) {
            res.status(404).json({ detail: 'No practitioners found for the requested service.' });
            return;
        }
        // Calculate window
        let windowStart = new Date(Math.max(startDate.getTime() - 12 * 60 * 60 * 1000, now.getTime() + 60 * 60 * 1000));
        let windowEnd = new Date(startDate.getTime() + 25 * 60 * 60 * 1000);
        logger.info(`[getFirstAvailablePractitioner] Checking availability from ${windowStart.toISOString()} to ${windowEnd.toISOString()} for practitioners:`, practitionersFiltered.map((p: any) => ({ id: p.id, name: p.user?.first_name + ' ' + p.user?.last_name })));
        let foundSlots = [];
        let exactMatch = null;
        let expanded = false;
        let attempt = 1;
        while (true) {
            const practitionerIds = practitionersFiltered.map((doc: any) => doc.id);
            const availableSlots = await batchCheckAvailability(practitionerIds, windowStart.toISOString(), windowEnd.toISOString(), parseInt(duration));
            logger.info(`[getFirstAvailablePractitioner] [Attempt ${attempt}] Available slots:`, availableSlots);
            // Group slots by practitioner
            const slotsByPractitioner: Record<string, any[]> = {};
            for (const slot of availableSlots) {
                if (!slotsByPractitioner[slot.practitioner_id]) slotsByPractitioner[slot.practitioner_id] = [];
                // Only include slots not in the past
                if (new Date(slot.start_time) >= now) {
                    slotsByPractitioner[slot.practitioner_id].push(slot);
                }
                // Check for exact match
                if (slot.start_time === start_time) {
                    exactMatch = slot;
                }
            }
            if (exactMatch) {
                logger.info(`[getFirstAvailablePractitioner] Exact match found:`, exactMatch);
                res.json({
                    message: 'Exact slot available',
                    slot: exactMatch,
                    practitioner_id: exactMatch.practitioner_id
                });
                return;
            }
            // If any slots found, return grouped by practitioner
            if (Object.keys(slotsByPractitioner).length > 0) {
                // Find slots on the same day as requested time
                const requestedDay = startDate.toISOString().split('T')[0];
                const recommended: any[] = [];
                for (const [practitionerId, slots] of Object.entries(slotsByPractitioner)) {
                    const sameDaySlots = slots.filter(slot => slot.start_time.startsWith(requestedDay));
                    if (sameDaySlots.length > 0) {
                        recommended.push({ practitioner_id: practitionerId, slots: sameDaySlots });
                    }
                }
                if (recommended.length > 0) {
                    logger.info(`[getFirstAvailablePractitioner] Recommended slots on requested day:`, recommended);
                    res.json({
                        message: 'No exact slot, here are available slots on the requested day',
                        recommended
                    });
                    return;
                }
                // Otherwise, return all slots in window
                logger.info(`[getFirstAvailablePractitioner] No slots on requested day, returning all available slots in window:`, slotsByPractitioner);
                res.json({
                    message: 'No slots on requested day, here are all available slots in the window',
                    slotsByPractitioner
                });
                return;
            }
            // If no slots, expand window by 25h and repeat
            windowStart = new Date(windowEnd.getTime());
            windowEnd = new Date(windowStart.getTime() + 25 * 60 * 60 * 1000);
            logger.info(`[getFirstAvailablePractitioner] No slots found, expanding window to ${windowStart.toISOString()} - ${windowEnd.toISOString()}`);
            attempt++;
            if (attempt > 5) {
                res.json({
                    message: `No available slots for any practitioner after searching ${attempt} windows (about ${attempt * 25} hours).`,
                    available_times: []
                });
                return;
            }
        }
    } catch (error) {
        logger.error('Error in getFirstAvailablePractitioner:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};

// Create patient and book appointment in one step
export const createPatientAndBookAppointment = async (req: Request, res: Response): Promise<void> => {
    let { patient, appointment } = req.body;

    // If not nested, try to transform from flat structure
    if (!patient || !appointment) {
        const flat = req.body;
        // Check for flat keys
        const hasFlatPatient = Object.keys(flat).some(key => key.startsWith('patient_'));
        const hasFlatAppointment = Object.keys(flat).some(key => key.startsWith('appointment_'));
        
        if (hasFlatPatient && hasFlatAppointment) {
            patient = {
                first_name: flat.patient_first_name,
                last_name: flat.patient_last_name,
                date_of_birth: flat.patient_date_of_birth,
                address_line_1: flat.patient_address_line_1,
                postcode: flat.patient_postcode,
                mobile_phone: flat.patient_mobile_phone,
                email_address: flat.patient_email_address,
                title: flat.patient_title
            };
            appointment = {
                practitioner_id: flat.appointment_practitioner_id,
                start_time: flat.appointment_start_time,
                finish_time: flat.appointment_finish_time,
                reason: flat.appointment_reason,
                service_id: flat.appointment_service_id
            };
        }
    }
    
    if (!patient || !appointment) {
        res.status(400).json({ detail: 'Missing required fields: patient, appointment' });
        return;
    }
    
    // Validate required patient fields
    const {
        first_name,
        last_name,
        date_of_birth,
        address_line_1,
        postcode,
        mobile_phone
    } = patient;
    
    if (!first_name || !last_name || !date_of_birth || !address_line_1 || !postcode || !mobile_phone) {
        res.status(400).json({ 
            detail: 'Missing required patient fields: first_name, last_name, date_of_birth, address_line_1, postcode, mobile_phone' 
        });
        return;
    }
    
    // Fill defaults for other fields
    const planId = 44651;
    const patientPayload = {
        title: patient.title || 'Mr',
        first_name,
        last_name,
        date_of_birth,
        gender: true, // always set to true (male)
        ethnicity: '99', // default as requested
        address_line_1,
        postcode,
        payment_plan_id: planId,
        email_address: patient.email_address || '',
        mobile_phone,
    };
    
    try {
        // 1. Create patient in Dentally
        const createdPatient = await createPatientAndStore({ patient: patientPayload });
        const patientId = createdPatient?.id || createdPatient?.patient?.id;
        
        if (!patientId) {
            res.status(500).json({ detail: 'Failed to create patient or retrieve patient_id.' });
            return;
        }
        
        // 2. Book appointment with patient_id
        const appointmentData = {
            appointment: {
                ...appointment,
                patient_id: patientId
            }
        };
        
        const createdAppointment = await createAppointmentAndStore(appointmentData);
        
        if (!createdAppointment) {
            res.status(500).json({ detail: 'Failed to create appointment.' });
            return;
        }
        
        res.status(201).json({ 
            success: true,
            appointment: createdAppointment,
            message: 'Patient and appointment created successfully'
        });
    } catch (error) {
        logger.error('Error in createPatientAndBookAppointment:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
}; 