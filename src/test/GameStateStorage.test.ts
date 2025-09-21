import { GameStateStorage } from '../services/GameStateStorage';
import { Game } from '../types';
import { createGame, createPlayer } from '../models/Game';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn()
  }
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('GameStateStorage', () => {
  let storage: GameStateStorage;
  let testGame: Game;
  const testStoragePath = '/test/storage';

  beforeEach(() => {
    jest.clearAllMocks();

    storage = new GameStateStorage({
      storagePath: testStoragePath,
      maxSnapshotsPerGame: 5
    });

    // Create test game
    const hostPlayer = createPlayer(randomUUID(), 'TestHost');
    testGame = createGame(hostPlayer);

    // Setup default mock implementations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue();
    mockFs.rename.mockResolvedValue();
    mockFs.unlink.mockResolvedValue();
    mockFs.readdir.mockResolvedValue([]);
    mockFs.stat.mockResolvedValue({
      size: 1024,
      mtime: new Date()
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('saveGame', () => {
    it('should save game to storage with atomic write', async () => {
      await storage.saveGame(testGame);

      const expectedPath = join(testStoragePath, `${testGame.gameId}.json`);
      const expectedTempPath = `${expectedPath}.tmp`;

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expectedTempPath,
        expect.stringContaining(testGame.gameId),
        'utf8'
      );
      expect(mockFs.rename).toHaveBeenCalledWith(expectedTempPath, expectedPath);
    });

    it('should handle save errors gracefully', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Disk full'));

      await expect(storage.saveGame(testGame)).rejects.toThrow('Failed to save game state');
    });

    it('should clean up temporary file on error', async () => {
      mockFs.rename.mockRejectedValue(new Error('File system error'));

      await expect(storage.saveGame(testGame)).rejects.toThrow();

      const expectedTempPath = join(testStoragePath, `${testGame.gameId}.json.tmp`);
      expect(mockFs.unlink).toHaveBeenCalledWith(expectedTempPath);
    });

    it('should update game integrity checksum', async () => {
      const originalChecksum = testGame.state.integrity.checksum;

      await storage.saveGame(testGame);

      expect(testGame.state.integrity.checksum).not.toBe(originalChecksum);
      expect(testGame.state.integrity.lastValidated).toBeInstanceOf(Date);
      expect(testGame.state.integrity.validationErrors).toEqual([]);
    });
  });

  describe('loadGame', () => {
    it('should load game from storage', async () => {
      const gameData = JSON.stringify(testGame, (key, value) => {
        if (value instanceof Date) {
          return { __type: 'Date', value: value.toISOString() };
        }
        if (value instanceof Set) {
          return { __type: 'Set', value: Array.from(value) };
        }
        return value;
      });

      mockFs.readFile.mockResolvedValue(gameData);

      const loadedGame = await storage.loadGame(testGame.gameId);

      expect(loadedGame).toBeDefined();
      expect(loadedGame!.gameId).toBe(testGame.gameId);
      expect(loadedGame!.createdAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent game', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const loadedGame = await storage.loadGame('non-existent-game');

      expect(loadedGame).toBeNull();
    });

    it('should verify data integrity on load', async () => {
      // Create corrupted game data
      const corruptedGame = { ...testGame };
      corruptedGame.state.integrity.checksum = 'invalid-checksum';

      const gameData = JSON.stringify(corruptedGame, (key, value) => {
        if (value instanceof Date) {
          return { __type: 'Date', value: value.toISOString() };
        }
        if (value instanceof Set) {
          return { __type: 'Set', value: Array.from(value) };
        }
        return value;
      });

      mockFs.readFile.mockResolvedValue(gameData);

      // Mock recovery functionality
      const recoverGameSpy = jest.spyOn(storage, 'recoverGame').mockResolvedValue(testGame);

      await storage.loadGame(testGame.gameId);

      expect(recoverGameSpy).toHaveBeenCalledWith(testGame.gameId);
    });

    it('should handle load errors', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));

      await expect(storage.loadGame(testGame.gameId)).rejects.toThrow('Failed to load game state');
    });
  });

  describe('deleteGame', () => {
    it('should delete game and cleanup snapshots', async () => {
      await storage.deleteGame(testGame.gameId);

      const expectedPath = join(testStoragePath, `${testGame.gameId}.json`);
      expect(mockFs.unlink).toHaveBeenCalledWith(expectedPath);
    });

    it('should handle deletion of non-existent game gracefully', async () => {
      mockFs.unlink.mockRejectedValue({ code: 'ENOENT' });

      await expect(storage.deleteGame('non-existent-game')).resolves.not.toThrow();
    });

    it('should handle deletion errors', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      await expect(storage.deleteGame(testGame.gameId)).rejects.toThrow('Failed to delete game state');
    });
  });

  describe('createSnapshot', () => {
    it('should create game snapshot', async () => {
      const snapshot = await storage.createSnapshot(testGame, 'test_reason', 'user123');

      expect(snapshot.gameId).toBe(testGame.gameId);
      expect(snapshot.reason).toBe('test_reason');
      expect(snapshot.triggeredBy).toBe('user123');
      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.timestamp).toBeInstanceOf(Date);

      const expectedPath = join(testStoragePath, 'snapshots', `${testGame.gameId}-${snapshot.snapshotId}.json`);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expectedPath,
        expect.stringContaining(snapshot.snapshotId),
        'utf8'
      );
    });

    it('should handle snapshot creation errors', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Disk full'));

      await expect(
        storage.createSnapshot(testGame, 'test_reason')
      ).rejects.toThrow('Failed to create game snapshot');
    });
  });

  describe('getRecoveryInfo', () => {
    it('should provide recovery info when snapshots exist', async () => {
      mockFs.readdir.mockResolvedValue([
        `${testGame.gameId}-snapshot1.json`,
        `${testGame.gameId}-snapshot2.json`
      ]);

      mockFs.readFile.mockResolvedValue(JSON.stringify({
        gameId: testGame.gameId,
        snapshotId: 'snapshot1',
        timestamp: new Date(),
        game: testGame,
        reason: 'test'
      }));

      const recoveryInfo = await storage.getRecoveryInfo(testGame.gameId);

      expect(recoveryInfo.canRecover).toBe(true);
      expect(recoveryInfo.lastValidSnapshot).toBeDefined();
      expect(recoveryInfo.recoverySteps).toContain('Load most recent valid snapshot');
    });

    it('should indicate no recovery possible when no snapshots exist', async () => {
      mockFs.readdir.mockResolvedValue([]);

      const recoveryInfo = await storage.getRecoveryInfo(testGame.gameId);

      expect(recoveryInfo.canRecover).toBe(false);
      expect(recoveryInfo.recoverySteps).toContain('No snapshots available for recovery');
    });
  });

  describe('recoverGame', () => {
    it('should recover game from snapshot', async () => {
      const snapshot = {
        gameId: testGame.gameId,
        snapshotId: 'snapshot1',
        timestamp: new Date(),
        game: testGame,
        reason: 'test'
      };

      // Mock getRecoveryInfo to return valid recovery info
      jest.spyOn(storage, 'getRecoveryInfo').mockResolvedValue({
        canRecover: true,
        lastValidSnapshot: snapshot,
        recoverySteps: ['Load snapshot'],
        dataLoss: []
      });

      const recoveredGame = await storage.recoverGame(testGame.gameId);

      expect(recoveredGame).toBeDefined();
      expect(recoveredGame!.gameId).toBe(testGame.gameId);
      expect(recoveredGame!.state.integrity.validationErrors).toContain('Recovered from snapshot');
    });

    it('should return null when recovery is not possible', async () => {
      jest.spyOn(storage, 'getRecoveryInfo').mockResolvedValue({
        canRecover: false,
        recoverySteps: ['No snapshots available'],
        dataLoss: ['Complete loss']
      });

      const recoveredGame = await storage.recoverGame(testGame.gameId);

      expect(recoveredGame).toBeNull();
    });
  });

  describe('getAllGameIds', () => {
    it('should return list of game IDs', async () => {
      mockFs.readdir.mockResolvedValue([
        'game1.json',
        'game2.json',
        'game3.json.tmp', // Should be filtered out
        'other-file.txt'  // Should be filtered out
      ]);

      const gameIds = await storage.getAllGameIds();

      expect(gameIds).toEqual(['game1', 'game2']);
    });

    it('should handle readdir errors', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

      const gameIds = await storage.getAllGameIds();

      expect(gameIds).toEqual([]);
    });
  });

  describe('getStorageStats', () => {
    it('should return storage statistics', async () => {
      mockFs.readdir
        .mockResolvedValueOnce(['game1.json', 'game2.json']) // games
        .mockResolvedValueOnce(['snapshot1.json']) // snapshots
        .mockResolvedValueOnce(['backup1.json']); // backups

      mockFs.stat.mockResolvedValue({
        size: 1024
      } as any);

      const stats = await storage.getStorageStats();

      expect(stats.totalGames).toBe(2);
      expect(stats.totalSnapshots).toBe(1);
      expect(stats.totalBackups).toBe(1);
      expect(stats.storageSize).toBeGreaterThan(0);
    });

    it('should handle stats errors gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

      const stats = await storage.getStorageStats();

      expect(stats).toEqual({
        totalGames: 0,
        totalSnapshots: 0,
        totalBackups: 0,
        storageSize: 0
      });
    });
  });

  describe('Date Serialization', () => {
    it('should properly serialize and deserialize Date objects', async () => {
      const now = new Date();
      testGame.createdAt = now;
      testGame.lastActivity = now;

      await storage.saveGame(testGame);

      // Verify the serialized data contains proper date format
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"__type":"Date"'),
        'utf8'
      );

      // Mock the load operation
      const serializedData = JSON.stringify(testGame, (key, value) => {
        if (value instanceof Date) {
          return { __type: 'Date', value: value.toISOString() };
        }
        if (value instanceof Set) {
          return { __type: 'Set', value: Array.from(value) };
        }
        return value;
      });

      mockFs.readFile.mockResolvedValue(serializedData);

      const loadedGame = await storage.loadGame(testGame.gameId);

      expect(loadedGame!.createdAt).toBeInstanceOf(Date);
      expect(loadedGame!.createdAt.getTime()).toBe(now.getTime());
    });
  });

  describe('Set Serialization', () => {
    it('should properly serialize and deserialize Set objects', async () => {
      // Add some data to the board sets
      Object.values(testGame.players).forEach(player => {
        player.board.hits.add('A1');
        player.board.hits.add('B2');
        player.board.misses.add('C3');
      });

      await storage.saveGame(testGame);

      // Mock the load operation
      const serializedData = JSON.stringify(testGame, (key, value) => {
        if (value instanceof Date) {
          return { __type: 'Date', value: value.toISOString() };
        }
        if (value instanceof Set) {
          return { __type: 'Set', value: Array.from(value) };
        }
        return value;
      });

      mockFs.readFile.mockResolvedValue(serializedData);

      const loadedGame = await storage.loadGame(testGame.gameId);

      const loadedPlayer = Object.values(loadedGame!.players)[0];
      expect(loadedPlayer.board.hits).toBeInstanceOf(Set);
      expect(loadedPlayer.board.hits.has('A1')).toBe(true);
      expect(loadedPlayer.board.hits.has('B2')).toBe(true);
      expect(loadedPlayer.board.misses.has('C3')).toBe(true);
    });
  });

  describe('Backup Operations', () => {
    it('should perform periodic backups', (done) => {
      // Create storage with short backup interval for testing
      const testStorage = new GameStateStorage({
        storagePath: testStoragePath,
        backupInterval: 100 // 100ms for testing
      });

      mockFs.readdir.mockResolvedValue(['game1.json']);
      mockFs.readFile.mockResolvedValue(JSON.stringify(testGame));

      setTimeout(() => {
        // Backup should have been called
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/backup-.*\.json$/),
          expect.stringContaining(testGame.gameId),
          'utf8'
        );
        done();
      }, 150);
    });
  });

  describe('Cleanup Operations', () => {
    it('should cleanup old backups', async () => {
      // Mock many backup files
      const backupFiles = Array.from({ length: 15 }, (_, i) => `backup-${i}.json`);
      mockFs.readdir.mockResolvedValue(backupFiles);

      // Create storage and wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should delete old backups (keep only 10 most recent)
      expect(mockFs.unlink).toHaveBeenCalledTimes(5);
    });
  });

  describe('Error Recovery', () => {
    it('should handle corrupted data gracefully', async () => {
      mockFs.readFile.mockResolvedValue('invalid json data');

      await expect(storage.loadGame(testGame.gameId)).rejects.toThrow();
    });

    it('should handle filesystem errors during snapshot creation', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('No space left on device'));

      await expect(
        storage.createSnapshot(testGame, 'test')
      ).rejects.toThrow('Failed to create game snapshot');
    });
  });

  describe('Performance', () => {
    it('should handle large game objects efficiently', async () => {
      // Create a large game with lots of history
      for (let i = 0; i < 1000; i++) {
        testGame.history.push({
          id: `event-${i}`,
          timestamp: new Date(),
          type: 'test_event',
          data: { largeData: 'x'.repeat(1000) },
          phase: 'waiting'
        });
      }

      const startTime = Date.now();
      await storage.saveGame(testGame);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete in < 1 second
    });
  });
});