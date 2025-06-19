import mongoose, { Document, Schema } from 'mongoose';

export interface ITreatmentDetailsBase {
  [key: string]: any; // Since treatment details are dynamic based on Excel file
}

export interface ITreatmentDetailsCreate extends ITreatmentDetailsBase {}

export interface ITreatmentDetails extends ITreatmentDetailsBase {
  _id: mongoose.Types.ObjectId;
}

const TreatmentDetailsSchema = new Schema<ITreatmentDetails>({
  // Using Schema.Types.Mixed to allow dynamic fields from Excel
}, {
  timestamps: true,
  versionKey: false,
  strict: false // Allow dynamic fields
});

export const TreatmentDetails = mongoose.model<ITreatmentDetails>('TreatmentDetails', TreatmentDetailsSchema); 