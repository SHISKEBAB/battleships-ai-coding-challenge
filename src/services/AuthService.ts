import { randomUUID } from 'crypto';
import { PlayerToken } from '../types';

export class AuthService {
  private tokenStore = new Map<string, PlayerToken>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60000);
  }

  generatePlayerToken(gameId: string, playerId: string, playerName: string): string {
    const token = randomUUID();
    const expiryHours = parseInt(process.env.TOKEN_EXPIRY_HOURS || '2');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);

    const playerToken: PlayerToken = {
      gameId,
      playerId,
      playerName,
      issuedAt: now,
      expiresAt,
    };

    this.tokenStore.set(token, playerToken);
    return token;
  }

  validateToken(token: string): PlayerToken | null {
    const playerToken = this.tokenStore.get(token);

    if (!playerToken) {
      return null;
    }

    if (new Date() > playerToken.expiresAt) {
      this.tokenStore.delete(token);
      return null;
    }

    return playerToken;
  }

  revokeGameTokens(gameId: string): void {
    for (const [token, playerToken] of this.tokenStore.entries()) {
      if (playerToken.gameId === gameId) {
        this.tokenStore.delete(token);
      }
    }
  }

  revokeToken(token: string): void {
    this.tokenStore.delete(token);
  }

  private cleanupExpiredTokens(): void {
    const now = new Date();
    for (const [token, playerToken] of this.tokenStore.entries()) {
      if (now > playerToken.expiresAt) {
        this.tokenStore.delete(token);
      }
    }
  }

  getActiveTokenCount(): number {
    return this.tokenStore.size;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.tokenStore.clear();
  }
}