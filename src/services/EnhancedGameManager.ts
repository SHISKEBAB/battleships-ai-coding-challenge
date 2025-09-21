import {
  Game,
  Player,
  ShipPlacement,
  AttackResult,
  Ship,
  GameQuery,
  GameQueryOptions,
  GameFilterResult,
  BatchGameOperation,
  BatchOperationResult,
  GameStateValidationResult,
  GamePhase,
  GameRules,
  GameSettings
} from '../types';
import {
  createGame,
  addPlayerToGame,
  createPlayer,
  areAllPlayersReady,
  getOpponentId,
  getFilteredGameState
} from '../models/Game';
import { validateShipPlacements, createShipsFromPlacements } from '../utils/shipValidation';
import { parsePosition } from '../utils/coordinates';
import { randomUUID } from 'crypto';
import {
  GameEvent,
  PlayerJoinedEvent,
  ShipsPlacedEvent,
  GameStartedEvent,
  AttackMadeEvent,
  GameFinishedEvent,
  GamePausedEvent,
  GameResumedEvent
} from '../types/events';
import { ConnectionManager } from './ConnectionManager';
import { GameStateStorage } from './GameStateStorage';
import { GameStateManager } from './GameStateManager';

/**
 * Enhanced Game Manager Service
 *
 * Provides comprehensive game management with:
 * - Advanced CRUD operations
 * - Game querying and filtering
 * - State persistence and recovery
 * - Batch operations
 * - Analytics and monitoring
 */
export class EnhancedGameManager {
  private games = new Map<string, Game>();
  private pausedGames = new Map<string, { reason: string; pausedAt: Date; pausedByPlayerId?: string }>();
  private cleanupInterval: NodeJS.Timeout;
  private connectionManager?: ConnectionManager;
  private stateStorage: GameStateStorage;
  private stateManager: GameStateManager;
  private gameIndex = new Map<string, Set<string>>(); // For fast querying

  constructor(
    connectionManager?: ConnectionManager,
    stateStorage?: GameStateStorage,
    options: {
      storageEnabled?: boolean;
      autoSave?: boolean;
      persistInterval?: number;
    } = {}
  ) {
    this.connectionManager = connectionManager;
    this.stateStorage = stateStorage || new GameStateStorage();
    this.stateManager = new GameStateManager(this.stateStorage);

    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveGames();
    }, 300000);

    // Initialize game loading from storage
    if (options.storageEnabled !== false) {
      this.loadGamesFromStorage();
    }

    // Auto-save games periodically
    if (options.autoSave !== false) {
      setInterval(() => {
        this.autoSaveGames();
      }, options.persistInterval || 60000);
    }
  }

  /**
   * Set the connection manager for broadcasting events
   */
  setConnectionManager(connectionManager: ConnectionManager): void {
    this.connectionManager = connectionManager;
  }

  /**
   * Create a new game with enhanced state management
   */
  async createGame(
    hostPlayerName: string,
    customRules?: Partial<GameRules>,
    customSettings?: Partial<GameSettings>
  ): Promise<Game> {
    const hostPlayer = createPlayer(randomUUID(), hostPlayerName);
    let game = createGame(hostPlayer);

    // Apply custom rules and settings if provided
    if (customRules) {
      game.metadata.rules = { ...game.metadata.rules, ...customRules };
    }
    if (customSettings) {
      game.metadata.settings = { ...game.metadata.settings, ...customSettings };
    }

    // Initialize with state manager
    game = this.stateManager.initializeGameState(
      hostPlayer.id,
      hostPlayerName,
      customRules,
      customSettings
    );

    this.games.set(game.gameId, game);
    this.updateGameIndex(game);

    // Save to persistent storage
    await this.stateStorage.saveGame(game);

    // Create initial snapshot
    await this.stateStorage.createSnapshot(game, 'game_created', hostPlayer.id);

    // Broadcast player joined event
    this.broadcastPlayerJoined(game, hostPlayer);

    console.log(`Enhanced game created: ${game.gameId} by ${hostPlayerName}`);
    return game;
  }

  /**
   * Add player to game with validation
   */
  async addPlayer(gameId: string, playerName: string): Promise<Game> {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    // Validate game state before adding player
    const validation = await this.stateManager.validateGameState(game);
    if (!validation.isValid) {
      console.warn(`Game ${gameId} has validation errors, attempting repair`);
      await this.stateManager.repairGameState(game);
    }

    const player = createPlayer(randomUUID(), playerName);
    const updatedGame = addPlayerToGame(game, player);
    this.games.set(gameId, updatedGame);
    this.updateGameIndex(updatedGame);

    // Save to storage
    await this.stateStorage.saveGame(updatedGame);

    // Broadcast player joined event
    this.broadcastPlayerJoined(updatedGame, player);

    return updatedGame;
  }

  /**
   * Place ships with enhanced validation and state management
   */
  async placeShips(gameId: string, playerId: string, shipPlacements: ShipPlacement[]): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    // Validate game state
    const validation = await this.stateManager.validateGameState(game);
    if (!validation.isValid && validation.errors.some(e => e.severity === 'critical')) {
      throw new Error('Game state is invalid and cannot proceed');
    }

    if (game.phase !== 'waiting' && game.phase !== 'setup') {
      throw new Error('Cannot place ships in current game phase');
    }

    const player = game.players[playerId];
    if (!player) {
      throw new Error('Player not found in game');
    }

    if (player.ships.length > 0) {
      throw new Error('Ships already placed');
    }

    const validationResult = validateShipPlacements(shipPlacements);
    if (!validationResult.valid) {
      const errorData = {
        errors: validationResult.errors,
        conflictingPositions: validationResult.conflictingPositions,
        suggestions: validationResult.suggestions
      };

      const errorMessages = validationResult.errors.map(e => e.message);
      const error = new Error(`Invalid ship placement: ${errorMessages.join(', ')}`);
      (error as any).validationDetails = errorData;
      throw error;
    }

    const ships = createShipsFromPlacements(shipPlacements);
    player.ships = ships;
    player.ready = true;

    if (game.phase === 'waiting') {
      await this.stateManager.transitionGamePhase(game, 'setup', playerId, 'Player ships placed');
    }

    const wasAllPlayersReady = areAllPlayersReady(game);

    // Record ships placement in history
    game.history.push({
      id: randomUUID(),
      timestamp: new Date(),
      type: 'ships_placed',
      playerId,
      data: {
        playerId,
        playerName: player.name,
        isReady: player.ready,
        allPlayersReady: wasAllPlayersReady,
        shipCount: ships.length
      },
      phase: game.phase
    });

    // Broadcast ships placed event
    this.broadcastShipsPlaced(game, player, wasAllPlayersReady);

    if (wasAllPlayersReady) {
      await this.stateManager.transitionGamePhase(game, 'playing', playerId, 'All players ready');
      const playerIds = Object.keys(game.players);
      game.currentTurn = playerIds[Math.floor(Math.random() * playerIds.length)]!;

      // Initialize turn management
      this.stateManager.updateTurnStatistics(game, game.currentTurn, 'turn_start', 0);

      // Broadcast game started event
      this.broadcastGameStarted(game);
    }

    game.lastActivity = new Date();
    this.games.set(gameId, game);
    this.updateGameIndex(game);

    // Save to storage and create snapshot
    await this.stateStorage.saveGame(game);
    if (wasAllPlayersReady) {
      await this.stateStorage.createSnapshot(game, 'game_started', playerId);
    }
  }

  /**
   * Process attack with enhanced state management
   */
  async processAttack(gameId: string, attackerId: string, position: string): Promise<AttackResult> {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    if (this.isGamePaused(gameId)) {
      throw new Error('Game is currently paused due to player disconnection');
    }

    if (game.currentTurn !== attackerId) {
      throw new Error('Not your turn');
    }

    const targetId = getOpponentId(game, attackerId);
    if (!targetId) {
      throw new Error('No opponent found');
    }

    const target = game.players[targetId];
    if (!target) {
      throw new Error('Target player not found');
    }

    try {
      parsePosition(position);
    } catch {
      throw new Error('Invalid position format');
    }

    if (target.board.hits.has(position) || target.board.misses.has(position)) {
      throw new Error('Position already attacked');
    }

    const turnStartTime = game.state.turnInfo.turnStartedAt.getTime();
    const turnDuration = Date.now() - turnStartTime;

    let hitShip: Ship | undefined;
    let result: 'hit' | 'miss' | 'sunk' = 'miss';

    for (const ship of target.ships) {
      if (ship.positions.includes(position)) {
        hitShip = ship;
        ship.hits++;
        target.board.hits.add(position);
        result = 'hit';

        if (ship.hits >= ship.length) {
          ship.sunk = true;
          result = 'sunk';
        }
        break;
      }
    }

    if (!hitShip) {
      target.board.misses.add(position);
    }

    // Update statistics
    this.stateManager.updateAttackStatistics(game, attackerId, result);

    // Record attack in history
    game.history.push({
      id: randomUUID(),
      timestamp: new Date(),
      type: 'attack_made',
      playerId: attackerId,
      data: {
        attackerId,
        attackerName: game.players[attackerId]?.name || 'Unknown',
        targetId,
        targetName: target.name,
        position,
        result,
        sunkShip: result === 'sunk' ? hitShip : undefined,
        turnDuration
      },
      phase: game.phase,
      turnNumber: game.state.turnInfo.turnNumber
    });

    const allShipsSunk = target.ships.every(ship => ship.sunk);
    if (allShipsSunk) {
      await this.stateManager.transitionGamePhase(game, 'finished', attackerId, 'All ships sunk');
      game.winner = attackerId;

      // Broadcast game finished event
      this.broadcastGameFinished(game, attackerId, targetId);

      // Create final snapshot
      await this.stateStorage.createSnapshot(game, 'game_finished', attackerId);
    } else {
      // End current turn and start next turn
      this.stateManager.updateTurnStatistics(game, attackerId, 'turn_end', turnDuration);
      game.currentTurn = targetId;
      this.stateManager.updateTurnStatistics(game, targetId, 'turn_start', 0);
    }

    // Broadcast attack made event
    this.broadcastAttackMade(game, attackerId, targetId, position, result, hitShip);

    game.lastActivity = new Date();
    this.games.set(gameId, game);
    this.updateGameIndex(game);

    // Save to storage
    await this.stateStorage.saveGame(game);

    return {
      result,
      position,
      sunkShip: result === 'sunk' ? hitShip : undefined,
      gameState: allShipsSunk ? 'won' : 'playing',
      nextTurn: game.currentTurn!,
    };
  }

  /**
   * Query games with advanced filtering
   */
  async queryGames(query: GameQuery, options: GameQueryOptions = {}): Promise<GameFilterResult> {
    const {
      limit = 50,
      offset = 0,
      sortBy = 'lastActivity',
      sortOrder = 'desc',
      includeHistory = false,
      includeStatistics = false
    } = options;

    let filteredGames = Array.from(this.games.values());

    // Apply filters
    if (query.phase) {
      const phases = Array.isArray(query.phase) ? query.phase : [query.phase];
      filteredGames = filteredGames.filter(game => phases.includes(game.phase));
    }

    if (query.hostPlayerId) {
      filteredGames = filteredGames.filter(game => game.metadata.hostPlayerId === query.hostPlayerId);
    }

    if (query.playerIds && query.playerIds.length > 0) {
      filteredGames = filteredGames.filter(game =>
        query.playerIds!.some(playerId => playerId in game.players)
      );
    }

    if (query.createdAfter) {
      filteredGames = filteredGames.filter(game => game.createdAt >= query.createdAfter!);
    }

    if (query.createdBefore) {
      filteredGames = filteredGames.filter(game => game.createdAt <= query.createdBefore!);
    }

    if (query.lastActivityAfter) {
      filteredGames = filteredGames.filter(game => game.lastActivity >= query.lastActivityAfter!);
    }

    if (query.lastActivityBefore) {
      filteredGames = filteredGames.filter(game => game.lastActivity <= query.lastActivityBefore!);
    }

    if (query.tags && query.tags.length > 0) {
      filteredGames = filteredGames.filter(game =>
        query.tags!.some(tag => game.metadata.tags.includes(tag))
      );
    }

    if (query.isPrivate !== undefined) {
      filteredGames = filteredGames.filter(game => game.metadata.settings.isPrivate === query.isPrivate);
    }

    if (query.minPlayers !== undefined) {
      filteredGames = filteredGames.filter(game => Object.keys(game.players).length >= query.minPlayers!);
    }

    if (query.maxPlayers !== undefined) {
      filteredGames = filteredGames.filter(game => Object.keys(game.players).length <= query.maxPlayers!);
    }

    // Sort results
    filteredGames.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (sortBy) {
        case 'createdAt':
          aValue = a.createdAt.getTime();
          bValue = b.createdAt.getTime();
          break;
        case 'lastActivity':
          aValue = a.lastActivity.getTime();
          bValue = b.lastActivity.getTime();
          break;
        case 'phase':
          aValue = a.phase;
          bValue = b.phase;
          break;
        case 'playerCount':
          aValue = Object.keys(a.players).length;
          bValue = Object.keys(b.players).length;
          break;
        case 'turnNumber':
          aValue = a.state.turnInfo.turnNumber;
          bValue = b.state.turnInfo.turnNumber;
          break;
        default:
          aValue = a.lastActivity.getTime();
          bValue = b.lastActivity.getTime();
      }

      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    const total = filteredGames.length;
    const paginatedGames = filteredGames.slice(offset, offset + limit);

    // Filter game data based on options
    const games = paginatedGames.map(game => {
      const result = { ...game };

      if (!includeHistory) {
        (result as any).history = [];
      }

      if (!includeStatistics) {
        (result as any).statistics = {
          totalTurns: game.statistics.totalTurns,
          totalShots: game.statistics.totalShots,
          playerStats: {}
        };
      }

      return result;
    });

    return {
      games,
      total,
      hasMore: offset + limit < total,
      nextOffset: offset + limit < total ? offset + limit : undefined
    };
  }

  /**
   * Perform batch operations on games
   */
  async batchOperation(operation: BatchGameOperation): Promise<BatchOperationResult> {
    const { operation: op, query, options = {} } = operation;
    const { dryRun = false, batchSize = 100 } = options;

    console.log(`Starting batch operation: ${op}`, { query, dryRun });

    // Get matching games
    const queryResult = await this.queryGames(query, { limit: batchSize });
    const games = queryResult.games;

    const result: BatchOperationResult = {
      success: true,
      processed: 0,
      failed: 0,
      errors: [],
      summary: ''
    };

    for (const game of games) {
      try {
        if (!dryRun) {
          switch (op) {
            case 'delete':
              await this.deleteGame(game.gameId);
              break;
            case 'archive':
              await this.archiveGame(game.gameId);
              break;
            case 'validate':
              await this.validateGame(game.gameId);
              break;
            case 'cleanup':
              await this.cleanupGame(game.gameId);
              break;
          }
        }

        result.processed++;

        if (options.onProgress) {
          options.onProgress(result.processed, games.length);
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          gameId: game.gameId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    result.success = result.failed === 0;
    result.summary = `${op} operation: ${result.processed} processed, ${result.failed} failed`;

    console.log(`Batch operation completed: ${result.summary}`);
    return result;
  }

  /**
   * Validate a specific game's state
   */
  async validateGame(gameId: string): Promise<GameStateValidationResult> {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    return await this.stateManager.validateGameState(game);
  }

  /**
   * Repair a game's state
   */
  async repairGame(gameId: string): Promise<Game> {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    const repairedGame = await this.stateManager.repairGameState(game);
    this.games.set(gameId, repairedGame);
    this.updateGameIndex(repairedGame);

    await this.stateStorage.saveGame(repairedGame);
    return repairedGame;
  }

  /**
   * Archive a game (move to archived state but keep data)
   */
  async archiveGame(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    // Create final snapshot before archiving
    await this.stateStorage.createSnapshot(game, 'archived', 'system');

    // Add archived tag
    if (!game.metadata.tags.includes('archived')) {
      game.metadata.tags.push('archived');
    }

    // Transition to abandoned state
    await this.stateManager.transitionGamePhase(game, 'abandoned', 'system', 'Game archived');

    await this.stateStorage.saveGame(game);
    this.games.delete(gameId);
    this.removeFromGameIndex(game);

    console.log(`Game ${gameId} archived`);
  }

  /**
   * Clean up game resources
   */
  async cleanupGame(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (!game) {
      return; // Already cleaned up
    }

    // Remove from memory
    this.games.delete(gameId);
    this.pausedGames.delete(gameId);
    this.removeFromGameIndex(game);

    console.log(`Game ${gameId} cleaned up from memory`);
  }

  /**
   * Get game with recovery if needed
   */
  async getGame(gameId: string): Promise<Game | null> {
    let game = this.games.get(gameId);

    if (!game) {
      // Try to load from storage
      game = await this.stateStorage.loadGame(gameId);
      if (game) {
        this.games.set(gameId, game);
        this.updateGameIndex(game);
      }
    }

    return game;
  }

  /**
   * Get filtered game state for a player
   */
  async getFilteredGame(gameId: string, playerId: string): Promise<any> {
    const game = await this.getGame(gameId);
    if (!game) {
      return null;
    }
    return getFilteredGameState(game, playerId);
  }

  /**
   * Delete game permanently
   */
  async deleteGame(gameId: string): Promise<void> {
    const game = this.games.get(gameId);
    if (game) {
      this.removeFromGameIndex(game);
    }

    this.games.delete(gameId);
    this.pausedGames.delete(gameId);
    await this.stateStorage.deleteGame(gameId);

    console.log(`Game ${gameId} deleted permanently`);
  }

  /**
   * Get comprehensive game statistics
   */
  async getGameAnalytics(): Promise<{
    totalGames: number;
    gamesByPhase: Record<string, number>;
    averageGameDuration: number;
    activePlayerCount: number;
    storageStats: any;
  }> {
    const games = Array.from(this.games.values());
    const storageStats = await this.stateStorage.getStorageStats();

    const gamesByPhase = games.reduce((acc, game) => {
      acc[game.phase] = (acc[game.phase] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const finishedGames = games.filter(g => g.phase === 'finished');
    const totalDuration = finishedGames.reduce((sum, game) => {
      return sum + (game.statistics.gameDuration || 0);
    }, 0);
    const averageGameDuration = finishedGames.length > 0 ? totalDuration / finishedGames.length : 0;

    const uniquePlayers = new Set();
    games.forEach(game => {
      Object.keys(game.players).forEach(playerId => uniquePlayers.add(playerId));
    });

    return {
      totalGames: games.length,
      gamesByPhase,
      averageGameDuration,
      activePlayerCount: uniquePlayers.size,
      storageStats
    };
  }

  // Existing methods from the original GameManager...
  isPlayersTurn(gameId: string, playerId: string): boolean {
    const game = this.games.get(gameId);
    return game?.currentTurn === playerId;
  }

  getActiveGameCount(): number {
    return this.games.size;
  }

  pauseGame(gameId: string, reason: 'disconnect' | 'manual', playerId?: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.phase === 'playing' && game.currentTurn) {
      this.pausedGames.set(gameId, {
        reason,
        pausedAt: new Date(),
        pausedByPlayerId: playerId
      });

      this.broadcastGamePaused(game, reason, playerId);
      console.log(`Game ${gameId} paused due to ${reason}`, { gameId, reason, playerId });
    }
  }

  resumeGame(gameId: string, playerId?: string): void {
    const game = this.games.get(gameId);
    const pauseInfo = this.pausedGames.get(gameId);

    if (!game) {
      throw new Error('Game not found');
    }

    if (!pauseInfo) {
      throw new Error('Game is not paused');
    }

    this.pausedGames.delete(gameId);
    this.broadcastGameResumed(game, pauseInfo.reason === 'disconnect' ? 'reconnect' : 'manual');

    console.log(`Game ${gameId} resumed`, { gameId, resumedBy: playerId });
  }

  isGamePaused(gameId: string): boolean {
    return this.pausedGames.has(gameId);
  }

  canResumeGame(gameId: string, playerId: string): boolean {
    const game = this.games.get(gameId);
    const pauseInfo = this.pausedGames.get(gameId);

    if (!game || !pauseInfo) {
      return false;
    }

    return (
      (pauseInfo.reason === 'disconnect' && !!game.players[playerId]) ||
      (pauseInfo.reason === 'manual' && !!game.players[playerId])
    );
  }

  handlePlayerDisconnect(gameId: string, playerId: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    if (game.phase === 'playing' && game.currentTurn === playerId) {
      this.pauseGame(gameId, 'disconnect', playerId);
    }
  }

  handlePlayerReconnect(gameId: string, playerId: string): void {
    const pauseInfo = this.pausedGames.get(gameId);

    if (pauseInfo && pauseInfo.reason === 'disconnect' && pauseInfo.pausedByPlayerId === playerId) {
      this.resumeGame(gameId, playerId);
    }
  }

  /**
   * Load games from persistent storage on startup
   */
  private async loadGamesFromStorage(): Promise<void> {
    try {
      const gameIds = await this.stateStorage.getAllGameIds();
      console.log(`Loading ${gameIds.length} games from storage...`);

      for (const gameId of gameIds) {
        try {
          const game = await this.stateStorage.loadGame(gameId);
          if (game) {
            this.games.set(gameId, game);
            this.updateGameIndex(game);
          }
        } catch (error) {
          console.error(`Failed to load game ${gameId}:`, error);
        }
      }

      console.log(`Loaded ${this.games.size} games from storage`);
    } catch (error) {
      console.error('Failed to load games from storage:', error);
    }
  }

  /**
   * Auto-save all games to storage
   */
  private async autoSaveGames(): Promise<void> {
    const savePromises = Array.from(this.games.values()).map(async game => {
      try {
        await this.stateStorage.saveGame(game);
      } catch (error) {
        console.error(`Failed to auto-save game ${game.gameId}:`, error);
      }
    });

    await Promise.allSettled(savePromises);
  }

  /**
   * Update game index for fast querying
   */
  private updateGameIndex(game: Game): void {
    // Index by phase
    const phaseKey = `phase:${game.phase}`;
    if (!this.gameIndex.has(phaseKey)) {
      this.gameIndex.set(phaseKey, new Set());
    }
    this.gameIndex.get(phaseKey)!.add(game.gameId);

    // Index by host player
    const hostKey = `host:${game.metadata.hostPlayerId}`;
    if (!this.gameIndex.has(hostKey)) {
      this.gameIndex.set(hostKey, new Set());
    }
    this.gameIndex.get(hostKey)!.add(game.gameId);

    // Index by tags
    for (const tag of game.metadata.tags) {
      const tagKey = `tag:${tag}`;
      if (!this.gameIndex.has(tagKey)) {
        this.gameIndex.set(tagKey, new Set());
      }
      this.gameIndex.get(tagKey)!.add(game.gameId);
    }
  }

  /**
   * Remove game from index
   */
  private removeFromGameIndex(game: Game): void {
    for (const [key, gameIds] of this.gameIndex.entries()) {
      gameIds.delete(game.gameId);
      if (gameIds.size === 0) {
        this.gameIndex.delete(key);
      }
    }
  }

  /**
   * Clean up inactive games
   */
  private cleanupInactiveGames(): void {
    const now = new Date();
    const inactiveThreshold = 2 * 60 * 60 * 1000;

    for (const [gameId, game] of this.games.entries()) {
      if (now.getTime() - game.lastActivity.getTime() > inactiveThreshold) {
        this.archiveGame(gameId).catch(error => {
          console.error(`Failed to archive inactive game ${gameId}:`, error);
        });
      }
    }
  }

  // Broadcast methods (unchanged from original)
  private broadcastPlayerJoined(game: Game, player: Omit<Player, 'board' | 'ships'>): void {
    if (!this.connectionManager) return;

    const event: PlayerJoinedEvent = {
      type: 'player_joined',
      gameId: game.gameId,
      timestamp: new Date().toISOString(),
      data: {
        playerId: player.id,
        playerName: player.name,
        playerCount: Object.keys(game.players).length
      }
    };

    this.connectionManager.broadcast(game.gameId, event, player.id);
  }

  private broadcastShipsPlaced(game: Game, player: Player, allPlayersReady: boolean): void {
    if (!this.connectionManager) return;

    const event: ShipsPlacedEvent = {
      type: 'ships_placed',
      gameId: game.gameId,
      timestamp: new Date().toISOString(),
      data: {
        playerId: player.id,
        playerName: player.name,
        isReady: player.ready,
        allPlayersReady
      }
    };

    this.connectionManager.broadcast(game.gameId, event, player.id);
  }

  private broadcastGameStarted(game: Game): void {
    if (!this.connectionManager) return;

    const currentPlayer = game.players[game.currentTurn!];
    const event: GameStartedEvent = {
      type: 'game_started',
      gameId: game.gameId,
      timestamp: new Date().toISOString(),
      data: {
        currentTurn: game.currentTurn || undefined!,
        currentPlayerName: currentPlayer?.name || 'Unknown',
        phase: 'playing' as const
      }
    };

    this.connectionManager.broadcast(game.gameId, event);
  }

  private broadcastAttackMade(
    game: Game,
    attackerId: string,
    targetId: string,
    position: string,
    result: 'hit' | 'miss' | 'sunk',
    sunkShip?: Ship
  ): void {
    if (!this.connectionManager) return;

    const attacker = game.players[attackerId];
    const target = game.players[targetId];
    const nextPlayer = game.players[game.currentTurn!];

    const event: AttackMadeEvent = {
      type: 'attack_made',
      gameId: game.gameId,
      timestamp: new Date().toISOString(),
      data: {
        attackerId,
        attackerName: attacker?.name || 'Unknown',
        targetId,
        targetName: target?.name || 'Unknown',
        position,
        result,
        sunkShip,
        nextTurn: game.currentTurn!,
        nextPlayerName: nextPlayer?.name || 'Unknown'
      }
    };

    this.connectionManager.broadcast(game.gameId, event, attackerId);
  }

  private broadcastGameFinished(game: Game, winnerId: string, loserId: string): void {
    if (!this.connectionManager) return;

    const winner = game.players[winnerId];
    const loser = game.players[loserId];

    const event: GameFinishedEvent = {
      type: 'game_finished',
      gameId: game.gameId,
      timestamp: new Date().toISOString(),
      data: {
        winnerId,
        winnerName: winner?.name || 'Unknown',
        loserId,
        loserName: loser?.name || 'Unknown',
        phase: 'finished' as const
      }
    };

    this.connectionManager.broadcast(game.gameId, event);
  }

  private broadcastGamePaused(game: Game, reason: 'disconnect' | 'manual', playerId?: string): void {
    if (!this.connectionManager) return;

    const player = playerId ? game.players[playerId] : undefined;

    const event: GamePausedEvent = {
      type: 'game_paused',
      gameId: game.gameId,
      timestamp: new Date().toISOString(),
      data: {
        playerId: playerId || 'unknown',
        playerName: player?.name || 'Unknown',
        reason,
        pausedAt: new Date().toISOString(),
        currentTurn: game.currentTurn || undefined
      }
    };

    this.connectionManager.broadcast(game.gameId, event);
  }

  private broadcastGameResumed(game: Game, reason: 'reconnect' | 'manual'): void {
    if (!this.connectionManager) return;

    const event: GameResumedEvent = {
      type: 'game_resumed',
      gameId: game.gameId,
      timestamp: new Date().toISOString(),
      data: {
        resumedAt: new Date().toISOString(),
        currentTurn: game.currentTurn || undefined,
        reason
      }
    };

    this.connectionManager.broadcast(game.gameId, event);
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Save all games before shutdown
    await this.autoSaveGames();

    this.games.clear();
    this.pausedGames.clear();
    this.gameIndex.clear();

    await this.stateStorage.destroy();
    console.log('Enhanced Game Manager destroyed');
  }
}