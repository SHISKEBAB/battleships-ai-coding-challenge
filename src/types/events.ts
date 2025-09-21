import { Ship, AttackResult } from './index';
import { Response } from 'express';

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
  | 'player_reconnected'
  | 'connection_established'
  | 'game_paused'
  | 'game_resumed'
  | 'reconnection_available'
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

export interface PlayerReconnectedEventData {
  playerId: string;
  playerName: string;
  sessionId: string;
  reconnectedAt: string;
  gamePhase: string;
}

export interface GamePausedEventData {
  playerId: string;
  playerName: string;
  reason: 'disconnect' | 'manual';
  pausedAt: string;
  currentTurn?: string;
}

export interface GameResumedEventData {
  resumedAt: string;
  currentTurn?: string;
  reason: 'reconnect' | 'manual';
}

export interface ReconnectionAvailableEventData {
  playerId: string;
  playerName: string;
  sessionId: string;
  gameId: string;
  availableUntil: string;
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

export interface PlayerReconnectedEvent extends BaseGameEvent {
  type: 'player_reconnected';
  data: PlayerReconnectedEventData;
}

export interface GamePausedEvent extends BaseGameEvent {
  type: 'game_paused';
  data: GamePausedEventData;
}

export interface GameResumedEvent extends BaseGameEvent {
  type: 'game_resumed';
  data: GameResumedEventData;
}

export interface ReconnectionAvailableEvent extends BaseGameEvent {
  type: 'reconnection_available';
  data: ReconnectionAvailableEventData;
}

// Union type for all possible events
export type GameEvent =
  | PlayerJoinedEvent
  | ShipsPlacedEvent
  | GameStartedEvent
  | AttackMadeEvent
  | GameFinishedEvent
  | PlayerDisconnectedEvent
  | PlayerReconnectedEvent
  | ConnectionEstablishedEvent
  | GamePausedEvent
  | GameResumedEvent
  | ReconnectionAvailableEvent
  | HeartbeatEvent;

// Connection interface for SSE management
export interface PlayerConnection {
  gameId: string;
  playerId: string;
  playerName: string;
  response: Response;
  connectedAt: Date;
  lastHeartbeat: Date;
  sessionId: string;
  reconnectionToken?: string;
}

// Disconnected player session interface for reconnection
export interface DisconnectedSession {
  gameId: string;
  playerId: string;
  playerName: string;
  sessionId: string;
  disconnectedAt: Date;
  reconnectionToken: string;
  expiresAt: Date;
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
  disconnectedSessions: number;
  uptime: number;
}