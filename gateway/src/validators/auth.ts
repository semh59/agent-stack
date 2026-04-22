import { z } from 'zod';

/**
 * Input validation schemas for authentication and API requests
 * Used both on frontend and backend for consistency
 */

// Email validation - RFC 5322 simplified
export const EmailSchema = z.string()
  .min(3, 'Email must be at least 3 characters')
  .max(254, 'Email is too long (max 254 characters)')
  .email('Valid email address required')
  .toLowerCase()
  .trim();

// Password validation - NIST guidelines
export const PasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long (max 128 characters)')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Password must contain at least one special character');

// Auth credentials object
export const AuthCredentialsSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>;

/**
 * Validate auth credentials and return detailed errors
 */
export function validateAuthCredentials(data: unknown):
  | { valid: true; data: AuthCredentials }
  | { valid: false; errors: Record<string, string[]> } {

  const result = AuthCredentialsSchema.safeParse(data);

  if (!result.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(issue.message);
    }
    return { valid: false, errors };
  }

  return { valid: true, data: result.data };
}

/**
 * Request body validation
 */
export const CreateAccountSchema = z.object({
  email: EmailSchema,
  projectId: z.string().optional(),
});

export type CreateAccountRequest = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = z.object({
  email: EmailSchema.optional(),
  projectId: z.string().optional(),
});

export type UpdateAccountRequest = z.infer<typeof UpdateAccountSchema>;

/**
 * API response validation
 */
export const TokenResponseSchema = z.object({
  accessToken: z.string().min(1, 'Missing access token'),
  refreshToken: z.string().min(1, 'Missing refresh token'),
  expiresAt: z.number().int().positive('Invalid expiry time'),
  email: z.string().email().optional(),
  projectId: z.string().optional(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/**
 * Query parameter validation
 */
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).strict();

export type PaginationParams = z.infer<typeof PaginationSchema>;

/**
 * Validate OAuth state parameter
 */
export const OAuthStateSchema = z.string()
  .min(16, 'Invalid OAuth state')
  .max(256, 'Invalid OAuth state')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid OAuth state format');

/**
 * Validate authorization code
 */
export const AuthorizationCodeSchema = z.string()
  .min(10, 'Invalid authorization code')
  .max(2000, 'Invalid authorization code');

/**
 * User profile validation
 */
export const UserProfileSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
  email: EmailSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Error details for API responses
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.array(z.string())).optional(),
  timestamp: z.number().int(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Generic validation helper
 */
export function validateWithSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { valid: true; data: T } | { valid: false; error: string; details?: Record<string, string[]> } {

  const result = schema.safeParse(data);

  if (!result.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(issue.message);
    }
    return {
      valid: false,
      error: 'Validation failed',
      details: errors,
    };
  }

  return { valid: true, data: result.data };
}
