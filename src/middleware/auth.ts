import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/AuthService';
import { PlayerToken } from '../types';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

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
    const correlationId = req.headers['x-correlation-id'] as string;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new UnauthorizedError(
        'Missing or invalid authorization header',
        'missing_token',
        correlationId
      ));
    }

    const token = authHeader.substring(7);
    const playerToken = this.authService.validateToken(token);

    if (!playerToken) {
      return next(new UnauthorizedError(
        'Invalid or expired token',
        'invalid_token',
        correlationId
      ));
    }

    req.player = playerToken;
    next();
  };

  requireGameAccess = (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = req.headers['x-correlation-id'] as string;

    if (!req.player) {
      return next(new UnauthorizedError(
        'Authentication required',
        'missing_token',
        correlationId
      ));
    }

    const gameId = req.params.gameId;
    if (req.player.gameId !== gameId) {
      return next(new ForbiddenError(
        'Access denied to this game',
        `game:${gameId}`,
        correlationId
      ));
    }

    next();
  };
}