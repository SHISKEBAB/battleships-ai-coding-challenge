export interface Player {
  id: string;
  name: string;
  ready: boolean;
  board: GameBoard;
  ships: Ship[];
}

export interface Game {
  gameId: string;
  phase: GamePhase;
  players: Record<string, Player>;
  currentTurn: string | null;
  winner: string | null;
  createdAt: Date;
  lastActivity: Date;
  metadata: GameMetadata;
  state: GameState;
  history: GameHistoryEntry[];
  statistics: GameStatistics;
}

export type GamePhase = 'waiting' | 'setup' | 'playing' | 'paused' | 'finished' | 'abandoned';

export interface GameMetadata {
  version: string;
  rules: GameRules;
  settings: GameSettings;
  hostPlayerId: string;
  timeouts: GameTimeouts;
  tags: string[];
}

export interface GameRules {
  boardSize: number;
  shipTypes: ShipType[];
  maxPlayers: number;
  turnTimeLimit: number;
  allowAdjacent: boolean;
  allowTouchingShips: boolean;
}

export interface GameSettings {
  isPrivate: boolean;
  allowSpectators: boolean;
  autoStart: boolean;
  pauseOnDisconnect: boolean;
  recordHistory: boolean;
}

export interface GameTimeouts {
  inactivityTimeout: number;
  turnTimeout: number;
  setupTimeout: number;
  reconnectGracePeriod: number;
}

export interface GameState {
  isValid: boolean;
  integrity: StateIntegrity;
  pauseInfo?: PauseInfo;
  turnInfo: TurnInfo;
  phaseTransitions: PhaseTransition[];
}

export interface StateIntegrity {
  checksum: string;
  lastValidated: Date;
  validationErrors: string[];
}

export interface PauseInfo {
  reason: 'disconnect' | 'manual' | 'timeout' | 'system';
  pausedAt: Date;
  pausedBy?: string;
  resumedAt?: Date;
  resumedBy?: string;
  duration?: number;
}

export interface TurnInfo {
  turnNumber: number;
  turnStartedAt: Date;
  timeRemaining?: number;
  previousTurn?: string;
  turnHistory: TurnHistoryEntry[];
}

export interface TurnHistoryEntry {
  playerId: string;
  turnNumber: number;
  startedAt: Date;
  endedAt?: Date;
  action?: string;
  duration?: number;
}

export interface PhaseTransition {
  fromPhase: GamePhase;
  toPhase: GamePhase;
  transitionedAt: Date;
  triggeredBy?: string;
  reason?: string;
}

export interface GameHistoryEntry {
  id: string;
  timestamp: Date;
  type: string;
  playerId?: string;
  data: any;
  phase: GamePhase;
  turnNumber?: number;
}

export interface GameStatistics {
  totalTurns: number;
  totalShots: number;
  totalHits: number;
  totalMisses: number;
  averageTurnTime: number;
  longestTurn: number;
  gameStartedAt?: Date;
  gameEndedAt?: Date;
  gameDuration?: number;
  playerStats: Record<string, PlayerStatistics>;
}

export interface PlayerStatistics {
  shotsAttempted: number;
  shotsHit: number;
  shotsMissed: number;
  shipsDestroyed: number;
  accuracyRate: number;
  averageResponseTime: number;
  totalTimeSpent: number;
  longestTurnTime: number;
}

export interface ShipType {
  name: string;
  length: number;
  count: number;
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

// Game State Management interfaces
export interface GameQuery {
  phase?: GamePhase | GamePhase[];
  hostPlayerId?: string;
  playerIds?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  lastActivityAfter?: Date;
  lastActivityBefore?: Date;
  tags?: string[];
  isPrivate?: boolean;
  minPlayers?: number;
  maxPlayers?: number;
}

export interface GameQueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: GameSortField;
  sortOrder?: 'asc' | 'desc';
  includeHistory?: boolean;
  includeStatistics?: boolean;
}

export type GameSortField = 'createdAt' | 'lastActivity' | 'phase' | 'playerCount' | 'turnNumber';

export interface GameFilterResult {
  games: Game[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
}

export interface GameStateValidationResult {
  isValid: boolean;
  errors: StateValidationError[];
  warnings: StateValidationWarning[];
  corrected: boolean;
}

export interface StateValidationError {
  type: 'integrity' | 'consistency' | 'rules' | 'data';
  field: string;
  message: string;
  severity: 'critical' | 'major' | 'minor';
  suggestedFix?: string;
}

export interface StateValidationWarning {
  type: 'performance' | 'data_quality' | 'deprecated';
  field: string;
  message: string;
  recommendation?: string;
}

export interface GameStateSnapshot {
  gameId: string;
  snapshotId: string;
  timestamp: Date;
  game: Game;
  reason: string;
  triggeredBy?: string;
}

export interface GameRecoveryInfo {
  canRecover: boolean;
  lastValidSnapshot?: GameStateSnapshot;
  recoverySteps: string[];
  dataLoss: string[];
}

export interface BatchGameOperation {
  operation: 'delete' | 'archive' | 'validate' | 'cleanup';
  query: GameQuery;
  options?: {
    dryRun?: boolean;
    batchSize?: number;
    onProgress?: (processed: number, total: number) => void;
  };
}

export interface BatchOperationResult {
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{
    gameId: string;
    error: string;
  }>;
  summary: string;
}