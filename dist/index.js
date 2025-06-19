"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const morgan_1 = __importDefault(require("morgan"));
const database_1 = require("./config/database");
const appointment_routes_1 = __importDefault(require("./routes/appointment.routes"));
const dentally_routes_1 = __importDefault(require("./routes/dentally.routes"));
const elevenlabs_routes_1 = __importDefault(require("./routes/elevenlabs.routes"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Logging middleware
app.use((0, morgan_1.default)('dev'));
// Security middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
// Body parsing middleware
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
// Database connection check middleware
app.use(async (req, res, next) => {
    try {
        await (0, database_1.connectDB)();
        next();
    }
    catch (error) {
        console.error('Database connection failed:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Database connection failed',
        });
    }
});
// Root route
app.get('/', (req, res) => {
    res.json({ message: 'Hello World' });
});
// Routes with /api/v1 prefix to match FastAPI
app.use('/api/v1', appointment_routes_1.default);
app.use('/api/v1', dentally_routes_1.default);
app.use('/api/v1', elevenlabs_routes_1.default);
// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Check database connection
        await (0, database_1.connectDB)();
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: 'connected',
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: 'disconnected',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`,
    });
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});
// Start server
(0, database_1.connectDB)()
    .then(() => {
    const server = app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        await (0, database_1.closeDB)();
        console.log(' MongoDB connection closed');
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await (0, database_1.closeDB)();
        process.exit(0);
    });
})
    .catch((error) => {
    console.error('[Server] Failed to start server:', error);
    process.exit(1);
});
