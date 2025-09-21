import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService';
import { PlayerToken } from '../types';

declare global {
  namespace Express {
    interface Request {
      player?: PlayerToken;
    }
  }
}

export class AuthMiddleware {
  constructor(private authService: AuthService) {}

  authenticatePlayer = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'UnauthorizedError',
        message: 'Missing or invalid authorization header',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const token = authHeader.substring(7);
    const playerToken = this.authService.validateToken(token);

    if (!playerToken) {
      res.status(401).json({
        error: 'UnauthorizedError',
        message: 'Invalid or expired token',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.player = playerToken;
    next();
  };

  requireGameAccess = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.player) {
      res.status(401).json({
        error: 'UnauthorizedError',
        message: 'Authentication required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const gameId = req.params.gameId;
    if (req.player.gameId !== gameId) {
      res.status(403).json({
        error: 'ForbiddenError',
        message: 'Access denied to this game',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}