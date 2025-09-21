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

export interface ShipPlacement {
  length: number;
  startPosition: string;
  direction: 'horizontal' | 'vertical';
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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  conflictingPositions?: string[];
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