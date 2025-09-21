import { Game, GamePhase, PlayerStatistics } from '../types';
import { GameHistoryManager } from './GameHistoryManager';

/**
 * Game Analytics Service
 *
 * Provides comprehensive analytics and statistics tracking:
 * - Real-time game metrics
 * - Player performance analytics
 * - System performance monitoring
 * - Trend analysis and reporting
 * - Business intelligence dashboards
 */
export class GameAnalyticsService {
  private historyManager: GameHistoryManager;
  private analyticsData = new Map<string, any>();
  private metricsUpdateInterval: NodeJS.Timeout;

  constructor(historyManager: GameHistoryManager) {
    this.historyManager = historyManager;

    // Update analytics metrics periodically
    this.metricsUpdateInterval = setInterval(() => {
      this.updateAnalyticsCache();
    }, 60000); // Update every minute
  }

  /**
   * Get comprehensive game statistics
   */
  getGameStatistics(games: Game[]): {
    overview: {
      totalGames: number;
      activeGames: number;
      completedGames: number;
      abandonedGames: number;
      totalPlayers: number;
      averageGameDuration: number;
      averagePlayersPerGame: number;
    };
    gameDistribution: {
      byPhase: Record<GamePhase, number>;
      byDuration: Record<string, number>;
      byPlayerCount: Record<string, number>;
      byHour: Record<string, number>;
      byDay: Record<string, number>;
    };
    performanceMetrics: {
      averageTurnTime: number;
      longestGame: number;
      shortestGame: number;
      mostActiveHour: string;
      peakConcurrency: number;
    };
  } {
    const totalGames = games.length;
    const activeGames = games.filter(g => ['waiting', 'setup', 'playing', 'paused'].includes(g.phase)).length;
    const completedGames = games.filter(g => g.phase === 'finished').length;
    const abandonedGames = games.filter(g => g.phase === 'abandoned').length;

    // Unique players
    const uniquePlayers = new Set<string>();
    games.forEach(game => {
      Object.keys(game.players).forEach(playerId => uniquePlayers.add(playerId));
    });

    // Average game duration (completed games only)
    const completedGamesWithDuration = games.filter(g =>
      g.phase === 'finished' && g.statistics.gameDuration
    );
    const averageGameDuration = completedGamesWithDuration.length > 0
      ? completedGamesWithDuration.reduce((sum, g) => sum + (g.statistics.gameDuration || 0), 0) / completedGamesWithDuration.length
      : 0;

    // Average players per game
    const averagePlayersPerGame = totalGames > 0
      ? games.reduce((sum, g) => sum + Object.keys(g.players).length, 0) / totalGames
      : 0;

    // Game distribution by phase
    const byPhase: Record<GamePhase, number> = {
      waiting: 0,
      setup: 0,
      playing: 0,
      paused: 0,
      finished: 0,
      abandoned: 0
    };
    games.forEach(game => byPhase[game.phase]++);

    // Game distribution by duration ranges
    const byDuration: Record<string, number> = {
      '0-5min': 0,
      '5-15min': 0,
      '15-30min': 0,
      '30-60min': 0,
      '60min+': 0
    };

    completedGamesWithDuration.forEach(game => {
      const durationMinutes = (game.statistics.gameDuration || 0) / (1000 * 60);
      if (durationMinutes <= 5) byDuration['0-5min']++;
      else if (durationMinutes <= 15) byDuration['5-15min']++;
      else if (durationMinutes <= 30) byDuration['15-30min']++;
      else if (durationMinutes <= 60) byDuration['30-60min']++;
      else byDuration['60min+']++;
    });

    // Game distribution by player count
    const byPlayerCount: Record<string, number> = {};
    games.forEach(game => {
      const playerCount = Object.keys(game.players).length;
      const key = `${playerCount} player${playerCount !== 1 ? 's' : ''}`;
      byPlayerCount[key] = (byPlayerCount[key] || 0) + 1;
    });

    // Game distribution by hour of creation
    const byHour: Record<string, number> = {};
    games.forEach(game => {
      const hour = game.createdAt.getHours();
      const key = `${hour.toString().padStart(2, '0')}:00`;
      byHour[key] = (byHour[key] || 0) + 1;
    });

    // Game distribution by day of week
    const byDay: Record<string, number> = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    games.forEach(game => {
      const day = dayNames[game.createdAt.getDay()];
      byDay[day] = (byDay[day] || 0) + 1;
    });

    // Performance metrics
    const allTurnTimes = games.flatMap(g =>
      g.state.turnInfo.turnHistory
        .filter(t => t.duration)
        .map(t => t.duration!)
    );
    const averageTurnTime = allTurnTimes.length > 0
      ? allTurnTimes.reduce((sum, time) => sum + time, 0) / allTurnTimes.length
      : 0;

    const gameDurations = completedGamesWithDuration.map(g => g.statistics.gameDuration || 0);
    const longestGame = gameDurations.length > 0 ? Math.max(...gameDurations) : 0;
    const shortestGame = gameDurations.length > 0 ? Math.min(...gameDurations) : 0;

    // Most active hour
    const hourCounts = Object.values(byHour);
    const maxHourCount = Math.max(...hourCounts);
    const mostActiveHour = Object.entries(byHour).find(([, count]) => count === maxHourCount)?.[0] || 'N/A';

    return {
      overview: {
        totalGames,
        activeGames,
        completedGames,
        abandonedGames,
        totalPlayers: uniquePlayers.size,
        averageGameDuration,
        averagePlayersPerGame
      },
      gameDistribution: {
        byPhase,
        byDuration,
        byPlayerCount,
        byHour,
        byDay
      },
      performanceMetrics: {
        averageTurnTime,
        longestGame,
        shortestGame,
        mostActiveHour,
        peakConcurrency: this.calculatePeakConcurrency(games)
      }
    };
  }

  /**
   * Get player analytics across all games
   */
  getPlayerAnalytics(games: Game[]): {
    overview: {
      totalUniquePlayers: number;
      averageGamesPerPlayer: number;
      averageGameCompletionRate: number;
      topPlayersByWins: Array<{ playerId: string; playerName?: string; wins: number; totalGames: number; winRate: number }>;
    };
    performanceMetrics: {
      averageAccuracy: number;
      averageResponseTime: number;
      mostActivePlayer: { playerId: string; gameCount: number };
      bestAccuracyPlayer: { playerId: string; accuracy: number };
    };
    engagementMetrics: {
      averageSessionDuration: number;
      returnPlayerRate: number;
      abandonmentRate: number;
      peakPlayingHours: string[];
    };
  } {
    // Collect all player data
    const playerData = new Map<string, {
      playerId: string;
      playerName?: string;
      totalGames: number;
      wins: number;
      completedGames: number;
      totalAccuracy: number;
      totalResponseTime: number;
      totalSessionTime: number;
      gamesByHour: Record<number, number>;
      firstSeen: Date;
      lastSeen: Date;
    }>();

    games.forEach(game => {
      Object.values(game.players).forEach(player => {
        if (!playerData.has(player.id)) {
          playerData.set(player.id, {
            playerId: player.id,
            playerName: player.name,
            totalGames: 0,
            wins: 0,
            completedGames: 0,
            totalAccuracy: 0,
            totalResponseTime: 0,
            totalSessionTime: 0,
            gamesByHour: {},
            firstSeen: game.createdAt,
            lastSeen: game.lastActivity
          });
        }

        const data = playerData.get(player.id)!;
        data.totalGames++;

        if (game.winner === player.id) {
          data.wins++;
        }

        if (game.phase === 'finished') {
          data.completedGames++;
        }

        // Update statistics from game
        const playerStats = game.statistics.playerStats[player.id];
        if (playerStats) {
          data.totalAccuracy += playerStats.accuracyRate || 0;
          data.totalResponseTime += playerStats.averageResponseTime || 0;
          data.totalSessionTime += playerStats.totalTimeSpent || 0;
        }

        // Track playing hours
        const hour = game.createdAt.getHours();
        data.gamesByHour[hour] = (data.gamesByHour[hour] || 0) + 1;

        // Update first/last seen
        if (game.createdAt < data.firstSeen) {
          data.firstSeen = game.createdAt;
        }
        if (game.lastActivity > data.lastSeen) {
          data.lastSeen = game.lastActivity;
        }
      });
    });

    const players = Array.from(playerData.values());
    const totalUniquePlayers = players.length;

    // Calculate metrics
    const averageGamesPerPlayer = totalUniquePlayers > 0
      ? players.reduce((sum, p) => sum + p.totalGames, 0) / totalUniquePlayers
      : 0;

    const averageGameCompletionRate = totalUniquePlayers > 0
      ? players.reduce((sum, p) => sum + (p.totalGames > 0 ? p.completedGames / p.totalGames : 0), 0) / totalUniquePlayers
      : 0;

    // Top players by wins
    const topPlayersByWins = players
      .map(p => ({
        playerId: p.playerId,
        playerName: p.playerName,
        wins: p.wins,
        totalGames: p.totalGames,
        winRate: p.totalGames > 0 ? p.wins / p.totalGames : 0
      }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 10);

    // Performance metrics
    const playersWithAccuracy = players.filter(p => p.totalGames > 0);
    const averageAccuracy = playersWithAccuracy.length > 0
      ? playersWithAccuracy.reduce((sum, p) => sum + (p.totalAccuracy / p.totalGames), 0) / playersWithAccuracy.length
      : 0;

    const averageResponseTime = playersWithAccuracy.length > 0
      ? playersWithAccuracy.reduce((sum, p) => sum + (p.totalResponseTime / p.totalGames), 0) / playersWithAccuracy.length
      : 0;

    const mostActivePlayer = players.reduce((max, p) =>
      p.totalGames > max.gameCount ? { playerId: p.playerId, gameCount: p.totalGames } : max,
      { playerId: '', gameCount: 0 }
    );

    const bestAccuracyPlayer = playersWithAccuracy.reduce((best, p) => {
      const accuracy = p.totalAccuracy / p.totalGames;
      return accuracy > best.accuracy ? { playerId: p.playerId, accuracy } : best;
    }, { playerId: '', accuracy: 0 });

    // Engagement metrics
    const averageSessionDuration = players.length > 0
      ? players.reduce((sum, p) => sum + p.totalSessionTime, 0) / players.length
      : 0;

    // Return player rate (players who played more than 1 game)
    const returnPlayers = players.filter(p => p.totalGames > 1).length;
    const returnPlayerRate = totalUniquePlayers > 0 ? returnPlayers / totalUniquePlayers : 0;

    // Abandonment rate (games not completed)
    const totalGamesPlayed = players.reduce((sum, p) => sum + p.totalGames, 0);
    const totalCompletedGames = players.reduce((sum, p) => sum + p.completedGames, 0);
    const abandonmentRate = totalGamesPlayed > 0 ? 1 - (totalCompletedGames / totalGamesPlayed) : 0;

    // Peak playing hours
    const hourlyActivity = new Array(24).fill(0);
    players.forEach(player => {
      Object.entries(player.gamesByHour).forEach(([hour, count]) => {
        hourlyActivity[parseInt(hour)] += count;
      });
    });

    const maxActivity = Math.max(...hourlyActivity);
    const peakPlayingHours = hourlyActivity
      .map((activity, hour) => ({ hour, activity }))
      .filter(({ activity }) => activity >= maxActivity * 0.8) // Within 80% of peak
      .map(({ hour }) => `${hour.toString().padStart(2, '0')}:00`);

    return {
      overview: {
        totalUniquePlayers,
        averageGamesPerPlayer,
        averageGameCompletionRate,
        topPlayersByWins
      },
      performanceMetrics: {
        averageAccuracy,
        averageResponseTime,
        mostActivePlayer,
        bestAccuracyPlayer
      },
      engagementMetrics: {
        averageSessionDuration,
        returnPlayerRate,
        abandonmentRate,
        peakPlayingHours
      }
    };
  }

  /**
   * Get real-time system performance metrics
   */
  getSystemPerformanceMetrics(games: Game[]): {
    performance: {
      averageMemoryUsage: number;
      averageResponseTime: number;
      errorRate: number;
      throughput: number; // games per hour
    };
    reliability: {
      uptime: number;
      crashCount: number;
      recoveryCount: number;
      dataIntegrityIssues: number;
    };
    scalability: {
      peakConcurrentGames: number;
      averageConcurrentGames: number;
      resourceUtilization: number;
      bottlenecks: string[];
    };
  } {
    // Calculate system metrics from game data
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);

    // Recent games for throughput calculation
    const recentGames = games.filter(g => g.createdAt.getTime() > hourAgo);
    const throughput = recentGames.length;

    // Error rate from game history
    const allErrorEvents = games.flatMap(g =>
      g.history.filter(h => h.type.includes('error') || h.type.includes('timeout'))
    );
    const totalEvents = games.reduce((sum, g) => sum + g.history.length, 0);
    const errorRate = totalEvents > 0 ? allErrorEvents.length / totalEvents : 0;

    // Recovery count (games that were repaired)
    const recoveryCount = games.filter(g =>
      g.history.some(h => h.type === 'state_recovery' || h.type === 'game_repaired')
    ).length;

    // Data integrity issues
    const dataIntegrityIssues = games.filter(g =>
      !g.state.isValid || g.state.integrity.validationErrors.length > 0
    ).length;

    // Peak concurrent games (estimate based on creation/completion times)
    const peakConcurrentGames = this.calculatePeakConcurrency(games);

    // Average concurrent games
    const activeGames = games.filter(g => ['waiting', 'setup', 'playing', 'paused'].includes(g.phase));
    const averageConcurrentGames = activeGames.length;

    // Identify bottlenecks
    const bottlenecks: string[] = [];
    if (errorRate > 0.05) bottlenecks.push('High error rate detected');
    if (peakConcurrentGames > 100) bottlenecks.push('High concurrent game load');
    if (dataIntegrityIssues > 0) bottlenecks.push('Data integrity issues present');

    return {
      performance: {
        averageMemoryUsage: this.estimateMemoryUsage(games),
        averageResponseTime: this.calculateAverageResponseTime(games),
        errorRate,
        throughput
      },
      reliability: {
        uptime: this.calculateUptime(),
        crashCount: 0, // Would be tracked separately in production
        recoveryCount,
        dataIntegrityIssues
      },
      scalability: {
        peakConcurrentGames,
        averageConcurrentGames,
        resourceUtilization: Math.min(averageConcurrentGames / 100, 1), // Assume capacity of 100
        bottlenecks
      }
    };
  }

  /**
   * Generate trend analysis report
   */
  generateTrendAnalysis(games: Game[], timeRange: {
    startDate: Date;
    endDate: Date;
    granularity: 'hour' | 'day' | 'week' | 'month';
  }): {
    gameCreationTrend: Array<{ period: string; count: number; change: number }>;
    playerEngagementTrend: Array<{ period: string; uniquePlayers: number; change: number }>;
    performanceTrend: Array<{ period: string; averageGameDuration: number; change: number }>;
    insights: string[];
  } {
    const { startDate, endDate, granularity } = timeRange;

    // Filter games within time range
    const filteredGames = games.filter(g =>
      g.createdAt >= startDate && g.createdAt <= endDate
    );

    // Group games by time periods
    const periods = this.generateTimePeriods(startDate, endDate, granularity);
    const gamesByPeriod = new Map<string, Game[]>();
    const playersByPeriod = new Map<string, Set<string>>();

    periods.forEach(period => {
      gamesByPeriod.set(period, []);
      playersByPeriod.set(period, new Set());
    });

    filteredGames.forEach(game => {
      const period = this.getPeriodForDate(game.createdAt, granularity);
      if (gamesByPeriod.has(period)) {
        gamesByPeriod.get(period)!.push(game);
        Object.keys(game.players).forEach(playerId => {
          playersByPeriod.get(period)!.add(playerId);
        });
      }
    });

    // Generate trends
    const gameCreationTrend = this.calculateTrend(
      periods,
      period => gamesByPeriod.get(period)?.length || 0
    );

    const playerEngagementTrend = this.calculateTrend(
      periods,
      period => playersByPeriod.get(period)?.size || 0
    );

    const performanceTrend = this.calculateTrend(
      periods,
      period => {
        const periodGames = gamesByPeriod.get(period) || [];
        const completedGames = periodGames.filter(g => g.phase === 'finished' && g.statistics.gameDuration);
        return completedGames.length > 0
          ? completedGames.reduce((sum, g) => sum + (g.statistics.gameDuration || 0), 0) / completedGames.length
          : 0;
      }
    );

    // Generate insights
    const insights = this.generateInsights(gameCreationTrend, playerEngagementTrend, performanceTrend);

    return {
      gameCreationTrend,
      playerEngagementTrend,
      performanceTrend,
      insights
    };
  }

  /**
   * Get real-time dashboard data
   */
  getRealTimeDashboard(games: Game[]): {
    summary: {
      activeGames: number;
      playersOnline: number;
      gamesCreatedToday: number;
      averageGameDuration: number;
    };
    recentActivity: Array<{
      timestamp: Date;
      event: string;
      gameId: string;
      details: string;
    }>;
    alerts: Array<{
      level: 'info' | 'warning' | 'error';
      message: string;
      timestamp: Date;
    }>;
    quickStats: {
      topPerformers: Array<{ name: string; metric: string; value: number }>;
      systemHealth: 'healthy' | 'warning' | 'critical';
      trends: {
        gamesUp: boolean;
        playersUp: boolean;
        performanceUp: boolean;
      };
    };
  } {
    const activeGames = games.filter(g => ['waiting', 'setup', 'playing', 'paused'].includes(g.phase));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const gamesCreatedToday = games.filter(g => g.createdAt >= today);

    // Players currently online (estimate based on recent activity)
    const recentThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes
    const playersOnline = new Set<string>();
    activeGames.forEach(game => {
      if (game.lastActivity >= recentThreshold) {
        Object.keys(game.players).forEach(playerId => playersOnline.add(playerId));
      }
    });

    // Recent activity
    const recentActivity = games
      .flatMap(game => game.history.slice(-5).map(event => ({
        timestamp: event.timestamp,
        event: event.type,
        gameId: game.gameId,
        details: this.formatEventDetails(event)
      })))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20);

    // Generate alerts
    const alerts = this.generateAlerts(games);

    // System health assessment
    const systemHealth = this.assessSystemHealth(games);

    // Top performers
    const topPerformers = this.getTopPerformers(games);

    // Trends (simplified - would need historical data for accurate trends)
    const trends = {
      gamesUp: gamesCreatedToday.length > 0,
      playersUp: playersOnline.size > 0,
      performanceUp: true // Would calculate based on historical performance data
    };

    return {
      summary: {
        activeGames: activeGames.length,
        playersOnline: playersOnline.size,
        gamesCreatedToday: gamesCreatedToday.length,
        averageGameDuration: this.calculateAverageGameDuration(games)
      },
      recentActivity,
      alerts,
      quickStats: {
        topPerformers,
        systemHealth,
        trends
      }
    };
  }

  /**
   * Export analytics data
   */
  async exportAnalytics(
    games: Game[],
    format: 'json' | 'csv' | 'pdf' = 'json'
  ): Promise<string> {
    const analytics = {
      generatedAt: new Date(),
      gameStatistics: this.getGameStatistics(games),
      playerAnalytics: this.getPlayerAnalytics(games),
      systemMetrics: this.getSystemPerformanceMetrics(games),
      dashboard: this.getRealTimeDashboard(games)
    };

    const fileName = `analytics-export-${Date.now()}.${format}`;
    const filePath = `/tmp/${fileName}`;

    switch (format) {
      case 'json':
        await require('fs').promises.writeFile(filePath, JSON.stringify(analytics, null, 2));
        break;
      case 'csv':
        // Simplified CSV export - would implement full CSV conversion
        const csvData = this.convertAnalyticsToCSV(analytics);
        await require('fs').promises.writeFile(filePath, csvData);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    return filePath;
  }

  // Private helper methods

  private calculatePeakConcurrency(games: Game[]): number {
    // Simplified peak concurrency calculation
    // In production, this would analyze overlapping game sessions
    return Math.max(1, games.filter(g => g.phase === 'playing').length);
  }

  private estimateMemoryUsage(games: Game[]): number {
    // Estimate memory usage based on game data size
    const totalGameSize = games.reduce((sum, game) => {
      return sum + JSON.stringify(game).length;
    }, 0);
    return totalGameSize / (1024 * 1024); // Convert to MB
  }

  private calculateAverageResponseTime(games: Game[]): number {
    const allResponseTimes = games.flatMap(g =>
      Object.values(g.statistics.playerStats).map(stats => stats.averageResponseTime)
    ).filter(time => time > 0);

    return allResponseTimes.length > 0
      ? allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length
      : 0;
  }

  private calculateUptime(): number {
    // In production, this would track actual service uptime
    return 99.9; // Placeholder percentage
  }

  private generateTimePeriods(startDate: Date, endDate: Date, granularity: string): string[] {
    const periods: string[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      periods.push(this.getPeriodForDate(current, granularity));

      switch (granularity) {
        case 'hour':
          current.setHours(current.getHours() + 1);
          break;
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
      }
    }

    return periods;
  }

  private getPeriodForDate(date: Date, granularity: string): string {
    switch (granularity) {
      case 'hour':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
      case 'day':
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return `${weekStart.getFullYear()}-W${Math.ceil(weekStart.getDate() / 7)}`;
      case 'month':
        return `${date.getFullYear()}-${date.getMonth() + 1}`;
      default:
        return date.toISOString();
    }
  }

  private calculateTrend(periods: string[], valueExtractor: (period: string) => number): Array<{ period: string; count: number; change: number }> {
    const trend = periods.map((period, index) => {
      const count = valueExtractor(period);
      const previousCount = index > 0 ? valueExtractor(periods[index - 1]) : count;
      const change = previousCount > 0 ? ((count - previousCount) / previousCount) * 100 : 0;

      return { period, count, change };
    });

    return trend;
  }

  private generateInsights(gameCreationTrend: any[], playerEngagementTrend: any[], performanceTrend: any[]): string[] {
    const insights: string[] = [];

    // Analyze game creation trend
    const recentGameGrowth = gameCreationTrend.slice(-3).reduce((sum, t) => sum + t.change, 0) / 3;
    if (recentGameGrowth > 10) {
      insights.push('Game creation is trending upward with strong growth');
    } else if (recentGameGrowth < -10) {
      insights.push('Game creation is declining - investigate user acquisition');
    }

    // Analyze player engagement
    const recentPlayerGrowth = playerEngagementTrend.slice(-3).reduce((sum, t) => sum + t.change, 0) / 3;
    if (recentPlayerGrowth > 15) {
      insights.push('Player engagement is increasing - good retention');
    } else if (recentPlayerGrowth < -15) {
      insights.push('Player engagement is declining - review user experience');
    }

    // Analyze performance trend
    const recentPerformanceChange = performanceTrend.slice(-3).reduce((sum, t) => sum + t.change, 0) / 3;
    if (recentPerformanceChange > 20) {
      insights.push('Game duration is increasing - players are more engaged');
    } else if (recentPerformanceChange < -20) {
      insights.push('Game duration is decreasing - possible balance issues');
    }

    return insights;
  }

  private formatEventDetails(event: any): string {
    switch (event.type) {
      case 'player_joined':
        return `${event.data.playerName} joined`;
      case 'attack_made':
        return `${event.data.attackerName} attacked ${event.data.position}`;
      case 'game_finished':
        return `${event.data.winnerName} won the game`;
      default:
        return event.type.replace(/_/g, ' ');
    }
  }

  private generateAlerts(games: Game[]): Array<{ level: 'info' | 'warning' | 'error'; message: string; timestamp: Date }> {
    const alerts: Array<{ level: 'info' | 'warning' | 'error'; message: string; timestamp: Date }> = [];

    // Check for data integrity issues
    const corruptedGames = games.filter(g => !g.state.isValid);
    if (corruptedGames.length > 0) {
      alerts.push({
        level: 'error',
        message: `${corruptedGames.length} games have data integrity issues`,
        timestamp: new Date()
      });
    }

    // Check for stuck games
    const stuckGames = games.filter(g => {
      const hourAgo = Date.now() - (60 * 60 * 1000);
      return g.phase === 'playing' && g.lastActivity.getTime() < hourAgo;
    });
    if (stuckGames.length > 0) {
      alerts.push({
        level: 'warning',
        message: `${stuckGames.length} games appear to be stuck`,
        timestamp: new Date()
      });
    }

    return alerts;
  }

  private assessSystemHealth(games: Game[]): 'healthy' | 'warning' | 'critical' {
    const errorCount = games.reduce((sum, g) => sum + g.state.integrity.validationErrors.length, 0);
    const totalGames = games.length;

    if (totalGames === 0) return 'healthy';

    const errorRate = errorCount / totalGames;

    if (errorRate > 0.1) return 'critical';
    if (errorRate > 0.05) return 'warning';
    return 'healthy';
  }

  private getTopPerformers(games: Game[]): Array<{ name: string; metric: string; value: number }> {
    const performers: Array<{ name: string; metric: string; value: number }> = [];

    // Top player by wins
    const playerWins = new Map<string, { name: string; wins: number }>();
    games.forEach(game => {
      if (game.winner && game.players[game.winner]) {
        const player = game.players[game.winner];
        const current = playerWins.get(game.winner) || { name: player.name, wins: 0 };
        current.wins++;
        playerWins.set(game.winner, current);
      }
    });

    const topWinner = Array.from(playerWins.values()).reduce((max, player) =>
      player.wins > max.wins ? player : max, { name: 'None', wins: 0 }
    );

    if (topWinner.wins > 0) {
      performers.push({
        name: topWinner.name,
        metric: 'Most Wins',
        value: topWinner.wins
      });
    }

    return performers;
  }

  private calculateAverageGameDuration(games: Game[]): number {
    const completedGames = games.filter(g => g.phase === 'finished' && g.statistics.gameDuration);
    return completedGames.length > 0
      ? completedGames.reduce((sum, g) => sum + (g.statistics.gameDuration || 0), 0) / completedGames.length
      : 0;
  }

  private convertAnalyticsToCSV(analytics: any): string {
    // Simplified CSV conversion - would implement full conversion in production
    return 'Analytics data exported to CSV format would be implemented here';
  }

  private updateAnalyticsCache(): void {
    // Update cached analytics data periodically
    console.log('Updating analytics cache...');
  }

  destroy(): void {
    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval);
    }
    this.analyticsData.clear();
    console.log('Game Analytics Service destroyed');
  }
}