import type { FastifyReply } from "fastify";
import { MissionServiceError } from "../services/mission.service";

export interface ApiErrorItem {
  code?: string;
  message: string;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  data: T | null;
  meta: Record<string, unknown>;
  errors: ApiErrorItem[];
}

export interface ApiErrorOptions {
  code?: string;
  meta?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export interface ApiErrorMapping {
  statusCode: number;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isApiErrorOptions(value: Record<string, unknown>): boolean {
  return "code" in value || "meta" in value || "details" in value;
}

function extractEnvelopeMeta(meta: unknown, requestId: string): Record<string, unknown> {
  const baseMeta = isRecord(meta) ? { ...meta } : {};
  const timestamp =
    typeof baseMeta.timestamp === "string" ? baseMeta.timestamp : new Date().toISOString();
  const resolvedRequestId =
    typeof baseMeta.requestId === "string" ? baseMeta.requestId : requestId;

  delete baseMeta.timestamp;
  delete baseMeta.requestId;

  return {
    timestamp,
    requestId: resolvedRequestId,
    ...baseMeta,
  };
}

function inferDefaultErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "INVALID_STATE_TRANSITION";
    case 429:
      return "RATE_LIMIT";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR";
  }
}

function resolveErrorItems(statusCode: number, errors: unknown): ApiErrorItem[] {
  if (!Array.isArray(errors) || errors.length === 0) {
    if (statusCode >= 400) {
      return [
        {
          code: inferDefaultErrorCode(statusCode),
          message: "Request failed",
        },
      ];
    }
    return [];
  }

  return errors.map((entry) => {
    if (!isRecord(entry)) {
      return {
        code: inferDefaultErrorCode(statusCode),
        message: String(entry),
      };
    }

    const message =
      typeof entry.message === "string" && entry.message.trim().length > 0
        ? entry.message
        : "Request failed";
    const code =
      typeof entry.code === "string" && entry.code.trim().length > 0
        ? entry.code
        : inferDefaultErrorCode(statusCode);

    return {
      ...entry,
      code,
      message,
    };
  });
}

function toEnvelope(statusCode: number, payload: unknown): ApiEnvelope<unknown> {
  if (isApiEnvelope(payload)) {
    return {
      data: payload.data,
      meta: isRecord(payload.meta) ? payload.meta : {},
      errors: resolveErrorItems(statusCode, payload.errors),
    };
  }

  if (statusCode >= 400) {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : typeof payload === "string"
          ? payload
          : "Request failed";
    return apiError(message, { code: inferDefaultErrorCode(statusCode) });
  }

  return apiResponse(payload);
}

export function apiResponse<T>(
  data: T,
  meta: Record<string, unknown> = {},
): ApiEnvelope<T> {
  return {
    data,
    meta: { ...meta },
    errors: [],
  };
}

export function apiError(
  message: string,
  metaOrOptions: Record<string, unknown> | ApiErrorOptions = {},
): ApiEnvelope<null> {
  let code: string | undefined;
  let meta: Record<string, unknown> = {};
  let details: Record<string, unknown> = {};

  if (isRecord(metaOrOptions) && isApiErrorOptions(metaOrOptions)) {
    code = typeof metaOrOptions.code === "string" ? metaOrOptions.code : undefined;
    meta = isRecord(metaOrOptions.meta) ? { ...metaOrOptions.meta } : {};
    details = isRecord(metaOrOptions.details) ? { ...metaOrOptions.details } : {};
  } else if (isRecord(metaOrOptions)) {
    meta = { ...metaOrOptions };
  }

  return {
    data: null,
    meta,
    errors: [
      {
        ...(code ? { code } : {}),
        message,
        ...details,
      },
    ],
  };
}

export function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return "data" in value && "meta" in value && "errors" in value;
}

export function normalizeApiEnvelope(
  requestId: string,
  statusCode: number,
  payload: unknown,
): ApiEnvelope<unknown> {
  const envelope = toEnvelope(statusCode, payload);
  return {
    data: statusCode >= 400 ? null : envelope.data,
    meta: extractEnvelopeMeta(envelope.meta, requestId),
    errors: statusCode >= 400 ? envelope.errors : [],
  };
}

export function parsePagination(query: Record<string, unknown>): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(query.limit ?? "50"), 10) || 50));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function mapErrorToApi(error: unknown, fallbackMessage = "Request failed"): ApiErrorMapping {
  if (error instanceof MissionServiceError) {
    if (error.code === "MISSION_NOT_FOUND") {
      return {
        statusCode: 404,
        code: "MISSION_NOT_FOUND",
        message: error.message,
      };
    }

    if (error.code === "INVALID_STATE_TRANSITION") {
      return {
        statusCode: 422,
        code: "INVALID_STATE_TRANSITION",
        message: error.message,
      };
    }

    if (error.code === "PLAN_NOT_AVAILABLE") {
      return {
        statusCode: 409,
        code: "PLAN_NOT_AVAILABLE",
        message: error.message,
      };
    }

    return {
      statusCode: 500,
      code: "MISSION_RUNTIME_ERROR",
      message: error.message,
    };
  }

  if (isRecord(error)) {
    const statusCode =
      typeof error.statusCode === "number" && Number.isFinite(error.statusCode)
        ? error.statusCode
        : 500;
    const code =
      typeof error.code === "string" && error.code.trim().length > 0
        ? error.code
        : inferDefaultErrorCode(statusCode);
    const message =
      typeof error.message === "string" && error.message.trim().length > 0
        ? error.message
        : fallbackMessage;

    return {
      statusCode,
      code,
      message,
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: error.message || fallbackMessage,
    };
  }

  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: fallbackMessage,
  };
}

export function sendMappedApiError(
  reply: FastifyReply,
  error: unknown,
  fallbackMessage = "Request failed",
): FastifyReply {
  const mapped = mapErrorToApi(error, fallbackMessage);
  return reply.status(mapped.statusCode).send(
    apiError(mapped.message, {
      code: mapped.code,
      meta: mapped.meta,
    }),
  );
}
