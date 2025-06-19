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
exports.syncPaymentPlans = exports.uploadMappingExcel = exports.uploadPractitionerExcel = exports.getAllDentallyAppointments = void 0;
const axios_1 = __importStar(require("axios"));
const XLSX = __importStar(require("xlsx"));
const appointment_model_1 = require("../models/appointment.model");
const payment_plan_model_1 = require("../models/payment-plan.model");
const practitioner_model_1 = require("../models/practitioner.model");
const treatment_details_model_1 = require("../models/treatment-details.model");
const DENTALLY_API_KEY = process.env.DENTALLY_API_KEY;
const DENTALLY_BASE_URL = process.env.DENTALLY_BASE_URL || 'https://api.dentally.co/v1';
if (!DENTALLY_API_KEY) {
    throw new Error('DENTALLY_API_KEY must be set in environment variables');
}
const headers = {
    'Authorization': `Bearer ${DENTALLY_API_KEY}`,
    'Content-Type': 'application/json'
};
const validateDateFormat = (dateStr) => {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) {
        throw new Error('Date must be in YYYY-MM-DD format');
    }
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
    }
    return dateStr; // Return the original string to maintain exact format
};
const getAllDentallyAppointments = async (req, res) => {
    const { date } = req.params;
    let validatedDate;
    try {
        validatedDate = validateDateFormat(date);
    }
    catch (error) {
        res.status(400).json({ detail: 'Date must be in YYYY-MM-DD format' });
        return;
    }
    const allAppointments = [];
    let page = 1;
    const perPage = 100;
    let meta = { total_pages: 1, current_page: 1 };
    while (true) {
        const url = `${DENTALLY_BASE_URL}/appointments?on=${validatedDate}&page=${page}&per_page=${perPage}`;
        const response = await axios_1.default.get(url, { headers });
        if (response.status !== 200) {
            res.status(response.status).json({
                detail: `Error fetching appointments on page ${page}: ${response.data}`
            });
            return;
        }
        const data = response.data;
        const appointments = data.appointments || [];
        meta = data.meta || { total_pages: 1, current_page: 1 };
        allAppointments.push(...appointments);
        if (meta.current_page >= meta.total_pages) {
            break;
        }
        page++;
    }
    // Save appointments to MongoDB
    await appointment_model_1.Appointment.deleteMany({});
    if (allAppointments.length > 0) {
        await appointment_model_1.Appointment.insertMany(allAppointments);
        res.status(200).json({
            message: `Fetched and saved ${allAppointments.length} appointments from ${meta.total_pages} page(s).`
        });
    }
    else {
        res.status(200).json({ message: 'No appointments found to save' });
    }
};
exports.getAllDentallyAppointments = getAllDentallyAppointments;
const setNestedValue = (dictionary, keys, value) => {
    for (const key of keys.slice(0, -1)) {
        dictionary = dictionary[key] = dictionary[key] || {};
    }
    dictionary[keys[keys.length - 1]] = value;
};
const uploadPractitionerExcel = async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ detail: 'No file uploaded' });
            return;
        }
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const headers = data[0];
        const rows = data.slice(1);
        const dataToInsert = [];
        for (const row of rows) {
            const nestedRecord = {};
            for (let i = 0; i < headers.length; i++) {
                if (!headers[i])
                    continue;
                const keys = headers[i].split('.');
                setNestedValue(nestedRecord, keys, row[i]);
            }
            dataToInsert.push(nestedRecord);
        }
        if (dataToInsert.length === 0) {
            res.status(400).json({ detail: 'No data to insert' });
            return;
        }
        await practitioner_model_1.Practitioner.deleteMany({});
        await practitioner_model_1.Practitioner.insertMany(dataToInsert);
        res.status(200).json({
            message: 'Upload successful',
            inserted_count: dataToInsert.length
        });
    }
    catch (error) {
        console.error('[DentallyController] Error uploading practitioner Excel:', error);
        if (error instanceof Error) {
            res.status(500).json({ detail: error.message });
        }
        else {
            res.status(500).json({ detail: 'An unknown error occurred' });
        }
    }
};
exports.uploadPractitionerExcel = uploadPractitionerExcel;
const uploadMappingExcel = async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ detail: 'No file uploaded' });
            return;
        }
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const headers = data[0];
        if (!headers || headers.some(header => header === null)) {
            res.status(400).json({ detail: 'Invalid or missing headers in the Excel file.' });
            return;
        }
        await treatment_details_model_1.TreatmentDetails.deleteMany({});
        const dataToInsert = [];
        for (const row of data.slice(1)) {
            if (!row.some((cell) => cell !== null))
                continue;
            const record = {};
            for (let i = 0; i < headers.length; i++) {
                const key = String(headers[i]).trim();
                const value = typeof row[i] === 'string' ? row[i].trim() : row[i];
                record[key] = value;
            }
            dataToInsert.push(record);
        }
        if (dataToInsert.length === 0) {
            res.status(400).json({ detail: 'No valid data to insert.' });
            return;
        }
        await treatment_details_model_1.TreatmentDetails.insertMany(dataToInsert);
        res.status(200).json({
            message: 'Upload successful',
            inserted_count: dataToInsert.length
        });
    }
    catch (error) {
        console.error('[DentallyController] Error uploading mapping Excel:', error);
        if (error instanceof Error) {
            res.status(500).json({ detail: `Error processing file: ${error.message}` });
        }
        else {
            res.status(500).json({ detail: 'An unknown error occurred' });
        }
    }
};
exports.uploadMappingExcel = uploadMappingExcel;
const syncPaymentPlans = async (req, res) => {
    try {
        const response = await axios_1.default.get(`${DENTALLY_BASE_URL}/payment_plans?active=true`, { headers });
        const data = response.data;
        const paymentPlans = data.payment_plans || [];
        if (paymentPlans.length === 0) {
            res.status(404).json({ detail: 'No payment plans found in API response' });
            return;
        }
        await payment_plan_model_1.PaymentPlan.deleteMany({});
        await payment_plan_model_1.PaymentPlan.insertMany(paymentPlans);
        res.status(200).json({
            message: 'Payment plans fetched and stored successfully.',
            stored_count: paymentPlans.length
        });
    }
    catch (error) {
        console.error('[DentallyController] Error syncing payment plans:', error);
        if (error instanceof axios_1.AxiosError) {
            res.status(502).json({ detail: `Failed to fetch payment plans: ${error.message}` });
        }
        else if (error instanceof Error) {
            res.status(500).json({ detail: `Unexpected error: ${error.message}` });
        }
        else {
            res.status(500).json({ detail: 'An unknown error occurred' });
        }
    }
};
exports.syncPaymentPlans = syncPaymentPlans;
