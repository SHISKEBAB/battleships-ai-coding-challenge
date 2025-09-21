import { Router, Request, Response, NextFunction } from 'express';
import { GameManager } from '../services/GameManager';
import { AuthService } from '../services/AuthService';
import { ConnectionManager } from '../services/ConnectionManager';
import { AuthMiddleware } from '../middleware/auth';
import {
  validateCreateGameRequest,
  validateJoinGameRequest,
  validateGameId,
  validatePlaceShipsRequest,
  validateAttackRequest,
  validateAuthHeader,
  addCorrelationId
} from '../middleware/validation';
import { asyncErrorHandler } from '../middleware/errorHandler';
import { CreateGameRequest, CreateGameResponse, JoinGameRequest, PlaceShipsRequest, AttackRequest, AttackResult, ErrorResponse } from '../types';
import {
  ErrorFactory,
  ValidationError,
  ConflictError,
  NotFoundError,
  GameValidationError,
  GameStateError,
  TurnValidationError,
  ShipPlacementError
} from '../utils/errors';

// Custom error factories are now in utils/errors.ts

export function createGameRoutes(
  gameManager: GameManager,
  authService: AuthService,
  connectionManager: ConnectionManager
): Router {
  const router = Router();
  const authMiddleware = new AuthMiddleware(authService);

  // GET /api/games/:gameId/events - SSE endpoint for real-time events
  router.get(
    '/:gameId/events',
    addCorrelationId,
    validateGameId,
    validateAuthHeader,
    authMiddleware.authenticatePlayer,
    authMiddleware.requireGameAccess,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId } = req.params;
      const playerId = req.player!.playerId;
      const playerName = req.player!.playerName;
      const reconnectionToken = req.query.reconnectionToken as string;

      // Validate game exists
      const game = gameManager.getGame(gameId);
      if (!game) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      // Validate player is in the game
      const player = game.players[playerId];
      if (!player) {
        throw ErrorFactory.playerNotFound(playerId, gameId, correlationId);
      }

      // Set up SSE connection (with optional reconnection token)
      const { sessionId, isReconnection } = connectionManager.addConnection(gameId, playerId, playerName, res, reconnectionToken);

      // Log the connection type
      if (isReconnection) {
        console.log('Player reconnected via SSE', {
          service: 'GameRoutes',
          action: 'player_reconnected',
          gameId,
          playerId,
          sessionId,
          correlationId
        });
      }

      // The response is now handled by ConnectionManager
      // No need to call res.json() or res.end() here
    })
  );

  // POST /api/games - Create new game
  router.post(
    '/',
    addCorrelationId,
    validateCreateGameRequest,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { playerName } = req.body as CreateGameRequest;

      // Create the game
      const game = gameManager.createGame(playerName);

      // Get the host player (first player in the game)
      const hostPlayerId = Object.keys(game.players)[0];
      if (!hostPlayerId) {
        throw new GameValidationError(
          'Failed to create game - no host player found',
          'game_creation',
          'game_phase',
          correlationId
        );
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
    })
  );

  // POST /api/games/:gameId/join - Join existing game
  router.post(
    '/:gameId/join',
    addCorrelationId,
    validateGameId,
    validateJoinGameRequest,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId } = req.params;
      const { playerName } = req.body as JoinGameRequest;

      // Check if game exists
      const existingGame = gameManager.getGame(gameId);
      if (!existingGame) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      // Check if game is in a joinable state
      if (existingGame.phase !== 'waiting') {
        throw ErrorFactory.invalidGamePhase(
          existingGame.phase,
          'waiting',
          gameId,
          correlationId
        );
      }

      // Check if game is full (battleships is 2-player)
      const playerCount = Object.keys(existingGame.players).length;
      if (playerCount >= 2) {
        throw ErrorFactory.gameFull(gameId, correlationId);
      }

      // Check if player name is already taken in this game
      const existingPlayerNames = Object.values(existingGame.players).map(p => p.name.toLowerCase());
      if (existingPlayerNames.includes(playerName.toLowerCase())) {
        throw ErrorFactory.duplicatePlayerName(playerName, gameId, correlationId);
      }

      // Add player to the game
      const updatedGame = gameManager.addPlayer(gameId, playerName);

      // Get the new player's ID (the one that was just added)
      const newPlayerId = Object.keys(updatedGame.players).find(id =>
        updatedGame.players[id]?.name === playerName
      );

      if (!newPlayerId) {
        throw new GameValidationError(
          'Failed to add player to game',
          'player_addition',
          'game_phase',
          correlationId
        );
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
    })
  );

  // GET /api/games/:gameId - Get game state (filtered by player)
  router.get(
    '/:gameId',
    addCorrelationId,
    validateGameId,
    validateAuthHeader,
    authMiddleware.authenticatePlayer,
    authMiddleware.requireGameAccess,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId } = req.params;
      const playerId = req.player!.playerId;

      // Get filtered game state for the requesting player
      const gameState = gameManager.getFilteredGame(gameId, playerId);

      if (!gameState) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      res.status(200).json({
        gameId,
        gameState
      });
    })
  );

  // POST /api/games/:gameId/ships - Place ships
  router.post(
    '/:gameId/ships',
    addCorrelationId,
    validateGameId,
    validatePlaceShipsRequest,
    validateAuthHeader,
    authMiddleware.authenticatePlayer,
    authMiddleware.requireGameAccess,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId } = req.params;
      const { ships } = req.body as PlaceShipsRequest;
      const playerId = req.player!.playerId;

      // Check if game exists
      const game = gameManager.getGame(gameId);
      if (!game) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      // Check if game is in correct phase for ship placement
      if (game.phase !== 'waiting' && game.phase !== 'setup') {
        throw ErrorFactory.invalidGamePhase(
          game.phase,
          ['waiting', 'setup'],
          gameId,
          correlationId
        );
      }

      // Check if player exists in game
      const player = game.players[playerId];
      if (!player) {
        throw ErrorFactory.playerNotFound(playerId, gameId, correlationId);
      }

      // Check if player has already placed ships
      if (player.ships.length > 0) {
        throw ErrorFactory.shipsAlreadyPlaced(playerId, gameId, correlationId);
      }

      // Place ships using GameManager (this will throw appropriate errors if validation fails)
      try {
        gameManager.placeShips(gameId, playerId, ships);
      } catch (error) {
        // Convert GameManager errors to proper error types
        if (error instanceof Error) {
          throw new ShipPlacementError(
            error.message,
            undefined,
            undefined,
            'ship_placement_validation',
            correlationId
          );
        }
        throw error;
      }

      // Get updated filtered game state
      const gameState = gameManager.getFilteredGame(gameId, playerId);

      res.status(200).json({
        success: true,
        message: 'Ships placed successfully',
        gameState
      });
    })
  );

  // POST /api/games/:gameId/attacks - Make attack
  router.post(
    '/:gameId/attacks',
    addCorrelationId,
    validateGameId,
    validateAttackRequest,
    validateAuthHeader,
    authMiddleware.authenticatePlayer,
    authMiddleware.requireGameAccess,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId } = req.params;
      const { position } = req.body as AttackRequest;
      const playerId = req.player!.playerId;

      // Check if game exists
      const game = gameManager.getGame(gameId);
      if (!game) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      // Check if game is in playing phase
      if (game.phase !== 'playing') {
        throw ErrorFactory.invalidGamePhase(
          game.phase,
          'playing',
          gameId,
          correlationId
        );
      }

      // Check if it's the player's turn
      if (game.currentTurn !== playerId) {
        throw ErrorFactory.notYourTurn(
          game.currentTurn || 'unknown',
          playerId,
          gameId,
          correlationId
        );
      }

      // Process attack using GameManager
      let attackResult: AttackResult;
      try {
        attackResult = gameManager.processAttack(gameId, playerId, position);
      } catch (error) {
        // Convert GameManager errors to proper error types
        if (error instanceof Error) {
          throw new GameValidationError(
            error.message,
            'attack_validation',
            'attack_position',
            correlationId
          );
        }
        throw error;
      }

      // Get updated filtered game state
      const gameState = gameManager.getFilteredGame(gameId, playerId);

      res.status(200).json({
        success: true,
        attack: attackResult,
        gameState
      });
    })
  );

  // GET /api/games/:gameId/reconnect/:playerId - Get reconnection info
  router.get(
    '/:gameId/reconnect/:playerId',
    addCorrelationId,
    validateGameId,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId, playerId } = req.params;

      // Validate game exists
      const game = gameManager.getGame(gameId);
      if (!game) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      // Validate player is in the game
      const player = game.players[playerId];
      if (!player) {
        throw ErrorFactory.playerNotFound(playerId, gameId, correlationId);
      }

      // Check if reconnection is available
      const reconnectionToken = connectionManager.getReconnectionToken(gameId, playerId);
      const disconnectedPlayers = connectionManager.getDisconnectedPlayers(gameId);
      const playerDisconnectedSession = disconnectedPlayers.find(session => session.playerId === playerId);

      if (!reconnectionToken || !playerDisconnectedSession) {
        res.status(404).json({
          error: 'No reconnection available',
          message: 'Player is not disconnected or reconnection has expired',
          correlationId
        });
        return;
      }

      res.status(200).json({
        gameId,
        playerId,
        playerName: player.name,
        reconnectionToken,
        sessionId: playerDisconnectedSession.sessionId,
        disconnectedAt: playerDisconnectedSession.disconnectedAt.toISOString(),
        expiresAt: playerDisconnectedSession.expiresAt.toISOString(),
        gameState: gameManager.getFilteredGame(gameId, playerId)
      });
    })
  );

  // POST /api/games/:gameId/reconnect - Reconnect to a game
  router.post(
    '/:gameId/reconnect',
    addCorrelationId,
    validateGameId,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId } = req.params;
      const { playerId, reconnectionToken } = req.body;

      if (!playerId || !reconnectionToken) {
        throw new ValidationError(
          'Missing required fields: playerId and reconnectionToken',
          'request_validation',
          ['missing_fields'],
          correlationId
        );
      }

      // Validate game exists
      const game = gameManager.getGame(gameId);
      if (!game) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      // Validate player is in the game
      const player = game.players[playerId];
      if (!player) {
        throw ErrorFactory.playerNotFound(playerId, gameId, correlationId);
      }

      // Validate reconnection token
      if (!connectionManager.canPlayerReconnect(gameId, playerId, reconnectionToken)) {
        throw new ValidationError(
          'Invalid or expired reconnection token',
          'reconnection_validation',
          ['invalid_token'],
          correlationId
        );
      }

      // Generate new auth token for the reconnecting player
      const playerToken = authService.generatePlayerToken(
        gameId,
        playerId,
        player.name
      );

      // Get current game state
      const gameState = gameManager.getFilteredGame(gameId, playerId);

      // Check if game was paused and can be resumed
      const canResumeGame = gameManager.canResumeGame(gameId, playerId);
      if (canResumeGame) {
        gameManager.resumeGame(gameId, playerId);
      }

      res.status(200).json({
        success: true,
        message: 'Reconnection successful',
        gameId,
        playerId,
        playerToken,
        reconnectionToken,
        gameState,
        gameResumed: canResumeGame
      });
    })
  );

  // GET /api/games/:gameId/disconnected - Get list of disconnected players
  router.get(
    '/:gameId/disconnected',
    addCorrelationId,
    validateGameId,
    validateAuthHeader,
    authMiddleware.authenticatePlayer,
    authMiddleware.requireGameAccess,
    asyncErrorHandler(async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.headers['x-correlation-id'] as string;
      const { gameId } = req.params;

      // Validate game exists
      const game = gameManager.getGame(gameId);
      if (!game) {
        throw ErrorFactory.gameNotFound(gameId, correlationId);
      }

      const disconnectedPlayers = connectionManager.getDisconnectedPlayers(gameId);
      const connectedPlayers = connectionManager.getConnectedPlayers(gameId);

      res.status(200).json({
        gameId,
        connectedPlayers,
        disconnectedPlayers: disconnectedPlayers.map(session => ({
          playerId: session.playerId,
          playerName: session.playerName,
          sessionId: session.sessionId,
          disconnectedAt: session.disconnectedAt.toISOString(),
          expiresAt: session.expiresAt.toISOString()
        })),
        isPaused: gameManager.isGamePaused(gameId)
      });
    })
  );

  return router;
}