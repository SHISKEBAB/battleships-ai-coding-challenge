import { Game, GameStateSnapshot, GameRecoveryInfo } from '../types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

/**
 * Persistent Game State Storage Service
 *
 * Provides file-based persistence for game states with:
 * - Atomic write operations
 * - State snapshots and recovery
 * - Data integrity verification
 * - Backup and recovery mechanisms
 */
export class GameStateStorage {
  private readonly storagePath: string;
  private readonly snapshotsPath: string;
  private readonly backupsPath: string;
  private readonly maxSnapshotsPerGame: number;
  private readonly backupInterval: number;
  private backupTimer?: NodeJS.Timeout;

  constructor(options: {
    storagePath?: string;
    maxSnapshotsPerGame?: number;
    backupInterval?: number;
  } = {}) {
    this.storagePath = options.storagePath || join(process.cwd(), 'data', 'games');
    this.snapshotsPath = join(this.storagePath, 'snapshots');
    this.backupsPath = join(this.storagePath, 'backups');
    this.maxSnapshotsPerGame = options.maxSnapshotsPerGame || 10;
    this.backupInterval = options.backupInterval || 300000; // 5 minutes

    this.initializeStorage();
    this.startPeriodicBackup();
  }

  /**
   * Initialize storage directories
   */
  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      await fs.mkdir(this.snapshotsPath, { recursive: true });
      await fs.mkdir(this.backupsPath, { recursive: true });
    } catch (error) {
      console.error('Failed to initialize game state storage:', error);
      throw new Error('Storage initialization failed');
    }
  }

  /**
   * Save game state to persistent storage
   */
  async saveGame(game: Game): Promise<void> {
    const filePath = this.getGameFilePath(game.gameId);
    const tempPath = `${filePath}.tmp`;

    try {
      // Prepare game data for storage
      const gameData = this.serializeGame(game);

      // Write to temporary file first (atomic operation)
      await fs.writeFile(tempPath, gameData, 'utf8');

      // Move temporary file to final location
      await fs.rename(tempPath, filePath);

      // Update game's state integrity
      await this.updateStateIntegrity(game);

      console.log(`Game ${game.gameId} saved successfully`);
    } catch (error) {
      // Clean up temporary file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      console.error(`Failed to save game ${game.gameId}:`, error);
      throw new Error(`Failed to save game state: ${error}`);
    }
  }

  /**
   * Load game state from persistent storage
   */
  async loadGame(gameId: string): Promise<Game | null> {
    const filePath = this.getGameFilePath(gameId);

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const game = this.deserializeGame(data);

      // Verify data integrity
      const isValid = await this.verifyGameIntegrity(game);
      if (!isValid) {
        console.warn(`Game ${gameId} failed integrity check, attempting recovery`);
        return await this.recoverGame(gameId);
      }

      return game;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // Game not found
      }

      console.error(`Failed to load game ${gameId}:`, error);
      throw new Error(`Failed to load game state: ${error}`);
    }
  }

  /**
   * Delete game from persistent storage
   */
  async deleteGame(gameId: string): Promise<void> {
    const filePath = this.getGameFilePath(gameId);

    try {
      await fs.unlink(filePath);

      // Also clean up snapshots
      await this.cleanupGameSnapshots(gameId);

      console.log(`Game ${gameId} deleted successfully`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error(`Failed to delete game ${gameId}:`, error);
        throw new Error(`Failed to delete game state: ${error}`);
      }
    }
  }

  /**
   * Create a snapshot of the current game state
   */
  async createSnapshot(game: Game, reason: string, triggeredBy?: string): Promise<GameStateSnapshot> {
    const snapshot: GameStateSnapshot = {
      gameId: game.gameId,
      snapshotId: randomUUID(),
      timestamp: new Date(),
      game: { ...game },
      reason,
      triggeredBy
    };

    const snapshotPath = this.getSnapshotFilePath(game.gameId, snapshot.snapshotId);

    try {
      const snapshotData = JSON.stringify(snapshot, this.dateReplacer, 2);
      await fs.writeFile(snapshotPath, snapshotData, 'utf8');

      // Clean up old snapshots if necessary
      await this.cleanupOldSnapshots(game.gameId);

      console.log(`Snapshot created for game ${game.gameId}: ${snapshot.snapshotId}`);
      return snapshot;
    } catch (error) {
      console.error(`Failed to create snapshot for game ${game.gameId}:`, error);
      throw new Error(`Failed to create game snapshot: ${error}`);
    }
  }

  /**
   * Get recovery information for a game
   */
  async getRecoveryInfo(gameId: string): Promise<GameRecoveryInfo> {
    const recoveryInfo: GameRecoveryInfo = {
      canRecover: false,
      recoverySteps: [],
      dataLoss: []
    };

    try {
      // Check for available snapshots
      const snapshots = await this.getGameSnapshots(gameId);

      if (snapshots.length > 0) {
        recoveryInfo.canRecover = true;
        recoveryInfo.lastValidSnapshot = snapshots[0]; // Most recent
        recoveryInfo.recoverySteps = [
          'Load most recent valid snapshot',
          'Validate game state integrity',
          'Restore to active game storage',
          'Resume game operations'
        ];

        // Calculate potential data loss
        const currentGame = await this.loadGame(gameId);
        if (currentGame && recoveryInfo.lastValidSnapshot) {
          const snapshotTime = recoveryInfo.lastValidSnapshot.timestamp.getTime();
          const currentTime = currentGame.lastActivity.getTime();

          if (currentTime > snapshotTime) {
            recoveryInfo.dataLoss = [
              `Game state changes after ${recoveryInfo.lastValidSnapshot.timestamp.toISOString()}`,
              'Potential loss of recent player actions',
              'Turn history after snapshot may be incomplete'
            ];
          }
        }
      } else {
        recoveryInfo.recoverySteps = [
          'No snapshots available for recovery',
          'Game state cannot be restored',
          'Manual intervention required'
        ];
        recoveryInfo.dataLoss = [
          'Complete game state loss',
          'All player progress lost',
          'Game cannot be recovered'
        ];
      }

      return recoveryInfo;
    } catch (error) {
      console.error(`Failed to get recovery info for game ${gameId}:`, error);
      return {
        canRecover: false,
        recoverySteps: ['Error occurred during recovery analysis'],
        dataLoss: ['Cannot determine data loss extent']
      };
    }
  }

  /**
   * Recover game from most recent valid snapshot
   */
  async recoverGame(gameId: string): Promise<Game | null> {
    try {
      const recoveryInfo = await this.getRecoveryInfo(gameId);

      if (!recoveryInfo.canRecover || !recoveryInfo.lastValidSnapshot) {
        console.error(`Cannot recover game ${gameId}: no valid snapshots available`);
        return null;
      }

      const snapshot = recoveryInfo.lastValidSnapshot;
      const recoveredGame = snapshot.game;

      // Update recovery metadata
      recoveredGame.state.integrity.lastValidated = new Date();
      recoveredGame.state.integrity.validationErrors = ['Recovered from snapshot'];
      recoveredGame.lastActivity = new Date();

      // Save recovered game
      await this.saveGame(recoveredGame);

      console.log(`Game ${gameId} recovered from snapshot ${snapshot.snapshotId}`);
      return recoveredGame;
    } catch (error) {
      console.error(`Failed to recover game ${gameId}:`, error);
      return null;
    }
  }

  /**
   * Get all game IDs in storage
   */
  async getAllGameIds(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.storagePath);
      return files
        .filter(file => file.endsWith('.json') && !file.includes('.tmp'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      console.error('Failed to get game IDs:', error);
      return [];
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalGames: number;
    totalSnapshots: number;
    totalBackups: number;
    storageSize: number;
  }> {
    try {
      const [gameFiles, snapshotFiles, backupFiles] = await Promise.all([
        fs.readdir(this.storagePath),
        fs.readdir(this.snapshotsPath),
        fs.readdir(this.backupsPath)
      ]);

      // Calculate total storage size
      let storageSize = 0;
      const allPaths = [
        ...gameFiles.map(f => join(this.storagePath, f)),
        ...snapshotFiles.map(f => join(this.snapshotsPath, f)),
        ...backupFiles.map(f => join(this.backupsPath, f))
      ];

      for (const path of allPaths) {
        try {
          const stats = await fs.stat(path);
          storageSize += stats.size;
        } catch {
          // Ignore errors for individual files
        }
      }

      return {
        totalGames: gameFiles.filter(f => f.endsWith('.json')).length,
        totalSnapshots: snapshotFiles.filter(f => f.endsWith('.json')).length,
        totalBackups: backupFiles.filter(f => f.endsWith('.json')).length,
        storageSize
      };
    } catch (error) {
      console.error('Failed to get storage stats:', error);
      return {
        totalGames: 0,
        totalSnapshots: 0,
        totalBackups: 0,
        storageSize: 0
      };
    }
  }

  /**
   * Start periodic backup process
   */
  private startPeriodicBackup(): void {
    this.backupTimer = setInterval(async () => {
      try {
        await this.performBackup();
      } catch (error) {
        console.error('Periodic backup failed:', error);
      }
    }, this.backupInterval);
  }

  /**
   * Stop periodic backup process
   */
  private stopPeriodicBackup(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = undefined;
    }
  }

  /**
   * Perform backup of all games
   */
  private async performBackup(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.backupsPath, `backup-${timestamp}.json`);

    try {
      const gameIds = await this.getAllGameIds();
      const games: Record<string, Game> = {};

      for (const gameId of gameIds) {
        const game = await this.loadGame(gameId);
        if (game) {
          games[gameId] = game;
        }
      }

      const backupData = JSON.stringify({
        timestamp: new Date(),
        gameCount: Object.keys(games).length,
        games
      }, this.dateReplacer, 2);

      await fs.writeFile(backupPath, backupData, 'utf8');
      console.log(`Backup created: ${backupPath}`);

      // Clean up old backups (keep last 10)
      await this.cleanupOldBackups();
    } catch (error) {
      console.error('Backup operation failed:', error);
    }
  }

  /**
   * Clean up old backups
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const files = await fs.readdir(this.backupsPath);
      const backupFiles = files
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first

      // Keep only the most recent 10 backups
      for (let i = 10; i < backupFiles.length; i++) {
        await fs.unlink(join(this.backupsPath, backupFiles[i]));
      }
    } catch (error) {
      console.error('Failed to clean up old backups:', error);
    }
  }

  /**
   * Get file path for a game
   */
  private getGameFilePath(gameId: string): string {
    return join(this.storagePath, `${gameId}.json`);
  }

  /**
   * Get file path for a snapshot
   */
  private getSnapshotFilePath(gameId: string, snapshotId: string): string {
    return join(this.snapshotsPath, `${gameId}-${snapshotId}.json`);
  }

  /**
   * Serialize game for storage
   */
  private serializeGame(game: Game): string {
    return JSON.stringify(game, this.dateReplacer, 2);
  }

  /**
   * Deserialize game from storage
   */
  private deserializeGame(data: string): Game {
    return JSON.parse(data, this.dateReviver);
  }

  /**
   * JSON replacer for Date objects
   */
  private dateReplacer(key: string, value: any): any {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    if (value instanceof Set) {
      return { __type: 'Set', value: Array.from(value) };
    }
    return value;
  }

  /**
   * JSON reviver for Date objects
   */
  private dateReviver(key: string, value: any): any {
    if (value && typeof value === 'object' && value.__type === 'Date') {
      return new Date(value.value);
    }
    if (value && typeof value === 'object' && value.__type === 'Set') {
      return new Set(value.value);
    }
    return value;
  }

  /**
   * Update state integrity for a game
   */
  private async updateStateIntegrity(game: Game): Promise<void> {
    const checksum = this.calculateChecksum(game);
    game.state.integrity.checksum = checksum;
    game.state.integrity.lastValidated = new Date();
    game.state.integrity.validationErrors = [];
  }

  /**
   * Verify game integrity
   */
  private async verifyGameIntegrity(game: Game): Promise<boolean> {
    try {
      const currentChecksum = this.calculateChecksum(game);
      return currentChecksum === game.state.integrity.checksum;
    } catch (error) {
      console.error('Integrity verification failed:', error);
      return false;
    }
  }

  /**
   * Calculate checksum for game state
   */
  private calculateChecksum(game: Game): string {
    // Create a copy without the integrity field to avoid circular dependency
    const gameForChecksum = { ...game };
    delete (gameForChecksum.state as any).integrity;

    const gameString = JSON.stringify(gameForChecksum, this.dateReplacer);
    return createHash('sha256').update(gameString).digest('hex');
  }

  /**
   * Get snapshots for a specific game
   */
  private async getGameSnapshots(gameId: string): Promise<GameStateSnapshot[]> {
    try {
      const files = await fs.readdir(this.snapshotsPath);
      const snapshotFiles = files
        .filter(f => f.startsWith(`${gameId}-`) && f.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first

      const snapshots: GameStateSnapshot[] = [];
      for (const file of snapshotFiles) {
        try {
          const data = await fs.readFile(join(this.snapshotsPath, file), 'utf8');
          const snapshot = JSON.parse(data, this.dateReviver);
          snapshots.push(snapshot);
        } catch (error) {
          console.error(`Failed to load snapshot ${file}:`, error);
        }
      }

      return snapshots;
    } catch (error) {
      console.error(`Failed to get snapshots for game ${gameId}:`, error);
      return [];
    }
  }

  /**
   * Clean up old snapshots for a game
   */
  private async cleanupOldSnapshots(gameId: string): Promise<void> {
    try {
      const snapshots = await this.getGameSnapshots(gameId);

      // Keep only the most recent snapshots
      for (let i = this.maxSnapshotsPerGame; i < snapshots.length; i++) {
        const snapshotPath = this.getSnapshotFilePath(gameId, snapshots[i].snapshotId);
        await fs.unlink(snapshotPath);
      }
    } catch (error) {
      console.error(`Failed to cleanup snapshots for game ${gameId}:`, error);
    }
  }

  /**
   * Clean up all snapshots for a game
   */
  private async cleanupGameSnapshots(gameId: string): Promise<void> {
    try {
      const files = await fs.readdir(this.snapshotsPath);
      const snapshotFiles = files.filter(f => f.startsWith(`${gameId}-`));

      for (const file of snapshotFiles) {
        await fs.unlink(join(this.snapshotsPath, file));
      }
    } catch (error) {
      console.error(`Failed to cleanup all snapshots for game ${gameId}:`, error);
    }
  }

  /**
   * Cleanup and shutdown storage
   */
  async destroy(): Promise<void> {
    this.stopPeriodicBackup();
    console.log('Game state storage service shut down');
  }
}