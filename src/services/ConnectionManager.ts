import { Response } from 'express';
import { logger } from '../middleware/logger';
import {
  PlayerConnection,
  GameEvent,
  ConnectionStats,
  SSEMessage,
  GameEventType,
  HeartbeatEvent
} from '../types/events';

export class ConnectionManager {
  private connections = new Map<string, PlayerConnection>();
  private gameConnections = new Map<string, Set<string>>();
  private heartbeatInterval: NodeJS.Timeout;
  private cleanupInterval: NodeJS.Timeout;
  private startTime: Date;

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

    logger.info('ConnectionManager initialized', {
      service: 'ConnectionManager',
      action: 'initialize',
      heartbeatInterval: 30000,
      cleanupInterval: 60000
    });
  }

  /**
   * Add a new SSE connection for a player in a game
   */
  addConnection(gameId: string, playerId: string, playerName: string, response: Response): void {
    const connectionKey = this.getConnectionKey(gameId, playerId);

    // Remove existing connection if any
    this.removeConnection(gameId, playerId);

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
      lastHeartbeat: new Date()
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
      this.removeConnection(gameId, playerId);
      logger.info('SSE connection closed', {
        service: 'ConnectionManager',
        action: 'connection_closed',
        gameId,
        playerId,
        playerName
      });
    });

    response.on('error', (error) => {
      logger.error('SSE connection error', {
        service: 'ConnectionManager',
        action: 'connection_error',
        gameId,
        playerId,
        playerName,
        error: error.message
      });
      this.removeConnection(gameId, playerId);
    });

    logger.info('SSE connection established', {
      service: 'ConnectionManager',
      action: 'connection_added',
      gameId,
      playerId,
      playerName,
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
        gamePhase: 'connected',
        connectedAt: connection.connectedAt.toISOString()
      }
    });
  }

  /**
   * Remove a connection for a player in a game
   */
  removeConnection(gameId: string, playerId: string): void {
    const connectionKey = this.getConnectionKey(gameId, playerId);
    const connection = this.connections.get(connectionKey);

    if (connection) {
      // Close the response if it's still open
      try {
        if (!connection.response.destroyed) {
          connection.response.end();
        }
      } catch (error) {
        logger.warn('Error closing SSE response', {
          service: 'ConnectionManager',
          action: 'connection_close_error',
          gameId,
          playerId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
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

      logger.info('SSE connection removed', {
        service: 'ConnectionManager',
        action: 'connection_removed',
        gameId,
        playerId,
        playerName: connection.playerName,
        totalConnections: this.connections.size
      });
    }
  }

  /**
   * Broadcast an event to all connected players in a game
   */
  broadcast(gameId: string, event: GameEvent, excludePlayer?: string): void {
    const gameConnections = this.gameConnections.get(gameId);
    if (!gameConnections || gameConnections.size === 0) {
      logger.debug('No connections to broadcast to', {
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

    logger.info('Event broadcasted', {
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

    logger.info('All game connections closed', {
      service: 'ConnectionManager',
      action: 'close_game_connections',
      gameId,
      closedConnections: connectionsToClose.length
    });
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

    logger.debug('Heartbeat sent', {
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
    const staleThreshold = 120000; // 2 minutes
    const connectionsToRemove: Array<{ gameId: string; playerId: string }> = [];

    for (const [connectionKey, connection] of this.connections.entries()) {
      const timeSinceHeartbeat = now.getTime() - connection.lastHeartbeat.getTime();

      if (timeSinceHeartbeat > staleThreshold) {
        connectionsToRemove.push({
          gameId: connection.gameId,
          playerId: connection.playerId
        });
      }
    }

    // Remove stale connections
    for (const { gameId, playerId } of connectionsToRemove) {
      this.removeConnection(gameId, playerId);
    }

    if (connectionsToRemove.length > 0) {
      logger.info('Stale connections cleaned up', {
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
      logger.error('Failed to send SSE message', {
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

    logger.info('ConnectionManager destroyed', {
      service: 'ConnectionManager',
      action: 'destroy'
    });
  }
}