import { TurnManager } from '../services/TurnManager';
import { Game, GamePhase } from '../types';
import { createGame, createPlayer } from '../models/Game';
import { randomUUID } from 'crypto';

describe('TurnManager', () => {
  let turnManager: TurnManager;
  let testGame: Game;
  let player1Id: string;
  let player2Id: string;

  beforeEach(() => {
    turnManager = new TurnManager();

    // Create test game with two players
    const hostPlayer = createPlayer(randomUUID(), 'Player1');
    player1Id = hostPlayer.id;
    testGame = createGame(hostPlayer);

    // Add second player
    player2Id = randomUUID();
    testGame.players[player2Id] = {
      id: player2Id,
      name: 'Player2',
      ready: true,
      board: { size: 10, hits: new Set(), misses: new Set() },
      ships: []
    };

    // Set game to playing phase
    testGame.phase = 'playing';
    testGame.metadata.timeouts.turnTimeout = 5000; // 5 seconds for testing
  });

  afterEach(() => {
    turnManager.destroy();
  });

  describe('startTurn', () => {
    it('should start a turn for a player', () => {
      turnManager.startTurn(testGame, player1Id);

      expect(testGame.state.turnInfo.turnNumber).toBe(1);
      expect(testGame.currentTurn).toBe(player1Id);
      expect(testGame.state.turnInfo.turnHistory).toHaveLength(1);

      const turnEntry = testGame.state.turnInfo.turnHistory[0];
      expect(turnEntry.playerId).toBe(player1Id);
      expect(turnEntry.turnNumber).toBe(1);
      expect(turnEntry.startedAt).toBeInstanceOf(Date);
      expect(turnEntry.endedAt).toBeUndefined();
    });

    it('should end previous turn when starting new turn', () => {
      // Start first turn
      turnManager.startTurn(testGame, player1Id);
      const firstTurnTime = testGame.state.turnInfo.turnStartedAt.getTime();

      // Start second turn
      setTimeout(() => {
        turnManager.startTurn(testGame, player2Id);

        expect(testGame.state.turnInfo.turnNumber).toBe(2);
        expect(testGame.currentTurn).toBe(player2Id);
        expect(testGame.state.turnInfo.previousTurn).toBe(player1Id);

        // First turn should be ended
        const firstTurn = testGame.state.turnInfo.turnHistory[0];
        expect(firstTurn.endedAt).toBeInstanceOf(Date);
        expect(firstTurn.duration).toBeGreaterThan(0);
      }, 10);
    });

    it('should set turn timeout when configured', (done) => {
      const timeoutHandler = jest.fn();
      testGame.metadata.timeouts.turnTimeout = 100; // 100ms for testing

      turnManager.startTurn(testGame, player1Id, timeoutHandler);

      setTimeout(() => {
        expect(timeoutHandler).toHaveBeenCalledWith(testGame.gameId, player1Id);
        done();
      }, 150);
    });

    it('should throw error for non-existent player', () => {
      expect(() => {
        turnManager.startTurn(testGame, 'non-existent-player');
      }).toThrow('Player not found in game');
    });

    it('should throw error when game is not in playing phase', () => {
      testGame.phase = 'setup';

      expect(() => {
        turnManager.startTurn(testGame, player1Id);
      }).toThrow('Cannot start turn when game is not in playing phase');
    });
  });

  describe('endTurn', () => {
    beforeEach(() => {
      turnManager.startTurn(testGame, player1Id);
    });

    it('should end current turn with duration calculation', () => {
      const startTime = testGame.state.turnInfo.turnStartedAt.getTime();

      setTimeout(() => {
        turnManager.endTurn(testGame, player1Id, 'player_action');

        const turnEntry = testGame.state.turnInfo.turnHistory[0];
        expect(turnEntry.endedAt).toBeInstanceOf(Date);
        expect(turnEntry.duration).toBeGreaterThan(0);
        expect(turnEntry.action).toBe('player_action');

        // Should update game statistics
        expect(testGame.statistics.longestTurn).toBe(turnEntry.duration);
      }, 10);
    });

    it('should handle ending turn for wrong player gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      turnManager.endTurn(testGame, player2Id);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attempted to end turn for player2')
      );

      consoleSpy.mockRestore();
    });

    it('should update player statistics', () => {
      // Initialize player statistics
      testGame.statistics.playerStats[player1Id] = {
        shotsAttempted: 0,
        shotsHit: 0,
        shotsMissed: 0,
        shipsDestroyed: 0,
        accuracyRate: 0,
        averageResponseTime: 0,
        totalTimeSpent: 0,
        longestTurnTime: 0
      };

      setTimeout(() => {
        turnManager.endTurn(testGame, player1Id);

        const playerStats = testGame.statistics.playerStats[player1Id];
        expect(playerStats.totalTimeSpent).toBeGreaterThan(0);
        expect(playerStats.longestTurnTime).toBeGreaterThan(0);
        expect(playerStats.averageResponseTime).toBeGreaterThan(0);
      }, 10);
    });
  });

  describe('switchTurn', () => {
    it('should switch between players', () => {
      turnManager.startTurn(testGame, player1Id);

      const nextPlayer = turnManager.switchTurn(testGame);

      expect(nextPlayer).toBe(player2Id);
      expect(testGame.currentTurn).toBe(player2Id);
      expect(testGame.state.turnInfo.turnNumber).toBe(2);
    });

    it('should cycle back to first player', () => {
      turnManager.startTurn(testGame, player2Id);

      const nextPlayer = turnManager.switchTurn(testGame);

      expect(nextPlayer).toBe(player1Id);
      expect(testGame.currentTurn).toBe(player1Id);
    });

    it('should throw error when game is not in playing phase', () => {
      testGame.phase = 'setup';

      expect(() => {
        turnManager.switchTurn(testGame);
      }).toThrow('Cannot switch turns when game is not in playing phase');
    });

    it('should throw error with insufficient players', () => {
      // Remove a player
      delete testGame.players[player2Id];

      expect(() => {
        turnManager.switchTurn(testGame);
      }).toThrow('Cannot switch turns with fewer than 2 players');
    });
  });

  describe('handleTurnTimeout', () => {
    beforeEach(() => {
      turnManager.startTurn(testGame, player1Id);
    });

    it('should handle turn timeout properly', () => {
      const timeoutHandler = jest.fn();

      turnManager.handleTurnTimeout(testGame, player1Id, timeoutHandler);

      expect(timeoutHandler).toHaveBeenCalledWith(testGame.gameId, player1Id);

      // Should record timeout in history
      const timeoutEvent = testGame.history.find(event => event.type === 'turn_timeout');
      expect(timeoutEvent).toBeDefined();
      expect(timeoutEvent!.playerId).toBe(player1Id);
      expect(timeoutEvent!.data.turnNumber).toBe(1);

      // Should switch to next player
      expect(testGame.currentTurn).toBe(player2Id);
    });

    it('should not switch turns if game is no longer playing', () => {
      testGame.phase = 'finished';

      turnManager.handleTurnTimeout(testGame, player1Id);

      expect(testGame.currentTurn).toBe(player1Id); // Should not change
    });
  });

  describe('getRemainingTurnTime', () => {
    it('should return remaining turn time', (done) => {
      testGame.metadata.timeouts.turnTimeout = 1000; // 1 second

      turnManager.startTurn(testGame, player1Id);

      setTimeout(() => {
        const remainingTime = turnManager.getRemainingTurnTime(testGame.gameId);
        expect(remainingTime).toBeGreaterThan(0);
        expect(remainingTime).toBeLessThan(1000);
        done();
      }, 100);
    });

    it('should return null when no timeout is set', () => {
      testGame.metadata.timeouts.turnTimeout = 0;

      turnManager.startTurn(testGame, player1Id);

      const remainingTime = turnManager.getRemainingTurnTime(testGame.gameId);
      expect(remainingTime).toBeNull();
    });

    it('should return 0 when time has expired', (done) => {
      testGame.metadata.timeouts.turnTimeout = 50; // 50ms

      turnManager.startTurn(testGame, player1Id);

      setTimeout(() => {
        const remainingTime = turnManager.getRemainingTurnTime(testGame.gameId);
        expect(remainingTime).toBe(0);
        done();
      }, 100);
    });
  });

  describe('isPlayersTurn', () => {
    it('should return true when it is the player\'s turn', () => {
      turnManager.startTurn(testGame, player1Id);

      expect(turnManager.isPlayersTurn(testGame, player1Id)).toBe(true);
      expect(turnManager.isPlayersTurn(testGame, player2Id)).toBe(false);
    });

    it('should return false when game is not in playing phase', () => {
      testGame.phase = 'setup';
      testGame.currentTurn = player1Id;

      expect(turnManager.isPlayersTurn(testGame, player1Id)).toBe(false);
    });
  });

  describe('validateTurnAction', () => {
    beforeEach(() => {
      turnManager.startTurn(testGame, player1Id);
    });

    it('should validate valid turn action', () => {
      const result = turnManager.validateTurnAction(testGame, player1Id, 'attack');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject action when not player\'s turn', () => {
      const result = turnManager.validateTurnAction(testGame, player2Id, 'attack');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Not player\'s turn');
    });

    it('should reject action when game is not in playing phase', () => {
      testGame.phase = 'setup';

      const result = turnManager.validateTurnAction(testGame, player1Id, 'attack');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Game is in setup phase');
    });

    it('should reject action for non-existent player', () => {
      const result = turnManager.validateTurnAction(testGame, 'non-existent', 'attack');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Player not found');
    });

    it('should reject action when turn has timed out', (done) => {
      testGame.metadata.timeouts.turnTimeout = 50; // 50ms

      turnManager.startTurn(testGame, player1Id);

      setTimeout(() => {
        const result = turnManager.validateTurnAction(testGame, player1Id, 'attack');

        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Turn has timed out');
        done();
      }, 100);
    });
  });

  describe('getTurnStatistics', () => {
    beforeEach(() => {
      // Create some turn history
      for (let i = 0; i < 5; i++) {
        const playerId = i % 2 === 0 ? player1Id : player2Id;
        turnManager.startTurn(testGame, playerId);

        setTimeout(() => {
          turnManager.endTurn(testGame, playerId, 'test_action');
        }, 10 * (i + 1));
      }
    });

    it('should calculate turn statistics correctly', (done) => {
      setTimeout(() => {
        const stats = turnManager.getTurnStatistics(testGame);

        expect(stats.totalTurns).toBeGreaterThan(0);
        expect(stats.averageTurnTime).toBeGreaterThan(0);
        expect(stats.longestTurn).toBeGreaterThan(0);
        expect(stats.shortestTurn).toBeGreaterThan(0);
        expect(stats.playerTurnCounts[player1Id]).toBeGreaterThan(0);
        expect(stats.playerTurnCounts[player2Id]).toBeGreaterThan(0);
        done();
      }, 100);
    });

    it('should return zero statistics for empty turn history', () => {
      const emptyGame = createGame(createPlayer('test', 'Test'));
      const stats = turnManager.getTurnStatistics(emptyGame);

      expect(stats.totalTurns).toBe(0);
      expect(stats.averageTurnTime).toBe(0);
      expect(stats.longestTurn).toBe(0);
      expect(stats.shortestTurn).toBe(0);
    });
  });

  describe('getCurrentTurnInfo', () => {
    it('should return current turn information', () => {
      turnManager.startTurn(testGame, player1Id);

      const turnInfo = turnManager.getCurrentTurnInfo(testGame);

      expect(turnInfo.currentPlayer).toBe(player1Id);
      expect(turnInfo.turnNumber).toBe(1);
      expect(turnInfo.turnStartedAt).toBeInstanceOf(Date);
      expect(turnInfo.isTimeout).toBe(false);
    });

    it('should indicate timeout status', (done) => {
      testGame.metadata.timeouts.turnTimeout = 50; // 50ms

      turnManager.startTurn(testGame, player1Id);

      setTimeout(() => {
        const turnInfo = turnManager.getCurrentTurnInfo(testGame);
        expect(turnInfo.isTimeout).toBe(true);
        done();
      }, 100);
    });
  });

  describe('resetTurnState', () => {
    beforeEach(() => {
      turnManager.startTurn(testGame, player1Id);
    });

    it('should reset turn state completely', () => {
      turnManager.resetTurnState(testGame);

      expect(testGame.state.turnInfo.turnNumber).toBe(0);
      expect(testGame.state.turnInfo.turnHistory).toHaveLength(0);
      expect(testGame.currentTurn).toBeNull();
    });
  });

  describe('pauseTurnTimer and resumeTurnTimer', () => {
    it('should pause and resume turn timer', (done) => {
      testGame.metadata.timeouts.turnTimeout = 1000; // 1 second
      const timeoutHandler = jest.fn();

      turnManager.startTurn(testGame, player1Id, timeoutHandler);

      setTimeout(() => {
        turnManager.pauseTurnTimer(testGame.gameId);

        setTimeout(() => {
          turnManager.resumeTurnTimer(testGame, timeoutHandler);

          // Timer should still be running after resume
          const remainingTime = turnManager.getRemainingTurnTime(testGame.gameId);
          expect(remainingTime).toBeGreaterThan(0);
          done();
        }, 100);
      }, 100);
    });
  });

  describe('forceEndTurn', () => {
    beforeEach(() => {
      turnManager.startTurn(testGame, player1Id);
    });

    it('should force end current turn', () => {
      turnManager.forceEndTurn(testGame, 'admin_action');

      expect(testGame.currentTurn).toBeNull();

      const turnEntry = testGame.state.turnInfo.turnHistory[0];
      expect(turnEntry.endedAt).toBeInstanceOf(Date);
      expect(turnEntry.action).toBe('admin_action');
    });
  });

  describe('Memory Management', () => {
    it('should clean up timers on destroy', () => {
      const timeoutHandler = jest.fn();

      turnManager.startTurn(testGame, player1Id, timeoutHandler);

      turnManager.destroy();

      // Timeout should not fire after destroy
      setTimeout(() => {
        expect(timeoutHandler).not.toHaveBeenCalled();
      }, testGame.metadata.timeouts.turnTimeout + 100);
    });

    it('should handle multiple games without memory leaks', () => {
      const games: Game[] = [];
      const timeoutHandler = jest.fn();

      // Create multiple games with timers
      for (let i = 0; i < 10; i++) {
        const hostPlayer = createPlayer(`host-${i}`, `Host${i}`);
        const game = createGame(hostPlayer);
        game.phase = 'playing';
        game.metadata.timeouts.turnTimeout = 1000;

        games.push(game);
        turnManager.startTurn(game, hostPlayer.id, timeoutHandler);
      }

      // Destroy turn manager
      turnManager.destroy();

      // No timeouts should fire
      setTimeout(() => {
        expect(timeoutHandler).not.toHaveBeenCalled();
      }, 1500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid turn switches', () => {
      for (let i = 0; i < 10; i++) {
        const playerId = i % 2 === 0 ? player1Id : player2Id;
        turnManager.startTurn(testGame, playerId);
        turnManager.endTurn(testGame, playerId, 'rapid_action');
      }

      expect(testGame.state.turnInfo.turnNumber).toBe(10);
      expect(testGame.state.turnInfo.turnHistory).toHaveLength(10);
    });

    it('should handle concurrent timeout and manual turn end', (done) => {
      testGame.metadata.timeouts.turnTimeout = 100;
      const timeoutHandler = jest.fn();

      turnManager.startTurn(testGame, player1Id, timeoutHandler);

      // Manually end turn before timeout
      setTimeout(() => {
        turnManager.endTurn(testGame, player1Id, 'manual_end');
      }, 50);

      setTimeout(() => {
        // Timeout handler might or might not be called depending on timing
        // The important thing is that the game state remains consistent
        expect(testGame.state.turnInfo.turnHistory[0].endedAt).toBeDefined();
        done();
      }, 150);
    });
  });
});