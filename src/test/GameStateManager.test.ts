import { GameStateManager } from '../services/GameStateManager';
import { GameStateStorage } from '../services/GameStateStorage';
import { Game, GamePhase, GameRules, GameSettings } from '../types';
import { createGame, createPlayer } from '../models/Game';
import { randomUUID } from 'crypto';

describe('GameStateManager', () => {
  let stateManager: GameStateManager;
  let mockStorage: jest.Mocked<GameStateStorage>;
  let testGame: Game;

  beforeEach(() => {
    // Create mock storage
    mockStorage = {
      saveGame: jest.fn(),
      loadGame: jest.fn(),
      deleteGame: jest.fn(),
      createSnapshot: jest.fn(),
      getRecoveryInfo: jest.fn(),
      recoverGame: jest.fn(),
      getAllGameIds: jest.fn(),
      getStorageStats: jest.fn(),
      destroy: jest.fn()
    } as any;

    stateManager = new GameStateManager(mockStorage);

    // Create test game
    const hostPlayer = createPlayer(randomUUID(), 'TestHost');
    testGame = createGame(hostPlayer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeGameState', () => {
    it('should create a game with proper initial state', () => {
      const customRules: Partial<GameRules> = {
        turnTimeLimit: 30000,
        allowAdjacent: true
      };

      const customSettings: Partial<GameSettings> = {
        isPrivate: true,
        allowSpectators: true
      };

      const game = stateManager.initializeGameState(
        'player1',
        'TestPlayer',
        customRules,
        customSettings
      );

      expect(game.gameId).toBeDefined();
      expect(game.phase).toBe('waiting');
      expect(game.metadata.hostPlayerId).toBe('player1');
      expect(game.metadata.rules.turnTimeLimit).toBe(30000);
      expect(game.metadata.rules.allowAdjacent).toBe(true);
      expect(game.metadata.settings.isPrivate).toBe(true);
      expect(game.metadata.settings.allowSpectators).toBe(true);
      expect(game.state.isValid).toBe(true);
      expect(game.state.turnInfo.turnNumber).toBe(0);
      expect(game.state.phaseTransitions).toHaveLength(1);
      expect(game.history).toEqual([]);
      expect(game.statistics.totalTurns).toBe(0);
    });

    it('should use default rules and settings when not provided', () => {
      const game = stateManager.initializeGameState('player1', 'TestPlayer');

      expect(game.metadata.rules.boardSize).toBe(10);
      expect(game.metadata.rules.maxPlayers).toBe(2);
      expect(game.metadata.settings.isPrivate).toBe(false);
      expect(game.metadata.settings.autoStart).toBe(true);
    });
  });

  describe('validateGameState', () => {
    it('should validate a correct game state', async () => {
      const result = await stateManager.validateGameState(testGame);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect missing required fields', async () => {
      // Remove required field
      delete (testGame as any).metadata;

      const result = await stateManager.validateGameState(testGame);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'data',
          field: 'metadata',
          severity: 'critical'
        })
      );
    });

    it('should detect phase consistency issues', async () => {
      // Set inconsistent state
      testGame.phase = 'playing';
      testGame.currentTurn = null;

      const result = await stateManager.validateGameState(testGame);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'consistency',
          field: 'currentTurn',
          severity: 'critical'
        })
      );
    });

    it('should detect player state issues', async () => {
      const player2 = createPlayer('player2', 'Player2');
      testGame.players['player2'] = {
        ...player2,
        ready: true,
        board: { size: 10, hits: new Set(), misses: new Set() },
        ships: [] // Ready but no ships
      };

      const result = await stateManager.validateGameState(testGame);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'data_quality',
          field: 'players.player2.ready'
        })
      );
    });

    it('should validate turn management consistency', async () => {
      testGame.phase = 'playing';
      testGame.currentTurn = 'nonexistent-player';

      const result = await stateManager.validateGameState(testGame);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'consistency',
          field: 'currentTurn',
          severity: 'critical'
        })
      );
    });
  });

  describe('transitionGamePhase', () => {
    it('should allow valid phase transitions', async () => {
      const success = await stateManager.transitionGamePhase(
        testGame,
        'setup',
        'player1',
        'Player added'
      );

      expect(success).toBe(true);
      expect(testGame.phase).toBe('setup');
      expect(testGame.state.phaseTransitions).toHaveLength(2);
      expect(testGame.state.phaseTransitions[1]).toMatchObject({
        fromPhase: 'waiting',
        toPhase: 'setup',
        triggeredBy: 'player1',
        reason: 'Player added'
      });
    });

    it('should reject invalid phase transitions', async () => {
      await expect(
        stateManager.transitionGamePhase(testGame, 'finished', 'player1')
      ).rejects.toThrow('Invalid phase transition from waiting to finished');
    });

    it('should validate phase-specific requirements', async () => {
      // Try to transition to playing without players being ready
      await expect(
        stateManager.transitionGamePhase(testGame, 'playing', 'player1')
      ).rejects.toThrow('Cannot start playing phase without all players ready');
    });

    it('should setup phase-specific state', async () => {
      // Add players and make them ready
      const player2 = createPlayer('player2', 'Player2');
      testGame.players['player2'] = {
        ...player2,
        ready: true,
        board: { size: 10, hits: new Set(), misses: new Set() },
        ships: [{ id: 'ship1', length: 2, positions: ['A1', 'A2'], hits: 0, sunk: false }]
      };

      Object.values(testGame.players).forEach(player => {
        player.ready = true;
        player.ships = [{ id: 'ship1', length: 2, positions: ['A1', 'A2'], hits: 0, sunk: false }];
      });

      await stateManager.transitionGamePhase(testGame, 'playing', 'player1');

      expect(testGame.currentTurn).toBeDefined();
      expect(testGame.statistics.gameStartedAt).toBeDefined();
    });
  });

  describe('repairGameState', () => {
    beforeEach(() => {
      mockStorage.createSnapshot.mockResolvedValue({
        gameId: testGame.gameId,
        snapshotId: 'snapshot1',
        timestamp: new Date(),
        game: testGame,
        reason: 'before_repair'
      });
    });

    it('should create backup snapshot before repair', async () => {
      await stateManager.repairGameState(testGame);

      expect(mockStorage.createSnapshot).toHaveBeenCalledWith(
        testGame,
        'before_repair',
        'system'
      );
    });

    it('should attempt to fix validation errors', async () => {
      // Introduce data inconsistency
      testGame.statistics.totalShots = 100;
      testGame.statistics.totalHits = 50;
      // But board states don't match

      const repairedGame = await stateManager.repairGameState(testGame);

      expect(repairedGame).toBeDefined();
      expect(mockStorage.createSnapshot).toHaveBeenCalledWith(
        testGame,
        'after_repair',
        'system'
      );
    });
  });

  describe('updateTurnStatistics', () => {
    beforeEach(() => {
      testGame.statistics.playerStats['player1'] = {
        shotsAttempted: 0,
        shotsHit: 0,
        shotsMissed: 0,
        shipsDestroyed: 0,
        accuracyRate: 0,
        averageResponseTime: 0,
        totalTimeSpent: 0,
        longestTurnTime: 0
      };
    });

    it('should update turn statistics for turn start', () => {
      stateManager.updateTurnStatistics(testGame, 'player1', 'turn_start', 0);

      expect(testGame.state.turnInfo.turnNumber).toBe(1);
      expect(testGame.state.turnInfo.turnHistory).toHaveLength(1);
      expect(testGame.state.turnInfo.turnHistory[0]).toMatchObject({
        playerId: 'player1',
        turnNumber: 1
      });
    });

    it('should update turn statistics for turn end', () => {
      // Start a turn first
      stateManager.updateTurnStatistics(testGame, 'player1', 'turn_start', 0);

      // End the turn
      const turnDuration = 5000;
      stateManager.updateTurnStatistics(testGame, 'player1', 'turn_end', turnDuration);

      const lastTurn = testGame.state.turnInfo.turnHistory[testGame.state.turnInfo.turnHistory.length - 1];
      expect(lastTurn.endedAt).toBeDefined();
      expect(lastTurn.duration).toBe(turnDuration);
      expect(lastTurn.action).toBe('turn_end');

      expect(testGame.statistics.averageTurnTime).toBeGreaterThan(0);
      expect(testGame.statistics.longestTurn).toBe(turnDuration);

      const playerStats = testGame.statistics.playerStats['player1'];
      expect(playerStats.totalTimeSpent).toBe(turnDuration);
      expect(playerStats.longestTurnTime).toBe(turnDuration);
    });
  });

  describe('updateAttackStatistics', () => {
    beforeEach(() => {
      testGame.statistics.playerStats['player1'] = {
        shotsAttempted: 0,
        shotsHit: 0,
        shotsMissed: 0,
        shipsDestroyed: 0,
        accuracyRate: 0,
        averageResponseTime: 0,
        totalTimeSpent: 0,
        longestTurnTime: 0
      };
    });

    it('should update statistics for hit attack', () => {
      stateManager.updateAttackStatistics(testGame, 'player1', 'hit');

      expect(testGame.statistics.totalShots).toBe(1);
      expect(testGame.statistics.totalHits).toBe(1);
      expect(testGame.statistics.totalMisses).toBe(0);

      const playerStats = testGame.statistics.playerStats['player1'];
      expect(playerStats.shotsAttempted).toBe(1);
      expect(playerStats.shotsHit).toBe(1);
      expect(playerStats.shotsMissed).toBe(0);
      expect(playerStats.accuracyRate).toBe(1);
    });

    it('should update statistics for miss attack', () => {
      stateManager.updateAttackStatistics(testGame, 'player1', 'miss');

      expect(testGame.statistics.totalShots).toBe(1);
      expect(testGame.statistics.totalHits).toBe(0);
      expect(testGame.statistics.totalMisses).toBe(1);

      const playerStats = testGame.statistics.playerStats['player1'];
      expect(playerStats.shotsAttempted).toBe(1);
      expect(playerStats.shotsHit).toBe(0);
      expect(playerStats.shotsMissed).toBe(1);
      expect(playerStats.accuracyRate).toBe(0);
    });

    it('should update statistics for sunk ship', () => {
      stateManager.updateAttackStatistics(testGame, 'player1', 'sunk');

      expect(testGame.statistics.totalShots).toBe(1);
      expect(testGame.statistics.totalHits).toBe(1);

      const playerStats = testGame.statistics.playerStats['player1'];
      expect(playerStats.shipsDestroyed).toBe(1);
      expect(playerStats.accuracyRate).toBe(1);
    });

    it('should calculate correct accuracy rate over multiple shots', () => {
      stateManager.updateAttackStatistics(testGame, 'player1', 'hit');
      stateManager.updateAttackStatistics(testGame, 'player1', 'miss');
      stateManager.updateAttackStatistics(testGame, 'player1', 'hit');

      const playerStats = testGame.statistics.playerStats['player1'];
      expect(playerStats.shotsAttempted).toBe(3);
      expect(playerStats.shotsHit).toBe(2);
      expect(playerStats.shotsMissed).toBe(1);
      expect(playerStats.accuracyRate).toBeCloseTo(2/3);
    });
  });

  describe('getDefaultMetadata', () => {
    it('should return default game metadata', () => {
      const metadata = stateManager.getDefaultMetadata('host123');

      expect(metadata.hostPlayerId).toBe('host123');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.rules.boardSize).toBe(10);
      expect(metadata.rules.maxPlayers).toBe(2);
      expect(metadata.settings.isPrivate).toBe(false);
      expect(metadata.settings.autoStart).toBe(true);
      expect(metadata.timeouts.turnTimeout).toBe(60000);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing player statistics gracefully', () => {
      // Remove player stats
      delete testGame.statistics.playerStats['player1'];

      stateManager.updateAttackStatistics(testGame, 'player1', 'hit');

      // Should create new player stats
      expect(testGame.statistics.playerStats['player1']).toBeDefined();
      expect(testGame.statistics.playerStats['player1'].shotsAttempted).toBe(1);
    });

    it('should handle corrupted game data during validation', async () => {
      // Corrupt game data
      (testGame as any).metadata = null;
      (testGame as any).state = undefined;

      const result = await stateManager.validateGameState(testGame);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle invalid phase transitions gracefully', async () => {
      testGame.phase = 'finished';

      await expect(
        stateManager.transitionGamePhase(testGame, 'waiting')
      ).rejects.toThrow();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large turn history efficiently', () => {
      // Add many turn history entries
      for (let i = 0; i < 1000; i++) {
        testGame.state.turnInfo.turnHistory.push({
          playerId: 'player1',
          turnNumber: i + 1,
          startedAt: new Date(Date.now() - (1000 - i) * 1000),
          endedAt: new Date(Date.now() - (1000 - i - 1) * 1000),
          duration: 1000
        });
      }

      const startTime = Date.now();
      stateManager.updateTurnStatistics(testGame, 'player1', 'turn_start', 0);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete in < 100ms
    });

    it('should handle large game history during validation', async () => {
      // Add many history entries
      for (let i = 0; i < 1000; i++) {
        testGame.history.push({
          id: `event-${i}`,
          timestamp: new Date(),
          type: 'test_event',
          data: { eventIndex: i },
          phase: 'waiting'
        });
      }

      const startTime = Date.now();
      const result = await stateManager.validateGameState(testGame);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(500); // Should complete in < 500ms
    });
  });
});