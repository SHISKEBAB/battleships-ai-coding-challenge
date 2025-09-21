import {
  Game,
  GamePhase,
  GameStateValidationResult,
  StateValidationError,
  StateValidationWarning,
  GameMetadata,
  GameRules,
  GameSettings,
  GameTimeouts,
  GameState,
  GameStatistics,
  TurnInfo,
  PhaseTransition
} from '../types';
import { GameStateStorage } from './GameStateStorage';
import { randomUUID } from 'crypto';

/**
 * Game State Manager Service
 *
 * Provides comprehensive game state management including:
 * - State validation and integrity checks
 * - Phase transition management
 * - State correction and recovery
 * - Game metadata management
 * - State history tracking
 */
export class GameStateManager {
  private storage: GameStateStorage;
  private readonly defaultRules: GameRules;
  private readonly defaultSettings: GameSettings;
  private readonly defaultTimeouts: GameTimeouts;

  constructor(storage: GameStateStorage) {
    this.storage = storage;

    // Default game configuration
    this.defaultRules = {
      boardSize: 10,
      shipTypes: [
        { name: 'Carrier', length: 5, count: 1 },
        { name: 'Battleship', length: 4, count: 1 },
        { name: 'Cruiser', length: 3, count: 1 },
        { name: 'Submarine', length: 3, count: 1 },
        { name: 'Destroyer', length: 2, count: 1 }
      ],
      maxPlayers: 2,
      turnTimeLimit: 60000, // 1 minute
      allowAdjacent: false,
      allowTouchingShips: false
    };

    this.defaultSettings = {
      isPrivate: false,
      allowSpectators: false,
      autoStart: true,
      pauseOnDisconnect: true,
      recordHistory: true
    };

    this.defaultTimeouts = {
      inactivityTimeout: 1800000, // 30 minutes
      turnTimeout: 60000, // 1 minute
      setupTimeout: 600000, // 10 minutes
      reconnectGracePeriod: 300000 // 5 minutes
    };
  }

  /**
   * Initialize a new game with proper state structure
   */
  initializeGameState(hostPlayerId: string, hostPlayerName: string, customRules?: Partial<GameRules>, customSettings?: Partial<GameSettings>): Game {
    const gameId = randomUUID();
    const now = new Date();

    const metadata: GameMetadata = {
      version: '1.0.0',
      rules: { ...this.defaultRules, ...customRules },
      settings: { ...this.defaultSettings, ...customSettings },
      hostPlayerId,
      timeouts: { ...this.defaultTimeouts },
      tags: []
    };

    const gameState: GameState = {
      isValid: true,
      integrity: {
        checksum: '',
        lastValidated: now,
        validationErrors: []
      },
      turnInfo: {
        turnNumber: 0,
        turnStartedAt: now,
        turnHistory: []
      },
      phaseTransitions: []
    };

    const statistics: GameStatistics = {
      totalTurns: 0,
      totalShots: 0,
      totalHits: 0,
      totalMisses: 0,
      averageTurnTime: 0,
      longestTurn: 0,
      playerStats: {}
    };

    const game: Game = {
      gameId,
      phase: 'waiting',
      players: {},
      currentTurn: null,
      winner: null,
      createdAt: now,
      lastActivity: now,
      metadata,
      state: gameState,
      history: [],
      statistics
    };

    // Record initial phase transition
    this.recordPhaseTransition(game, 'waiting', 'waiting', hostPlayerId, 'Game created');

    return game;
  }

  /**
   * Validate complete game state
   */
  async validateGameState(game: Game): Promise<GameStateValidationResult> {
    const errors: StateValidationError[] = [];
    const warnings: StateValidationWarning[] = [];
    let corrected = false;

    try {
      // Validate basic game structure
      this.validateBasicStructure(game, errors);

      // Validate game rules compliance
      this.validateGameRules(game, errors, warnings);

      // Validate phase consistency
      this.validatePhaseConsistency(game, errors);

      // Validate player states
      this.validatePlayerStates(game, errors, warnings);

      // Validate turn management
      this.validateTurnManagement(game, errors);

      // Validate board states
      this.validateBoardStates(game, errors);

      // Validate statistics consistency
      this.validateStatistics(game, errors, warnings);

      // Attempt auto-correction for minor issues
      corrected = await this.attemptAutoCorrection(game, warnings);

      // Update validation state
      game.state.integrity.lastValidated = new Date();
      game.state.integrity.validationErrors = errors.map(e => e.message);
      game.state.isValid = errors.length === 0;

    } catch (error) {
      errors.push({
        type: 'integrity',
        field: 'general',
        message: `Validation failed: ${error}`,
        severity: 'critical'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      corrected
    };
  }

  /**
   * Transition game to a new phase
   */
  async transitionGamePhase(game: Game, newPhase: GamePhase, triggeredBy?: string, reason?: string): Promise<boolean> {
    const oldPhase = game.phase;

    // Validate transition is allowed
    if (!this.isValidPhaseTransition(oldPhase, newPhase)) {
      throw new Error(`Invalid phase transition from ${oldPhase} to ${newPhase}`);
    }

    // Perform phase-specific validations
    await this.validatePhaseTransition(game, newPhase);

    // Update game phase
    game.phase = newPhase;
    game.lastActivity = new Date();

    // Record phase transition
    this.recordPhaseTransition(game, oldPhase, newPhase, triggeredBy, reason);

    // Perform phase-specific setup
    await this.setupPhaseSpecificState(game, newPhase);

    // Update statistics
    this.updatePhaseStatistics(game, oldPhase, newPhase);

    console.log(`Game ${game.gameId} transitioned from ${oldPhase} to ${newPhase}`);
    return true;
  }

  /**
   * Repair corrupted game state
   */
  async repairGameState(game: Game): Promise<Game> {
    console.log(`Attempting to repair game state for ${game.gameId}`);

    // Create a backup before repair
    await this.storage.createSnapshot(game, 'before_repair', 'system');

    // Validate and identify issues
    const validation = await this.validateGameState(game);

    for (const error of validation.errors) {
      switch (error.type) {
        case 'consistency':
          await this.repairConsistencyError(game, error);
          break;
        case 'integrity':
          await this.repairIntegrityError(game, error);
          break;
        case 'rules':
          await this.repairRulesError(game, error);
          break;
        case 'data':
          await this.repairDataError(game, error);
          break;
      }
    }

    // Re-validate after repair
    const finalValidation = await this.validateGameState(game);

    if (finalValidation.isValid) {
      console.log(`Game ${game.gameId} successfully repaired`);
      await this.storage.createSnapshot(game, 'after_repair', 'system');
    } else {
      console.error(`Failed to repair game ${game.gameId}`, finalValidation.errors);
    }

    return game;
  }

  /**
   * Get default game metadata
   */
  getDefaultMetadata(hostPlayerId: string): GameMetadata {
    return {
      version: '1.0.0',
      rules: { ...this.defaultRules },
      settings: { ...this.defaultSettings },
      hostPlayerId,
      timeouts: { ...this.defaultTimeouts },
      tags: []
    };
  }

  /**
   * Update game statistics for a turn
   */
  updateTurnStatistics(game: Game, playerId: string, action: string, duration: number): void {
    const now = new Date();

    // Update turn info
    if (action === 'turn_start') {
      game.state.turnInfo.turnNumber++;
      game.state.turnInfo.turnStartedAt = now;
      game.state.turnInfo.previousTurn = game.currentTurn;

      // Record turn in history
      game.state.turnInfo.turnHistory.push({
        playerId,
        turnNumber: game.state.turnInfo.turnNumber,
        startedAt: now
      });
    } else if (action === 'turn_end') {
      // Update the most recent turn history entry
      const lastTurn = game.state.turnInfo.turnHistory[game.state.turnInfo.turnHistory.length - 1];
      if (lastTurn && !lastTurn.endedAt) {
        lastTurn.endedAt = now;
        lastTurn.duration = duration;
        lastTurn.action = action;
      }
    }

    // Update game statistics
    game.statistics.totalTurns = Math.max(game.statistics.totalTurns, game.state.turnInfo.turnNumber);

    if (duration > 0) {
      const totalTurnTime = game.statistics.averageTurnTime * game.statistics.totalTurns + duration;
      game.statistics.averageTurnTime = totalTurnTime / (game.statistics.totalTurns + 1);
      game.statistics.longestTurn = Math.max(game.statistics.longestTurn, duration);
    }

    // Update player statistics
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
    if (duration > 0) {
      playerStats.totalTimeSpent += duration;
      playerStats.longestTurnTime = Math.max(playerStats.longestTurnTime, duration);

      const turnCount = game.state.turnInfo.turnHistory.filter(t => t.playerId === playerId && t.endedAt).length;
      if (turnCount > 0) {
        playerStats.averageResponseTime = playerStats.totalTimeSpent / turnCount;
      }
    }
  }

  /**
   * Update statistics for an attack
   */
  updateAttackStatistics(game: Game, attackerId: string, result: 'hit' | 'miss' | 'sunk'): void {
    game.statistics.totalShots++;

    if (result === 'hit' || result === 'sunk') {
      game.statistics.totalHits++;
    } else {
      game.statistics.totalMisses++;
    }

    // Update player statistics
    const playerStats = game.statistics.playerStats[attackerId];
    if (playerStats) {
      playerStats.shotsAttempted++;

      if (result === 'hit' || result === 'sunk') {
        playerStats.shotsHit++;
      } else {
        playerStats.shotsMissed++;
      }

      if (result === 'sunk') {
        playerStats.shipsDestroyed++;
      }

      // Update accuracy rate
      playerStats.accuracyRate = playerStats.shotsHit / playerStats.shotsAttempted;
    }
  }

  /**
   * Validate basic game structure
   */
  private validateBasicStructure(game: Game, errors: StateValidationError[]): void {
    if (!game.gameId) {
      errors.push({
        type: 'data',
        field: 'gameId',
        message: 'Game ID is required',
        severity: 'critical'
      });
    }

    if (!game.metadata) {
      errors.push({
        type: 'data',
        field: 'metadata',
        message: 'Game metadata is required',
        severity: 'critical'
      });
    }

    if (!game.state) {
      errors.push({
        type: 'data',
        field: 'state',
        message: 'Game state is required',
        severity: 'critical'
      });
    }

    if (!game.statistics) {
      errors.push({
        type: 'data',
        field: 'statistics',
        message: 'Game statistics are required',
        severity: 'major'
      });
    }
  }

  /**
   * Validate game rules compliance
   */
  private validateGameRules(game: Game, errors: StateValidationError[], warnings: StateValidationWarning[]): void {
    if (!game.metadata?.rules) return;

    const playerCount = Object.keys(game.players).length;
    if (playerCount > game.metadata.rules.maxPlayers) {
      errors.push({
        type: 'rules',
        field: 'players',
        message: `Too many players: ${playerCount} > ${game.metadata.rules.maxPlayers}`,
        severity: 'critical'
      });
    }

    // Validate ship configurations for each player
    for (const [playerId, player] of Object.entries(game.players)) {
      if (player.ships.length > 0) {
        const expectedShipCount = game.metadata.rules.shipTypes.reduce((sum, type) => sum + type.count, 0);
        if (player.ships.length !== expectedShipCount) {
          warnings.push({
            type: 'data_quality',
            field: `players.${playerId}.ships`,
            message: `Player has ${player.ships.length} ships, expected ${expectedShipCount}`,
            recommendation: 'Verify ship placement completion'
          });
        }
      }
    }
  }

  /**
   * Validate phase consistency
   */
  private validatePhaseConsistency(game: Game, errors: StateValidationError[]): void {
    const playerCount = Object.keys(game.players).length;
    const readyPlayers = Object.values(game.players).filter(p => p.ready).length;

    switch (game.phase) {
      case 'waiting':
        if (playerCount > 1 && readyPlayers > 0) {
          errors.push({
            type: 'consistency',
            field: 'phase',
            message: 'Game should be in setup phase when players start getting ready',
            severity: 'major',
            suggestedFix: 'Transition to setup phase'
          });
        }
        break;

      case 'setup':
        if (playerCount === 2 && readyPlayers === 2) {
          errors.push({
            type: 'consistency',
            field: 'phase',
            message: 'Game should be in playing phase when all players are ready',
            severity: 'major',
            suggestedFix: 'Transition to playing phase'
          });
        }
        break;

      case 'playing':
        if (!game.currentTurn) {
          errors.push({
            type: 'consistency',
            field: 'currentTurn',
            message: 'Current turn must be set in playing phase',
            severity: 'critical',
            suggestedFix: 'Set current turn to a valid player'
          });
        }
        break;

      case 'finished':
        if (!game.winner) {
          errors.push({
            type: 'consistency',
            field: 'winner',
            message: 'Winner must be set in finished phase',
            severity: 'critical',
            suggestedFix: 'Set winner or transition to appropriate phase'
          });
        }
        break;
    }
  }

  /**
   * Validate player states
   */
  private validatePlayerStates(game: Game, errors: StateValidationError[], warnings: StateValidationWarning[]): void {
    for (const [playerId, player] of Object.entries(game.players)) {
      if (!player.board) {
        errors.push({
          type: 'data',
          field: `players.${playerId}.board`,
          message: 'Player board is required',
          severity: 'critical'
        });
      }

      if (player.ready && player.ships.length === 0) {
        warnings.push({
          type: 'data_quality',
          field: `players.${playerId}.ready`,
          message: 'Player marked as ready but has no ships',
          recommendation: 'Verify ship placement or ready status'
        });
      }
    }
  }

  /**
   * Validate turn management
   */
  private validateTurnManagement(game: Game, errors: StateValidationError[]): void {
    if (game.phase === 'playing' && game.currentTurn) {
      if (!game.players[game.currentTurn]) {
        errors.push({
          type: 'consistency',
          field: 'currentTurn',
          message: 'Current turn refers to non-existent player',
          severity: 'critical',
          suggestedFix: 'Set current turn to valid player'
        });
      }
    }

    // Validate turn history consistency
    if (game.state?.turnInfo?.turnHistory) {
      const turnNumbers = game.state.turnInfo.turnHistory.map(t => t.turnNumber);
      const maxTurn = Math.max(...turnNumbers, 0);

      if (maxTurn > game.state.turnInfo.turnNumber) {
        errors.push({
          type: 'consistency',
          field: 'turnInfo.turnNumber',
          message: 'Turn number is inconsistent with turn history',
          severity: 'major',
          suggestedFix: 'Synchronize turn number with history'
        });
      }
    }
  }

  /**
   * Validate board states
   */
  private validateBoardStates(game: Game, errors: StateValidationError[]): void {
    for (const [playerId, player] of Object.entries(game.players)) {
      if (!player.board) continue;

      const boardSize = game.metadata?.rules?.boardSize || 10;
      if (player.board.size !== boardSize) {
        errors.push({
          type: 'rules',
          field: `players.${playerId}.board.size`,
          message: `Board size ${player.board.size} doesn't match rules ${boardSize}`,
          severity: 'major',
          suggestedFix: 'Update board size to match game rules'
        });
      }

      // Validate hit/miss positions are within bounds
      const allPositions = [...player.board.hits, ...player.board.misses];
      for (const position of allPositions) {
        if (!this.isValidBoardPosition(position, boardSize)) {
          errors.push({
            type: 'data',
            field: `players.${playerId}.board`,
            message: `Invalid board position: ${position}`,
            severity: 'major',
            suggestedFix: 'Remove invalid positions'
          });
        }
      }
    }
  }

  /**
   * Validate statistics consistency
   */
  private validateStatistics(game: Game, errors: StateValidationError[], warnings: StateValidationWarning[]): void {
    if (!game.statistics) return;

    const calculatedHits = Object.values(game.players).reduce((sum, player) => sum + player.board.hits.size, 0);
    const calculatedMisses = Object.values(game.players).reduce((sum, player) => sum + player.board.misses.size, 0);
    const calculatedTotal = calculatedHits + calculatedMisses;

    if (game.statistics.totalShots !== calculatedTotal) {
      warnings.push({
        type: 'data_quality',
        field: 'statistics.totalShots',
        message: `Statistics mismatch: recorded ${game.statistics.totalShots}, calculated ${calculatedTotal}`,
        recommendation: 'Recalculate statistics from board states'
      });
    }

    if (game.statistics.totalHits !== calculatedHits) {
      warnings.push({
        type: 'data_quality',
        field: 'statistics.totalHits',
        message: `Hit count mismatch: recorded ${game.statistics.totalHits}, calculated ${calculatedHits}`,
        recommendation: 'Recalculate hit statistics'
      });
    }
  }

  /**
   * Attempt automatic correction of minor issues
   */
  private async attemptAutoCorrection(game: Game, warnings: StateValidationWarning[]): Promise<boolean> {
    let corrected = false;

    for (const warning of warnings) {
      switch (warning.type) {
        case 'data_quality':
          if (warning.field.includes('statistics')) {
            this.recalculateStatistics(game);
            corrected = true;
          }
          break;
      }
    }

    return corrected;
  }

  /**
   * Recalculate game statistics from current state
   */
  private recalculateStatistics(game: Game): void {
    const stats = game.statistics;

    // Reset counters
    let totalHits = 0;
    let totalMisses = 0;

    // Calculate from board states
    for (const player of Object.values(game.players)) {
      totalHits += player.board.hits.size;
      totalMisses += player.board.misses.size;
    }

    stats.totalShots = totalHits + totalMisses;
    stats.totalHits = totalHits;
    stats.totalMisses = totalMisses;

    console.log(`Recalculated statistics for game ${game.gameId}`);
  }

  /**
   * Check if phase transition is valid
   */
  private isValidPhaseTransition(from: GamePhase, to: GamePhase): boolean {
    const validTransitions: Record<GamePhase, GamePhase[]> = {
      'waiting': ['setup', 'abandoned'],
      'setup': ['playing', 'waiting', 'abandoned'],
      'playing': ['paused', 'finished', 'abandoned'],
      'paused': ['playing', 'abandoned'],
      'finished': ['abandoned'],
      'abandoned': []
    };

    return validTransitions[from]?.includes(to) || false;
  }

  /**
   * Validate specific phase transition requirements
   */
  private async validatePhaseTransition(game: Game, newPhase: GamePhase): Promise<void> {
    switch (newPhase) {
      case 'setup':
        if (Object.keys(game.players).length === 0) {
          throw new Error('Cannot enter setup phase without players');
        }
        break;

      case 'playing':
        const readyPlayers = Object.values(game.players).filter(p => p.ready).length;
        if (readyPlayers < 2) {
          throw new Error('Cannot start playing phase without all players ready');
        }
        break;

      case 'finished':
        if (!game.winner) {
          throw new Error('Cannot finish game without determining winner');
        }
        break;
    }
  }

  /**
   * Record phase transition in game history
   */
  private recordPhaseTransition(game: Game, fromPhase: GamePhase, toPhase: GamePhase, triggeredBy?: string, reason?: string): void {
    const transition: PhaseTransition = {
      fromPhase,
      toPhase,
      transitionedAt: new Date(),
      triggeredBy,
      reason
    };

    game.state.phaseTransitions.push(transition);

    // Also add to history
    game.history.push({
      id: randomUUID(),
      timestamp: new Date(),
      type: 'phase_transition',
      data: transition,
      phase: toPhase,
      playerId: triggeredBy
    });
  }

  /**
   * Setup phase-specific state
   */
  private async setupPhaseSpecificState(game: Game, newPhase: GamePhase): Promise<void> {
    switch (newPhase) {
      case 'playing':
        // Initialize turn management
        if (!game.currentTurn) {
          const playerIds = Object.keys(game.players);
          game.currentTurn = playerIds[Math.floor(Math.random() * playerIds.length)];
        }

        // Initialize game start statistics
        if (!game.statistics.gameStartedAt) {
          game.statistics.gameStartedAt = new Date();
        }
        break;

      case 'finished':
        // Finalize game statistics
        game.statistics.gameEndedAt = new Date();
        if (game.statistics.gameStartedAt) {
          game.statistics.gameDuration = game.statistics.gameEndedAt.getTime() - game.statistics.gameStartedAt.getTime();
        }
        break;
    }
  }

  /**
   * Update statistics for phase transitions
   */
  private updatePhaseStatistics(game: Game, oldPhase: GamePhase, newPhase: GamePhase): void {
    // Add any phase-specific statistics updates here
    if (newPhase === 'finished') {
      // Calculate final player statistics
      for (const [playerId, playerStats] of Object.entries(game.statistics.playerStats)) {
        if (playerStats.shotsAttempted > 0) {
          playerStats.accuracyRate = playerStats.shotsHit / playerStats.shotsAttempted;
        }
      }
    }
  }

  /**
   * Check if board position is valid
   */
  private isValidBoardPosition(position: string, boardSize: number): boolean {
    const match = position.match(/^([A-J])(\d{1,2})$/);
    if (!match) return false;

    const col = match[1].charCodeAt(0) - 'A'.charCodeAt(0);
    const row = parseInt(match[2]) - 1;

    return col >= 0 && col < boardSize && row >= 0 && row < boardSize;
  }

  /**
   * Repair consistency errors
   */
  private async repairConsistencyError(game: Game, error: StateValidationError): Promise<void> {
    console.log(`Repairing consistency error: ${error.message}`);
    // Implementation would depend on specific error types
  }

  /**
   * Repair integrity errors
   */
  private async repairIntegrityError(game: Game, error: StateValidationError): Promise<void> {
    console.log(`Repairing integrity error: ${error.message}`);
    // Implementation would depend on specific error types
  }

  /**
   * Repair rules errors
   */
  private async repairRulesError(game: Game, error: StateValidationError): Promise<void> {
    console.log(`Repairing rules error: ${error.message}`);
    // Implementation would depend on specific error types
  }

  /**
   * Repair data errors
   */
  private async repairDataError(game: Game, error: StateValidationError): Promise<void> {
    console.log(`Repairing data error: ${error.message}`);
    // Implementation would depend on specific error types
  }
}