let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

const TOKEN_FETCH_TIMEOUT_MS = 5000;
const TOKEN_CACHE_TIME_MS = 55 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function getCsrfToken(): Promise<string> {
  try {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
      return cachedToken;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch("/api/csrf-token", {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`CSRF token fetch failed: ${response.statusText}`);
      }

      const token = response.headers.get("X-CSRF-Token");
      if (!token) {
        throw new Error("CSRF token not in response headers");
      }

      cachedToken = token;
      tokenExpiry = Date.now() + TOKEN_CACHE_TIME_MS;
      return token;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error("Error fetching CSRF token:", error);
    resetCsrfToken();
    throw new Error("Failed to fetch CSRF token");
  }
}

export function resetCsrfToken(): void {
  cachedToken = null;
  tokenExpiry = null;
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    if (options.method === "GET" || !options.method) {
      return fetch(url, {
        ...options,
        method: options.method || "GET",
        credentials: "include",
        headers: { ...options.headers },
      });
    }

    const csrfToken = await getCsrfToken();
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
      "X-CSRF-Token": csrfToken,
    };

    const response = await fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });

    if (response.status === 403) {
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (isRecord(payload) && payload.error === "csrf_validation_failed") {
        resetCsrfToken();
        const newToken = await getCsrfToken();
        return fetch(url, {
          ...options,
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
            "X-CSRF-Token": newToken,
          },
        });
      }
    }

    return response;
  } catch (error) {
    console.error("API fetch error:", error);
    throw error;
  }
}

export type ApiError = Error & { status: number; data: unknown };

export async function handleApiResponse<T = unknown>(response: Response): Promise<T> {
  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    let errorData: unknown;

    try {
      if (contentType?.includes("application/json")) {
        errorData = await response.json();
      } else {
        errorData = { error: await response.text() };
      }
    } catch {
      errorData = { error: response.statusText };
    }

    let message = "API request failed";
    if (isRecord(errorData)) {
      const maybeMessage = errorData.message;
      const maybeError = errorData.error;
      if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
        message = maybeMessage;
      } else if (typeof maybeError === "string" && maybeError.length > 0) {
        message = maybeError;
      }
    }

    const error = new Error(message) as ApiError;
    error.status = response.status;
    error.data = errorData;
    throw error;
  }

  return (await response.json()) as T;
}

export function logout(): void {
  resetCsrfToken();
  window.location.href = "/login";
}

