import crypto from "node:crypto";

const DEFAULT_ROTATION_GRACE_MS = 60_000;
const DEFAULT_WS_TICKET_TTL_MS = 60_000;

interface GraceTokenEntry {
  token: string;
  expiresAt: number;
}

export interface WsSocketGeneration {
  epochMs: number;
  seq: number;
}

interface WsTicketEntry {
  sessionId: string;
  expiresAt: number;
  used: boolean;
  clientId: string;
  generation: WsSocketGeneration;
}

export interface RotateTokenResult {
  token: string;
  graceExpiresAt: string;
}

export interface WsTicketResult {
  ticket: string;
  expiresAt: string;
  clientId: string;
  generation: WsSocketGeneration;
}

export interface ConsumedWsTicket {
  sessionId: string;
  clientId: string;
  generation: WsSocketGeneration;
}

export class GatewayAuthManager {
  private activeToken: string;
  private readonly graceTokens = new Map<string, GraceTokenEntry>();
  private readonly wsTickets = new Map<string, WsTicketEntry>();

  constructor(token: string) {
    this.activeToken = token.trim();
    if (!this.activeToken) {
      throw new Error("Gateway auth token cannot be empty");
    }
  }

  public getMaskedActiveToken(): string {
    return this.maskToken(this.activeToken);
  }

  public isAuthorized(token: string | null | undefined): boolean {
    if (!token) return false;
    const candidate = token.trim();
    if (!candidate) return false;
    if (candidate === this.activeToken) return true;

    this.cleanupExpired();
    const grace = this.graceTokens.get(candidate);
    return Boolean(grace && grace.expiresAt > Date.now());
  }

  public rotateToken(nextToken?: string, graceMs = DEFAULT_ROTATION_GRACE_MS): RotateTokenResult {
    const previous = this.activeToken;
    const next = (nextToken?.trim() || this.generateToken()).trim();
    if (!next) {
      throw new Error("Rotated token cannot be empty");
    }
    if (next === previous) {
      throw new Error("Rotated token must differ from active token");
    }

    const expiresAt = Date.now() + Math.max(1_000, graceMs);
    this.graceTokens.set(previous, { token: previous, expiresAt });
    this.activeToken = next;
    this.cleanupExpired();

    return {
      token: next,
      graceExpiresAt: new Date(expiresAt).toISOString(),
    };
  }

  public revokeGraceTokens(): void {
    this.graceTokens.clear();
  }

  public issueWsTicket(
    sessionId: string,
    optionsOrTtl: {
      ttlMs?: number;
      clientId?: string;
      generation?: WsSocketGeneration | null;
    } | number = {},
  ): WsTicketResult {
    this.cleanupExpired();
    const ticket = `agt_ws_${crypto.randomBytes(24).toString("base64url")}`;
    const options =
      typeof optionsOrTtl === "number"
        ? { ttlMs: optionsOrTtl }
        : optionsOrTtl;
    const expiresAt = Date.now() + Math.max(1_000, options.ttlMs ?? DEFAULT_WS_TICKET_TTL_MS);
    const clientId = options.clientId?.trim() || `legacy-${crypto.randomBytes(8).toString("hex")}`;
    const generation = this.normalizeGeneration(options.generation);
    this.wsTickets.set(ticket, {
      sessionId,
      expiresAt,
      used: false,
      clientId,
      generation,
    });

    return {
      ticket,
      expiresAt: new Date(expiresAt).toISOString(),
      clientId,
      generation,
    };
  }

  public consumeWsTicket(sessionId: string, ticket: string): ConsumedWsTicket | null {
    this.cleanupExpired();
    const record = this.wsTickets.get(ticket);
    if (!record) return null;
    if (record.used) return null;
    if (record.sessionId !== sessionId) return null;
    if (record.expiresAt <= Date.now()) return null;

    record.used = true;
    this.wsTickets.set(ticket, record);
    return {
      sessionId: record.sessionId,
      clientId: record.clientId,
      generation: record.generation,
    };
  }

  public getTokenState(): { activeMasked: string; graceCount: number } {
    this.cleanupExpired();
    return {
      activeMasked: this.maskToken(this.activeToken),
      graceCount: this.graceTokens.size,
    };
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [token, record] of this.graceTokens.entries()) {
      if (record.expiresAt <= now) {
        this.graceTokens.delete(token);
      }
    }
    for (const [ticket, record] of this.wsTickets.entries()) {
      if (record.expiresAt <= now || record.used) {
        this.wsTickets.delete(ticket);
      }
    }
  }

  private generateToken(): string {
    return `alloy_${crypto.randomBytes(32).toString("base64url")}`;
  }

  private normalizeGeneration(generation?: WsSocketGeneration | null): WsSocketGeneration {
    const epochMs =
      typeof generation?.epochMs === "number" && Number.isFinite(generation.epochMs)
        ? Math.max(0, Math.floor(generation.epochMs))
        : Date.now();
    const seq =
      typeof generation?.seq === "number" && Number.isFinite(generation.seq)
        ? Math.max(0, Math.floor(generation.seq))
        : 0;

    return { epochMs, seq };
  }

  private maskToken(token: string): string {
    if (token.length <= 12) return "********";
    return `${token.slice(0, 6)}...${token.slice(-6)}`;
  }
}