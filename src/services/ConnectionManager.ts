import { Response } from 'express';
import { randomUUID } from 'crypto';
import {
  PlayerConnection,
  DisconnectedSession,
  GameEvent,
  ConnectionStats,
  SSEMessage,
  GameEventType,
  HeartbeatEvent,
  PlayerDisconnectedEvent,
  PlayerReconnectedEvent,
  ReconnectionAvailableEvent
} from '../types/events';

export class ConnectionManager {
  private connections = new Map<string, PlayerConnection>();
  private gameConnections = new Map<string, Set<string>>();
  private disconnectedSessions = new Map<string, DisconnectedSession>();
  private heartbeatInterval: NodeJS.Timeout;
  private cleanupInterval: NodeJS.Timeout;
  private sessionCleanupInterval: NodeJS.Timeout;
  private startTime: Date;
  private reconnectionTimeoutMs = 5 * 60 * 1000; // 5 minutes
  private heartbeatTimeoutMs = 90000; // 90 seconds (increased for better disconnect detection)
  private onPlayerDisconnect?: (gameId: string, playerId: string) => void;
  private onPlayerReconnect?: (gameId: string, playerId: string) => void;

  constructor() {
    this.startTime = new Date();

    // Send heartbeat every 30 seconds to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);

    // Clean up stale connections every 60 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 60000);

    // Clean up expired disconnected sessions every 2 minutes
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 120000);

    console.log('ConnectionManager initialized', {
      service: 'ConnectionManager',
      action: 'initialize',
      heartbeatInterval: 30000,
      cleanupInterval: 60000,
      sessionCleanupInterval: 120000,
      reconnectionTimeoutMs: this.reconnectionTimeoutMs
    });
  }

  /**
   * Set disconnect/reconnect event handlers
   */
  setEventHandlers(
    onPlayerDisconnect?: (gameId: string, playerId: string) => void,
    onPlayerReconnect?: (gameId: string, playerId: string) => void
  ): void {
    this.onPlayerDisconnect = onPlayerDisconnect;
    this.onPlayerReconnect = onPlayerReconnect;
  }

  /**
   * Add a new SSE connection for a player in a game
   */
  addConnection(
    gameId: string,
    playerId: string,
    playerName: string,
    response: Response,
    reconnectionToken?: string
  ): { sessionId: string; isReconnection: boolean } {
    const connectionKey = this.getConnectionKey(gameId, playerId);
    const sessionKey = this.getSessionKey(gameId, playerId);

    let sessionId: string;
    let isReconnection = false;

    // Check if this is a reconnection attempt
    if (reconnectionToken) {
      const disconnectedSession = this.disconnectedSessions.get(sessionKey);
      if (disconnectedSession && disconnectedSession.reconnectionToken === reconnectionToken) {
        sessionId = disconnectedSession.sessionId;
        isReconnection = true;
        this.disconnectedSessions.delete(sessionKey);

        console.log('Player reconnecting', {
          service: 'ConnectionManager',
          action: 'player_reconnection',
          gameId,
          playerId,
          playerName,
          sessionId
        });
      } else {
        throw new Error('Invalid or expired reconnection token');
      }
    } else {
      // Generate new session ID for new connections
      sessionId = randomUUID();
    }

    // Remove existing connection if any
    this.removeConnection(gameId, playerId, false); // Don't create disconnected session for immediate reconnect

    // Setup SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no', // For nginx compatibility
    });

    // Create connection object
    const connection: PlayerConnection = {
      gameId,
      playerId,
      playerName,
      response,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      sessionId,
      reconnectionToken
    };

    // Store connection
    this.connections.set(connectionKey, connection);

    // Add to game connections index
    if (!this.gameConnections.has(gameId)) {
      this.gameConnections.set(gameId, new Set());
    }
    this.gameConnections.get(gameId)!.add(connectionKey);

    // Handle connection close
    response.on('close', () => {
      this.handleConnectionClose(gameId, playerId, sessionId, 'client_close');
    });

    response.on('error', (error) => {
      console.error('SSE connection error', {
        service: 'ConnectionManager',
        action: 'connection_error',
        gameId,
        playerId,
        playerName,
        sessionId,
        error: error.message
      });
      this.handleConnectionClose(gameId, playerId, sessionId, 'connection_error');
    });

    if (isReconnection) {
      // Broadcast reconnection event
      this.broadcastPlayerReconnected(gameId, playerId, playerName, sessionId);

      // Notify game manager
      if (this.onPlayerReconnect) {
        this.onPlayerReconnect(gameId, playerId);
      }
    }

    console.info('SSE connection established', {
      service: 'ConnectionManager',
      action: isReconnection ? 'connection_reestablished' : 'connection_added',
      gameId,
      playerId,
      playerName,
      sessionId,
      isReconnection,
      totalConnections: this.connections.size
    });

    // Send connection established event
    this.sendToConnection(connectionKey, {
      type: 'connection_established',
      gameId,
      timestamp: new Date().toISOString(),
      data: {
        playerId,
        playerName,
        gamePhase: isReconnection ? 'reconnected' : 'connected',
        connectedAt: connection.connectedAt.toISOString()
      }
    });

    return { sessionId, isReconnection };
  }

  /**
   * Remove a connection for a player in a game
   */
  removeConnection(gameId: string, playerId: string, createDisconnectedSession = true): void {
    const connectionKey = this.getConnectionKey(gameId, playerId);
    const connection = this.connections.get(connectionKey);

    if (connection) {
      // Close the response if it's still open
      try {
        if (!connection.response.destroyed) {
          connection.response.end();
        }
      } catch (error) {
        console.warn('Error closing SSE response', {
          service: 'ConnectionManager',
          action: 'connection_close_error',
          gameId,
          playerId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Create disconnected session for potential reconnection
      if (createDisconnectedSession) {
        this.createDisconnectedSession(connection);
      }

      // Remove from connections
      this.connections.delete(connectionKey);

      // Remove from game connections index
      const gameConnections = this.gameConnections.get(gameId);
      if (gameConnections) {
        gameConnections.delete(connectionKey);
        if (gameConnections.size === 0) {
          this.gameConnections.delete(gameId);
        }
      }

      console.info('SSE connection removed', {
        service: 'ConnectionManager',
        action: 'connection_removed',
        gameId,
        playerId,
        playerName: connection.playerName,
        sessionId: connection.sessionId,
        totalConnections: this.connections.size,
        disconnectedSessionCreated: createDisconnectedSession
      });
    }
  }

  /**
   * Broadcast an event to all connected players in a game
   */
  broadcast(gameId: string, event: GameEvent, excludePlayer?: string): void {
    const gameConnections = this.gameConnections.get(gameId);
    if (!gameConnections || gameConnections.size === 0) {
      console.debug('No connections to broadcast to', {
        service: 'ConnectionManager',
        action: 'broadcast_no_connections',
        gameId,
        eventType: event.type
      });
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    for (const connectionKey of gameConnections) {
      const connection = this.connections.get(connectionKey);
      if (!connection) continue;

      // Skip excluded player
      if (excludePlayer && connection.playerId === excludePlayer) {
        continue;
      }

      if (this.sendToConnection(connectionKey, event)) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    console.info('Event broadcasted', {
      service: 'ConnectionManager',
      action: 'broadcast_complete',
      gameId,
      eventType: event.type,
      totalConnections: gameConnections.size,
      successCount,
      failureCount,
      excludedPlayer: excludePlayer
    });
  }

  /**
   * Get list of connected player IDs for a game
   */
  getConnectedPlayers(gameId: string): string[] {
    const gameConnections = this.gameConnections.get(gameId);
    if (!gameConnections) {
      return [];
    }

    const connectedPlayers: string[] = [];
    for (const connectionKey of gameConnections) {
      const connection = this.connections.get(connectionKey);
      if (connection) {
        connectedPlayers.push(connection.playerId);
      }
    }

    return connectedPlayers;
  }

  /**
   * Close all connections for a specific game
   */
  closeGameConnections(gameId: string): void {
    const gameConnections = this.gameConnections.get(gameId);
    if (!gameConnections) {
      return;
    }

    const connectionsToClose = Array.from(gameConnections);
    for (const connectionKey of connectionsToClose) {
      const connection = this.connections.get(connectionKey);
      if (connection) {
        this.removeConnection(gameId, connection.playerId);
      }
    }

    console.info('All game connections closed', {
      service: 'ConnectionManager',
      action: 'close_game_connections',
      gameId,
      closedConnections: connectionsToClose.length
    });
  }

  /**
   * Get reconnection token for a disconnected player
   */
  getReconnectionToken(gameId: string, playerId: string): string | null {
    const sessionKey = this.getSessionKey(gameId, playerId);
    const disconnectedSession = this.disconnectedSessions.get(sessionKey);

    if (disconnectedSession && disconnectedSession.expiresAt > new Date()) {
      return disconnectedSession.reconnectionToken;
    }

    return null;
  }

  /**
   * Check if a player can reconnect
   */
  canPlayerReconnect(gameId: string, playerId: string, reconnectionToken: string): boolean {
    const sessionKey = this.getSessionKey(gameId, playerId);
    const disconnectedSession = this.disconnectedSessions.get(sessionKey);

    return !!(
      disconnectedSession &&
      disconnectedSession.reconnectionToken === reconnectionToken &&
      disconnectedSession.expiresAt > new Date()
    );
  }

  /**
   * Get all disconnected players for a game
   */
  getDisconnectedPlayers(gameId: string): DisconnectedSession[] {
    const disconnectedPlayers: DisconnectedSession[] = [];

    for (const session of this.disconnectedSessions.values()) {
      if (session.gameId === gameId && session.expiresAt > new Date()) {
        disconnectedPlayers.push(session);
      }
    }

    return disconnectedPlayers;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    const connectionsPerGame: Record<string, number> = {};

    for (const [gameId, connections] of this.gameConnections.entries()) {
      connectionsPerGame[gameId] = connections.size;
    }

    return {
      totalConnections: this.connections.size,
      connectionsPerGame,
      disconnectedSessions: this.disconnectedSessions.size,
      uptime: Date.now() - this.startTime.getTime()
    };
  }

  /**
   * Send a heartbeat to all connections
   */
  private sendHeartbeat(): void {
    const heartbeatEvent: HeartbeatEvent = {
      type: 'heartbeat',
      gameId: '',
      timestamp: new Date().toISOString(),
      data: {
        timestamp: new Date().toISOString(),
        gameId: ''
      }
    };

    let activeConnections = 0;
    let staleConnections = 0;

    for (const [connectionKey, connection] of this.connections.entries()) {
      // Update heartbeat event with game-specific data
      heartbeatEvent.gameId = connection.gameId;
      heartbeatEvent.data.gameId = connection.gameId;

      if (this.sendToConnection(connectionKey, heartbeatEvent)) {
        connection.lastHeartbeat = new Date();
        activeConnections++;
      } else {
        staleConnections++;
      }
    }

    console.debug('Heartbeat sent', {
      service: 'ConnectionManager',
      action: 'heartbeat',
      activeConnections,
      staleConnections,
      totalConnections: this.connections.size
    });
  }

  /**
   * Clean up stale connections (connections that haven't responded to heartbeat)
   */
  private cleanupStaleConnections(): void {
    const now = new Date();
    const connectionsToRemove: Array<{ gameId: string; playerId: string; sessionId: string; reason: string }> = [];

    for (const [connectionKey, connection] of this.connections.entries()) {
      const timeSinceHeartbeat = now.getTime() - connection.lastHeartbeat.getTime();

      if (timeSinceHeartbeat > this.heartbeatTimeoutMs) {
        connectionsToRemove.push({
          gameId: connection.gameId,
          playerId: connection.playerId,
          sessionId: connection.sessionId,
          reason: 'heartbeat_timeout'
        });
      }
    }

    // Remove stale connections
    for (const { gameId, playerId, sessionId, reason } of connectionsToRemove) {
      this.handleConnectionClose(gameId, playerId, sessionId, reason);
    }

    if (connectionsToRemove.length > 0) {
      console.info('Stale connections cleaned up', {
        service: 'ConnectionManager',
        action: 'cleanup_stale_connections',
        removedConnections: connectionsToRemove.length,
        remainingConnections: this.connections.size
      });
    }
  }

  /**
   * Send an event to a specific connection
   */
  private sendToConnection(connectionKey: string, event: GameEvent): boolean {
    const connection = this.connections.get(connectionKey);
    if (!connection || connection.response.destroyed) {
      return false;
    }

    try {
      const sseMessage: SSEMessage = {
        event: event.type,
        data: JSON.stringify(event),
        id: `${event.gameId}-${Date.now()}`
      };

      let message = '';
      if (sseMessage.id) {
        message += `id: ${sseMessage.id}\n`;
      }
      if (sseMessage.event) {
        message += `event: ${sseMessage.event}\n`;
      }
      message += `data: ${sseMessage.data}\n\n`;

      connection.response.write(message);
      return true;
    } catch (error) {
      console.error('Failed to send SSE message', {
        service: 'ConnectionManager',
        action: 'send_message_error',
        connectionKey,
        gameId: connection.gameId,
        playerId: connection.playerId,
        eventType: event.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Generate connection key for a player in a game
   */
  private getConnectionKey(gameId: string, playerId: string): string {
    return `${gameId}:${playerId}`;
  }

  /**
   * Generate session key for disconnected sessions
   */
  private getSessionKey(gameId: string, playerId: string): string {
    return `${gameId}:${playerId}:session`;
  }

  /**
   * Handle connection close with disconnect reason tracking
   */
  private handleConnectionClose(gameId: string, playerId: string, sessionId: string, reason: string): void {
    const connection = this.connections.get(this.getConnectionKey(gameId, playerId));

    if (connection) {
      // Broadcast player disconnected event
      this.broadcastPlayerDisconnected(gameId, playerId, connection.playerName, reason);

      // Notify game manager
      if (this.onPlayerDisconnect) {
        this.onPlayerDisconnect(gameId, playerId);
      }
    }

    // Remove the connection and create disconnected session
    this.removeConnection(gameId, playerId, true);

    console.log('Connection closed with disconnect handling', {
      service: 'ConnectionManager',
      action: 'connection_closed_handled',
      gameId,
      playerId,
      sessionId,
      reason
    });
  }

  /**
   * Create a disconnected session for potential reconnection
   */
  private createDisconnectedSession(connection: PlayerConnection): void {
    const sessionKey = this.getSessionKey(connection.gameId, connection.playerId);
    const reconnectionToken = randomUUID();
    const expiresAt = new Date(Date.now() + this.reconnectionTimeoutMs);

    const disconnectedSession: DisconnectedSession = {
      gameId: connection.gameId,
      playerId: connection.playerId,
      playerName: connection.playerName,
      sessionId: connection.sessionId,
      disconnectedAt: new Date(),
      reconnectionToken,
      expiresAt
    };

    this.disconnectedSessions.set(sessionKey, disconnectedSession);

    // Broadcast reconnection available event to other players
    this.broadcastReconnectionAvailable(connection.gameId, connection.playerId, connection.playerName, connection.sessionId, expiresAt);

    console.log('Disconnected session created', {
      service: 'ConnectionManager',
      action: 'disconnected_session_created',
      gameId: connection.gameId,
      playerId: connection.playerId,
      sessionId: connection.sessionId,
      expiresAt: expiresAt.toISOString()
    });
  }

  /**
   * Clean up expired disconnected sessions
   */
  private cleanupExpiredSessions(): void {
    const now = new Date();
    const expiredSessions: string[] = [];

    for (const [sessionKey, session] of this.disconnectedSessions.entries()) {
      if (session.expiresAt <= now) {
        expiredSessions.push(sessionKey);
      }
    }

    for (const sessionKey of expiredSessions) {
      this.disconnectedSessions.delete(sessionKey);
    }

    if (expiredSessions.length > 0) {
      console.log('Expired disconnected sessions cleaned up', {
        service: 'ConnectionManager',
        action: 'cleanup_expired_sessions',
        expiredSessions: expiredSessions.length,
        remainingSessions: this.disconnectedSessions.size
      });
    }
  }

  /**
   * Broadcast player disconnected event
   */
  private broadcastPlayerDisconnected(gameId: string, playerId: string, playerName: string, reason: string): void {
    const event: PlayerDisconnectedEvent = {
      type: 'player_disconnected',
      gameId,
      timestamp: new Date().toISOString(),
      data: {
        playerId,
        playerName,
        remainingPlayers: this.getConnectedPlayers(gameId).length - 1 // -1 because we're about to remove this player
      }
    };

    this.broadcast(gameId, event, playerId);
  }

  /**
   * Broadcast player reconnected event
   */
  private broadcastPlayerReconnected(gameId: string, playerId: string, playerName: string, sessionId: string): void {
    const event: PlayerReconnectedEvent = {
      type: 'player_reconnected',
      gameId,
      timestamp: new Date().toISOString(),
      data: {
        playerId,
        playerName,
        sessionId,
        reconnectedAt: new Date().toISOString(),
        gamePhase: 'reconnected'
      }
    };

    this.broadcast(gameId, event, playerId);
  }

  /**
   * Broadcast reconnection available event
   */
  private broadcastReconnectionAvailable(gameId: string, playerId: string, playerName: string, sessionId: string, availableUntil: Date): void {
    const event: ReconnectionAvailableEvent = {
      type: 'reconnection_available',
      gameId,
      timestamp: new Date().toISOString(),
      data: {
        playerId,
        playerName,
        sessionId,
        gameId,
        availableUntil: availableUntil.toISOString()
      }
    };

    this.broadcast(gameId, event, playerId);
  }

  /**
   * Cleanup resources when shutting down
   */
  destroy(): void {
    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }

    // Close all connections
    for (const [connectionKey, connection] of this.connections.entries()) {
      try {
        if (!connection.response.destroyed) {
          connection.response.end();
        }
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Clear maps
    this.connections.clear();
    this.gameConnections.clear();
    this.disconnectedSessions.clear();

    console.info('ConnectionManager destroyed', {
      service: 'ConnectionManager',
      action: 'destroy'
    });
  }
}