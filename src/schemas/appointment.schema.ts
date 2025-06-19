import { z } from 'zod';

// Base appointment schema matching FastAPI's AppointmentSchemaBase
export const appointmentSchemaBase = z.object({
  appointment_cancellation_reason_id: z.number().optional(),
  arrived_at: z.date().optional(),
  booked_via_api: z.boolean().optional(),
  cancelled_at: z.date().optional(),
  completed_at: z.date().optional(),
  confirmed_at: z.date().optional(),
  created_at: z.date().optional(),
  did_not_attend_at: z.date().optional(),
  duration: z.number().optional(),
  finish_time: z.date().optional(),
  import_id: z.string().optional(),
  in_surgery_at: z.date().optional(),
  metadata: z.record(z.any()).default({}),
  notes: z.string().optional(),
  patient_id: z.number().optional(),
  patient_image_url: z.string().url().optional(),
  patient_name: z.string().default(""),
  payment_plan_id: z.number().optional(),
  pending_at: z.date().optional(),
  practitioner_id: z.number().optional(),
  reason: z.string().optional(),
  room_id: z.number().optional(),
  start_time: z.date().optional(),
  state: z.string().optional(),
  treatment_description: z.string().optional(),
  updated_at: z.date().optional(),
  user_id: z.number().optional(),
  practitioner_site_id: z.string().optional(),
  uuid: z.string().optional(),
});

// Schema for creating appointments (matches FastAPI's AppointmentCreate)
export const appointmentCreateSchema = appointmentSchemaBase;

// Schema for appointment response (matches FastAPI's Appointment)
export const appointmentSchema = appointmentSchemaBase.extend({
  id: z.string().optional(),
});

// Schema for list of appointments (matches FastAPI's AppointmentList)
export const appointmentListSchema = z.object({
  results: z.array(appointmentSchema),
});

// Type exports
export type AppointmentBase = z.infer<typeof appointmentSchemaBase>;
export type AppointmentCreate = z.infer<typeof appointmentCreateSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type AppointmentList = z.infer<typeof appointmentListSchema>; 