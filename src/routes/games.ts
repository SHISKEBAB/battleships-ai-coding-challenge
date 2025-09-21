import { Router, Request, Response, NextFunction } from 'express';
import { GameManager } from '../services/GameManager';
import { AuthService } from '../services/AuthService';
import { AuthMiddleware } from '../middleware/auth';
import { validateCreateGameRequest, validateJoinGameRequest, validateGameId } from '../middleware/validation';
import { CreateGameRequest, CreateGameResponse, JoinGameRequest, ErrorResponse } from '../types';

interface NotFoundError extends Error {
  name: 'NotFoundError';
}

interface ConflictError extends Error {
  name: 'ConflictError';
}

function createNotFoundError(message: string): NotFoundError {
  const error = new Error(message) as NotFoundError;
  error.name = 'NotFoundError';
  return error;
}

function createConflictError(message: string): ConflictError {
  const error = new Error(message) as ConflictError;
  error.name = 'ConflictError';
  return error;
}

export function createGameRoutes(
  gameManager: GameManager,
  authService: AuthService
): Router {
  const router = Router();
  const authMiddleware = new AuthMiddleware(authService);

  // POST /api/games - Create new game
  router.post(
    '/',
    validateCreateGameRequest,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { playerName } = req.body as CreateGameRequest;

        // Create the game
        const game = gameManager.createGame(playerName);

        // Get the host player (first player in the game)
        const hostPlayerId = Object.keys(game.players)[0];
        if (!hostPlayerId) {
          throw new Error('Failed to create game - no host player found');
        }

        // Generate token for the host player
        const playerToken = authService.generatePlayerToken(
          game.gameId,
          hostPlayerId,
          playerName
        );

        // Get filtered game state for the host player
        const gameState = gameManager.getFilteredGame(game.gameId, hostPlayerId);

        const response: CreateGameResponse = {
          gameId: game.gameId,
          playerToken,
          playerId: hostPlayerId,
          gameState
        };

        res.status(201).json(response);
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/games/:gameId/join - Join existing game
  router.post(
    '/:gameId/join',
    validateGameId,
    validateJoinGameRequest,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { gameId } = req.params;
        const { playerName } = req.body as JoinGameRequest;

        // Check if game exists
        const existingGame = gameManager.getGame(gameId);
        if (!existingGame) {
          throw createNotFoundError('Game not found');
        }

        // Check if game is in a joinable state
        if (existingGame.phase !== 'waiting') {
          throw createConflictError('Game has already started or finished');
        }

        // Check if game is full (battleships is 2-player)
        const playerCount = Object.keys(existingGame.players).length;
        if (playerCount >= 2) {
          throw createConflictError('Game is full');
        }

        // Check if player name is already taken in this game
        const existingPlayerNames = Object.values(existingGame.players).map(p => p.name.toLowerCase());
        if (existingPlayerNames.includes(playerName.toLowerCase())) {
          throw createConflictError('Player name already taken in this game');
        }

        // Add player to the game
        const updatedGame = gameManager.addPlayer(gameId, playerName);

        // Get the new player's ID (the one that was just added)
        const newPlayerId = Object.keys(updatedGame.players).find(id =>
          updatedGame.players[id]?.name === playerName
        );

        if (!newPlayerId) {
          throw new Error('Failed to add player to game');
        }

        // Generate token for the new player
        const playerToken = authService.generatePlayerToken(
          gameId,
          newPlayerId,
          playerName
        );

        // Get filtered game state for the new player
        const gameState = gameManager.getFilteredGame(gameId, newPlayerId);

        const response: CreateGameResponse = {
          gameId,
          playerToken,
          playerId: newPlayerId,
          gameState
        };

        res.status(200).json(response);
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /api/games/:gameId - Get game state (filtered by player)
  router.get(
    '/:gameId',
    validateGameId,
    authMiddleware.authenticatePlayer,
    authMiddleware.requireGameAccess,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { gameId } = req.params;
        const playerId = req.player!.playerId;

        // Get filtered game state for the requesting player
        const gameState = gameManager.getFilteredGame(gameId, playerId);

        if (!gameState) {
          throw createNotFoundError('Game not found');
        }

        res.status(200).json({
          gameId,
          gameState
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}