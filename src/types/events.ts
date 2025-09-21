import { Ship, AttackResult } from './index';

// Base event interface
export interface BaseGameEvent {
  type: GameEventType;
  gameId: string;
  timestamp: string;
  data: any;
}

// Event types supported by SSE
export type GameEventType =
  | 'player_joined'
  | 'ships_placed'
  | 'game_started'
  | 'attack_made'
  | 'game_finished'
  | 'player_disconnected'
  | 'connection_established'
  | 'heartbeat';

// Specific event data interfaces
export interface PlayerJoinedEventData {
  playerId: string;
  playerName: string;
  playerCount: number;
}

export interface ShipsPlacedEventData {
  playerId: string;
  playerName: string;
  isReady: boolean;
  allPlayersReady: boolean;
}

export interface GameStartedEventData {
  currentTurn: string;
  currentPlayerName: string;
  phase: 'playing';
}

export interface AttackMadeEventData {
  attackerId: string;
  attackerName: string;
  targetId: string;
  targetName: string;
  position: string;
  result: 'hit' | 'miss' | 'sunk';
  sunkShip?: Ship;
  nextTurn: string;
  nextPlayerName: string;
}

export interface GameFinishedEventData {
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  phase: 'finished';
}

export interface PlayerDisconnectedEventData {
  playerId: string;
  playerName: string;
  remainingPlayers: number;
}

export interface ConnectionEstablishedEventData {
  playerId: string;
  playerName: string;
  gamePhase: string;
  connectedAt: string;
}

export interface HeartbeatEventData {
  timestamp: string;
  gameId: string;
}

// Typed event interfaces
export interface PlayerJoinedEvent extends BaseGameEvent {
  type: 'player_joined';
  data: PlayerJoinedEventData;
}

export interface ShipsPlacedEvent extends BaseGameEvent {
  type: 'ships_placed';
  data: ShipsPlacedEventData;
}

export interface GameStartedEvent extends BaseGameEvent {
  type: 'game_started';
  data: GameStartedEventData;
}

export interface AttackMadeEvent extends BaseGameEvent {
  type: 'attack_made';
  data: AttackMadeEventData;
}

export interface GameFinishedEvent extends BaseGameEvent {
  type: 'game_finished';
  data: GameFinishedEventData;
}

export interface PlayerDisconnectedEvent extends BaseGameEvent {
  type: 'player_disconnected';
  data: PlayerDisconnectedEventData;
}

export interface ConnectionEstablishedEvent extends BaseGameEvent {
  type: 'connection_established';
  data: ConnectionEstablishedEventData;
}

export interface HeartbeatEvent extends BaseGameEvent {
  type: 'heartbeat';
  data: HeartbeatEventData;
}

// Union type for all possible events
export type GameEvent =
  | PlayerJoinedEvent
  | ShipsPlacedEvent
  | GameStartedEvent
  | AttackMadeEvent
  | GameFinishedEvent
  | PlayerDisconnectedEvent
  | ConnectionEstablishedEvent
  | HeartbeatEvent;

// Connection interface for SSE management
export interface PlayerConnection {
  gameId: string;
  playerId: string;
  playerName: string;
  response: Response;
  connectedAt: Date;
  lastHeartbeat: Date;
}

// SSE-specific interfaces
export interface SSEMessage {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export interface ConnectionStats {
  totalConnections: number;
  connectionsPerGame: Record<string, number>;
  uptime: number;
}