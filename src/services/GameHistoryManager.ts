import { Game, GameHistoryEntry, GamePhase } from '../types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Game History Manager Service
 *
 * Provides comprehensive game event logging and history management:
 * - Event logging and storage
 * - History querying and filtering
 * - Event replay capabilities
 * - Performance analytics from history
 * - Export and import functionality
 */
export class GameHistoryManager {
  private readonly historyPath: string;
  private readonly maxHistoryPerGame: number;
  private readonly compressionEnabled: boolean;

  constructor(options: {
    historyPath?: string;
    maxHistoryPerGame?: number;
    compressionEnabled?: boolean;
  } = {}) {
    this.historyPath = options.historyPath || join(process.cwd(), 'data', 'history');
    this.maxHistoryPerGame = options.maxHistoryPerGame || 1000;
    this.compressionEnabled = options.compressionEnabled || false;

    this.initializeHistoryStorage();
  }

  /**
   * Initialize history storage directory
   */
  private async initializeHistoryStorage(): Promise<void> {
    try {
      await fs.mkdir(this.historyPath, { recursive: true });
    } catch (error) {
      console.error('Failed to initialize history storage:', error);
    }
  }

  /**
   * Log an event to game history
   */
  logEvent(
    game: Game,
    eventType: string,
    playerId: string | undefined,
    data: any,
    metadata?: {
      sourceService?: string;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      tags?: string[];
    }
  ): GameHistoryEntry {
    const historyEntry: GameHistoryEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      type: eventType,
      playerId,
      data: {
        ...data,
        metadata
      },
      phase: game.phase,
      turnNumber: game.state?.turnInfo?.turnNumber
    };

    // Add to game history
    game.history.push(historyEntry);

    // Trim history if it exceeds maximum
    if (game.history.length > this.maxHistoryPerGame) {
      const excessEntries = game.history.splice(0, game.history.length - this.maxHistoryPerGame);

      // Archive excess entries if needed
      this.archiveHistoryEntries(game.gameId, excessEntries).catch(error => {
        console.error(`Failed to archive history for game ${game.gameId}:`, error);
      });
    }

    // Update last activity
    game.lastActivity = new Date();

    console.log(`Event logged: ${eventType} for game ${game.gameId}`);
    return historyEntry;
  }

  /**
   * Query game history with filters
   */
  queryHistory(
    game: Game,
    filters: {
      eventTypes?: string[];
      playerId?: string;
      fromDate?: Date;
      toDate?: Date;
      phase?: GamePhase;
      turnNumber?: number;
      limit?: number;
      offset?: number;
    } = {}
  ): {
    entries: GameHistoryEntry[];
    total: number;
    hasMore: boolean;
  } {
    let filteredEntries = [...game.history];

    // Apply filters
    if (filters.eventTypes && filters.eventTypes.length > 0) {
      filteredEntries = filteredEntries.filter(entry =>
        filters.eventTypes!.includes(entry.type)
      );
    }

    if (filters.playerId) {
      filteredEntries = filteredEntries.filter(entry =>
        entry.playerId === filters.playerId
      );
    }

    if (filters.fromDate) {
      filteredEntries = filteredEntries.filter(entry =>
        entry.timestamp >= filters.fromDate!
      );
    }

    if (filters.toDate) {
      filteredEntries = filteredEntries.filter(entry =>
        entry.timestamp <= filters.toDate!
      );
    }

    if (filters.phase) {
      filteredEntries = filteredEntries.filter(entry =>
        entry.phase === filters.phase
      );
    }

    if (filters.turnNumber !== undefined) {
      filteredEntries = filteredEntries.filter(entry =>
        entry.turnNumber === filters.turnNumber
      );
    }

    // Sort by timestamp (most recent first)
    filteredEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = filteredEntries.length;
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;

    const paginatedEntries = filteredEntries.slice(offset, offset + limit);

    return {
      entries: paginatedEntries,
      total,
      hasMore: offset + limit < total
    };
  }

  /**
   * Get game timeline with events grouped by time periods
   */
  getGameTimeline(
    game: Game,
    granularity: 'minute' | 'hour' | 'day' = 'hour'
  ): Array<{
    period: string;
    startTime: Date;
    endTime: Date;
    events: GameHistoryEntry[];
    eventCount: number;
    playerActivity: Record<string, number>;
  }> {
    const timeline: Array<{
      period: string;
      startTime: Date;
      endTime: Date;
      events: GameHistoryEntry[];
      eventCount: number;
      playerActivity: Record<string, number>;
    }> = [];

    if (game.history.length === 0) {
      return timeline;
    }

    // Group events by time period
    const periodMap = new Map<string, GameHistoryEntry[]>();

    for (const entry of game.history) {
      const periodKey = this.getPeriodKey(entry.timestamp, granularity);
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, []);
      }
      periodMap.get(periodKey)!.push(entry);
    }

    // Convert to timeline format
    for (const [periodKey, events] of periodMap.entries()) {
      const periodStart = this.getPeriodStart(periodKey, granularity);
      const periodEnd = this.getPeriodEnd(periodStart, granularity);

      // Count player activity
      const playerActivity: Record<string, number> = {};
      for (const event of events) {
        if (event.playerId) {
          playerActivity[event.playerId] = (playerActivity[event.playerId] || 0) + 1;
        }
      }

      timeline.push({
        period: periodKey,
        startTime: periodStart,
        endTime: periodEnd,
        events: events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
        eventCount: events.length,
        playerActivity
      });
    }

    // Sort timeline by start time
    timeline.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    return timeline;
  }

  /**
   * Generate game replay data
   */
  generateReplay(game: Game): {
    gameId: string;
    metadata: {
      duration: number;
      totalEvents: number;
      players: Array<{ id: string; name: string }>;
      finalPhase: GamePhase;
      winner?: string;
    };
    events: Array<{
      timestamp: Date;
      relativeTime: number;
      type: string;
      playerId?: string;
      data: any;
      gameState?: any;
    }>;
  } {
    const startTime = game.createdAt.getTime();
    const endTime = game.lastActivity.getTime();
    const duration = endTime - startTime;

    const players = Object.values(game.players).map(player => ({
      id: player.id,
      name: player.name
    }));

    const replayEvents = game.history.map(entry => ({
      timestamp: entry.timestamp,
      relativeTime: entry.timestamp.getTime() - startTime,
      type: entry.type,
      playerId: entry.playerId,
      data: entry.data,
      // Include relevant game state snapshot for key events
      gameState: this.getGameStateForReplay(entry, game)
    }));

    return {
      gameId: game.gameId,
      metadata: {
        duration,
        totalEvents: game.history.length,
        players,
        finalPhase: game.phase,
        winner: game.winner || undefined
      },
      events: replayEvents
    };
  }

  /**
   * Get performance analytics from game history
   */
  getPerformanceAnalytics(game: Game): {
    gamePerformance: {
      averageEventInterval: number;
      peakActivityPeriod: string;
      totalGameDuration: number;
      phaseDistribution: Record<GamePhase, number>;
    };
    playerPerformance: Record<string, {
      eventCount: number;
      averageResponseTime: number;
      activityPattern: Array<{ hour: number; events: number }>;
      mostCommonActions: Array<{ action: string; count: number }>;
    }>;
    systemPerformance: {
      errorRate: number;
      averageProcessingTime: number;
      timeoutCount: number;
    };
  } {
    const gameStart = game.createdAt.getTime();
    const gameEnd = game.lastActivity.getTime();
    const totalDuration = gameEnd - gameStart;

    // Game performance metrics
    const eventIntervals = [];
    for (let i = 1; i < game.history.length; i++) {
      const interval = game.history[i].timestamp.getTime() - game.history[i - 1].timestamp.getTime();
      eventIntervals.push(interval);
    }

    const averageEventInterval = eventIntervals.length > 0
      ? eventIntervals.reduce((sum, interval) => sum + interval, 0) / eventIntervals.length
      : 0;

    // Phase distribution
    const phaseDistribution: Record<GamePhase, number> = {
      waiting: 0,
      setup: 0,
      playing: 0,
      paused: 0,
      finished: 0,
      abandoned: 0
    };

    for (const entry of game.history) {
      phaseDistribution[entry.phase]++;
    }

    // Peak activity period (hour of day with most events)
    const hourlyActivity = new Array(24).fill(0);
    for (const entry of game.history) {
      const hour = entry.timestamp.getHours();
      hourlyActivity[hour]++;
    }
    const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
    const peakActivityPeriod = `${peakHour}:00-${peakHour + 1}:00`;

    // Player performance metrics
    const playerPerformance: Record<string, any> = {};

    for (const [playerId, player] of Object.entries(game.players)) {
      const playerEvents = game.history.filter(entry => entry.playerId === playerId);

      // Activity pattern by hour
      const activityPattern = new Array(24).fill(0).map((_, hour) => ({
        hour,
        events: playerEvents.filter(entry => entry.timestamp.getHours() === hour).length
      }));

      // Most common actions
      const actionCounts: Record<string, number> = {};
      for (const event of playerEvents) {
        actionCounts[event.type] = (actionCounts[event.type] || 0) + 1;
      }
      const mostCommonActions = Object.entries(actionCounts)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Response time calculation (time between events)
      const responseTimes = [];
      for (let i = 1; i < playerEvents.length; i++) {
        const responseTime = playerEvents[i].timestamp.getTime() - playerEvents[i - 1].timestamp.getTime();
        responseTimes.push(responseTime);
      }
      const averageResponseTime = responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
        : 0;

      playerPerformance[playerId] = {
        eventCount: playerEvents.length,
        averageResponseTime,
        activityPattern,
        mostCommonActions
      };
    }

    // System performance metrics
    const errorEvents = game.history.filter(entry =>
      entry.type.includes('error') || entry.type.includes('timeout')
    );
    const errorRate = game.history.length > 0 ? errorEvents.length / game.history.length : 0;

    const timeoutEvents = game.history.filter(entry => entry.type === 'turn_timeout');
    const timeoutCount = timeoutEvents.length;

    // Processing time from event metadata (if available)
    const processingTimes = game.history
      .map(entry => entry.data?.metadata?.processingTime)
      .filter(time => typeof time === 'number');
    const averageProcessingTime = processingTimes.length > 0
      ? processingTimes.reduce((sum: number, time: number) => sum + time, 0) / processingTimes.length
      : 0;

    return {
      gamePerformance: {
        averageEventInterval,
        peakActivityPeriod,
        totalGameDuration: totalDuration,
        phaseDistribution
      },
      playerPerformance,
      systemPerformance: {
        errorRate,
        averageProcessingTime,
        timeoutCount
      }
    };
  }

  /**
   * Export game history to file
   */
  async exportHistory(
    game: Game,
    format: 'json' | 'csv' | 'xml' = 'json',
    options: {
      includeMetadata?: boolean;
      compress?: boolean;
    } = {}
  ): Promise<string> {
    const { includeMetadata = true, compress = false } = options;

    const exportData = {
      gameId: game.gameId,
      exportedAt: new Date().toISOString(),
      metadata: includeMetadata ? {
        players: Object.values(game.players).map(p => ({ id: p.id, name: p.name })),
        gamePhase: game.phase,
        duration: game.lastActivity.getTime() - game.createdAt.getTime(),
        totalEvents: game.history.length
      } : undefined,
      history: game.history
    };

    const fileName = `game-${game.gameId}-history-${Date.now()}.${format}`;
    const filePath = join(this.historyPath, fileName);

    let content: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(exportData, this.dateReplacer, 2);
        break;
      case 'csv':
        content = this.convertToCSV(exportData.history);
        break;
      case 'xml':
        content = this.convertToXML(exportData);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    await fs.writeFile(filePath, content, 'utf8');

    console.log(`Game history exported: ${filePath}`);
    return filePath;
  }

  /**
   * Import game history from file
   */
  async importHistory(filePath: string): Promise<{
    gameId: string;
    importedEvents: number;
    metadata?: any;
  }> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const importData = JSON.parse(content, this.dateReviver);

      return {
        gameId: importData.gameId,
        importedEvents: importData.history?.length || 0,
        metadata: importData.metadata
      };
    } catch (error) {
      throw new Error(`Failed to import history: ${error}`);
    }
  }

  /**
   * Clean up old history files
   */
  async cleanupHistoryFiles(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const files = await fs.readdir(this.historyPath);
      const now = Date.now();

      for (const file of files) {
        const filePath = join(this.historyPath, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > maxAgeMs) {
          await fs.unlink(filePath);
          console.log(`Cleaned up old history file: ${file}`);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup history files:', error);
    }
  }

  /**
   * Archive excess history entries
   */
  private async archiveHistoryEntries(gameId: string, entries: GameHistoryEntry[]): Promise<void> {
    const archiveFileName = `archive-${gameId}-${Date.now()}.json`;
    const archivePath = join(this.historyPath, 'archives', archiveFileName);

    try {
      await fs.mkdir(join(this.historyPath, 'archives'), { recursive: true });

      const archiveData = {
        gameId,
        archivedAt: new Date(),
        entryCount: entries.length,
        entries
      };

      await fs.writeFile(archivePath, JSON.stringify(archiveData, this.dateReplacer, 2), 'utf8');
      console.log(`Archived ${entries.length} history entries for game ${gameId}`);
    } catch (error) {
      console.error(`Failed to archive history entries for game ${gameId}:`, error);
    }
  }

  /**
   * Get period key for timeline grouping
   */
  private getPeriodKey(date: Date, granularity: 'minute' | 'hour' | 'day'): string {
    switch (granularity) {
      case 'minute':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
      case 'hour':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
      case 'day':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      default:
        return date.toISOString();
    }
  }

  /**
   * Get period start date
   */
  private getPeriodStart(periodKey: string, granularity: 'minute' | 'hour' | 'day'): Date {
    const parts = periodKey.split('-').map(Number);

    switch (granularity) {
      case 'minute':
        return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], 0, 0);
      case 'hour':
        return new Date(parts[0], parts[1] - 1, parts[2], parts[3], 0, 0, 0);
      case 'day':
        return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      default:
        return new Date();
    }
  }

  /**
   * Get period end date
   */
  private getPeriodEnd(periodStart: Date, granularity: 'minute' | 'hour' | 'day'): Date {
    const periodEnd = new Date(periodStart);

    switch (granularity) {
      case 'minute':
        periodEnd.setMinutes(periodEnd.getMinutes() + 1);
        break;
      case 'hour':
        periodEnd.setHours(periodEnd.getHours() + 1);
        break;
      case 'day':
        periodEnd.setDate(periodEnd.getDate() + 1);
        break;
    }

    return periodEnd;
  }

  /**
   * Get game state snapshot for replay
   */
  private getGameStateForReplay(entry: GameHistoryEntry, game: Game): any {
    // Return relevant state for key events
    if (['game_started', 'attack_made', 'ships_placed', 'game_finished'].includes(entry.type)) {
      return {
        phase: entry.phase,
        currentTurn: game.currentTurn,
        turnNumber: entry.turnNumber,
        playerCount: Object.keys(game.players).length
      };
    }
    return undefined;
  }

  /**
   * Convert history to CSV format
   */
  private convertToCSV(history: GameHistoryEntry[]): string {
    const headers = ['id', 'timestamp', 'type', 'playerId', 'phase', 'turnNumber', 'data'];
    const rows = [headers.join(',')];

    for (const entry of history) {
      const row = [
        entry.id,
        entry.timestamp.toISOString(),
        entry.type,
        entry.playerId || '',
        entry.phase,
        entry.turnNumber || '',
        JSON.stringify(entry.data).replace(/,/g, ';') // Escape commas in JSON
      ];
      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  /**
   * Convert history to XML format
   */
  private convertToXML(data: any): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<gameHistory>\n';
    xml += `  <gameId>${data.gameId}</gameId>\n`;
    xml += `  <exportedAt>${data.exportedAt}</exportedAt>\n`;

    if (data.metadata) {
      xml += '  <metadata>\n';
      xml += `    <totalEvents>${data.metadata.totalEvents}</totalEvents>\n`;
      xml += '  </metadata>\n';
    }

    xml += '  <events>\n';
    for (const entry of data.history) {
      xml += '    <event>\n';
      xml += `      <id>${entry.id}</id>\n`;
      xml += `      <timestamp>${entry.timestamp}</timestamp>\n`;
      xml += `      <type>${entry.type}</type>\n`;
      xml += `      <phase>${entry.phase}</phase>\n`;
      if (entry.playerId) xml += `      <playerId>${entry.playerId}</playerId>\n`;
      if (entry.turnNumber) xml += `      <turnNumber>${entry.turnNumber}</turnNumber>\n`;
      xml += '    </event>\n';
    }
    xml += '  </events>\n';
    xml += '</gameHistory>';

    return xml;
  }

  /**
   * JSON replacer for Date objects
   */
  private dateReplacer(key: string, value: any): any {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
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
    return value;
  }
}