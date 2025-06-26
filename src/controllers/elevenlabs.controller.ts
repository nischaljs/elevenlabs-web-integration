import { Request, Response } from 'express';
import { createAppointmentAndStore, createPatientAndStore, getAvailabilityFromDentally } from '../utils/dentally';
import logger from '../utils/logger';
import {
  fetchActivePractitioners,
  shufflePractitioners,
  batchCheckAvailability,
  findFirstAvailableOrRecommend,
  splitBlockIntoSlots
} from '../utils/availabilityUtils';
import { parseAppointmentReason, calculateTotalPayment } from '../utils/paymentUtils';
import { handlePaymentAndSms } from '../utils/paymentLinkAndSms';
import { SERVICE_DURATION_MAP } from '../models/service.model';

// Get first available practitioner for a given time, duration, and service
export const getFirstAvailablePractitioner = async (req: Request, res: Response): Promise<void> => {
    console.log("available practioner checking route received this payload", req.body);
    let { start_time, service_id } = req.body;
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

    // Parse service IDs (comma-separated string)
    const serviceIds = service_id.split(',').map((id: string) => id.trim()).filter(Boolean);
    if (serviceIds.length === 0) {
        res.status(400).json({ detail: 'No valid service IDs provided.' });
        return;
    }

    // If service 1 is present, it must be booked before any other
    const hasBio = serviceIds.includes('1');
    const otherServiceIds = serviceIds.filter((id: string) => id !== '1');

    // For each service, find available slots (independently)
    const results: Record<string, any[]> = {};
    let earliestBioSlot: { start_time: string, finish_time: string, practitioner_id: number } | null = null;

    for (const sid of serviceIds) {
        logger.info(`[Availability] Processing service_id=${sid} (${sid === '1' ? 'Biological New Consultation' : sid === '2' ? 'Holistic Hygiene' : 'Holistic Hygiene Direct Access'})`);
        const duration = SERVICE_DURATION_MAP[Number(sid)] || 60;
        // Fetch practitioners for this service
        let practitionersRaw = await fetchActivePractitioners();
        let practitionersFiltered = [];
        let source = 'dentally';
        if (!practitionersRaw || practitionersRaw.length === 0) {
            logger.info(`[Availability] No active practitioners from Dentally for service_id=${sid}, falling back to MongoDB...`);
            const { Practitioner } = require('../models/practitioner.model');
            practitionersRaw = await Practitioner.find({ active: true, services: Number(sid) }).lean();
            source = 'db';
        } else {
            const { Practitioner } = require('../models/practitioner.model');
            const dentallyIds = practitionersRaw.map((doc: any) => doc.id);
            const dbPractitioners = await Practitioner.find({ id: { $in: dentallyIds } }).lean();
            const dbPractitionerMap = new Map(dbPractitioners.map((p: any) => [p.id, p]));
            practitionersFiltered = practitionersRaw.filter((doc: any) => {
                const dbDoc = dbPractitionerMap.get(doc.id) as { services?: number[] } | undefined;
                return dbDoc && Array.isArray(dbDoc.services) && dbDoc.services.includes(Number(sid));
            }).map((doc: any) => {
                const dbDoc = dbPractitionerMap.get(doc.id) as { services?: number[] } | undefined;
                return { ...doc, services: dbDoc?.services };
            });
            logger.info(`[Availability] Practitioners for service_id=${sid}:`, practitionersFiltered.map((p: any) => ({ id: p.id, name: p.user?.first_name + ' ' + p.user?.last_name, services: p.services })));
        }
        if (!practitionersFiltered || practitionersFiltered.length === 0) {
            logger.warn(`[Availability] No practitioners found for service_id=${sid} in DB fallback.`);
            const { Practitioner } = require('../models/practitioner.model');
            practitionersFiltered = await Practitioner.find({ active: true, services: Number(sid) }).lean();
            source = 'db';
        }
        if (!practitionersFiltered || practitionersFiltered.length === 0) {
            logger.error(`[Availability] No practitioners found for service_id=${sid}. Skipping.`);
            results[sid] = [];
            continue;
        }
        // Calculate window for this service
        let windowStart = new Date(Math.max(startDate.getTime() - 12 * 60 * 60 * 1000, now.getTime() + 60 * 60 * 1000));
        let windowEnd = new Date(startDate.getTime() + 25 * 60 * 60 * 1000);
        let foundSlots: any[] = [];
        let attempt = 1;
        let found = false;
        while (!found && attempt <= 5) {
            const practitionerIds = practitionersFiltered.map((doc: any) => doc.id);
            logger.info(`[Availability] [service_id=${sid}] Attempt ${attempt}: Checking availability for practitioners:`, practitionerIds);
            const availableBlocks: any[] = await batchCheckAvailability(practitionerIds, windowStart.toISOString(), windowEnd.toISOString(), duration);
            logger.info(`[Availability] [service_id=${sid}] Available blocks:`, availableBlocks);
            const slots: any[] = [];
            for (const block of availableBlocks as any[]) {
                const blockSlots = splitBlockIntoSlots(block.start_time, block.finish_time, duration);
                for (const slot of blockSlots) {
                    if (new Date(slot.start_time) >= now) {
                        slots.push({ ...slot, practitioner_id: block.practitioner_id });
                    }
                }
            }
            logger.info(`[Availability] [service_id=${sid}] Generated slots:`, slots);
            if (slots.length > 0) {
                foundSlots = slots;
                found = true;
                logger.info(`[Availability] [service_id=${sid}] Found ${slots.length} slots.`);
            } else {
                // Expand window
                logger.info(`[Availability] [service_id=${sid}] No slots found, expanding window to ${windowStart.toISOString()} - ${windowEnd.toISOString()}`);
                windowStart = new Date(windowEnd.getTime());
                windowEnd = new Date(windowStart.getTime() + 25 * 60 * 60 * 1000);
                attempt++;
            }
        }
        // Sort slots by start_time ascending
        foundSlots.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        results[sid] = foundSlots;
        // Track earliest bio slot
        if (sid === '1' && foundSlots.length > 0) {
            logger.info(`[Availability] Earliest Biological New Consultation slot:`, foundSlots[0]);
            earliestBioSlot = foundSlots[0];
        }
    }

    // Enforce order: if service 1 is present, other services must be after it
    if (hasBio && earliestBioSlot) {
        const bioTime = new Date(earliestBioSlot.start_time).getTime();
        for (const sid of otherServiceIds) {
            logger.info(`[Availability] Filtering slots for service_id=${sid} to only after Biological New Consultation at ${earliestBioSlot.start_time}`);
            results[sid] = (results[sid] || []).filter(slot => new Date(slot.start_time).getTime() > bioTime);
        }
    }

    // Prepare a human-readable response
    const serviceNames: Record<string, string> = {
        '1': 'Biological New Consultation',
        '2': 'Holistic Hygiene',
        '3': 'Holistic Hygiene Direct Access'
    };
    const readableSlots: any[] = [];
    let messageParts: string[] = [];
    for (const sid of serviceIds) {
        const slots = results[sid] || [];
        const name = serviceNames[sid] || `Service ${sid}`;
        if (slots.length === 0) {
            messageParts.push(`No available slots found for ${name}.`);
            readableSlots.push({
                service_id: sid,
                service_name: name,
                available: false,
                slots: []
            });
            continue;
        }
        // Check if any slot matches the requested start_time exactly
        const exactMatch = slots.find(slot => slot.start_time === start_time);
        let slotMessage = '';
        if (exactMatch) {
            slotMessage = `Exact matching time found for ${name}: ${exactMatch.start_time} - ${exactMatch.finish_time}.`;
        } else {
            // Check if any slot is on the same day as requested
            const requestedDay = new Date(start_time).toISOString().split('T')[0];
            const sameDaySlots = slots.filter(slot => slot.start_time.startsWith(requestedDay));
            if (sameDaySlots.length > 0) {
                slotMessage = `Exact matching time was not found for ${name}. Here are recommended slots on the same day:`;
            } else {
                slotMessage = `Exact matching time was not found for ${name}. Here are recommended slots on the next available day:`;
            }
        }
        messageParts.push(slotMessage);
        readableSlots.push({
            service_id: sid,
            service_name: name,
            available: true,
            slots: slots.map(slot => ({
                start_time: slot.start_time,
                finish_time: slot.finish_time,
                practitioner_id: slot.practitioner_id
            }))
        });
    }
    logger.info(`[Availability] Final slot results:`, results);
     res.json({
        message: messageParts.join(' '),
        services: readableSlots
    });
};

// Create patient and book appointment in one step
export const createPatientAndBookAppointment = async (req: Request, res: Response): Promise<void> => {
    logger.info('[createPatientAndBookAppointment] API received body:', JSON.stringify(req.body));
    let { patient, appointment, total_payment } = req.body;

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
                reason: flat.appointment_reason,
                service_id: flat.appointment_service_id
            };
            total_payment = flat.total_payment;
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

    // --- Payment Logic ---
    let paymentInfo = null;
    let parsedTotalPayment: number | null = null;
    if (typeof total_payment === 'number') {
        parsedTotalPayment = total_payment;
    } else if (typeof total_payment === 'string' && !isNaN(parseFloat(total_payment))) {
        parsedTotalPayment = parseFloat(total_payment);
    }
    if (parsedTotalPayment !== null) {
        logger.info(`[Payment] total_payment provided in request: €${parsedTotalPayment}`);
        paymentInfo = { total: parsedTotalPayment, breakdown: 'Provided by client', discount: 0, drSeb: false, details: {} };
    } else {
        // Parse appointment_reason for services
        const services = parseAppointmentReason(appointment.reason);
        logger.info(`[Payment] Parsed services from appointment_reason:`, services);
        // Use practitioner_id and optionally name
        const practitionerId = appointment.practitioner_id;
        const practitionerName = patient.practitioner_name || '';
        paymentInfo = calculateTotalPayment({ services, practitionerId, practitionerName });
        logger.info(`[Payment] Computed payment info:`, paymentInfo);
    }
    // --- End Payment Logic ---
    
    try {
        // 1. Create patient in Dentally
        const createdPatient = await createPatientAndStore({ patient: patientPayload });
        const patientId = createdPatient?.id || createdPatient?.patient?.id;
        
        if (!patientId) {
            res.status(500).json({ detail: 'Failed to create patient or retrieve patient_id.' });
            return;
        }
        
        // 2. Book appointment with patient_id
        // Always use backend-defined duration for the service
        const duration = SERVICE_DURATION_MAP[Number(appointment.service_id)] || 60;
        const startTime = appointment.start_time;
        const finishTime = new Date(new Date(startTime).getTime() + duration * 60000).toISOString();
        const appointmentData = {
            appointment: {
                ...appointment,
                patient_id: patientId,
                start_time: startTime,
                finish_time: finishTime,
                duration: duration
            }
        };
        
        const createdAppointment = await createAppointmentAndStore(appointmentData);
        
        if (!createdAppointment) {
            // Check if the last error was a known Dentally overlap error
            // (We rely on the logger in dentally.ts to log the right message, but here we can return a more specific message)
            const overlapMsg = 'Practitioner already has an appointment in this period.';
            res.status(422).json({ detail: overlapMsg });
            logger.error(`[createPatientAndBookAppointment] ${overlapMsg}`);
            return;
        }

        // --- Payment Link and SMS Logic ---
        let paymentLinkResult = null;
        if (paymentInfo.total > 0) {
            paymentLinkResult = await handlePaymentAndSms({
                euroAmount: paymentInfo.total,
                patientPhone: patient.mobile_phone,
                patientName: patient.first_name
            });
            logger.info(`[PaymentFlow] Payment link: ${paymentLinkResult.paymentUrl}, SMS sent: ${paymentLinkResult.smsSent}`);
        } else {
            logger.info('[PaymentFlow] No payment link or SMS sent (total is 0 or not applicable)');
        }
        // --- End Payment Link and SMS Logic ---
        
        res.status(201).json({ 
            success: true,
            appointment: createdAppointment,
            payment: paymentInfo,
            payment_link: paymentLinkResult?.paymentUrl || null,
            sms_sent: paymentLinkResult?.smsSent || false,
            message: 'Patient and appointment created successfully'
        });
    } catch (error) {
        logger.error('Error in createPatientAndBookAppointment:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};  