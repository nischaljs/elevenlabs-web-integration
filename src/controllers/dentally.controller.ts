import axios, { AxiosError } from 'axios';
import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { Appointment } from '../models/appointment.model';
import { PaymentPlan } from '../models/payment-plan.model';
import { Practitioner } from '../models/practitioner.model';
import { TreatmentDetails } from '../models/treatment-details.model';
import logger from '../utils/logger';

// Extend Express Request type to include multer file
interface MulterRequest extends Request {
    file?: Express.Multer.File;
}

const DENTALLY_API_KEY = process.env.DENTALLY_API_KEY;
const DENTALLY_BASE_URL = process.env.DENTALLY_BASE_URL || 'https://api.dentally.co/v1';

if (!DENTALLY_API_KEY) {
    throw new Error('DENTALLY_API_KEY must be set in environment variables');
}

const headers = {
    'Authorization': `Bearer ${DENTALLY_API_KEY}`,
    'Content-Type': 'application/json'
};

const validateDateFormat = (dateStr: string): string => {
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

export const getAllDentallyAppointments = async (req: Request, res: Response): Promise<void> => {
    const { date } = req.params;
    let validatedDate: string;
    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Incoming request to fetch-all-dentally-appointments:', { params: req.params, query: req.query });
    }
    try {
        validatedDate = validateDateFormat(date);
    } catch (error) {
        res.status(400).json({ detail: 'Date must be in YYYY-MM-DD format' });
        return;
    }

    const allAppointments = [];
    let page = 1;
    const perPage = 100;
    let meta: { total_pages: number; current_page: number } = { total_pages: 1, current_page: 1 };

    while (true) {
        const url = `${DENTALLY_BASE_URL}/appointments?on=${validatedDate}&page=${page}&per_page=${perPage}`;
        if (process.env.NODE_ENV === 'development') {
            logger.info('[DentallyController] Fetching appointments from Dentally:', url);
        }
        const response = await axios.get(url, { headers });
        if (process.env.NODE_ENV === 'development') {
            logger.info('[DentallyController] Dentally response:', JSON.stringify(response.data));
        }

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
    await Appointment.deleteMany({});
    if (allAppointments.length > 0) {
        await Appointment.insertMany(allAppointments);
        res.status(200).json({
            source: 'dentally',
            message: `Fetched and saved ${allAppointments.length} appointments from ${meta.total_pages} page(s).`,
            data: allAppointments
        });
    } else {
        res.status(200).json({
            source: 'dentally',
            message: 'No appointments found to save',
            data: []
        });
    }

    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Final response to client:', res.statusCode === 200 ? res.json() : res.json({ detail: res.statusMessage }));
    }
};

const setNestedValue = (dictionary: Record<string, any>, keys: string[], value: any): void => {
    for (const key of keys.slice(0, -1)) {
        dictionary = dictionary[key] = dictionary[key] || {};
    }
    dictionary[keys[keys.length - 1]] = value;
};

export const uploadPractitionerExcel = async (req: MulterRequest, res: Response): Promise<void> => {
    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Incoming request to upload-practitioners-excel-file:', { body: req.body, file: req.file });
    }
    try {
        if (!req.file) {
            res.status(400).json({ detail: 'No file uploaded' });
            return;
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const headers = data[0] as string[];
        const rows = data.slice(1) as any[][];
        const dataToInsert: Record<string, any>[] = [];

        for (const row of rows) {
            const nestedRecord: Record<string, any> = {};
            for (let i = 0; i < headers.length; i++) {
                if (!headers[i]) continue;
                const keys = headers[i].split('.');
                setNestedValue(nestedRecord, keys, row[i]);
            }
            dataToInsert.push(nestedRecord);
        }

        if (dataToInsert.length === 0) {
            res.status(400).json({ detail: 'No data to insert' });
            return;
        }

        if (process.env.NODE_ENV === 'development') {
            logger.info('[DentallyController] Practitioners to insert:', dataToInsert.length);
        }

        await Practitioner.deleteMany({});
        await Practitioner.insertMany(dataToInsert);

        res.status(200).json({
            message: 'Upload successful',
            inserted_count: dataToInsert.length
        });
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            logger.error('[DentallyController] Error uploading practitioner Excel:', error);
        }
        if (error instanceof Error) {
            res.status(500).json({ detail: error.message });
        } else {
            res.status(500).json({ detail: 'An unknown error occurred' });
        }
    }

    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Final response to client:', res.statusCode === 200 ? res.json() : res.json({ detail: res.statusMessage }));
    }
};

export const uploadMappingExcel = async (req: MulterRequest, res: Response): Promise<void> => {
    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Incoming request to upload-practitioners-mapping-excel-file:', { body: req.body, file: req.file });
    }
    try {
        if (!req.file) {
            res.status(400).json({ detail: 'No file uploaded' });
            return;
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const headers = data[0] as (string | null)[];
        if (!headers || headers.some(header => header === null)) {
            res.status(400).json({ detail: 'Invalid or missing headers in the Excel file.' });
            return;
        }

        await TreatmentDetails.deleteMany({});

        const dataToInsert: Record<string, any>[] = [];
        for (const row of data.slice(1) as any[][]) {
            if (!row.some((cell: any) => cell !== null)) continue;

            const record: Record<string, any> = {};
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

        if (process.env.NODE_ENV === 'development') {
            logger.info('[DentallyController] Mapping records to insert:', dataToInsert.length);
        }

        await TreatmentDetails.insertMany(dataToInsert);

        res.status(200).json({
            message: 'Upload successful',
            inserted_count: dataToInsert.length
        });
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            logger.error('[DentallyController] Error uploading mapping Excel:', error);
        }
        if (error instanceof Error) {
            res.status(500).json({ detail: `Error processing file: ${error.message}` });
        } else {
            res.status(500).json({ detail: 'An unknown error occurred' });
        }
    }

    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Final response to client:', res.statusCode === 200 ? res.json() : res.json({ detail: res.statusMessage }));
    }
};

export const syncPaymentPlans = async (req: Request, res: Response): Promise<void> => {
    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Incoming request to sync-payment-plans:', { body: req.body });
    }
    try {
        const response = await axios.get(`${DENTALLY_BASE_URL}/payment_plans?active=true`, { headers });
        if (process.env.NODE_ENV === 'development') {
            logger.info('[DentallyController] Dentally payment plans response:', JSON.stringify(response.data));
        }
        const data = response.data;

        const paymentPlans = data.payment_plans || [];
        if (paymentPlans.length === 0) {
            res.status(404).json({ detail: 'No payment plans found in API response' });
            return;
        }

        await PaymentPlan.deleteMany({});
        await PaymentPlan.insertMany(paymentPlans);

        res.status(200).json({
            source: 'dentally',
            message: 'Payment plans fetched and stored successfully.',
            stored_count: paymentPlans.length,
            data: paymentPlans
        });
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            logger.error('[DentallyController] Error syncing payment plans:', error);
        }
        if (error instanceof AxiosError) {
            res.status(502).json({ detail: `Failed to fetch payment plans: ${error.message}` });
        } else if (error instanceof Error) {
            res.status(500).json({ detail: `Unexpected error: ${error.message}` });
        } else {
            res.status(500).json({ detail: 'An unknown error occurred' });
        }
    }

    if (process.env.NODE_ENV === 'development') {
        logger.info('[DentallyController] Final response to client:', res.statusCode === 200 ? res.json() : res.json({ detail: res.statusMessage }));
    }
}; 