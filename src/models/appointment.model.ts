import mongoose, { Document, Schema } from 'mongoose';

// Interface for the base appointment document
export interface IAppointmentBase {
  appointment_cancellation_reason_id?: number;
  arrived_at?: Date;
  booked_via_api?: boolean;
  cancelled_at?: Date;
  completed_at?: Date;
  confirmed_at?: Date;
  created_at?: Date;
  did_not_attend_at?: Date;
  duration?: number;
  finish_time?: Date;
  import_id?: string;
  in_surgery_at?: Date;
  metadata?: Record<string, any>;
  notes?: string;
  patient_id?: number;
  patient_image_url?: string;
  patient_name?: string;
  payment_plan_id?: number;
  pending_at?: Date;
  practitioner_id?: number;
  reason?: string;
  room_id?: number;
  start_time?: Date;
  state?: string;
  treatment_description?: string;
  updated_at?: Date;
  user_id?: number;
  practitioner_site_id?: string;
  uuid?: string;
}

// Interface for creating a new appointment
export interface IAppointmentCreate extends IAppointmentBase {}

// Interface for the full appointment document including MongoDB _id
export interface IAppointment extends IAppointmentBase {
  _id: mongoose.Types.ObjectId;
}

// Mongoose Schema definition
const AppointmentSchema = new Schema<IAppointment>({
  appointment_cancellation_reason_id: { type: Number, required: false },
  arrived_at: { type: Date, required: false },
  booked_via_api: { type: Boolean, required: false },
  cancelled_at: { type: Date, required: false },
  completed_at: { type: Date, required: false },
  confirmed_at: { type: Date, required: false },
  created_at: { type: Date, required: false },
  did_not_attend_at: { type: Date, required: false },
  duration: { type: Number, required: false },
  finish_time: { type: Date, required: false },
  import_id: { type: String, required: false },
  in_surgery_at: { type: Date, required: false },
  metadata: { type: Schema.Types.Mixed, default: {} },
  notes: { type: String, required: false },
  patient_id: { type: Number, required: false },
  patient_image_url: { type: String, required: false },
  patient_name: { type: String, default: "" },
  payment_plan_id: { type: Number, required: false },
  pending_at: { type: Date, required: false },
  practitioner_id: { type: Number, required: false },
  reason: { type: String, required: false },
  room_id: { type: Number, required: false },
  start_time: { type: Date, required: false },
  state: { type: String, required: false },
  treatment_description: { type: String, required: false },
  updated_at: { type: Date, required: false },
  user_id: { type: Number, required: false },
  practitioner_site_id: { type: String, required: false },
  uuid: { type: String, required: false }
}, {
  timestamps: true,
  versionKey: false
});

// Interface for the appointment list response
export interface IAppointmentList {
  results: IAppointment[];
}

// Create and export the Mongoose model
export const Appointment = mongoose.model<IAppointment>('Appointment', AppointmentSchema); 