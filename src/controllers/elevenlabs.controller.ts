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

    // Fetch practitioners for each service
    const practitionersByService: Record<string, any[]> = {};
    for (const sid of serviceIds) {
        const sidNum = Number(sid);
        let practitionersRaw = await fetchActivePractitioners();
        let practitionersFiltered = [];
        if (!practitionersRaw || practitionersRaw.length === 0) {
            const { Practitioner } = require('../models/practitioner.model');
            practitionersRaw = await Practitioner.find({ active: true, services: sidNum }).lean();
            practitionersFiltered = practitionersRaw;
        } else {
            const { Practitioner } = require('../models/practitioner.model');
            const dentallyIds = practitionersRaw.map((doc: any) => doc.id);
            const dbPractitioners = await Practitioner.find({ id: { $in: dentallyIds } }).lean();
            const dbPractitionerMap = new Map(dbPractitioners.map((p: any) => [p.id, p]));
            practitionersFiltered = practitionersRaw.filter((doc: any) => {
                const dbDoc = dbPractitionerMap.get(doc.id) as { services?: number[] } | undefined;
                return dbDoc && Array.isArray(dbDoc.services) && dbDoc.services.includes(sidNum);
            }).map((doc: any) => {
                const dbDoc = dbPractitionerMap.get(doc.id) as { services?: number[] } | undefined;
                return { ...doc, services: dbDoc?.services };
            });
        }
        if (!practitionersFiltered || practitionersFiltered.length === 0) {
            const { Practitioner } = require('../models/practitioner.model');
            practitionersFiltered = await Practitioner.find({ active: true, services: sidNum }).lean();
        }
        practitionersByService[sid] = practitionersFiltered;
    }

    // Helper to find slots for a service given practitioners and a window
    async function findSlotsForService(sid: string, practitioners: any[], windowStart: Date, windowEnd: Date, duration: number) {
        let foundSlots: any[] = [];
        let attempt = 1;
        let found = false;
        let maxAttempts = 10; // Increase attempts for wider search horizon
        while (!found && attempt <= maxAttempts) {
            const practitionerIds = practitioners.map((doc: any) => doc.id);
            const availableBlocks: any[] = await batchCheckAvailability(practitionerIds, windowStart.toISOString(), windowEnd.toISOString(), duration);
            const slots: any[] = [];
            for (const block of availableBlocks as any[]) {
                const blockSlots = splitBlockIntoSlots(block.start_time, block.finish_time, duration);
                for (const slot of blockSlots) {
                    if (new Date(slot.start_time) >= now) {
                        slots.push({ ...slot, practitioner_id: block.practitioner_id });
                    }
                }
            }
            if (slots.length > 0) {
                foundSlots = slots;
                found = true;
            } else {
                // Expand window
                windowStart = new Date(windowEnd.getTime());
                windowEnd = new Date(windowStart.getTime() + 25 * 60 * 60 * 1000);
                attempt++;
            }
        }
        foundSlots.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        return foundSlots;
    }

    // Paired slot search logic
    let pairedSlots: any[] = [];
    let otherPairs: any[] = [];
    let message = '';
    const requestedTime = new Date(startDate);
    if (serviceIds.length === 1) {
        // Single service, just find slots as before
        const sid = serviceIds[0];
        const duration = SERVICE_DURATION_MAP[Number(sid)] || 60;
        const practitioners = practitionersByService[sid];
        let windowStart = new Date(Math.max(startDate.getTime() - 12 * 60 * 60 * 1000, now.getTime() + 60 * 60 * 1000));
        let windowEnd = new Date(startDate.getTime() + 25 * 60 * 60 * 1000);
        const slots = await findSlotsForService(sid, practitioners, windowStart, windowEnd, duration);
        // Filter out slots in the past
        const validSlots = slots.filter(slot => new Date(slot.start_time) >= now);
        // Find the closest slot before requestedTime (but not in the past)
        const beforeSlots = validSlots.filter(slot => new Date(slot.start_time) < requestedTime);
        const afterSlots = validSlots.filter(slot => new Date(slot.start_time) >= requestedTime);
        let recommendedSlot = null;
        if (beforeSlots.length > 0) {
            // Closest before
            recommendedSlot = beforeSlots[beforeSlots.length - 1];
            pairedSlots = [{ service_id: sid, slot: recommendedSlot }];
            otherPairs = afterSlots.slice(0, 3).map(slot => [{ service_id: sid, slot }]);
            message = `Recommended closest slot before your requested time. Here are other slots after your requested time.`;
        } else if (afterSlots.length > 0) {
            // No before, recommend first after
            recommendedSlot = afterSlots[0];
            pairedSlots = [{ service_id: sid, slot: recommendedSlot }];
            otherPairs = afterSlots.slice(1, 4).map(slot => [{ service_id: sid, slot }]);
            message = `No slots before your requested time. Here are slots after your requested time.`;
        } else {
            message = `No available slots found for service.`;
        }
    } else {
        // Multi-service paired search
        const firstSid = serviceIds[0];
        const firstDuration = SERVICE_DURATION_MAP[Number(firstSid)] || 60;
        const firstPractitioners = practitionersByService[firstSid];
        let windowStart = new Date(Math.max(startDate.getTime() - 12 * 60 * 60 * 1000, now.getTime() + 60 * 60 * 1000));
        let windowEnd = new Date(startDate.getTime() + 25 * 60 * 60 * 1000);
        const firstSlots = await findSlotsForService(firstSid, firstPractitioners, windowStart, windowEnd, firstDuration);
        let foundPairs = [];
        for (const slot1 of firstSlots) {
            let prevSlot = slot1;
            let valid = true;
            let slotSequence = [{ service_id: firstSid, slot: slot1 }];
            for (let i = 1; i < serviceIds.length; i++) {
                const sid = serviceIds[i];
                const duration = SERVICE_DURATION_MAP[Number(sid)] || 60;
                const practitioners = practitionersByService[sid];
                let nextWindowStart = new Date(prevSlot.finish_time);
                let nextWindowEnd = new Date(nextWindowStart.getTime() + 25 * 60 * 60 * 1000);
                const nextSlots = await findSlotsForService(sid, practitioners, nextWindowStart, nextWindowEnd, duration);
                const nextValidSlot = nextSlots.find(s => new Date(s.start_time) > new Date(prevSlot.finish_time));
                if (nextValidSlot) {
                    slotSequence.push({ service_id: sid, slot: nextValidSlot });
                    prevSlot = nextValidSlot;
                } else {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                // Only add if all slots in sequence are not in the past
                if (slotSequence.every(entry => new Date(entry.slot.start_time) >= now)) {
                    foundPairs.push(slotSequence);
                }
                if (foundPairs.length >= 10) break; // collect more for before/after logic
            }
        }
        // Partition foundPairs into before/after requestedTime (by first slot)
        const beforePairs = foundPairs.filter(seq => new Date(seq[0].slot.start_time) < requestedTime);
        const afterPairs = foundPairs.filter(seq => new Date(seq[0].slot.start_time) >= requestedTime);
        if (beforePairs.length > 0) {
            pairedSlots = beforePairs.slice(-1)[0]; // Closest before
            otherPairs = afterPairs.slice(0, 3);
            message = `Recommended closest valid sequence before your requested time. Here are other sequences after your requested time.`;
        } else if (afterPairs.length > 0) {
            pairedSlots = afterPairs[0];
            otherPairs = afterPairs.slice(1, 4);
            message = `No valid sequence before your requested time. Here are sequences after your requested time.`;
        } else {
            message = `No valid sequence of slots found for the requested services.`;
        }
    }

    // Prepare response
    const serviceNames: Record<string, string> = {
        '1': 'Biological New Consultation',
        '2': 'Holistic Hygiene',
        '3': 'Holistic Hygiene Direct Access'
    };
    function formatSlotSequence(seq: any[]) {
        return seq.map(entry => ({
            service_id: entry.service_id,
            service_name: serviceNames[entry.service_id] || `Service ${entry.service_id}`,
            start_time: entry.slot.start_time,
            finish_time: entry.slot.finish_time,
            practitioner_id: entry.slot.practitioner_id
        }));
    }
    if (!pairedSlots || pairedSlots.length === 0) {
        res.json({ message, recommended: null, others: [] });
        return;
    }
    res.json({
        message,
        recommended: formatSlotSequence(pairedSlots),
        others: otherPairs.map(formatSlotSequence)
    });
};

// Create patient and book appointment in one step
export const createPatientAndBookAppointment = async (req: Request, res: Response): Promise<void> => {
    logger.info('[createPatientAndBookAppointment] API received body:', JSON.stringify(req.body));
    let patient = req.body.patient;
    let appointments = req.body.appointments;
    let total_payment = req.body.total_payment;

    // Handle flat payload (single appointment, flat patient fields)
    if (!patient && !appointments) {
        const flat = req.body;
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
            appointments = [{
                practitioner_id: flat.appointment_practitioner_id,
                start_time: flat.appointment_start_time,
                reason: flat.appointment_reason,
                service_id: flat.appointment_service_id
            }];
            total_payment = flat.total_payment;
        }
    }

    // Handle legacy nested single appointment
    if (!appointments && req.body.appointment) {
        appointments = [req.body.appointment];
    }

    // If appointments is a single object, wrap in array
    if (appointments && !Array.isArray(appointments)) {
        appointments = [appointments];
    }

    if (!patient || !appointments || !Array.isArray(appointments) || appointments.length === 0) {
        res.status(400).json({ detail: 'Missing required fields: patient, appointments' });
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

    // --- Payment Logic (for batch, just sum up or use provided total_payment) ---
    let paymentInfo = null;
    let parsedTotalPayment: number | null = null;
    if (typeof total_payment === 'number') {
        parsedTotalPayment = total_payment;
    } else if (typeof total_payment === 'string' && !isNaN(parseFloat(total_payment))) {
        parsedTotalPayment = parseFloat(total_payment);
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

        // 2. Enforce service 1 is booked first (by start_time)
        const service1Appt = appointments.find(a => a.service_id === '1');
        if (service1Appt && appointments.length > 1) {
            const service1Time = new Date(service1Appt.start_time).getTime();
            for (const appt of appointments) {
                if (appt.service_id !== '1' && new Date(appt.start_time).getTime() <= service1Time) {
                    res.status(400).json({
                        detail: 'To ensure the best care, the Biological New Consultation (service 1) must be booked before any other service. Please select a time for your consultation that is before any additional services.'
                    });
                    return;
                }
            }
        }

        // 3. Book all appointments
        const bookingResults = [];
        let allPayment = 0;
        const serviceNames: Record<string, string> = {
            '1': 'Biological New Consultation',
            '2': 'Holistic Hygiene',
            '3': 'Holistic Hygiene Direct Access'
        };
        let bioBooked = true;
        let bioBookingError = '';
        for (const appt of appointments) {
            const duration = SERVICE_DURATION_MAP[Number(appt.service_id)] || 60;
            const startTime = appt.start_time;
            const finishTime = new Date(new Date(startTime).getTime() + duration * 60000).toISOString();
            // Always set reason to the official service name
            const reason = serviceNames[appt.service_id] || `Service ${appt.service_id}`;
            const appointmentData = {
                appointment: {
                    ...appt,
                    reason, // override reason
                    patient_id: patientId,
                    start_time: startTime,
                    finish_time: finishTime,
                    duration: duration
                }
            };
            // If this is a dependent service and bioBooked is false, skip booking
            if ((appt.service_id === '2' || appt.service_id === '3') && !bioBooked) {
                bookingResults.push({
                    service_id: appt.service_id,
                    service_name: serviceNames[appt.service_id] || `Service ${appt.service_id}`,
                    practitioner_id: appt.practitioner_id,
                    start_time: startTime,
                    finish_time: finishTime,
                    status: 'failed',
                    error: 'Cannot book this service without a successful Biological New Consultation in the same request.'
                });
                continue;
            }
            try {
                const createdAppointment = await createAppointmentAndStore(appointmentData);
                if (createdAppointment) {
                    // Use service_id directly for payment calculation
                    const services = [{ id: Number(appt.service_id), name: reason }];
                    const payment = calculateTotalPayment({ services, practitionerId: appt.practitioner_id, practitionerName: patient.practitioner_name || '' });
                    allPayment += payment.total;
                    bookingResults.push({
                        service_id: appt.service_id,
                        service_name: serviceNames[appt.service_id] || `Service ${appt.service_id}`,
                        practitioner_id: appt.practitioner_id,
                        start_time: startTime,
                        finish_time: finishTime,
                        status: 'success',
                        appointment: createdAppointment,
                        payment
                    });
                } else {
                    bookingResults.push({
                        service_id: appt.service_id,
                        service_name: serviceNames[appt.service_id] || `Service ${appt.service_id}`,
                        practitioner_id: appt.practitioner_id,
                        start_time: startTime,
                        finish_time: finishTime,
                        status: 'failed',
                        error: 'Practitioner already has an appointment in this period.'
                    });
                    if (appt.service_id === '1') {
                        bioBooked = false;
                        bioBookingError = 'Biological New Consultation could not be booked.';
                    }
                }
            } catch (err) {
                logger.error(`[createPatientAndBookAppointment] Error booking appointment for service_id=${appt.service_id}:`, err);
                bookingResults.push({
                    service_id: appt.service_id,
                    service_name: serviceNames[appt.service_id] || `Service ${appt.service_id}`,
                    practitioner_id: appt.practitioner_id,
                    start_time: startTime,
                    finish_time: finishTime,
                    status: 'failed',
                    error: 'Internal server error'
                });
                if (appt.service_id === '1') {
                    bioBooked = false;
                    bioBookingError = 'Biological New Consultation could not be booked.';
                }
            }
        }

        // --- Payment Link and SMS Logic (for total payment) ---
        let paymentLinkResult = null;
        const totalToCharge = parsedTotalPayment !== null ? parsedTotalPayment : allPayment;
        if (totalToCharge > 0) {
            paymentLinkResult = await handlePaymentAndSms({
                euroAmount: totalToCharge,
                patientPhone: patient.mobile_phone,
                patientName: patient.first_name
            });
            logger.info(`[PaymentFlow] Payment link: ${paymentLinkResult.paymentUrl}, SMS sent: ${paymentLinkResult.smsSent}`);
        } else {
            logger.info('[PaymentFlow] No payment link or SMS sent (total is 0 or not applicable)');
        }
        // --- End Payment Link and SMS Logic ---

        // Human-readable response
        const summary = bookingResults.map(b => {
            if (b.status === 'success') {
                return `Booked ${b.service_name} with practitioner ${b.practitioner_id} at ${b.start_time}.`;
            } else {
                return `Failed to book ${b.service_name} with practitioner ${b.practitioner_id} at ${b.start_time}: ${b.error}`;
            }
        }).join(' ');

        res.status(201).json({
            success: true,
            patient_id: patientId,
            bookings: bookingResults,
            payment_link: paymentLinkResult?.paymentUrl || null,
            sms_sent: paymentLinkResult?.smsSent || false,
            message: summary
        });
    } catch (error) {
        logger.error('Error in createPatientAndBookAppointment:', error);
        res.status(500).json({ detail: 'Internal server error' });
    }
};  