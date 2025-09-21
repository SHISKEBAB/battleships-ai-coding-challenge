import { Game, Player, ShipPlacement, AttackResult, Ship } from '../types';
import { createGame, addPlayerToGame, createPlayer, areAllPlayersReady, getOpponentId, getFilteredGameState } from '../models/Game';
import { validateShipPlacements, createShipsFromPlacements } from '../utils/shipValidation';
import { parsePosition } from '../utils/coordinates';
import { randomUUID } from 'crypto';

export class GameManager {
  private games = new Map<string, Game>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveGames();
    }, 300000);
  }

  createGame(hostPlayerName: string): Game {
    const hostPlayer = createPlayer(randomUUID(), hostPlayerName);
    const game = createGame(hostPlayer);
    this.games.set(game.gameId, game);
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

    if (areAllPlayersReady(game)) {
      game.phase = 'playing';
      const playerIds = Object.keys(game.players);
      game.currentTurn = playerIds[Math.floor(Math.random() * playerIds.length)]!;
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
    } else {
      game.currentTurn = targetId;
    }

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

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.games.clear();
  }
}