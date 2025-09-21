import { Game, Player, GameBoard, Ship, GameMetadata, GameState, GameStatistics } from '../types';
import { randomUUID } from 'crypto';

export function createGame(hostPlayer: Omit<Player, 'board' | 'ships'>): Game {
  const gameId = randomUUID();
  const now = new Date();

  const player: Player = {
    ...hostPlayer,
    ready: false,
    board: createGameBoard(),
    ships: [],
  };

  const metadata: GameMetadata = {
    version: '1.0.0',
    rules: {
      boardSize: 10,
      shipTypes: [
        { name: 'Carrier', length: 5, count: 1 },
        { name: 'Battleship', length: 4, count: 1 },
        { name: 'Cruiser', length: 3, count: 1 },
        { name: 'Submarine', length: 3, count: 1 },
        { name: 'Destroyer', length: 2, count: 1 }
      ],
      maxPlayers: 2,
      turnTimeLimit: 60000,
      allowAdjacent: false,
      allowTouchingShips: false
    },
    settings: {
      isPrivate: false,
      allowSpectators: false,
      autoStart: true,
      pauseOnDisconnect: true,
      recordHistory: true
    },
    hostPlayerId: hostPlayer.id,
    timeouts: {
      inactivityTimeout: 1800000,
      turnTimeout: 60000,
      setupTimeout: 600000,
      reconnectGracePeriod: 300000
    },
    tags: []
  };

  const gameState: GameState = {
    isValid: true,
    integrity: {
      checksum: '',
      lastValidated: now,
      validationErrors: []
    },
    turnInfo: {
      turnNumber: 0,
      turnStartedAt: now,
      turnHistory: []
    },
    phaseTransitions: [{
      fromPhase: 'waiting',
      toPhase: 'waiting',
      transitionedAt: now,
      triggeredBy: hostPlayer.id,
      reason: 'Game created'
    }]
  };

  const statistics: GameStatistics = {
    totalTurns: 0,
    totalShots: 0,
    totalHits: 0,
    totalMisses: 0,
    averageTurnTime: 0,
    longestTurn: 0,
    playerStats: {}
  };

  return {
    gameId,
    phase: 'waiting',
    players: {
      [hostPlayer.id]: player,
    },
    currentTurn: null,
    winner: null,
    createdAt: now,
    lastActivity: now,
    metadata,
    state: gameState,
    history: [],
    statistics
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

  const now = new Date();

  // Initialize player statistics
  game.statistics.playerStats[player.id] = {
    shotsAttempted: 0,
    shotsHit: 0,
    shotsMissed: 0,
    shipsDestroyed: 0,
    accuracyRate: 0,
    averageResponseTime: 0,
    totalTimeSpent: 0,
    longestTurnTime: 0
  };

  // Record player join in history
  game.history.push({
    id: randomUUID(),
    timestamp: now,
    type: 'player_joined',
    playerId: player.id,
    data: {
      playerId: player.id,
      playerName: player.name,
      playerCount: Object.keys(game.players).length + 1
    },
    phase: game.phase
  });

  return {
    ...game,
    players: {
      ...game.players,
      [player.id]: fullPlayer,
    },
    lastActivity: now,
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