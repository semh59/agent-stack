/**
 * Standardized Error Hierarchy for Alloy AI Platform
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: Date.now(),
    };
  }
}

/**
 * Domain errors represent business rule violations.
 */
export class DomainError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 400, details);
  }
}

/**
 * Infrastructure errors represent failures in external systems (DB, API, etc.)
 */
export class InfrastructureError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(code, message, 500, details, options);
  }
}

/**
 * API errors specifically for HTTP responses
 */
export class ApiError extends AppError {
  constructor(code: string, message: string, statusCode: number = 400, details?: Record<string, unknown>) {
    super(code, message, statusCode, details);
  }
}

// Specialized Errors

export class NotFoundError extends ApiError {
  constructor(resource: string, id: string) {
    super(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} with ID ${id} not found`, 404);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, string[]>) {
    super("VALIDATION_FAILED", message, 422, details as Record<string, unknown>);
  }
}
