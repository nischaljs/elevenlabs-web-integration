"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appointmentListSchema = exports.appointmentSchema = exports.appointmentCreateSchema = exports.appointmentSchemaBase = void 0;
const zod_1 = require("zod");
// Base appointment schema matching FastAPI's AppointmentSchemaBase
exports.appointmentSchemaBase = zod_1.z.object({
    appointment_cancellation_reason_id: zod_1.z.number().optional(),
    arrived_at: zod_1.z.date().optional(),
    booked_via_api: zod_1.z.boolean().optional(),
    cancelled_at: zod_1.z.date().optional(),
    completed_at: zod_1.z.date().optional(),
    confirmed_at: zod_1.z.date().optional(),
    created_at: zod_1.z.date().optional(),
    did_not_attend_at: zod_1.z.date().optional(),
    duration: zod_1.z.number().optional(),
    finish_time: zod_1.z.date().optional(),
    import_id: zod_1.z.string().optional(),
    in_surgery_at: zod_1.z.date().optional(),
    metadata: zod_1.z.record(zod_1.z.any()).default({}),
    notes: zod_1.z.string().optional(),
    patient_id: zod_1.z.number().optional(),
    patient_image_url: zod_1.z.string().url().optional(),
    patient_name: zod_1.z.string().default(""),
    payment_plan_id: zod_1.z.number().optional(),
    pending_at: zod_1.z.date().optional(),
    practitioner_id: zod_1.z.number().optional(),
    reason: zod_1.z.string().optional(),
    room_id: zod_1.z.number().optional(),
    start_time: zod_1.z.date().optional(),
    state: zod_1.z.string().optional(),
    treatment_description: zod_1.z.string().optional(),
    updated_at: zod_1.z.date().optional(),
    user_id: zod_1.z.number().optional(),
    practitioner_site_id: zod_1.z.string().optional(),
    uuid: zod_1.z.string().optional(),
});
// Schema for creating appointments (matches FastAPI's AppointmentCreate)
exports.appointmentCreateSchema = exports.appointmentSchemaBase;
// Schema for appointment response (matches FastAPI's Appointment)
exports.appointmentSchema = exports.appointmentSchemaBase.extend({
    id: zod_1.z.string().optional(),
});
// Schema for list of appointments (matches FastAPI's AppointmentList)
exports.appointmentListSchema = zod_1.z.object({
    results: zod_1.z.array(exports.appointmentSchema),
});
