import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { logger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { createGameRoutes } from './routes/games';
import { GameManager } from './services/GameManager';
import { AuthService } from './services/AuthService';

dotenv.config();

const app = express();

// Initialize services
const gameManager = new GameManager();
const authService = new AuthService();

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(logger);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/games', createGameRoutes(gameManager, authService));

app.use(errorHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  gameManager.destroy();
  authService.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  gameManager.destroy();
  authService.destroy();
  process.exit(0);
});

export default app;