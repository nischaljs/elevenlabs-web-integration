import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { closeDB, connectDB, isDBConnected } from './config/database';
import elevenlabsRoutes from './routes/elevenlabs.routes';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Logging middleware
app.use(morgan('combined'));

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

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
  logger.info(`[${new Date().toISOString()}] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'ElevenLabs Integration Server',
    version: '1.0.0',
    status: 'operational'
  });
});

// Apply rate limiting to ElevenLabs routes
app.use('/api/v1', elevenlabsRoutes);

// Health check endpoint for API versioning
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    message: 'API is healthy',
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  // Only check mongoose connection state, do not reconnect
  const dbState = isDBConnected() ? 'connected' : 'disconnected';
  res.json({
    status: dbState === 'connected' ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbState,
    memory: process.memoryUsage(),
  });
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
  logger.error('Error:', err.stack);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server
connectDB()
  .then(() => {
    const server = app.listen(port, () => {
      logger.info(`Server is running on port ${port} in ${process.env.NODE_ENV} mode`);
      console.log(`🚀 Server is running on port ${port} in ${process.env.NODE_ENV} mode`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await closeDB();
      logger.info('MongoDB connection closed');
      server.close(() => {
        logger.info('Server closed');
      process.exit(0);
      });
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await closeDB();
      logger.info('MongoDB connection closed');
      server.close(() => {
        logger.info('Server closed');
      process.exit(0);
      });
    });
  })
  .catch((error) => {
    logger.error('[Server] Failed to start server:');
    logger.error(error);
    process.exit(1);
  });
