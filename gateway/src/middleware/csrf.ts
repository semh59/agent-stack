import crypto from 'node:crypto';
import { createLogger } from '../plugin/logger';

const log = createLogger('csrf');

/**
 * CSRF Token Configuration
 */
const CONFIG = {
  TOKEN_TTL_MS: 60 * 60 * 1000, // 1 hour
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  HMAC_ALGORITHM: 'sha256',
  MAX_TOKENS: 5000, // Prevent OOM from many sessions
};

/**
 * Stored CSRF token metadata
 */
interface StoredToken {
  token: string;
  createdAt: number;
  isValid: boolean;
  sessionId: string;
}

/**
 * CSRF Token Manager
 *
 * Generates and validates CSRF tokens using HMAC.
 * - Tokens are one-time use (consumed after validation)
 * - Tokens expire after 1 hour
 * - Session binding to prevent token reuse across sessions
 */
export class CSRFTokenManager {
  private tokens = new Map<string, StoredToken>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private secret: string;

  constructor(secret?: string) {
    // Use provided secret or generate from environment
    this.secret = secret || process.env.CSRF_SECRET || 'default-csrf-secret-change-in-production';

    if (!secret && process.env.NODE_ENV === 'production') {
      log.warn('CSRF_SECRET not configured in production environment');
    }

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Generate a new CSRF token bound to a session
   */
  generateToken(sessionId: string): string {
    // Generate random token
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('hex');

    // Create HMAC of token with session ID
    const hmac = crypto
      .createHmac(CONFIG.HMAC_ALGORITHM, this.secret)
      .update(`${token}:${sessionId}`)
      .digest('hex');

    // Evict oldest tokens if we hit the cap
    if (this.tokens.size >= CONFIG.MAX_TOKENS) {
      log.warn('CSRF token cap reached, evicting oldest token');
      const oldestKey = this.tokens.keys().next().value;
      if (oldestKey) this.tokens.delete(oldestKey);
    }

    // Store token metadata
    const now = Date.now();
    this.tokens.set(hmac, {
      token,
      sessionId,
      createdAt: now,
      isValid: true,
    });

    log.debug('Generated CSRF token', { sessionId: sessionId.slice(0, 8) + '...' });

    return hmac;
  }

  /**
   * Validate CSRF token bound to session
   *
   * Returns true if:
   * - Token exists
   * - Token has not expired
   * - Token has not been consumed
   * - Token matches session ID
   */
  validateToken(sessionId: string, token: string): boolean {
    const stored = this.tokens.get(token);

    if (!stored) {
      log.warn('CSRF token not found', { sessionId: sessionId.slice(0, 8) + '...' });
      return false;
    }

    if (!stored.isValid) {
      log.warn('CSRF token already consumed', { sessionId: sessionId.slice(0, 8) + '...' });
      this.tokens.delete(token);
      return false;
    }

    // Check expiration
    if (Date.now() - stored.createdAt > CONFIG.TOKEN_TTL_MS) {
      log.warn('CSRF token expired', { sessionId: sessionId.slice(0, 8) + '...' });
      this.tokens.delete(token);
      return false;
    }

    // Verify session binding
    if (stored.sessionId !== sessionId) {
      log.warn('CSRF token session mismatch (potential attack)', {
        expectedSession: stored.sessionId.slice(0, 8) + '...',
        receivedSession: sessionId.slice(0, 8) + '...',
      });
      this.tokens.delete(token);
      return false;
    }

    // Verify HMAC integrity
    const hmac = crypto
      .createHmac(CONFIG.HMAC_ALGORITHM, this.secret)
      .update(`${stored.token}:${sessionId}`)
      .digest('hex');

    if (hmac !== token) {
      log.error('CSRF token HMAC verification failed (potential tampering)');
      this.tokens.delete(token);
      return false;
    }

    // Mark as consumed (one-time use)
    stored.isValid = false;
    this.tokens.delete(token);

    log.debug('CSRF token validated', { sessionId: sessionId.slice(0, 8) + '...' });
    return true;
  }

  /**
   * Start periodic cleanup of expired tokens
   */
  private startCleanupTimer(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, CONFIG.CLEANUP_INTERVAL_MS);

    // Allow process to exit even with cleanup timer running
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }

    log.debug('Started CSRF token cleanup timer');
  }

  /**
   * Remove expired tokens from memory
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.tokens) {
      if (now - value.createdAt > CONFIG.TOKEN_TTL_MS) {
        this.tokens.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug('Cleaned expired CSRF tokens', { count: cleaned });
    }
  }

  /**
   * Get count of active tokens (for monitoring)
   */
  getTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Shutdown manager and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.tokens.clear();
    log.debug('CSRF token manager shut down');
  }
}

/**
 * Global CSRF token manager instance
 */
export const csrfTokenManager = new CSRFTokenManager();

/**
 * Express middleware for CSRF protection
 *
 * Usage:
 * - GET requests: Generate and return token in X-CSRF-Token header
 * - POST/PUT/DELETE: Validate token from X-CSRF-Token header
 */
export function csrfProtection(req: any, res: any, next: () => void): void {
  const sessionId = req.sessionID || req.id || 'anonymous';

  if (req.method === 'GET') {
    // Generate new token for GET requests
    const token = csrfTokenManager.generateToken(sessionId);
    res.set('X-CSRF-Token', token);
    return next();
  }

  // For POST/PUT/DELETE, validate token
  const token = req.get('X-CSRF-Token');

  if (!token) {
    log.warn('CSRF token missing', { method: req.method, path: req.path });
    return res.status(403).json({
      error: 'csrf_token_missing',
      message: 'CSRF token is required for this request',
    });
  }

  if (!csrfTokenManager.validateToken(sessionId, token)) {
    log.warn('CSRF token validation failed', { method: req.method, path: req.path });
    return res.status(403).json({
      error: 'csrf_validation_failed',
      message: 'CSRF token is invalid or expired',
    });
  }

  // Token is valid, proceed
  next();
}

/**
 * Middleware factory for selective CSRF protection
 *
 * Usage:
 * app.use(csrfProtectionIf((req) => !req.path.startsWith('/health')))
 */
export function csrfProtectionIf(shouldProtect: (req: any) => boolean) {
  return (req: any, res: any, next: () => void) => {
    if (!shouldProtect(req)) {
      return next();
    }
    csrfProtection(req, res, next);
  };
}

/**
 * Helper to exempt certain routes from CSRF protection
 */
export function skipCsrf(
  paths: string[],
  methods: string[] = ['GET']
): (req: any) => boolean {
  return (req: any) => {
    const shouldSkip =
      paths.some(p => req.path.startsWith(p)) &&
      methods.includes(req.method);

    return !shouldSkip;
  };
}
