"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.closeDB = exports.connectDB = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME;
if (!MONGO_URI || !MONGO_DB_NAME) {
    throw new Error('MONGO_URI and MONGO_DB_NAME must be set in environment variables');
}
const connectDB = async () => {
    try {
        await mongoose_1.default.connect(MONGO_URI, {
            dbName: MONGO_DB_NAME,
            serverSelectionTimeoutMS: 3000
        });
        console.log('[Database] MongoDB connected successfully');
    }
    catch (error) {
        console.error('[Database] MongoDB connection failed:', error);
        throw error;
    }
};
exports.connectDB = connectDB;
const closeDB = async () => {
    try {
        await mongoose_1.default.connection.close();
        console.log('[Database] MongoDB connection closed');
    }
    catch (error) {
        console.error('[Database] Error closing MongoDB connection:', error);
        throw error;
    }
};
exports.closeDB = closeDB;
// Export the mongoose connection for direct access if needed
exports.db = mongoose_1.default.connection;
