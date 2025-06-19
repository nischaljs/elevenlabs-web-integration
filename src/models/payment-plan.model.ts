import mongoose, { Document, Schema } from 'mongoose';

export interface IPaymentPlanBase {
  id?: number;
  name?: string;
  active?: boolean;
  description?: string;
  amount?: number;
  currency?: string;
  [key: string]: any; // Allow for additional fields from API
}

export interface IPaymentPlanCreate extends IPaymentPlanBase {}

export interface IPaymentPlan extends IPaymentPlanBase {
  _id: mongoose.Types.ObjectId;
}

const PaymentPlanSchema = new Schema<IPaymentPlan>({
  id: { type: Number, required: false },
  name: { type: String, required: false },
  active: { type: Boolean, required: false },
  description: { type: String, required: false },
  amount: { type: Number, required: false },
  currency: { type: String, required: false }
}, {
  timestamps: true,
  versionKey: false,
  strict: false // Allow additional fields from API
});

export const PaymentPlan = mongoose.model<IPaymentPlan>('PaymentPlan', PaymentPlanSchema); 