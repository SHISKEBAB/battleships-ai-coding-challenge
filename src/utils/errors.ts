/**
 * Custom error classes for the Battleships API
 * Provides standardized error types with consistent naming and structure
 */

/**
 * Base application error class
 * All custom errors should extend this class
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;
  readonly isOperational: boolean = true;
  readonly timestamp: string;
  readonly correlationId?: string;
  public details?: any;

  constructor(
    message: string,
    details?: any,
    correlationId?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    this.correlationId = correlationId;
    this.details = details;

    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON response format
   */
  toJSON() {
    return {
      error: this.errorCode,
      message: this.message,
      timestamp: this.timestamp,
      ...(this.details && process.env.NODE_ENV === 'development' && { details: this.details }),
      ...(this.correlationId && { correlationId: this.correlationId })
    };
  }
}

/**
 * Validation Error (400 Bad Request)
 * Used for input validation failures, malformed requests, invalid data format
 */
export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly field?: string,
    public readonly validationRules?: string[],
    correlationId?: string
  ) {
    super(message, { field, validationRules }, correlationId);
  }
}

/**
 * Authentication Error (401 Unauthorized)
 * Used for missing, invalid, or expired authentication tokens
 */
export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly errorCode = 'UNAUTHORIZED';

  constructor(
    message: string = 'Authentication required',
    public readonly reason?: 'missing_token' | 'invalid_token' | 'expired_token',
    correlationId?: string
  ) {
    super(message, { reason }, correlationId);
  }
}

/**
 * Authorization Error (403 Forbidden)
 * Used when user is authenticated but lacks permission for the requested resource
 */
export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly errorCode = 'FORBIDDEN';

  constructor(
    message: string = 'Access denied',
    public readonly resource?: string,
    correlationId?: string
  ) {
    super(message, { resource }, correlationId);
  }
}

/**
 * Not Found Error (404 Not Found)
 * Used when requested resource doesn't exist
 */
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly errorCode = 'NOT_FOUND';

  constructor(
    message: string,
    public readonly resourceType?: string,
    public readonly resourceId?: string,
    correlationId?: string
  ) {
    super(message, { resourceType, resourceId }, correlationId);
  }
}

/**
 * Conflict Error (409 Conflict)
 * Used for business logic conflicts, duplicate resources, invalid state transitions
 */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly errorCode = 'CONFLICT';

  constructor(
    message: string,
    public readonly conflictType?: string,
    public readonly currentState?: any,
    correlationId?: string
  ) {
    super(message, { conflictType, currentState }, correlationId);
  }
}

/**
 * Rate Limit Error (429 Too Many Requests)
 * Used when client exceeds rate limits
 */
export class RateLimitError extends AppError {
  readonly statusCode = 429;
  readonly errorCode = 'RATE_LIMIT_EXCEEDED';

  constructor(
    message: string = 'Rate limit exceeded',
    public readonly retryAfter?: number,
    correlationId?: string
  ) {
    super(message, { retryAfter }, correlationId);
  }
}

/**
 * Internal Server Error (500 Internal Server Error)
 * Used for unexpected application errors
 */
export class InternalServerError extends AppError {
  readonly statusCode = 500;
  readonly errorCode = 'INTERNAL_SERVER_ERROR';

  constructor(
    message: string = 'An unexpected error occurred',
    public readonly originalError?: Error,
    correlationId?: string
  ) {
    super(message, process.env.NODE_ENV === 'development' ? { originalError: originalError?.stack } : undefined, correlationId);
  }
}

/**
 * Game-specific validation error
 * Used for battleships game rule violations
 */
export class GameValidationError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'GAME_VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly gameRule?: string,
    public readonly violationType?: 'ship_placement' | 'attack_position' | 'turn_order' | 'game_phase',
    correlationId?: string
  ) {
    super(message, { gameRule, violationType }, correlationId);
  }
}

/**
 * Player authentication/authorization error specific to games
 */
export class PlayerAuthError extends AppError {
  readonly statusCode = 401;
  readonly errorCode = 'PLAYER_AUTH_ERROR';

  constructor(
    message: string,
    public readonly gameId?: string,
    public readonly playerId?: string,
    correlationId?: string
  ) {
    super(message, { gameId, playerId }, correlationId);
  }
}

/**
 * Game state conflict error
 * Used when game operations conflict with current game state
 */
export class GameStateError extends AppError {
  readonly statusCode = 409;
  readonly errorCode = 'GAME_STATE_ERROR';

  constructor(
    message: string,
    public readonly expectedState?: string,
    public readonly actualState?: string,
    public readonly gameId?: string,
    correlationId?: string
  ) {
    super(message, { expectedState, actualState, gameId }, correlationId);
  }
}

/**
 * Turn validation error
 * Used when players attempt actions out of turn
 */
export class TurnValidationError extends AppError {
  readonly statusCode = 409;
  readonly errorCode = 'TURN_VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly currentTurn?: string,
    public readonly attemptedBy?: string,
    public readonly gameId?: string,
    correlationId?: string
  ) {
    super(message, { currentTurn, attemptedBy, gameId }, correlationId);
  }
}

/**
 * Ship placement validation error
 * Used for specific ship placement rule violations
 */
export class ShipPlacementError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'SHIP_PLACEMENT_ERROR';

  constructor(
    message: string,
    public readonly shipIndex?: number,
    public readonly conflictingPositions?: string[],
    public readonly placementRule?: string,
    correlationId?: string
  ) {
    super(message, { shipIndex, conflictingPositions, placementRule, violationType: 'ship_placement' }, correlationId);
  }
}

/**
 * JSON parsing error
 * Used when request body contains malformed JSON
 */
export class JSONParsingError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'JSON_PARSING_ERROR';

  constructor(
    message: string = 'Invalid JSON in request body',
    public readonly parseError?: string,
    correlationId?: string
  ) {
    super(message, { field: 'request_body', parseError, validationRules: ['valid_json'] }, correlationId);
  }
}

/**
 * Required field error
 * Used when required fields are missing from request
 */
export class RequiredFieldError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'REQUIRED_FIELD_ERROR';

  constructor(
    field: string,
    correlationId?: string
  ) {
    super(`${field} is required`, { field, validationRules: ['required'] }, correlationId);
  }
}

/**
 * Invalid field type error
 * Used when field has wrong data type
 */
export class InvalidFieldTypeError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'INVALID_FIELD_TYPE_ERROR';

  constructor(
    field: string,
    expectedType: string,
    actualType: string,
    correlationId?: string
  ) {
    super(`${field} must be of type ${expectedType}, received ${actualType}`, { field, expectedType, actualType, validationRules: [`type:${expectedType}`] }, correlationId);
  }
}

/**
 * Field length validation error
 * Used when string fields violate length constraints
 */
export class FieldLengthError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'FIELD_LENGTH_ERROR';

  constructor(
    field: string,
    actualLength: number,
    minLength?: number,
    maxLength?: number,
    correlationId?: string
  ) {
    const constraints = [];
    let message = `${field} length is invalid`;

    if (minLength !== undefined && maxLength !== undefined) {
      message = `${field} must be between ${minLength} and ${maxLength} characters`;
      constraints.push(`length:${minLength}-${maxLength}`);
    } else if (minLength !== undefined) {
      message = `${field} must be at least ${minLength} characters`;
      constraints.push(`minLength:${minLength}`);
    } else if (maxLength !== undefined) {
      message = `${field} must be at most ${maxLength} characters`;
      constraints.push(`maxLength:${maxLength}`);
    }

    super(message, { field, actualLength, minLength, maxLength, validationRules: constraints }, correlationId);
  }
}

/**
 * Pattern validation error
 * Used when fields don't match required patterns (UUID, coordinates, etc.)
 */
export class PatternValidationError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = 'PATTERN_VALIDATION_ERROR';

  constructor(
    field: string,
    pattern: string,
    value?: string,
    correlationId?: string
  ) {
    super(`${field} format is invalid`, {
      field,
      pattern,
      value: process.env.NODE_ENV === 'development' ? value : undefined,
      validationRules: [`pattern:${pattern}`]
    }, correlationId);
  }
}

/**
 * Error factory functions for common scenarios
 */
export const ErrorFactory = {
  /**
   * Create a validation error for invalid UUID format
   */
  invalidUUID: (field: string, value?: string, correlationId?: string) =>
    new PatternValidationError(field, 'UUID v4', value, correlationId),

  /**
   * Create a validation error for invalid coordinate format
   */
  invalidCoordinate: (field: string, value?: string, correlationId?: string) =>
    new PatternValidationError(field, 'A1-J10', value, correlationId),

  /**
   * Create a validation error for invalid player token format
   */
  invalidPlayerToken: (correlationId?: string) =>
    new UnauthorizedError('Invalid player token format', 'invalid_token', correlationId),

  /**
   * Create a game not found error
   */
  gameNotFound: (gameId: string, correlationId?: string) =>
    new NotFoundError('Game not found', 'game', gameId, correlationId),

  /**
   * Create a player not found error
   */
  playerNotFound: (playerId: string, gameId?: string, correlationId?: string) =>
    new NotFoundError('Player not found', 'player', playerId, correlationId),

  /**
   * Create a game full error
   */
  gameFull: (gameId: string, correlationId?: string) =>
    new ConflictError('Game is full', 'game_capacity', { gameId, maxPlayers: 2 }, correlationId),

  /**
   * Create a duplicate player name error
   */
  duplicatePlayerName: (playerName: string, gameId: string, correlationId?: string) =>
    new ConflictError('Player name already taken in this game', 'duplicate_name', { playerName, gameId }, correlationId),

  /**
   * Create a ships already placed error
   */
  shipsAlreadyPlaced: (playerId: string, gameId: string, correlationId?: string) =>
    new ConflictError('Ships already placed', 'ships_placed', { playerId, gameId }, correlationId),

  /**
   * Create an invalid game phase error
   */
  invalidGamePhase: (currentPhase: string, expectedPhase: string | string[], gameId: string, correlationId?: string) =>
    new GameStateError(
      `Invalid game phase. Expected ${Array.isArray(expectedPhase) ? expectedPhase.join(' or ') : expectedPhase}, got ${currentPhase}`,
      Array.isArray(expectedPhase) ? expectedPhase.join('|') : expectedPhase,
      currentPhase,
      gameId,
      correlationId
    ),

  /**
   * Create a not your turn error
   */
  notYourTurn: (currentTurn: string, attemptedBy: string, gameId: string, correlationId?: string) =>
    new TurnValidationError('Not your turn', currentTurn, attemptedBy, gameId, correlationId)
};

/**
 * Type guard to check if error is an instance of AppError
 */
export function isAppError(error: any): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if error is operational (expected) vs programming error
 */
export function isOperationalError(error: any): boolean {
  return isAppError(error) && error.isOperational;
}