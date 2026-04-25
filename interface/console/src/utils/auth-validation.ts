import { z } from 'zod';

/**
 * Input validation schemas for authentication
 * Decoupled from backend for frontend-only builds
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
  .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one special character');

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
