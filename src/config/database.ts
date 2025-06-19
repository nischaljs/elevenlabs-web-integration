import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME;

if (!MONGO_URI || !MONGO_DB_NAME) {
    throw new Error('MONGO_URI and MONGO_DB_NAME must be set in environment variables');
}

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI, {
            dbName: MONGO_DB_NAME,
            serverSelectionTimeoutMS: 3000
        });
        console.log('[Database] MongoDB connected successfully');
    } catch (error) {
        console.error('[Database] MongoDB connection failed:', error);
        throw error;
    }
};

export const closeDB = async () => {
    try {
        await mongoose.connection.close();
        console.log('[Database] MongoDB connection closed');
    } catch (error) {
        console.error('[Database] Error closing MongoDB connection:', error);
        throw error;
    }
};

// Export the mongoose connection for direct access if needed
export const db = mongoose.connection; 