import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { connectDB, closeDB } from './config/database';
import appointmentRoutes from './routes/appointment.routes';
import dentallyRoutes from './routes/dentally.routes';
import elevenlabsRoutes from './routes/elevenlabs.routes';
import logForDev from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Logging middleware
app.use(morgan('dev'));

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }),
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logForDev(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Database connection check middleware
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    logForDev('Database connection failed:');
    logForDev(error);
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
app.use('/api/v1', appointmentRoutes);
app.use('/api/v1', dentallyRoutes);
app.use('/api/v1', elevenlabsRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await connectDB();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected',
    });
  } catch (error) {
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
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logForDev(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
connectDB()
  .then(() => {
    const server = app.listen(port, () => {
      logForDev(`Server is running on port ${port} in ${process.env.NODE_ENV} mode`);
      console.log(`Server is running on port ${port} in ${process.env.NODE_ENV} mode`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await closeDB();
      logForDev(' MongoDB connection closed');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await closeDB();
      process.exit(0);
    });
  })
  .catch((error) => {
    logForDev('[Server] Failed to start server:');
    logForDev(error);
    process.exit(1);
  });
