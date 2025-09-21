import { Request, Response, NextFunction } from 'express';
import { CreateGameRequest, JoinGameRequest, PlaceShipsRequest, AttackRequest } from '../types';

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

export const validatePlaceShipsRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { ships } = req.body as PlaceShipsRequest;

  if (!ships) {
    next(createValidationError('Ships array is required'));
    return;
  }

  if (!Array.isArray(ships)) {
    next(createValidationError('Ships must be an array'));
    return;
  }

  if (ships.length !== 5) {
    next(createValidationError('Exactly 5 ships must be provided'));
    return;
  }

  // Validate ship lengths match expected [5,4,3,3,2]
  const expectedLengths = [5, 4, 3, 3, 2];
  const providedLengths = ships.map(ship => ship.length).sort((a, b) => b - a);

  if (JSON.stringify(providedLengths) !== JSON.stringify(expectedLengths)) {
    next(createValidationError('Ships must have lengths: 5, 4, 3, 3, 2'));
    return;
  }

  // Validate each ship placement
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i];

    if (!ship.length || !ship.startPosition || !ship.direction) {
      next(createValidationError(`Ship ${i + 1}: length, startPosition, and direction are required`));
      return;
    }

    if (typeof ship.length !== 'number' || ship.length < 1 || ship.length > 5) {
      next(createValidationError(`Ship ${i + 1}: length must be a number between 1 and 5`));
      return;
    }

    if (typeof ship.startPosition !== 'string') {
      next(createValidationError(`Ship ${i + 1}: startPosition must be a string`));
      return;
    }

    // Validate position format (A1-J10)
    const positionPattern = /^[A-J]([1-9]|10)$/;
    if (!positionPattern.test(ship.startPosition)) {
      next(createValidationError(`Ship ${i + 1}: startPosition must be in format A1-J10`));
      return;
    }

    if (ship.direction !== 'horizontal' && ship.direction !== 'vertical') {
      next(createValidationError(`Ship ${i + 1}: direction must be 'horizontal' or 'vertical'`));
      return;
    }
  }

  next();
};

export const validateAttackRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { position } = req.body as AttackRequest;

  if (!position) {
    next(createValidationError('Position is required'));
    return;
  }

  if (typeof position !== 'string') {
    next(createValidationError('Position must be a string'));
    return;
  }

  // Validate position format (A1-J10)
  const positionPattern = /^[A-J]([1-9]|10)$/;
  if (!positionPattern.test(position)) {
    next(createValidationError('Position must be in format A1-J10'));
    return;
  }

  next();
};