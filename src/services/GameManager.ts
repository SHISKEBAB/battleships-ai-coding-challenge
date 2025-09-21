import { Game, Player, ShipPlacement, AttackResult, Ship } from '../types';
import { createGame, addPlayerToGame, createPlayer, areAllPlayersReady, getOpponentId, getFilteredGameState } from '../models/Game';
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

export class GameManager {
  private games = new Map<string, Game>();
  private pausedGames = new Map<string, { reason: string; pausedAt: Date; pausedByPlayerId?: string }>();
  private cleanupInterval: NodeJS.Timeout;
  private connectionManager?: ConnectionManager;

  constructor(connectionManager?: ConnectionManager) {
    this.connectionManager = connectionManager;
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveGames();
    }, 300000);
  }

  /**
   * Set the connection manager for broadcasting events
   */
  setConnectionManager(connectionManager: ConnectionManager): void {
    this.connectionManager = connectionManager;
  }

  createGame(hostPlayerName: string): Game {
    const hostPlayer = createPlayer(randomUUID(), hostPlayerName);
    const game = createGame(hostPlayer);
    this.games.set(game.gameId, game);

    // Broadcast player joined event
    this.broadcastPlayerJoined(game, hostPlayer);

    return game;
  }

  addPlayer(gameId: string, playerName: string): Game {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    const player = createPlayer(randomUUID(), playerName);
    const updatedGame = addPlayerToGame(game, player);
    this.games.set(gameId, updatedGame);

    // Broadcast player joined event
    this.broadcastPlayerJoined(updatedGame, player);

    return updatedGame;
  }

  placeShips(gameId: string, playerId: string, shipPlacements: ShipPlacement[]): void {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
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

    const validation = validateShipPlacements(shipPlacements);
    if (!validation.valid) {
      throw new Error(`Invalid ship placement: ${validation.errors.join(', ')}`);
    }

    const ships = createShipsFromPlacements(shipPlacements);
    player.ships = ships;
    player.ready = true;

    if (game.phase === 'waiting') {
      game.phase = 'setup';
    }

    const wasAllPlayersReady = areAllPlayersReady(game);

    // Broadcast ships placed event
    this.broadcastShipsPlaced(game, player, wasAllPlayersReady);

    if (wasAllPlayersReady) {
      game.phase = 'playing';
      const playerIds = Object.keys(game.players);
      game.currentTurn = playerIds[Math.floor(Math.random() * playerIds.length)]!;

      // Broadcast game started event
      this.broadcastGameStarted(game);
    }

    game.lastActivity = new Date();
    this.games.set(gameId, game);
  }

  processAttack(gameId: string, attackerId: string, position: string): AttackResult {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    // Check if game is paused
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

    const allShipsSunk = target.ships.every(ship => ship.sunk);
    if (allShipsSunk) {
      game.phase = 'finished';
      game.winner = attackerId;

      // Broadcast game finished event
      this.broadcastGameFinished(game, attackerId, targetId);
    } else {
      game.currentTurn = targetId;
    }

    // Broadcast attack made event
    this.broadcastAttackMade(game, attackerId, targetId, position, result, hitShip);

    game.lastActivity = new Date();
    this.games.set(gameId, game);

    return {
      result,
      position,
      sunkShip: result === 'sunk' ? hitShip : undefined,
      gameState: allShipsSunk ? 'won' : 'playing',
      nextTurn: game.currentTurn!,
    };
  }

  getGame(gameId: string): Game | null {
    return this.games.get(gameId) || null;
  }

  getFilteredGame(gameId: string, playerId: string): any {
    const game = this.getGame(gameId);
    if (!game) {
      return null;
    }
    return getFilteredGameState(game, playerId);
  }

  isPlayersTurn(gameId: string, playerId: string): boolean {
    const game = this.games.get(gameId);
    return game?.currentTurn === playerId;
  }

  deleteGame(gameId: string): void {
    this.games.delete(gameId);
  }

  private cleanupInactiveGames(): void {
    const now = new Date();
    const inactiveThreshold = 2 * 60 * 60 * 1000;

    for (const [gameId, game] of this.games.entries()) {
      if (now.getTime() - game.lastActivity.getTime() > inactiveThreshold) {
        this.games.delete(gameId);
      }
    }
  }

  getActiveGameCount(): number {
    return this.games.size;
  }

  /**
   * Pause a game (typically due to player disconnection)
   */
  pauseGame(gameId: string, reason: 'disconnect' | 'manual', playerId?: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    // Only pause games that are in playing phase and during a player's turn
    if (game.phase === 'playing' && game.currentTurn) {
      this.pausedGames.set(gameId, {
        reason,
        pausedAt: new Date(),
        pausedByPlayerId: playerId
      });

      // Broadcast game paused event
      this.broadcastGamePaused(game, reason, playerId);

      console.log(`Game ${gameId} paused due to ${reason}`, {
        gameId,
        reason,
        playerId,
        currentTurn: game.currentTurn || undefined
      });
    }
  }

  /**
   * Resume a paused game
   */
  resumeGame(gameId: string, playerId?: string): void {
    const game = this.games.get(gameId);
    const pauseInfo = this.pausedGames.get(gameId);

    if (!game) {
      throw new Error('Game not found');
    }

    if (!pauseInfo) {
      throw new Error('Game is not paused');
    }

    // Remove pause state
    this.pausedGames.delete(gameId);

    // Broadcast game resumed event
    this.broadcastGameResumed(game, pauseInfo.reason === 'disconnect' ? 'reconnect' : 'manual');

    console.log(`Game ${gameId} resumed`, {
      gameId,
      resumedBy: playerId,
      pausedFor: Date.now() - pauseInfo.pausedAt.getTime()
    });
  }

  /**
   * Check if a game is paused
   */
  isGamePaused(gameId: string): boolean {
    return this.pausedGames.has(gameId);
  }

  /**
   * Check if a game can be resumed by a specific player
   */
  canResumeGame(gameId: string, playerId: string): boolean {
    const game = this.games.get(gameId);
    const pauseInfo = this.pausedGames.get(gameId);

    if (!game || !pauseInfo) {
      return false;
    }

    // Game can be resumed if:
    // 1. It was paused due to disconnect and the reconnecting player is in the game
    // 2. It was paused manually and any player in the game can resume
    return (
      (pauseInfo.reason === 'disconnect' && !!game.players[playerId]) ||
      (pauseInfo.reason === 'manual' && !!game.players[playerId])
    );
  }

  /**
   * Handle player disconnection - pause game if it's the current player's turn
   */
  handlePlayerDisconnect(gameId: string, playerId: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }

    // Only pause if it's the disconnected player's turn and game is in playing phase
    if (game.phase === 'playing' && game.currentTurn === playerId) {
      this.pauseGame(gameId, 'disconnect', playerId);
    }
  }

  /**
   * Handle player reconnection - resume game if it was paused due to this player's disconnect
   */
  handlePlayerReconnect(gameId: string, playerId: string): void {
    const pauseInfo = this.pausedGames.get(gameId);

    if (pauseInfo && pauseInfo.reason === 'disconnect' && pauseInfo.pausedByPlayerId === playerId) {
      this.resumeGame(gameId, playerId);
    }
  }

  /**
   * Broadcast player joined event
   */
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

  /**
   * Broadcast ships placed event
   */
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

  /**
   * Broadcast game started event
   */
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

  /**
   * Broadcast attack made event
   */
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

  /**
   * Broadcast game finished event
   */
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

  /**
   * Broadcast game paused event
   */
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

  /**
   * Broadcast game resumed event
   */
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

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.games.clear();
    this.pausedGames.clear();
  }
}