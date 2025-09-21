import { Game, TurnInfo, TurnHistoryEntry, GamePhase } from '../types';
import { randomUUID } from 'crypto';

/**
 * Turn Manager Service
 *
 * Provides comprehensive turn-based gameplay management including:
 * - Turn timing and validation
 * - Turn history tracking
 * - Turn timeout handling
 * - Turn sequence management
 * - Turn-based game flow control
 */
export class TurnManager {
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private turnTimeouts = new Map<string, number>();

  constructor() {
    // Clean up timers periodically
    setInterval(() => {
      this.cleanupExpiredTimers();
    }, 60000); // Check every minute
  }

  /**
   * Start a new turn for a player
   */
  startTurn(
    game: Game,
    playerId: string,
    onTurnTimeout?: (gameId: string, playerId: string) => void
  ): void {
    if (!game.players[playerId]) {
      throw new Error('Player not found in game');
    }

    if (game.phase !== 'playing') {
      throw new Error('Cannot start turn when game is not in playing phase');
    }

    const now = new Date();

    // End previous turn if exists
    if (game.currentTurn && game.currentTurn !== playerId) {
      this.endTurn(game, game.currentTurn);
    }

    // Clear any existing timer for this game
    this.clearTurnTimer(game.gameId);

    // Update turn info
    game.state.turnInfo.turnNumber++;
    game.state.turnInfo.turnStartedAt = now;
    game.state.turnInfo.previousTurn = game.currentTurn;
    game.currentTurn = playerId;

    // Add to turn history
    const turnEntry: TurnHistoryEntry = {
      playerId,
      turnNumber: game.state.turnInfo.turnNumber,
      startedAt: now
    };

    game.state.turnInfo.turnHistory.push(turnEntry);

    // Set turn timeout if configured
    const turnTimeLimit = game.metadata.timeouts.turnTimeout;
    if (turnTimeLimit > 0 && onTurnTimeout) {
      const timer = setTimeout(() => {
        console.log(`Turn timeout for player ${playerId} in game ${game.gameId}`);
        onTurnTimeout(game.gameId, playerId);
      }, turnTimeLimit);

      this.turnTimers.set(game.gameId, timer);
      this.turnTimeouts.set(game.gameId, Date.now() + turnTimeLimit);
    }

    // Update game activity
    game.lastActivity = now;

    console.log(`Turn started: Game ${game.gameId}, Player ${playerId}, Turn ${game.state.turnInfo.turnNumber}`);
  }

  /**
   * End the current turn for a player
   */
  endTurn(game: Game, playerId: string, action?: string): void {
    if (game.currentTurn !== playerId) {
      console.warn(`Attempted to end turn for ${playerId} but current turn is ${game.currentTurn}`);
      return;
    }

    const now = new Date();
    const turnStartTime = game.state.turnInfo.turnStartedAt.getTime();
    const duration = now.getTime() - turnStartTime;

    // Update the most recent turn history entry
    const currentTurnEntry = game.state.turnInfo.turnHistory[game.state.turnInfo.turnHistory.length - 1];
    if (currentTurnEntry && !currentTurnEntry.endedAt) {
      currentTurnEntry.endedAt = now;
      currentTurnEntry.duration = duration;
      currentTurnEntry.action = action;
    }

    // Update game statistics
    this.updateTurnStatistics(game, playerId, duration);

    // Clear turn timer
    this.clearTurnTimer(game.gameId);

    game.lastActivity = now;

    console.log(`Turn ended: Game ${game.gameId}, Player ${playerId}, Duration ${duration}ms`);
  }

  /**
   * Switch to the next player's turn
   */
  switchTurn(
    game: Game,
    onTurnTimeout?: (gameId: string, playerId: string) => void
  ): string | null {
    if (game.phase !== 'playing') {
      throw new Error('Cannot switch turns when game is not in playing phase');
    }

    const playerIds = Object.keys(game.players);
    if (playerIds.length < 2) {
      throw new Error('Cannot switch turns with fewer than 2 players');
    }

    // End current turn
    if (game.currentTurn) {
      this.endTurn(game, game.currentTurn, 'turn_switch');
    }

    // Find next player
    const currentIndex = playerIds.indexOf(game.currentTurn || '');
    const nextIndex = (currentIndex + 1) % playerIds.length;
    const nextPlayerId = playerIds[nextIndex];

    // Start next turn
    this.startTurn(game, nextPlayerId, onTurnTimeout);

    return nextPlayerId;
  }

  /**
   * Handle turn timeout
   */
  handleTurnTimeout(
    game: Game,
    playerId: string,
    onTimeout?: (gameId: string, playerId: string) => void
  ): void {
    console.log(`Handling turn timeout for player ${playerId} in game ${game.gameId}`);

    // Record timeout in history
    game.history.push({
      id: randomUUID(),
      timestamp: new Date(),
      type: 'turn_timeout',
      playerId,
      data: {
        playerId,
        playerName: game.players[playerId]?.name || 'Unknown',
        turnNumber: game.state.turnInfo.turnNumber,
        timeoutDuration: game.metadata.timeouts.turnTimeout
      },
      phase: game.phase,
      turnNumber: game.state.turnInfo.turnNumber
    });

    // End the timed-out turn
    this.endTurn(game, playerId, 'timeout');

    // Call custom timeout handler if provided
    if (onTimeout) {
      onTimeout(game.gameId, playerId);
    }

    // Switch to next player if game is still playing
    if (game.phase === 'playing') {
      this.switchTurn(game);
    }
  }

  /**
   * Get remaining turn time in milliseconds
   */
  getRemainingTurnTime(gameId: string): number | null {
    const timeoutTimestamp = this.turnTimeouts.get(gameId);
    if (!timeoutTimestamp) {
      return null;
    }

    const remaining = timeoutTimestamp - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Check if it's a specific player's turn
   */
  isPlayersTurn(game: Game, playerId: string): boolean {
    return game.currentTurn === playerId && game.phase === 'playing';
  }

  /**
   * Validate if a player can take an action
   */
  validateTurnAction(game: Game, playerId: string, action: string): {
    valid: boolean;
    reason?: string;
  } {
    if (game.phase !== 'playing') {
      return {
        valid: false,
        reason: `Game is in ${game.phase} phase, not playing`
      };
    }

    if (!this.isPlayersTurn(game, playerId)) {
      return {
        valid: false,
        reason: `Not player's turn. Current turn: ${game.currentTurn}`
      };
    }

    if (!game.players[playerId]) {
      return {
        valid: false,
        reason: 'Player not found in game'
      };
    }

    // Check if turn has timed out
    const remainingTime = this.getRemainingTurnTime(game.gameId);
    if (remainingTime !== null && remainingTime <= 0) {
      return {
        valid: false,
        reason: 'Turn has timed out'
      };
    }

    return { valid: true };
  }

  /**
   * Get turn statistics for a game
   */
  getTurnStatistics(game: Game): {
    totalTurns: number;
    averageTurnTime: number;
    longestTurn: number;
    shortestTurn: number;
    timeoutCount: number;
    playerTurnCounts: Record<string, number>;
    playerAverageTimes: Record<string, number>;
  } {
    const turnHistory = game.state.turnInfo.turnHistory.filter(t => t.endedAt && t.duration);

    if (turnHistory.length === 0) {
      return {
        totalTurns: 0,
        averageTurnTime: 0,
        longestTurn: 0,
        shortestTurn: 0,
        timeoutCount: 0,
        playerTurnCounts: {},
        playerAverageTimes: {}
      };
    }

    const durations = turnHistory.map(t => t.duration!);
    const totalTime = durations.reduce((sum, d) => sum + d, 0);
    const averageTurnTime = totalTime / durations.length;
    const longestTurn = Math.max(...durations);
    const shortestTurn = Math.min(...durations);

    // Count timeouts
    const timeoutCount = game.history.filter(h => h.type === 'turn_timeout').length;

    // Player-specific statistics
    const playerTurnCounts: Record<string, number> = {};
    const playerTotalTimes: Record<string, number> = {};

    for (const turn of turnHistory) {
      const playerId = turn.playerId;
      playerTurnCounts[playerId] = (playerTurnCounts[playerId] || 0) + 1;
      playerTotalTimes[playerId] = (playerTotalTimes[playerId] || 0) + turn.duration!;
    }

    const playerAverageTimes: Record<string, number> = {};
    for (const playerId in playerTurnCounts) {
      playerAverageTimes[playerId] = playerTotalTimes[playerId] / playerTurnCounts[playerId];
    }

    return {
      totalTurns: turnHistory.length,
      averageTurnTime,
      longestTurn,
      shortestTurn,
      timeoutCount,
      playerTurnCounts,
      playerAverageTimes
    };
  }

  /**
   * Get current turn information
   */
  getCurrentTurnInfo(game: Game): {
    currentPlayer: string | null;
    turnNumber: number;
    turnStartedAt: Date;
    remainingTime: number | null;
    isTimeout: boolean;
  } {
    const remainingTime = this.getRemainingTurnTime(game.gameId);
    const isTimeout = remainingTime !== null && remainingTime <= 0;

    return {
      currentPlayer: game.currentTurn,
      turnNumber: game.state.turnInfo.turnNumber,
      turnStartedAt: game.state.turnInfo.turnStartedAt,
      remainingTime,
      isTimeout
    };
  }

  /**
   * Reset turn state (for game restart or recovery)
   */
  resetTurnState(game: Game): void {
    // Clear any existing timers
    this.clearTurnTimer(game.gameId);

    // Reset turn info
    game.state.turnInfo = {
      turnNumber: 0,
      turnStartedAt: new Date(),
      turnHistory: []
    };

    game.currentTurn = null;

    console.log(`Turn state reset for game ${game.gameId}`);
  }

  /**
   * Pause turn timer (for game pause)
   */
  pauseTurnTimer(gameId: string): void {
    const timer = this.turnTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.turnTimers.delete(gameId);
      // Keep the timeout timestamp for resume calculation
    }
  }

  /**
   * Resume turn timer (for game resume)
   */
  resumeTurnTimer(
    game: Game,
    onTurnTimeout?: (gameId: string, playerId: string) => void
  ): void {
    if (!game.currentTurn || game.phase !== 'playing') {
      return;
    }

    const remainingTime = this.getRemainingTurnTime(game.gameId);
    if (remainingTime !== null && remainingTime > 0 && onTurnTimeout) {
      const timer = setTimeout(() => {
        onTurnTimeout(game.gameId, game.currentTurn!);
      }, remainingTime);

      this.turnTimers.set(game.gameId, timer);
    }
  }

  /**
   * Force end current turn (for administrative actions)
   */
  forceEndTurn(game: Game, reason: string = 'forced'): void {
    if (game.currentTurn) {
      this.endTurn(game, game.currentTurn, reason);
      game.currentTurn = null;
    }

    this.clearTurnTimer(game.gameId);
  }

  /**
   * Update turn statistics in game
   */
  private updateTurnStatistics(game: Game, playerId: string, duration: number): void {
    // Update game-level statistics
    if (duration > game.statistics.longestTurn) {
      game.statistics.longestTurn = duration;
    }

    const completedTurns = game.state.turnInfo.turnHistory.filter(t => t.endedAt).length;
    if (completedTurns > 0) {
      const totalTime = game.state.turnInfo.turnHistory
        .filter(t => t.endedAt && t.duration)
        .reduce((sum, t) => sum + t.duration!, 0);
      game.statistics.averageTurnTime = totalTime / completedTurns;
    }

    // Update player-specific statistics
    if (!game.statistics.playerStats[playerId]) {
      game.statistics.playerStats[playerId] = {
        shotsAttempted: 0,
        shotsHit: 0,
        shotsMissed: 0,
        shipsDestroyed: 0,
        accuracyRate: 0,
        averageResponseTime: 0,
        totalTimeSpent: 0,
        longestTurnTime: 0
      };
    }

    const playerStats = game.statistics.playerStats[playerId];
    playerStats.totalTimeSpent += duration;
    playerStats.longestTurnTime = Math.max(playerStats.longestTurnTime, duration);

    // Calculate average response time
    const playerTurns = game.state.turnInfo.turnHistory.filter(
      t => t.playerId === playerId && t.endedAt && t.duration
    );
    if (playerTurns.length > 0) {
      const totalPlayerTime = playerTurns.reduce((sum, t) => sum + t.duration!, 0);
      playerStats.averageResponseTime = totalPlayerTime / playerTurns.length;
    }
  }

  /**
   * Clear turn timer for a game
   */
  private clearTurnTimer(gameId: string): void {
    const timer = this.turnTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.turnTimers.delete(gameId);
    }
    this.turnTimeouts.delete(gameId);
  }

  /**
   * Clean up expired timers
   */
  private cleanupExpiredTimers(): void {
    const now = Date.now();

    for (const [gameId, timeoutTimestamp] of this.turnTimeouts.entries()) {
      if (timeoutTimestamp <= now) {
        this.clearTurnTimer(gameId);
      }
    }
  }

  /**
   * Destroy turn manager and clean up resources
   */
  destroy(): void {
    // Clear all timers
    for (const [gameId] of this.turnTimers) {
      this.clearTurnTimer(gameId);
    }

    console.log('Turn Manager destroyed');
  }
}