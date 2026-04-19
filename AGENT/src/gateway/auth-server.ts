import * as http from "node:http";
import { URL } from "node:url";
import { exchangeAntigravity } from "../antigravity/oauth";
import { ANTIGRAVITY_REDIRECT_URI } from "../constants";
import { TokenStore, type StoredToken } from "./token-store";

export interface AuthServerOptions {
  port?: number;
  timeoutMs?: number;
  tokenStore?: TokenStore;
  expectedState?: string;
}

// Track server listening state for test synchronization
interface ServerState {
  listening: boolean;
  listeningResolve?: () => void;
  listeningPromise?: Promise<void>;
}

export type AuthErrorCode =
  | "NONE"
  | "OAUTH_TIMEOUT"
  | "OAUTH_PROVIDER_ERROR"
  | "MISSING_CODE_OR_STATE"
  | "OAUTH_STATE_MISMATCH"
  | "TOKEN_EXCHANGE_FAILED"
  | "TOKEN_EXCHANGE_EXCEPTION"
  | "PORT_IN_USE";

export interface AuthResult {
  success: boolean;
  token?: StoredToken;
  error: string | null;
  errorCode: AuthErrorCode;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><title>Giris Basarili</title></head>
<body>
  <h1>Giris Basarili</h1>
  <p>Google Antigravity hesabi baglandi. Bu pencereyi kapatabilirsiniz.</p>
</body>
</html>`;

const errorHtml = (message: string): string => `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><title>Giris Hatasi</title></head>
<body>
  <h1>Giris Hatasi</h1>
  <p>OAuth token exchange basarisiz oldu.</p>
  <code>${message}</code>
</body>
</html>`;

export class AuthServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly tokenStore: TokenStore;
  private readonly expectedState: string | null;
  private serverState: ServerState;

  constructor(options: AuthServerOptions = {}) {
    const redirectUrl = new URL(ANTIGRAVITY_REDIRECT_URI);
    this.port = options.port ?? (parseInt(redirectUrl.port, 10) || 51121);
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000; // 5'ten 10 dakikaya cikarildi
    this.tokenStore = options.tokenStore ?? new TokenStore();
    this.expectedState = options.expectedState ?? null;

    // Initialize listening state
    this.serverState = {
      listening: false,
    };

    // Create the listening promise
    this.serverState.listeningPromise = new Promise((resolve) => {
      this.serverState.listeningResolve = resolve;
    });
  }

  start(): Promise<AuthResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        console.error(`[AuthServer] OAuth giris zaman asimina ugradi (${this.timeoutMs / 60000} dakika).`);
        resolve({
          success: false,
          error: `OAuth giris zaman asimina ugradi (${this.timeoutMs / 60000} dakika). Tekrar deneyin.`,
          errorCode: "OAUTH_TIMEOUT",
        });
      }, this.timeoutMs);

      this.server = http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url || "/", `http://localhost:${this.port}`);
        console.log(`[AuthServer] Gelen istek: ${req.method} ${requestUrl.pathname}${requestUrl.search}`);
        console.log(`[AuthServer] Beklenen State: ${this.expectedState || "yok"}`);
        if (requestUrl.pathname === "/health") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
          return;
        }

        const isCallback = requestUrl.pathname === "/oauth-callback" || (requestUrl.pathname === "/" && requestUrl.searchParams.has("code"));
        
        if (!isCallback) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }

        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        const providerError = requestUrl.searchParams.get("error");

        if (providerError) {
          const errorDesc = requestUrl.searchParams.get("error_description") || providerError;
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(errorHtml(errorDesc));
          clearTimeout(timeout);
          this.stop();
          resolve({
            success: false,
            error: errorDesc,
            errorCode: "OAUTH_PROVIDER_ERROR",
          });
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(errorHtml("Eksik authorization code veya state parametresi."));
          clearTimeout(timeout);
          this.stop();
          resolve({
            success: false,
            error: "Missing code or state parameter",
            errorCode: "MISSING_CODE_OR_STATE",
          });
          return;
        }

        if (this.expectedState && state !== this.expectedState) {
          console.error(`[AuthServer] CSRF check failed! Expected ${this.expectedState}, got ${state}`);
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(errorHtml("Gecersiz veya eksik OAuth state (CSRF dogrulamasi basarisiz)."));
          clearTimeout(timeout);
          this.stop();
          resolve({
            success: false,
            error: "Invalid OAuth state (CSRF failure)",
            errorCode: "OAUTH_STATE_MISMATCH",
          });
          return;
        }

        try {
          console.log(`[AuthServer] Token exchange baslatiliyor... (state: ${state.slice(0, 8)}...)`);
          const result = await exchangeAntigravity(code, state);

          if (result.type === "failed") {
            console.error("[AuthServer] Token exchange failed:", result.error);
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(errorHtml(result.error));
            clearTimeout(timeout);
            this.stop();
            resolve({
              success: false,
              error: result.error,
              errorCode: "TOKEN_EXCHANGE_FAILED",
            });
            return;
          }

          const storedToken: StoredToken = {
            accessToken: result.access,
            refreshToken: result.refresh,
            expiresAt: result.expires,
            email: result.email,
            projectId: result.projectId,
            createdAt: Date.now(),
          };

          this.tokenStore.addOrUpdateAccount(storedToken);
          console.log(
            `[AuthServer] Auth basarili! Email: ${result.email || "bilinmiyor"}, Project: ${result.projectId || "otomatik"}`,
          );

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(SUCCESS_HTML);
          clearTimeout(timeout);

          setTimeout(() => {
            this.stop();
            resolve({
              success: true,
              token: storedToken,
              error: null,
              errorCode: "NONE",
            });
          }, 500);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error("[AuthServer] Token exchange exception:", errorMsg);
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(errorHtml(errorMsg));
          clearTimeout(timeout);
          this.stop();
          resolve({
            success: false,
            error: errorMsg,
            errorCode: "TOKEN_EXCHANGE_EXCEPTION",
          });
        }
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        if (err.code === "EADDRINUSE") {
          console.error(`[AuthServer] Port ${this.port} already in use.`);
          resolve({
            success: false,
            error: `Port ${this.port} is already in use`,
            errorCode: "PORT_IN_USE",
          });
          return;
        }
        reject(err);
      });

      this.server.listen(this.port, "127.0.0.1", () => {
        this.serverState.listening = true;
        console.log(`[AuthServer] OAuth callback listening: http://localhost:${this.port}/oauth-callback`);

        // Signal to waiters that server is ready
        if (this.serverState.listeningResolve) {
          this.serverState.listeningResolve();
        }
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  isListening(): boolean {
    return this.serverState.listening;
  }

  getTokenStore(): TokenStore {
    return this.tokenStore;
  }
}

