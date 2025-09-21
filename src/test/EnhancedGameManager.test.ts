import { EnhancedGameManager } from '../services/EnhancedGameManager';
import { GameStateStorage } from '../services/GameStateStorage';
import { ConnectionManager } from '../services/ConnectionManager';
import { Game, GameQuery, GameQueryOptions, ShipPlacement } from '../types';
import { randomUUID } from 'crypto';

// Mock dependencies
jest.mock('../services/GameStateStorage');
jest.mock('../services/ConnectionManager');

describe('EnhancedGameManager', () => {
  let gameManager: EnhancedGameManager;
  let mockStorage: jest.Mocked<GameStateStorage>;
  let mockConnectionManager: jest.Mocked<ConnectionManager>;

  beforeEach(() => {
    mockStorage = new GameStateStorage() as jest.Mocked<GameStateStorage>;
    mockConnectionManager = new ConnectionManager() as jest.Mocked<ConnectionManager>;

    // Setup default mock implementations
    mockStorage.saveGame = jest.fn().mockResolvedValue(undefined);
    mockStorage.loadGame = jest.fn().mockResolvedValue(null);
    mockStorage.deleteGame = jest.fn().mockResolvedValue(undefined);
    mockStorage.createSnapshot = jest.fn().mockResolvedValue({
      gameId: 'test-game',
      snapshotId: 'snapshot-1',
      timestamp: new Date(),
      game: {} as Game,
      reason: 'test'
    });
    mockStorage.getAllGameIds = jest.fn().mockResolvedValue([]);
    mockStorage.getStorageStats = jest.fn().mockResolvedValue({
      totalGames: 0,
      totalSnapshots: 0,
      totalBackups: 0,
      storageSize: 0
    });

    mockConnectionManager.broadcast = jest.fn();

    gameManager = new EnhancedGameManager(
      mockConnectionManager,
      mockStorage,
      { storageEnabled: true, autoSave: false }
    );
  });

  afterEach(async () => {
    await gameManager.destroy();
    jest.clearAllMocks();
  });

  describe('createGame', () => {
    it('should create a new game with enhanced state management', async () => {
      const game = await gameManager.createGame('TestPlayer');

      expect(game).toBeDefined();
      expect(game.gameId).toBeDefined();
      expect(game.phase).toBe('waiting');
      expect(game.metadata.hostPlayerId).toBeDefined();
      expect(game.state.isValid).toBe(true);
      expect(game.statistics).toBeDefined();
      expect(game.history).toBeDefined();

      expect(mockStorage.saveGame).toHaveBeenCalledWith(game);
      expect(mockStorage.createSnapshot).toHaveBeenCalledWith(
        game,
        'game_created',
        expect.any(String)
      );
    });

    it('should apply custom rules and settings', async () => {
      const customRules = {
        turnTimeLimit: 30000,
        allowAdjacent: true
      };

      const customSettings = {
        isPrivate: true,
        allowSpectators: true
      };

      const game = await gameManager.createGame('TestPlayer', customRules, customSettings);

      expect(game.metadata.rules.turnTimeLimit).toBe(30000);
      expect(game.metadata.rules.allowAdjacent).toBe(true);
      expect(game.metadata.settings.isPrivate).toBe(true);
      expect(game.metadata.settings.allowSpectators).toBe(true);
    });

    it('should broadcast player joined event', async () => {
      await gameManager.createGame('TestPlayer');

      expect(mockConnectionManager.broadcast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'player_joined',
          data: expect.objectContaining({
            playerName: 'TestPlayer'
          })
        }),
        expect.any(String)
      );
    });
  });

  describe('addPlayer', () => {
    let testGame: Game;

    beforeEach(async () => {
      testGame = await gameManager.createGame('Host');
      jest.clearAllMocks();
    });

    it('should add player to existing game', async () => {
      const updatedGame = await gameManager.addPlayer(testGame.gameId, 'Player2');

      expect(Object.keys(updatedGame.players)).toHaveLength(2);
      expect(updatedGame.players).toHaveProperty(expect.any(String), expect.objectContaining({
        name: 'Player2'
      }));

      expect(mockStorage.saveGame).toHaveBeenCalledWith(updatedGame);
    });

    it('should throw error for non-existent game', async () => {
      await expect(
        gameManager.addPlayer('non-existent-game', 'Player2')
      ).rejects.toThrow('Game not found');
    });

    it('should validate and repair game state before adding player', async () => {
      // Simulate corrupted game state
      testGame.state.isValid = false;

      // Mock validation to return errors
      const validateSpy = jest.spyOn(gameManager as any, 'stateManager');

      await gameManager.addPlayer(testGame.gameId, 'Player2');

      // Should attempt repair for invalid state
      expect(mockStorage.saveGame).toHaveBeenCalled();
    });
  });

  describe('placeShips', () => {
    let testGame: Game;
    let playerId: string;

    beforeEach(async () => {
      testGame = await gameManager.createGame('Host');
      playerId = Object.keys(testGame.players)[0];
      jest.clearAllMocks();
    });

    it('should place ships successfully', async () => {
      const shipPlacements: ShipPlacement[] = [
        { length: 2, startPosition: 'A1', direction: 'horizontal' },
        { length: 3, startPosition: 'B1', direction: 'vertical' }
      ];

      await gameManager.placeShips(testGame.gameId, playerId, shipPlacements);

      expect(testGame.players[playerId].ships).toHaveLength(2);
      expect(testGame.players[playerId].ready).toBe(true);
      expect(mockStorage.saveGame).toHaveBeenCalled();
    });

    it('should transition to setup phase when first ships are placed', async () => {
      const shipPlacements: ShipPlacement[] = [
        { length: 2, startPosition: 'A1', direction: 'horizontal' }
      ];

      await gameManager.placeShips(testGame.gameId, playerId, shipPlacements);

      expect(testGame.phase).toBe('setup');
    });

    it('should start game when all players are ready', async () => {
      // Add second player
      await gameManager.addPlayer(testGame.gameId, 'Player2');
      const player2Id = Object.keys(testGame.players).find(id => id !== playerId)!;

      const shipPlacements: ShipPlacement[] = [
        { length: 2, startPosition: 'A1', direction: 'horizontal' }
      ];

      // Place ships for both players
      await gameManager.placeShips(testGame.gameId, playerId, shipPlacements);
      await gameManager.placeShips(testGame.gameId, player2Id, shipPlacements);

      expect(testGame.phase).toBe('playing');
      expect(testGame.currentTurn).toBeDefined();
      expect(mockStorage.createSnapshot).toHaveBeenCalledWith(
        testGame,
        'game_started',
        expect.any(String)
      );
    });

    it('should validate ship placements', async () => {
      const invalidPlacements: ShipPlacement[] = [
        { length: 2, startPosition: 'A1', direction: 'horizontal' },
        { length: 2, startPosition: 'A1', direction: 'vertical' } // Overlapping
      ];

      await expect(
        gameManager.placeShips(testGame.gameId, playerId, invalidPlacements)
      ).rejects.toThrow('Invalid ship placement');
    });

    it('should record ship placement in history', async () => {
      const shipPlacements: ShipPlacement[] = [
        { length: 2, startPosition: 'A1', direction: 'horizontal' }
      ];

      await gameManager.placeShips(testGame.gameId, playerId, shipPlacements);

      expect(testGame.history).toContainEqual(
        expect.objectContaining({
          type: 'ships_placed',
          playerId
        })
      );
    });
  });

  describe('processAttack', () => {
    let testGame: Game;
    let player1Id: string;
    let player2Id: string;

    beforeEach(async () => {
      testGame = await gameManager.createGame('Player1');
      player1Id = Object.keys(testGame.players)[0];

      await gameManager.addPlayer(testGame.gameId, 'Player2');
      player2Id = Object.keys(testGame.players).find(id => id !== player1Id)!;

      // Set up ships for both players
      const shipPlacements: ShipPlacement[] = [
        { length: 2, startPosition: 'A1', direction: 'horizontal' }
      ];

      await gameManager.placeShips(testGame.gameId, player1Id, shipPlacements);
      await gameManager.placeShips(testGame.gameId, player2Id, shipPlacements);

      jest.clearAllMocks();
    });

    it('should process attack successfully', async () => {
      const result = await gameManager.processAttack(testGame.gameId, testGame.currentTurn!, 'C3');

      expect(result).toMatchObject({
        result: expect.stringMatching(/^(hit|miss|sunk)$/),
        position: 'C3',
        gameState: expect.stringMatching(/^(playing|won)$/),
        nextTurn: expect.any(String)
      });

      expect(mockStorage.saveGame).toHaveBeenCalled();
    });

    it('should update attack statistics', async () => {
      await gameManager.processAttack(testGame.gameId, testGame.currentTurn!, 'C3');

      expect(testGame.statistics.totalShots).toBe(1);
      expect(testGame.statistics.playerStats[testGame.currentTurn!].shotsAttempted).toBe(1);
    });

    it('should record attack in history', async () => {
      await gameManager.processAttack(testGame.gameId, testGame.currentTurn!, 'C3');

      expect(testGame.history).toContainEqual(
        expect.objectContaining({
          type: 'attack_made',
          playerId: testGame.currentTurn
        })
      );
    });

    it('should finish game when all ships are sunk', async () => {
      // Attack all positions of opponent's ship
      const currentPlayer = testGame.currentTurn!;
      const targetPlayer = Object.keys(testGame.players).find(id => id !== currentPlayer)!;
      const targetShips = testGame.players[targetPlayer].ships;

      for (const ship of targetShips) {
        for (const position of ship.positions) {
          if (testGame.currentTurn === currentPlayer) {
            await gameManager.processAttack(testGame.gameId, currentPlayer, position);
          }
        }
      }

      expect(testGame.phase).toBe('finished');
      expect(testGame.winner).toBe(currentPlayer);
      expect(mockStorage.createSnapshot).toHaveBeenCalledWith(
        testGame,
        'game_finished',
        currentPlayer
      );
    });

    it('should reject attack when not player\'s turn', async () => {
      const notCurrentPlayer = Object.keys(testGame.players).find(id => id !== testGame.currentTurn)!;

      await expect(
        gameManager.processAttack(testGame.gameId, notCurrentPlayer, 'C3')
      ).rejects.toThrow('Not your turn');
    });

    it('should reject attack on paused game', async () => {
      gameManager.pauseGame(testGame.gameId, 'manual');

      await expect(
        gameManager.processAttack(testGame.gameId, testGame.currentTurn!, 'C3')
      ).rejects.toThrow('Game is currently paused');
    });
  });

  describe('queryGames', () => {
    let testGames: Game[];

    beforeEach(async () => {
      testGames = [];

      // Create multiple test games
      for (let i = 0; i < 5; i++) {
        const game = await gameManager.createGame(`Player${i}`);
        testGames.push(game);
      }

      jest.clearAllMocks();
    });

    it('should query games by phase', async () => {
      const query: GameQuery = { phase: 'waiting' };
      const result = await gameManager.queryGames(query);

      expect(result.games).toHaveLength(5); // All games should be in waiting phase
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(false);
    });

    it('should filter games by creation date', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const query: GameQuery = {
        createdAfter: yesterday,
        createdBefore: tomorrow
      };

      const result = await gameManager.queryGames(query);

      expect(result.games.length).toBeGreaterThan(0);
    });

    it('should support pagination', async () => {
      const query: GameQuery = {};
      const options: GameQueryOptions = { limit: 2, offset: 0 };

      const result = await gameManager.queryGames(query, options);

      expect(result.games).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextOffset).toBe(2);
    });

    it('should sort games by specified field', async () => {
      const query: GameQuery = {};
      const options: GameQueryOptions = {
        sortBy: 'createdAt',
        sortOrder: 'desc'
      };

      const result = await gameManager.queryGames(query, options);

      // Should be sorted by creation date, newest first
      for (let i = 1; i < result.games.length; i++) {
        expect(result.games[i - 1].createdAt.getTime())
          .toBeGreaterThanOrEqual(result.games[i].createdAt.getTime());
      }
    });

    it('should exclude history and statistics when not requested', async () => {
      const query: GameQuery = {};
      const options: GameQueryOptions = {
        includeHistory: false,
        includeStatistics: false
      };

      const result = await gameManager.queryGames(query, options);

      result.games.forEach(game => {
        expect((game as any).history).toEqual([]);
        expect((game as any).statistics.playerStats).toEqual({});
      });
    });
  });

  describe('batchOperation', () => {
    let testGames: Game[];

    beforeEach(async () => {
      testGames = [];

      // Create test games
      for (let i = 0; i < 3; i++) {
        const game = await gameManager.createGame(`Player${i}`);
        testGames.push(game);
      }

      jest.clearAllMocks();
    });

    it('should execute delete batch operation', async () => {
      const operation = {
        operation: 'delete' as const,
        query: { phase: 'waiting' as const },
        options: { dryRun: false }
      };

      const result = await gameManager.batchOperation(operation);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(3);
      expect(result.failed).toBe(0);
      expect(mockStorage.deleteGame).toHaveBeenCalledTimes(3);
    });

    it('should execute archive batch operation', async () => {
      const operation = {
        operation: 'archive' as const,
        query: { phase: 'waiting' as const },
        options: { dryRun: false }
      };

      const result = await gameManager.batchOperation(operation);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(3);
      expect(mockStorage.createSnapshot).toHaveBeenCalledTimes(3);
    });

    it('should handle dry run mode', async () => {
      const operation = {
        operation: 'delete' as const,
        query: { phase: 'waiting' as const },
        options: { dryRun: true }
      };

      const result = await gameManager.batchOperation(operation);

      expect(result.success).toBe(true);
      expect(result.processed).toBe(3);
      expect(result.summary).toContain('DRY RUN');
      expect(mockStorage.deleteGame).not.toHaveBeenCalled();
    });

    it('should handle batch operation errors', async () => {
      mockStorage.deleteGame.mockRejectedValue(new Error('Storage error'));

      const operation = {
        operation: 'delete' as const,
        query: { phase: 'waiting' as const },
        options: { dryRun: false }
      };

      const result = await gameManager.batchOperation(operation);

      expect(result.success).toBe(false);
      expect(result.failed).toBe(3);
      expect(result.errors).toHaveLength(3);
    });

    it('should call progress callback', async () => {
      const progressCallback = jest.fn();

      const operation = {
        operation: 'validate' as const,
        query: { phase: 'waiting' as const },
        options: { onProgress: progressCallback }
      };

      await gameManager.batchOperation(operation);

      expect(progressCallback).toHaveBeenCalledTimes(3);
      expect(progressCallback).toHaveBeenLastCalledWith(3, 3);
    });
  });

  describe('validateGame', () => {
    let testGame: Game;

    beforeEach(async () => {
      testGame = await gameManager.createGame('TestPlayer');
      jest.clearAllMocks();
    });

    it('should validate game state', async () => {
      const result = await gameManager.validateGame(testGame.gameId);

      expect(result).toMatchObject({
        isValid: expect.any(Boolean),
        errors: expect.any(Array),
        warnings: expect.any(Array),
        corrected: expect.any(Boolean)
      });
    });

    it('should throw error for non-existent game', async () => {
      await expect(
        gameManager.validateGame('non-existent-game')
      ).rejects.toThrow('Game not found');
    });
  });

  describe('getGameAnalytics', () => {
    beforeEach(async () => {
      // Create some test games
      await gameManager.createGame('Player1');
      await gameManager.createGame('Player2');
      jest.clearAllMocks();
    });

    it('should return comprehensive analytics', async () => {
      const analytics = await gameManager.getGameAnalytics();

      expect(analytics).toMatchObject({
        totalGames: expect.any(Number),
        gamesByPhase: expect.any(Object),
        averageGameDuration: expect.any(Number),
        activePlayerCount: expect.any(Number),
        storageStats: expect.any(Object)
      });

      expect(analytics.totalGames).toBeGreaterThan(0);
    });
  });

  describe('Memory Management', () => {
    it('should clean up resources on destroy', async () => {
      await gameManager.destroy();

      expect(mockStorage.destroy).toHaveBeenCalled();
    });

    it('should handle auto-save games', async () => {
      const autoSaveManager = new EnhancedGameManager(
        mockConnectionManager,
        mockStorage,
        { autoSave: true, persistInterval: 100 }
      );

      await autoSaveManager.createGame('TestPlayer');

      // Wait for auto-save interval
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockStorage.saveGame).toHaveBeenCalled();

      await autoSaveManager.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should handle storage errors gracefully', async () => {
      mockStorage.saveGame.mockRejectedValue(new Error('Storage unavailable'));

      // Should not throw, but log error
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await gameManager.createGame('TestPlayer');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should handle connection manager errors gracefully', async () => {
      mockConnectionManager.broadcast.mockImplementation(() => {
        throw new Error('Connection error');
      });

      // Should not throw when broadcasting fails
      await expect(gameManager.createGame('TestPlayer')).resolves.toBeDefined();
    });
  });

  describe('Pause and Resume', () => {
    let testGame: Game;

    beforeEach(async () => {
      testGame = await gameManager.createGame('TestPlayer');
      await gameManager.addPlayer(testGame.gameId, 'Player2');

      // Set up game for playing
      const players = Object.keys(testGame.players);
      const shipPlacements: ShipPlacement[] = [
        { length: 2, startPosition: 'A1', direction: 'horizontal' }
      ];

      for (const playerId of players) {
        await gameManager.placeShips(testGame.gameId, playerId, shipPlacements);
      }

      jest.clearAllMocks();
    });

    it('should pause and resume game', () => {
      gameManager.pauseGame(testGame.gameId, 'manual', testGame.currentTurn!);

      expect(gameManager.isGamePaused(testGame.gameId)).toBe(true);
      expect(mockConnectionManager.broadcast).toHaveBeenCalledWith(
        testGame.gameId,
        expect.objectContaining({ type: 'game_paused' })
      );

      gameManager.resumeGame(testGame.gameId, testGame.currentTurn!);

      expect(gameManager.isGamePaused(testGame.gameId)).toBe(false);
      expect(mockConnectionManager.broadcast).toHaveBeenCalledWith(
        testGame.gameId,
        expect.objectContaining({ type: 'game_resumed' })
      );
    });

    it('should handle player disconnect and reconnect', () => {
      gameManager.handlePlayerDisconnect(testGame.gameId, testGame.currentTurn!);

      expect(gameManager.isGamePaused(testGame.gameId)).toBe(true);

      gameManager.handlePlayerReconnect(testGame.gameId, testGame.currentTurn!);

      expect(gameManager.isGamePaused(testGame.gameId)).toBe(false);
    });
  });
});