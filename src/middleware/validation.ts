import { Request, Response, NextFunction } from 'express';
import { CreateGameRequest, JoinGameRequest } from '../types';

interface ValidationError extends Error {
  name: 'ValidationError';
}

function createValidationError(message: string): ValidationError {
  const error = new Error(message) as ValidationError;
  error.name = 'ValidationError';
  return error;
}

export const validateCreateGameRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { playerName } = req.body as CreateGameRequest;

  if (!playerName) {
    next(createValidationError('Player name is required'));
    return;
  }

  if (typeof playerName !== 'string') {
    next(createValidationError('Player name must be a string'));
    return;
  }

  if (playerName.trim().length === 0) {
    next(createValidationError('Player name cannot be empty'));
    return;
  }

  if (playerName.length > 50) {
    next(createValidationError('Player name must be 50 characters or less'));
    return;
  }

  // Sanitize player name
  req.body.playerName = playerName.trim();
  next();
};

export const validateJoinGameRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { playerName } = req.body as JoinGameRequest;

  if (!playerName) {
    next(createValidationError('Player name is required'));
    return;
  }

  if (typeof playerName !== 'string') {
    next(createValidationError('Player name must be a string'));
    return;
  }

  if (playerName.trim().length === 0) {
    next(createValidationError('Player name cannot be empty'));
    return;
  }

  if (playerName.length > 50) {
    next(createValidationError('Player name must be 50 characters or less'));
    return;
  }

  // Sanitize player name
  req.body.playerName = playerName.trim();
  next();
};

export const validateGameId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { gameId } = req.params;

  if (!gameId) {
    next(createValidationError('Game ID is required'));
    return;
  }

  if (typeof gameId !== 'string') {
    next(createValidationError('Game ID must be a string'));
    return;
  }

  // Basic UUID validation pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(gameId)) {
    next(createValidationError('Invalid game ID format'));
    return;
  }

  next();
};