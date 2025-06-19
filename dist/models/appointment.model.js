"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Appointment = void 0;
const mongoose_1 = __importStar(require("mongoose"));
// Mongoose Schema definition
const AppointmentSchema = new mongoose_1.Schema({
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
    metadata: { type: mongoose_1.Schema.Types.Mixed, default: {} },
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
// Create and export the Mongoose model
exports.Appointment = mongoose_1.default.model('Appointment', AppointmentSchema);
