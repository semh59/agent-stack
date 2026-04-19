import type { StateCreator } from "zustand";
import type { AppState, GoogleAccount, AccountQuota, VSCodeAPI } from "../types";
import { 
  gatewayFetch, 
  parseGatewayError, 
  mapOAuthActionableError, 
  persistGatewayToken, 
  normalizeAccounts, 
  normalizeOAuthUrl 
} from "../helpers";

// VS Code API declaration
declare const vscode: VSCodeAPI | undefined;

export interface AuthSlice {
  accounts: GoogleAccount[];
  activeAccount: string | null;
  gatewayToken: string | null;
  accountQuotas: AccountQuota[];
  
  setGatewayToken: (token: string | null) => void;
  fetchAccounts: () => Promise<void>;
  fetchQuota: () => Promise<void>;
  selectAccount: (email: string) => Promise<void>;
  addAccount: () => Promise<void>;
  removeAccount: (email: string) => Promise<void>;
}

export const createAuthSlice: StateCreator<
  AppState,
  [],
  [],
  AuthSlice
> = (set, get) => ({
  accounts: [],
  activeAccount: null,
  gatewayToken: null,
  accountQuotas: [],

  setGatewayToken: (token: string | null) => {
    persistGatewayToken(token);
    set({
      gatewayToken: token,
      bootState: token ? "ready" : "error",
    });
    if (token) {
      void get().runPostBootInitialization();
    }
  },

  fetchAccounts: async () => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "getAccounts" });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/accounts", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Failed to fetch accounts (${res.status})`);
      const body = (await res.json()) as { data?: GoogleAccount[] };
      set({ accounts: normalizeAccounts(body.data), lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Baglanti hatasi: ${message}` });
    }
  },

  fetchQuota: async () => {
    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch("/api/accounts/quota", { method: "GET" }, token);
      if (!res.ok) throw new Error(`Failed to fetch quota (${res.status})`);
      const body = (await res.json()) as { data?: AccountQuota[] };
      set({ accountQuotas: Array.isArray(body.data) ? body.data : [], lastError: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Store] Quota fetch error:", message);
    }
  },

  selectAccount: async (email: string) => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "selectAccount", payload: email });
      set({ activeAccount: email });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        "/api/accounts/active",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
        token,
      );
      if (!res.ok) throw new Error(`Account selection failed (${res.status})`);
      
      set({ activeAccount: email, lastError: null });
      
      // Refresh dynamic data for the new account
      await Promise.all([
        get().fetchModels(),
        get().fetchQuota()
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Hesap secme hatasi: ${message}` });
    }
  },

  addAccount: async () => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "addAccount" });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const response = await gatewayFetch("/api/auth/login", { method: "GET" }, token);
      if (!response.ok) {
        const parsed = await parseGatewayError(response);
        throw new Error(mapOAuthActionableError(parsed));
      }
      const body = (await response.json()) as { data?: { url?: string } };
      const oauthUrl = body.data?.url;
      if (!oauthUrl) throw new Error("OAuth URL not returned");
      const normalizedOAuthUrl = normalizeOAuthUrl(oauthUrl);
      window.open(normalizedOAuthUrl, "_blank", "noopener,noreferrer");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Hesap ekleme hatasi: ${message}` });
    }
  },

  removeAccount: async (email: string) => {
    if (typeof vscode !== "undefined" && vscode) {
      vscode.postMessage({ type: "removeAccount", payload: email });
      return;
    }

    try {
      const token = get().gatewayToken;
      if (!token) throw new Error("Gateway auth token missing");
      const res = await gatewayFetch(
        `/api/accounts/${encodeURIComponent(email)}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) throw new Error(`Account removal failed (${res.status})`);
      await get().fetchAccounts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ lastError: `Hesap silme hatasi: ${message}` });
    }
  },
});
