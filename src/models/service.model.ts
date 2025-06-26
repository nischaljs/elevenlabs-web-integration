import mongoose, { Schema } from 'mongoose';

export interface IService {
  id: number;
  name: string;
}

const ServiceSchema = new Schema<IService>({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true }
}, {
  timestamps: false,
  versionKey: false
});

export const Service = mongoose.model<IService>('Service', ServiceSchema);

export const SERVICE_LIST: IService[] = [
  { id: 1, name: 'Biological New Consultation' },
  { id: 2, name: 'Holistic Hygiene' },
  { id: 3, name: 'Holistic Hygiene Direct Access' }
]; 