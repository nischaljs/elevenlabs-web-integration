import mongoose, { Document, Schema } from 'mongoose';

export interface IPatientBase {
  title?: string;
  first_name?: string;
  last_name?: string;
  date_of_birth?: Date;
  gender?: boolean;
  ethnicity?: string;
  address_line_1?: string;
  postcode?: string;
  payment_plan_id?: number;
  payment_plan?: number[];
  email_address?: string;
  mobile_phone?: string;
}

export interface IPatientCreate extends IPatientBase {}

export interface IPatient extends IPatientBase {
  _id: mongoose.Types.ObjectId;
}

const PatientSchema = new Schema<IPatient>({
  title: { type: String, required: false },
  first_name: { type: String, required: false },
  last_name: { type: String, required: false },
  date_of_birth: { type: Date, required: false },
  gender: { type: Boolean, required: false },
  ethnicity: { type: String, required: false },
  address_line_1: { type: String, required: false },
  postcode: { type: String, required: false },
  payment_plan_id: { type: Number, required: false },
  payment_plan: { type: [Number], required: false },
  email_address: { type: String, required: false },
  mobile_phone: { type: String, required: false }
}, {
  timestamps: true,
  versionKey: false
});

export const Patient = mongoose.model<IPatient>('Patient', PatientSchema); 