import { Request, Response, NextFunction } from 'express';
import { CreateGameRequest, JoinGameRequest, PlaceShipsRequest, AttackRequest } from '../types';
import {
  ValidationError,
  RequiredFieldError,
  InvalidFieldTypeError,
  FieldLengthError,
  PatternValidationError,
  ShipPlacementError,
  JSONParsingError,
  ErrorFactory
} from '../utils/errors';

/**
 * Generates a unique correlation ID for request tracking
 */
function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Middleware to generate correlation ID for each request
 */
export const addCorrelationId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.headers['x-correlation-id']) {
    req.headers['x-correlation-id'] = generateCorrelationId();
  }
  res.setHeader('X-Correlation-ID', req.headers['x-correlation-id'] as string);
  next();
};

/**
 * Enhanced JSON parsing middleware with better error handling
 */
export const parseJSON = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationId = req.headers['x-correlation-id'] as string;

  // Skip for GET requests and other methods that typically don't have body
  if (req.method === 'GET' || req.method === 'DELETE') {
    return next();
  }

  // Check if content-type is JSON
  const contentType = req.headers['content-type'];
  if (contentType && !contentType.includes('application/json')) {
    return next(new ValidationError(
      'Content-Type must be application/json',
      'content-type',
      ['application/json'],
      correlationId
    ));
  }

  // Check if body exists for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.body) {
    return next(new ValidationError(
      'Request body is required',
      'body',
      ['required'],
      correlationId
    ));
  }

  next();
};

/**
 * Validates string field with length constraints
 */
function validateString(
  value: any,
  fieldName: string,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    patternName?: string;
    trim?: boolean;
  },
  correlationId?: string
): string {
  // Check if required
  if (options.required && (value === undefined || value === null)) {
    throw new RequiredFieldError(fieldName, correlationId);
  }

  // If not required and empty, return empty string
  if (!options.required && (value === undefined || value === null)) {
    return '';
  }

  // Check type
  if (typeof value !== 'string') {
    throw new InvalidFieldTypeError(fieldName, 'string', typeof value, correlationId);
  }

  // Trim if requested
  const processedValue = options.trim ? value.trim() : value;

  // Check if empty after trimming (for required fields)
  if (options.required && options.trim && processedValue.length === 0) {
    throw new FieldLengthError(fieldName, 0, 1, undefined, correlationId);
  }

  // Check length constraints
  if (options.minLength !== undefined || options.maxLength !== undefined) {
    const length = processedValue.length;
    if (options.minLength !== undefined && length < options.minLength) {
      throw new FieldLengthError(fieldName, length, options.minLength, options.maxLength, correlationId);
    }
    if (options.maxLength !== undefined && length > options.maxLength) {
      throw new FieldLengthError(fieldName, length, options.minLength, options.maxLength, correlationId);
    }
  }

  // Check pattern
  if (options.pattern && !options.pattern.test(processedValue)) {
    throw new PatternValidationError(
      fieldName,
      options.patternName || options.pattern.toString(),
      processedValue,
      correlationId
    );
  }

  return processedValue;
}

/**
 * Validates UUID format
 */
function validateUUID(value: string, fieldName: string, correlationId?: string): string {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(value)) {
    throw ErrorFactory.invalidUUID(fieldName, value, correlationId);
  }

  return value;
}

/**
 * Validates coordinate format (A1-J10)
 */
function validateCoordinate(value: string, fieldName: string, correlationId?: string): string {
  const coordinatePattern = /^[A-J]([1-9]|10)$/;

  if (!coordinatePattern.test(value)) {
    throw ErrorFactory.invalidCoordinate(fieldName, value, correlationId);
  }

  return value;
}

/**
 * Validates ship direction
 */
function validateShipDirection(value: any, fieldName: string, correlationId?: string): 'horizontal' | 'vertical' {
  if (value !== 'horizontal' && value !== 'vertical') {
    throw new ValidationError(
      `${fieldName} must be 'horizontal' or 'vertical'`,
      fieldName,
      ['horizontal', 'vertical'],
      correlationId
    );
  }
  return value;
}

/**
 * Validates ship length
 */
function validateShipLength(value: any, fieldName: string, correlationId?: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new InvalidFieldTypeError(fieldName, 'integer', typeof value, correlationId);
  }

  if (value < 1 || value > 5) {
    throw new ValidationError(
      `${fieldName} must be between 1 and 5`,
      fieldName,
      ['range:1-5'],
      correlationId
    );
  }

  return value;
}

/**
 * Validates array field
 */
function validateArray(value: any, fieldName: string, options: {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  exactLength?: number;
}, correlationId?: string): any[] {
  // Check if required
  if (options.required && (value === undefined || value === null)) {
    throw new RequiredFieldError(fieldName, correlationId);
  }

  // If not required and empty, return empty array
  if (!options.required && (value === undefined || value === null)) {
    return [];
  }

  // Check if array
  if (!Array.isArray(value)) {
    throw new InvalidFieldTypeError(fieldName, 'array', typeof value, correlationId);
  }

  // Check length constraints
  const length = value.length;

  if (options.exactLength !== undefined && length !== options.exactLength) {
    throw new ValidationError(
      `${fieldName} must contain exactly ${options.exactLength} items`,
      fieldName,
      [`exactLength:${options.exactLength}`],
      correlationId
    );
  }

  if (options.minLength !== undefined && length < options.minLength) {
    throw new ValidationError(
      `${fieldName} must contain at least ${options.minLength} items`,
      fieldName,
      [`minLength:${options.minLength}`],
      correlationId
    );
  }

  if (options.maxLength !== undefined && length > options.maxLength) {
    throw new ValidationError(
      `${fieldName} must contain at most ${options.maxLength} items`,
      fieldName,
      [`maxLength:${options.maxLength}`],
      correlationId
    );
  }

  return value;
}

/**
 * Sanitizes input by removing dangerous characters and normalizing whitespace
 */
function sanitizeInput(value: string): string {
  return value
    .replace(/[<>"'&]/g, '') // Remove potentially dangerous HTML characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

export const validateCreateGameRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string;
    const body = req.body as CreateGameRequest;

    // Validate request body exists
    if (!body || typeof body !== 'object') {
      throw new ValidationError(
        'Request body must be a valid JSON object',
        'body',
        ['object'],
        correlationId
      );
    }

    // Validate and sanitize player name
    const playerName = validateString(body.playerName, 'playerName', {
      required: true,
      minLength: 1,
      maxLength: 50,
      trim: true
    }, correlationId);

    // Sanitize and update request body
    req.body.playerName = sanitizeInput(playerName);

    next();
  } catch (error) {
    next(error);
  }
};

export const validateJoinGameRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string;
    const body = req.body as JoinGameRequest;

    // Validate request body exists
    if (!body || typeof body !== 'object') {
      throw new ValidationError(
        'Request body must be a valid JSON object',
        'body',
        ['object'],
        correlationId
      );
    }

    // Validate and sanitize player name
    const playerName = validateString(body.playerName, 'playerName', {
      required: true,
      minLength: 1,
      maxLength: 50,
      trim: true
    }, correlationId);

    // Sanitize and update request body
    req.body.playerName = sanitizeInput(playerName);

    next();
  } catch (error) {
    next(error);
  }
};

export const validateGameId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string;
    const { gameId } = req.params;

    // Validate game ID exists
    if (!gameId) {
      throw new RequiredFieldError('gameId', correlationId);
    }

    // Validate game ID type
    if (typeof gameId !== 'string') {
      throw new InvalidFieldTypeError('gameId', 'string', typeof gameId, correlationId);
    }

    // Validate UUID format
    validateUUID(gameId, 'gameId', correlationId);

    next();
  } catch (error) {
    next(error);
  }
};

export const validatePlaceShipsRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string;
    const body = req.body as PlaceShipsRequest;

    // Validate request body exists
    if (!body || typeof body !== 'object') {
      throw new ValidationError(
        'Request body must be a valid JSON object',
        'body',
        ['object'],
        correlationId
      );
    }

    // Validate ships array
    const ships = validateArray(body.ships, 'ships', {
      required: true,
      exactLength: 5
    }, correlationId);

    // Expected ship lengths for battleships game
    const expectedLengths = [5, 4, 3, 3, 2];
    const providedLengths = ships.map(ship => {
      if (!ship || typeof ship !== 'object') {
        throw new ValidationError(
          'Each ship must be an object',
          'ships',
          ['object'],
          correlationId
        );
      }
      return ship.length;
    }).sort((a, b) => b - a);

    // Validate ship lengths match expected configuration
    if (JSON.stringify(providedLengths) !== JSON.stringify(expectedLengths)) {
      throw new ShipPlacementError(
        'Ships must have lengths: 5, 4, 3, 3, 2',
        undefined,
        undefined,
        'required_ship_lengths',
        correlationId
      );
    }

    // Validate each ship placement in detail
    const usedPositions = new Set<string>();

    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i];
      const shipPrefix = `ships[${i}]`;

      try {
        // Validate ship structure
        if (!ship || typeof ship !== 'object') {
          throw new ValidationError(
            `Ship ${i + 1} must be an object`,
            `${shipPrefix}`,
            ['object'],
            correlationId
          );
        }

        // Validate required fields
        const length = validateShipLength(ship.length, `${shipPrefix}.length`, correlationId);
        const startPosition = validateCoordinate(ship.startPosition, `${shipPrefix}.startPosition`, correlationId);
        const direction = validateShipDirection(ship.direction, `${shipPrefix}.direction`, correlationId);

        // Calculate all positions for this ship
        const shipPositions = calculateShipPositions(startPosition, length, direction);

        // Validate ship doesn't go out of bounds
        if (!shipPositions) {
          throw new ShipPlacementError(
            `Ship ${i + 1} extends beyond board boundaries`,
            i,
            [startPosition],
            'ship_bounds',
            correlationId
          );
        }

        // Check for overlapping positions
        const conflictingPositions = shipPositions.filter(pos => usedPositions.has(pos));
        if (conflictingPositions.length > 0) {
          throw new ShipPlacementError(
            `Ship ${i + 1} overlaps with another ship`,
            i,
            conflictingPositions,
            'ship_overlap',
            correlationId
          );
        }

        // Add positions to used set
        shipPositions.forEach(pos => usedPositions.add(pos));

      } catch (error) {
        // Re-throw with ship index context if it's not already a ShipPlacementError
        if (error instanceof ShipPlacementError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new ShipPlacementError(
          `Ship ${i + 1}: ${errorMessage}`,
          i,
          undefined,
          'ship_validation',
          correlationId
        );
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate all positions occupied by a ship
 */
function calculateShipPositions(
  startPosition: string,
  length: number,
  direction: 'horizontal' | 'vertical'
): string[] | null {
  const positions: string[] = [];
  const col = startPosition.charCodeAt(0) - 65; // A=0, B=1, etc.
  const row = parseInt(startPosition.slice(1)) - 1; // 1-based to 0-based

  for (let i = 0; i < length; i++) {
    let newCol = col;
    let newRow = row;

    if (direction === 'horizontal') {
      newCol = col + i;
    } else {
      newRow = row + i;
    }

    // Check bounds (10x10 board: A-J, 1-10)
    if (newCol < 0 || newCol > 9 || newRow < 0 || newRow > 9) {
      return null;
    }

    const position = String.fromCharCode(65 + newCol) + (newRow + 1);
    positions.push(position);
  }

  return positions;
}

export const validateAttackRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string;
    const body = req.body as AttackRequest;

    // Validate request body exists
    if (!body || typeof body !== 'object') {
      throw new ValidationError(
        'Request body must be a valid JSON object',
        'body',
        ['object'],
        correlationId
      );
    }

    // Validate position
    const position = validateCoordinate(body.position, 'position', correlationId);

    // Ensure position is properly formatted in request
    req.body.position = position;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to validate Authorization header format
 */
export const validateAuthHeader = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string;
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new ValidationError(
        'Authorization header is required',
        'authorization',
        ['required'],
        correlationId
      );
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new ValidationError(
        'Authorization header must start with "Bearer "',
        'authorization',
        ['bearer_format'],
        correlationId
      );
    }

    const token = authHeader.substring(7);
    if (!token || token.trim().length === 0) {
      throw new ValidationError(
        'Bearer token cannot be empty',
        'authorization',
        ['non_empty'],
        correlationId
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to handle malformed JSON parsing
 */
export const handleJSONParsingError = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationId = req.headers['x-correlation-id'] as string;

  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return next(new JSONParsingError(
      'Invalid JSON in request body',
      err.message,
      correlationId
    ));
  }

  next(err);
};

/**
 * Comprehensive request validation middleware that can be applied globally
 */
export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const correlationId = req.headers['x-correlation-id'] as string;

    // Validate request method
    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    if (!allowedMethods.includes(req.method)) {
      throw new ValidationError(
        `HTTP method ${req.method} is not allowed`,
        'method',
        allowedMethods,
        correlationId
      );
    }

    // Validate Content-Length for large requests
    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10MB limit
      throw new ValidationError(
        'Request body too large (max 10MB)',
        'content-length',
        ['max:10MB'],
        correlationId
      );
    }

    // Validate User-Agent (optional but recommended)
    const userAgent = req.headers['user-agent'];
    if (userAgent && userAgent.length > 500) {
      throw new ValidationError(
        'User-Agent header too long',
        'user-agent',
        ['max:500'],
        correlationId
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};