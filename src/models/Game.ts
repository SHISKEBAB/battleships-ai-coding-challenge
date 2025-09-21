import { Game, Player, GameBoard, Ship } from '../types';
import { randomUUID } from 'crypto';

export function createGame(hostPlayer: Omit<Player, 'board' | 'ships'>): Game {
  const gameId = randomUUID();

  const player: Player = {
    ...hostPlayer,
    ready: false,
    board: createGameBoard(),
    ships: [],
  };

  return {
    gameId,
    phase: 'waiting',
    players: {
      [hostPlayer.id]: player,
    },
    currentTurn: null,
    winner: null,
    createdAt: new Date(),
    lastActivity: new Date(),
  };
}

export function createGameBoard(size: number = 10): GameBoard {
  return {
    size,
    hits: new Set<string>(),
    misses: new Set<string>(),
  };
}

export function createPlayer(id: string, name: string): Omit<Player, 'board' | 'ships'> {
  return {
    id,
    name,
    ready: false,
  };
}

export function addPlayerToGame(game: Game, player: Omit<Player, 'board' | 'ships'>): Game {
  if (Object.keys(game.players).length >= 2) {
    throw new Error('Game is full');
  }

  if (game.phase !== 'waiting') {
    throw new Error('Cannot join game in current phase');
  }

  const fullPlayer: Player = {
    ...player,
    ready: false,
    board: createGameBoard(),
    ships: [],
  };

  return {
    ...game,
    players: {
      ...game.players,
      [player.id]: fullPlayer,
    },
    lastActivity: new Date(),
  };
}

export function isGameFull(game: Game): boolean {
  return Object.keys(game.players).length >= 2;
}

export function areAllPlayersReady(game: Game): boolean {
  const players = Object.values(game.players);
  return players.length === 2 && players.every(player => player.ready);
}

export function getOpponentId(game: Game, playerId: string): string | null {
  const playerIds = Object.keys(game.players);
  const opponentId = playerIds.find(id => id !== playerId);
  return opponentId || null;
}

export function getFilteredGameState(game: Game, playerId: string): any {
  const opponent = getOpponentId(game, playerId);

  return {
    gameId: game.gameId,
    phase: game.phase,
    currentTurn: game.currentTurn,
    winner: game.winner,
    player: game.players[playerId],
    opponent: opponent ? {
      id: opponent,
      name: game.players[opponent]?.name,
      ready: game.players[opponent]?.ready,
      shipsPlaced: game.players[opponent]?.ships.length > 0,
      board: {
        size: game.players[opponent]?.board.size,
        hits: Array.from(game.players[opponent]?.board.hits || []),
        misses: Array.from(game.players[opponent]?.board.misses || []),
      },
    } : null,
  };
}