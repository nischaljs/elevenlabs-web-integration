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
exports.Patient = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const PatientSchema = new mongoose_1.Schema({
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
exports.Patient = mongoose_1.default.model('Patient', PatientSchema);
