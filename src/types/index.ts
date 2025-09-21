export interface Player {
  id: string;
  name: string;
  ready: boolean;
  board: GameBoard;
  ships: Ship[];
}

export interface Game {
  gameId: string;
  phase: 'waiting' | 'setup' | 'playing' | 'finished';
  players: Record<string, Player>;
  currentTurn: string | null;
  winner: string | null;
  createdAt: Date;
  lastActivity: Date;
}

export interface GameBoard {
  size: number;
  hits: Set<string>;
  misses: Set<string>;
}

export interface Ship {
  id: string;
  length: number;
  positions: string[];
  hits: number;
  sunk: boolean;
}

// Traditional ship placement format
export interface TraditionalShipPlacement {
  length: number;
  startPosition: string;
  direction: 'horizontal' | 'vertical';
}

// Alternative ship placement format using position list
export interface PositionListShipPlacement {
  length: number;
  positions: string[];
}

// Union type for backward compatibility
export type ShipPlacement = TraditionalShipPlacement | PositionListShipPlacement;

// Type guards for ship placement formats
export function isTraditionalShipPlacement(placement: ShipPlacement): placement is TraditionalShipPlacement {
  return 'startPosition' in placement && 'direction' in placement;
}

export function isPositionListShipPlacement(placement: ShipPlacement): placement is PositionListShipPlacement {
  return 'positions' in placement && Array.isArray((placement as PositionListShipPlacement).positions);
}

export interface AttackResult {
  result: 'hit' | 'miss' | 'sunk';
  position: string;
  sunkShip?: Ship;
  gameState: 'playing' | 'won' | 'lost';
  nextTurn: string;
}

export interface PlayerToken {
  gameId: string;
  playerId: string;
  playerName: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface ValidationError {
  message: string;
  type: 'ship_count' | 'ship_length' | 'ship_overlap' | 'ship_adjacent' | 'ship_bounds' | 'position_format' | 'ship_format';
  shipIndex?: number;
  conflictingPositions?: string[];
  suggestions?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  conflictingPositions?: string[];
  suggestions?: string[];
}

export interface GameEvent {
  type: string;
  timestamp: string;
  gameId: string;
  data: any;
}

export interface PlayerConnection {
  gameId: string;
  playerId: string;
  response: Response;
  connectedAt: Date;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details?: any;
  timestamp: string;
}

export interface CreateGameRequest {
  playerName: string;
}

export interface CreateGameResponse {
  gameId: string;
  playerToken: string;
  playerId: string;
  gameState: any;
}

export interface JoinGameRequest {
  playerName: string;
}

export interface PlaceShipsRequest {
  ships: ShipPlacement[];
}

export interface AttackRequest {
  position: string;
}