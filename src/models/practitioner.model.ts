import mongoose, { Document, Schema } from 'mongoose';

export interface IPractitionerBase {
  id?: number;
  active?: boolean;
  user?: {
    first_name?: string;
    last_name?: string;
  };
}

export interface IPractitionerCreate extends IPractitionerBase {}

export interface IPractitioner extends IPractitionerBase {
  _id: mongoose.Types.ObjectId;
}

const PractitionerSchema = new Schema<IPractitioner>({
  id: { type: Number, required: false },
  active: { type: Boolean, required: false },
  user: {
    first_name: { type: String, required: false },
    last_name: { type: String, required: false }
  }
}, {
  timestamps: true,
  versionKey: false
});

export const Practitioner = mongoose.model<IPractitioner>('Practitioner', PractitionerSchema); 