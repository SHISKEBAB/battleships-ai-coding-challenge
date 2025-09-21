import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { logger } from './middleware/logger';
import {
  errorHandler,
  notFoundHandler,
  setupGlobalErrorHandlers,
  asyncErrorHandler
} from './middleware/errorHandler';
import {
  requestLogger,
  securityLogger,
  rateLimitLogger
} from './middleware/requestLogger';
import {
  addCorrelationId,
  parseJSON,
  handleJSONParsingError,
  validateRequest
} from './middleware/validation';
import { createGameRoutes } from './routes/games';
import { GameManager } from './services/GameManager';
import { AuthService } from './services/AuthService';
import { ConnectionManager } from './services/ConnectionManager';

dotenv.config();

// Setup global error handlers
setupGlobalErrorHandlers();

const app = express();

// Initialize services
const connectionManager = new ConnectionManager();
const gameManager = new GameManager(connectionManager);
const authService = new AuthService();

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

// Request parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Handle JSON parsing errors
app.use(handleJSONParsingError);

// Enhanced logging and monitoring middleware
app.use(addCorrelationId);
app.use(requestLogger);
app.use(securityLogger);
app.use(rateLimitLogger);
app.use(logger);

// Global request validation
app.use(validateRequest);
app.use(parseJSON);

// Health check endpoint with enhanced metrics
app.get('/health', asyncErrorHandler(async (req: express.Request, res: express.Response) => {
  const correlationId = req.headers['x-correlation-id'] as string;

  // Basic health status
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    correlationId,
    services: {
      gameManager: gameManager ? 'available' : 'unavailable',
      authService: authService ? 'available' : 'unavailable',
      connectionManager: connectionManager ? 'available' : 'unavailable'
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100
    }
  };

  res.status(200).json(healthStatus);
}));

// API routes
app.use('/api/games', createGameRoutes(gameManager, authService, connectionManager));

// Handle 404 for unmatched routes
app.use('*', notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  connectionManager.destroy();
  gameManager.destroy();
  authService.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  connectionManager.destroy();
  gameManager.destroy();
  authService.destroy();
  process.exit(0);
});
export default app;