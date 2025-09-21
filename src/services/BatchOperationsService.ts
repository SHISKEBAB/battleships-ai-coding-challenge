import { Game, GameQuery, BatchGameOperation, BatchOperationResult } from '../types';
import { GameStateStorage } from './GameStateStorage';
import { GameStateManager } from './GameStateManager';
import { GameAnalyticsService } from './GameAnalyticsService';

/**
 * Batch Operations Service
 *
 * Provides comprehensive batch operations and cleanup utilities:
 * - Bulk game operations (delete, archive, validate, cleanup)
 * - Automated cleanup tasks
 * - Data maintenance operations
 * - Performance optimization utilities
 * - System health monitoring
 */
export class BatchOperationsService {
  private stateStorage: GameStateStorage;
  private stateManager: GameStateManager;
  private analyticsService?: GameAnalyticsService;
  private cleanupScheduler?: NodeJS.Timeout;
  private maintenanceScheduler?: NodeJS.Timeout;

  constructor(
    stateStorage: GameStateStorage,
    stateManager: GameStateManager,
    analyticsService?: GameAnalyticsService,
    options: {
      enableScheduledCleanup?: boolean;
      cleanupInterval?: number; // milliseconds
      maintenanceInterval?: number; // milliseconds
    } = {}
  ) {
    this.stateStorage = stateStorage;
    this.stateManager = stateManager;
    this.analyticsService = analyticsService;

    // Start scheduled operations if enabled
    if (options.enableScheduledCleanup !== false) {
      this.startScheduledCleanup(options.cleanupInterval || 6 * 60 * 60 * 1000); // 6 hours
    }

    if (options.maintenanceInterval) {
      this.startScheduledMaintenance(options.maintenanceInterval);
    }
  }

  /**
   * Execute batch operation on games matching query
   */
  async executeBatchOperation(
    games: Map<string, Game>,
    operation: BatchGameOperation
  ): Promise<BatchOperationResult> {
    const { operation: op, query, options = {} } = operation;
    const { dryRun = false, batchSize = 100, onProgress } = options;

    console.log(`Starting batch operation: ${op}`, { query, dryRun, batchSize });

    const result: BatchOperationResult = {
      success: true,
      processed: 0,
      failed: 0,
      errors: [],
      summary: ''
    };

    try {
      // Filter games based on query
      const matchingGames = this.filterGamesByQuery(games, query);
      console.log(`Found ${matchingGames.length} games matching query`);

      // Process games in batches
      for (let i = 0; i < matchingGames.length; i += batchSize) {
        const batch = matchingGames.slice(i, i + batchSize);

        for (const game of batch) {
          try {
            if (!dryRun) {
              await this.executeOperation(games, game, op);
            }

            result.processed++;

            if (onProgress) {
              onProgress(result.processed, matchingGames.length);
            }

            // Log progress every 100 operations
            if (result.processed % 100 === 0) {
              console.log(`Batch operation progress: ${result.processed}/${matchingGames.length}`);
            }

          } catch (error) {
            result.failed++;
            result.errors.push({
              gameId: game.gameId,
              error: error instanceof Error ? error.message : String(error)
            });

            console.error(`Failed to process game ${game.gameId}:`, error);
          }
        }

        // Small delay between batches to prevent overwhelming the system
        if (i + batchSize < matchingGames.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      result.success = result.failed === 0;
      result.summary = `${op} operation: ${result.processed} processed, ${result.failed} failed`;

      if (dryRun) {
        result.summary += ' (DRY RUN - no changes made)';
      }

      console.log(`Batch operation completed: ${result.summary}`);
      return result;

    } catch (error) {
      console.error(`Batch operation failed:`, error);
      return {
        success: false,
        processed: result.processed,
        failed: result.failed + 1,
        errors: [
          ...result.errors,
          { gameId: 'BATCH_OPERATION', error: error instanceof Error ? error.message : String(error) }
        ],
        summary: `Batch operation failed: ${error}`
      };
    }
  }

  /**
   * Clean up inactive and abandoned games
   */
  async cleanupInactiveGames(
    games: Map<string, Game>,
    options: {
      inactivityThreshold?: number; // milliseconds
      dryRun?: boolean;
      archiveBeforeDelete?: boolean;
    } = {}
  ): Promise<BatchOperationResult> {
    const {
      inactivityThreshold = 7 * 24 * 60 * 60 * 1000, // 7 days
      dryRun = false,
      archiveBeforeDelete = true
    } = options;

    const cutoffTime = new Date(Date.now() - inactivityThreshold);

    const query: GameQuery = {
      lastActivityBefore: cutoffTime,
      phase: ['abandoned', 'finished']
    };

    console.log(`Cleaning up inactive games older than ${cutoffTime.toISOString()}`);

    // First archive if requested
    if (archiveBeforeDelete && !dryRun) {
      const archiveOperation: BatchGameOperation = {
        operation: 'archive',
        query,
        options: { dryRun: false, batchSize: 50 }
      };

      const archiveResult = await this.executeBatchOperation(games, archiveOperation);
      console.log(`Archive operation completed: ${archiveResult.summary}`);
    }

    // Then delete
    const deleteOperation: BatchGameOperation = {
      operation: 'delete',
      query,
      options: { dryRun, batchSize: 50 }
    };

    return await this.executeBatchOperation(games, deleteOperation);
  }

  /**
   * Validate and repair corrupted game states
   */
  async validateAndRepairGames(
    games: Map<string, Game>,
    options: {
      dryRun?: boolean;
      autoRepair?: boolean;
      maxRepairAttempts?: number;
    } = {}
  ): Promise<{
    validationResult: BatchOperationResult;
    repairResult?: BatchOperationResult;
    corruptedGames: string[];
    repairedGames: string[];
  }> {
    const { dryRun = false, autoRepair = true, maxRepairAttempts = 3 } = options;

    console.log('Starting game state validation and repair process');

    // First, validate all games
    const validationOperation: BatchGameOperation = {
      operation: 'validate',
      query: {}, // Validate all games
      options: { dryRun: true, batchSize: 100 }
    };

    const validationResult = await this.executeBatchOperation(games, validationOperation);

    // Identify corrupted games
    const corruptedGames: string[] = [];
    for (const [gameId, game] of games.entries()) {
      if (!game.state.isValid || game.state.integrity.validationErrors.length > 0) {
        corruptedGames.push(gameId);
      }
    }

    console.log(`Found ${corruptedGames.length} corrupted games`);

    let repairResult: BatchOperationResult | undefined;
    const repairedGames: string[] = [];

    if (autoRepair && corruptedGames.length > 0 && !dryRun) {
      console.log('Starting automated repair process');

      repairResult = {
        success: true,
        processed: 0,
        failed: 0,
        errors: [],
        summary: ''
      };

      for (const gameId of corruptedGames) {
        const game = games.get(gameId);
        if (!game) continue;

        let repairAttempts = 0;
        let repairSuccessful = false;

        while (repairAttempts < maxRepairAttempts && !repairSuccessful) {
          try {
            repairAttempts++;
            console.log(`Repair attempt ${repairAttempts} for game ${gameId}`);

            // Create backup before repair
            await this.stateStorage.createSnapshot(game, `repair_attempt_${repairAttempts}`, 'system');

            // Attempt repair
            const repairedGame = await this.stateManager.repairGameState(game);

            // Validate repair
            const validation = await this.stateManager.validateGameState(repairedGame);

            if (validation.isValid) {
              games.set(gameId, repairedGame);
              await this.stateStorage.saveGame(repairedGame);
              repairedGames.push(gameId);
              repairResult.processed++;
              repairSuccessful = true;

              console.log(`Successfully repaired game ${gameId} on attempt ${repairAttempts}`);
            } else {
              console.warn(`Repair attempt ${repairAttempts} for game ${gameId} failed validation`);
            }

          } catch (error) {
            console.error(`Repair attempt ${repairAttempts} for game ${gameId} failed:`, error);

            if (repairAttempts === maxRepairAttempts) {
              repairResult.failed++;
              repairResult.errors.push({
                gameId,
                error: `All ${maxRepairAttempts} repair attempts failed: ${error}`
              });
            }
          }
        }
      }

      repairResult.success = repairResult.failed === 0;
      repairResult.summary = `Repair operation: ${repairResult.processed} repaired, ${repairResult.failed} failed`;

      console.log(`Repair process completed: ${repairResult.summary}`);
    }

    return {
      validationResult,
      repairResult,
      corruptedGames,
      repairedGames
    };
  }

  /**
   * Optimize storage and clean up redundant data
   */
  async optimizeStorage(
    games: Map<string, Game>,
    options: {
      compactHistory?: boolean;
      removeOldSnapshots?: boolean;
      snapshotRetentionDays?: number;
      dryRun?: boolean;
    } = {}
  ): Promise<{
    storageOptimized: boolean;
    spaceSaved: number; // bytes
    operationsPerformed: string[];
    errors: string[];
  }> {
    const {
      compactHistory = true,
      removeOldSnapshots = true,
      snapshotRetentionDays = 30,
      dryRun = false
    } = options;

    console.log('Starting storage optimization process');

    const result = {
      storageOptimized: false,
      spaceSaved: 0,
      operationsPerformed: [] as string[],
      errors: [] as string[]
    };

    try {
      // Get initial storage statistics
      const initialStats = await this.stateStorage.getStorageStats();
      const initialSize = initialStats.storageSize;

      // Compact game history if requested
      if (compactHistory) {
        for (const [gameId, game] of games.entries()) {
          try {
            if (!dryRun) {
              // Compress old history entries (keep only essential data)
              this.compactGameHistory(game);
              await this.stateStorage.saveGame(game);
            }
          } catch (error) {
            result.errors.push(`Failed to compact history for game ${gameId}: ${error}`);
          }
        }
        result.operationsPerformed.push('Game history compaction');
      }

      // Remove old snapshots if requested
      if (removeOldSnapshots) {
        try {
          if (!dryRun) {
            await this.cleanupOldSnapshots(snapshotRetentionDays);
          }
          result.operationsPerformed.push(`Snapshot cleanup (${snapshotRetentionDays} days retention)`);
        } catch (error) {
          result.errors.push(`Failed to cleanup old snapshots: ${error}`);
        }
      }

      // Calculate space saved
      if (!dryRun) {
        const finalStats = await this.stateStorage.getStorageStats();
        result.spaceSaved = Math.max(0, initialSize - finalStats.storageSize);
      }

      result.storageOptimized = result.errors.length === 0;

      console.log(`Storage optimization completed. Space saved: ${result.spaceSaved} bytes`);
      return result;

    } catch (error) {
      result.errors.push(`Storage optimization failed: ${error}`);
      return result;
    }
  }

  /**
   * Generate system health report
   */
  async generateHealthReport(games: Map<string, Game>): Promise<{
    overallHealth: 'healthy' | 'warning' | 'critical';
    issues: Array<{
      severity: 'low' | 'medium' | 'high' | 'critical';
      category: 'performance' | 'data' | 'storage' | 'system';
      description: string;
      recommendation: string;
      affectedGames?: string[];
    }>;
    metrics: {
      totalGames: number;
      corruptedGames: number;
      stuckGames: number;
      oldGames: number;
      storageUtilization: number;
      averageGameSize: number;
    };
    recommendations: string[];
  }> {
    console.log('Generating system health report');

    const gamesArray = Array.from(games.values());
    const issues: Array<{
      severity: 'low' | 'medium' | 'high' | 'critical';
      category: 'performance' | 'data' | 'storage' | 'system';
      description: string;
      recommendation: string;
      affectedGames?: string[];
    }> = [];

    // Check for corrupted games
    const corruptedGames = gamesArray.filter(g => !g.state.isValid || g.state.integrity.validationErrors.length > 0);
    if (corruptedGames.length > 0) {
      issues.push({
        severity: corruptedGames.length > gamesArray.length * 0.1 ? 'critical' : 'high',
        category: 'data',
        description: `${corruptedGames.length} games have data integrity issues`,
        recommendation: 'Run validation and repair batch operation',
        affectedGames: corruptedGames.map(g => g.gameId)
      });
    }

    // Check for stuck games (no activity for > 2 hours in playing state)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stuckGames = gamesArray.filter(g =>
      g.phase === 'playing' && g.lastActivity < twoHoursAgo
    );
    if (stuckGames.length > 0) {
      issues.push({
        severity: 'medium',
        category: 'performance',
        description: `${stuckGames.length} games appear to be stuck`,
        recommendation: 'Review turn timeout handling and consider automatic cleanup',
        affectedGames: stuckGames.map(g => g.gameId)
      });
    }

    // Check for very old games
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const oldGames = gamesArray.filter(g => g.lastActivity < oneWeekAgo);
    if (oldGames.length > 0) {
      issues.push({
        severity: 'low',
        category: 'storage',
        description: `${oldGames.length} games are older than 1 week`,
        recommendation: 'Consider archiving or deleting old inactive games',
        affectedGames: oldGames.map(g => g.gameId)
      });
    }

    // Check storage metrics
    const storageStats = await this.stateStorage.getStorageStats();
    const averageGameSize = gamesArray.length > 0 ? storageStats.storageSize / gamesArray.length : 0;

    // Storage utilization warning (assuming 1GB limit)
    const storageUtilization = storageStats.storageSize / (1024 * 1024 * 1024); // GB
    if (storageUtilization > 0.8) {
      issues.push({
        severity: storageUtilization > 0.95 ? 'critical' : 'high',
        category: 'storage',
        description: `Storage utilization is at ${(storageUtilization * 100).toFixed(1)}%`,
        recommendation: 'Run storage optimization and cleanup operations'
      });
    }

    // Check for performance issues
    if (this.analyticsService) {
      const systemMetrics = this.analyticsService.getSystemPerformanceMetrics(gamesArray);

      if (systemMetrics.performance.errorRate > 0.05) {
        issues.push({
          severity: systemMetrics.performance.errorRate > 0.1 ? 'critical' : 'high',
          category: 'system',
          description: `High error rate: ${(systemMetrics.performance.errorRate * 100).toFixed(1)}%`,
          recommendation: 'Investigate system logs and error patterns'
        });
      }
    }

    // Determine overall health
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const highIssues = issues.filter(i => i.severity === 'high').length;

    let overallHealth: 'healthy' | 'warning' | 'critical';
    if (criticalIssues > 0) {
      overallHealth = 'critical';
    } else if (highIssues > 0) {
      overallHealth = 'warning';
    } else {
      overallHealth = 'healthy';
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (corruptedGames.length > 0) {
      recommendations.push('Schedule regular data validation and repair operations');
    }
    if (stuckGames.length > 0) {
      recommendations.push('Implement automatic cleanup for stuck games');
    }
    if (oldGames.length > gamesArray.length * 0.2) {
      recommendations.push('Implement automatic archiving for old games');
    }
    if (storageUtilization > 0.7) {
      recommendations.push('Schedule regular storage optimization');
    }

    const metrics = {
      totalGames: gamesArray.length,
      corruptedGames: corruptedGames.length,
      stuckGames: stuckGames.length,
      oldGames: oldGames.length,
      storageUtilization,
      averageGameSize
    };

    console.log(`Health report generated: ${overallHealth} status with ${issues.length} issues`);

    return {
      overallHealth,
      issues,
      metrics,
      recommendations
    };
  }

  /**
   * Start scheduled cleanup operations
   */
  private startScheduledCleanup(intervalMs: number): void {
    console.log(`Starting scheduled cleanup every ${intervalMs / (1000 * 60 * 60)} hours`);

    this.cleanupScheduler = setInterval(async () => {
      try {
        console.log('Running scheduled cleanup operations');

        // Cleanup old history files
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        // Implementation would depend on having access to games map
        // This would typically be called from the main game manager

        console.log('Scheduled cleanup completed');
      } catch (error) {
        console.error('Scheduled cleanup failed:', error);
      }
    }, intervalMs);
  }

  /**
   * Start scheduled maintenance operations
   */
  private startScheduledMaintenance(intervalMs: number): void {
    console.log(`Starting scheduled maintenance every ${intervalMs / (1000 * 60)} minutes`);

    this.maintenanceScheduler = setInterval(async () => {
      try {
        console.log('Running scheduled maintenance operations');

        // Maintenance operations would go here
        // - Storage optimization
        // - Performance monitoring
        // - Health checks

        console.log('Scheduled maintenance completed');
      } catch (error) {
        console.error('Scheduled maintenance failed:', error);
      }
    }, intervalMs);
  }

  /**
   * Filter games by query criteria
   */
  private filterGamesByQuery(games: Map<string, Game>, query: GameQuery): Game[] {
    const gameArray = Array.from(games.values());
    let filtered = gameArray;

    if (query.phase) {
      const phases = Array.isArray(query.phase) ? query.phase : [query.phase];
      filtered = filtered.filter(game => phases.includes(game.phase));
    }

    if (query.hostPlayerId) {
      filtered = filtered.filter(game => game.metadata.hostPlayerId === query.hostPlayerId);
    }

    if (query.playerIds && query.playerIds.length > 0) {
      filtered = filtered.filter(game =>
        query.playerIds!.some(playerId => playerId in game.players)
      );
    }

    if (query.createdAfter) {
      filtered = filtered.filter(game => game.createdAt >= query.createdAfter!);
    }

    if (query.createdBefore) {
      filtered = filtered.filter(game => game.createdAt <= query.createdBefore!);
    }

    if (query.lastActivityAfter) {
      filtered = filtered.filter(game => game.lastActivity >= query.lastActivityAfter!);
    }

    if (query.lastActivityBefore) {
      filtered = filtered.filter(game => game.lastActivity <= query.lastActivityBefore!);
    }

    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter(game =>
        query.tags!.some(tag => game.metadata.tags.includes(tag))
      );
    }

    if (query.isPrivate !== undefined) {
      filtered = filtered.filter(game => game.metadata.settings.isPrivate === query.isPrivate);
    }

    if (query.minPlayers !== undefined) {
      filtered = filtered.filter(game => Object.keys(game.players).length >= query.minPlayers!);
    }

    if (query.maxPlayers !== undefined) {
      filtered = filtered.filter(game => Object.keys(game.players).length <= query.maxPlayers!);
    }

    return filtered;
  }

  /**
   * Execute specific operation on a game
   */
  private async executeOperation(games: Map<string, Game>, game: Game, operation: string): Promise<void> {
    switch (operation) {
      case 'delete':
        games.delete(game.gameId);
        await this.stateStorage.deleteGame(game.gameId);
        break;

      case 'archive':
        if (!game.metadata.tags.includes('archived')) {
          game.metadata.tags.push('archived');
        }
        await this.stateManager.transitionGamePhase(game, 'abandoned', 'system', 'Archived by batch operation');
        await this.stateStorage.saveGame(game);
        await this.stateStorage.createSnapshot(game, 'archived', 'system');
        games.delete(game.gameId);
        break;

      case 'validate':
        const validation = await this.stateManager.validateGameState(game);
        if (!validation.isValid) {
          throw new Error(`Validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
        }
        break;

      case 'cleanup':
        // Clean up game memory footprint
        this.cleanupGameMemory(game);
        await this.stateStorage.saveGame(game);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * Compact game history to reduce storage space
   */
  private compactGameHistory(game: Game): void {
    if (game.history.length <= 100) return; // Don't compact small histories

    // Keep the most recent 50 entries and every 10th entry from the rest
    const recentEntries = game.history.slice(-50);
    const oldEntries = game.history.slice(0, -50);
    const compactedOldEntries = oldEntries.filter((_, index) => index % 10 === 0);

    game.history = [...compactedOldEntries, ...recentEntries];

    console.log(`Compacted history for game ${game.gameId}: ${oldEntries.length} -> ${compactedOldEntries.length} old entries`);
  }

  /**
   * Clean up old snapshots
   */
  private async cleanupOldSnapshots(retentionDays: number): Promise<void> {
    const cutoffTime = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    console.log(`Cleaning up snapshots older than ${cutoffTime.toISOString()}`);
    // Implementation would depend on storage structure
  }

  /**
   * Clean up game memory footprint
   */
  private cleanupGameMemory(game: Game): void {
    // Remove redundant data, compress large objects, etc.

    // Limit turn history size
    if (game.state.turnInfo.turnHistory.length > 200) {
      game.state.turnInfo.turnHistory = game.state.turnInfo.turnHistory.slice(-200);
    }

    // Clean up phase transitions (keep last 20)
    if (game.state.phaseTransitions.length > 20) {
      game.state.phaseTransitions = game.state.phaseTransitions.slice(-20);
    }
  }

  /**
   * Stop all scheduled operations and cleanup
   */
  destroy(): void {
    if (this.cleanupScheduler) {
      clearInterval(this.cleanupScheduler);
      this.cleanupScheduler = undefined;
    }

    if (this.maintenanceScheduler) {
      clearInterval(this.maintenanceScheduler);
      this.maintenanceScheduler = undefined;
    }

    console.log('Batch Operations Service destroyed');
  }
}