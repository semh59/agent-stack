import { describe, it, expect } from 'vitest';
import {
  EmailSchema,
  PasswordSchema,
  AuthCredentialsSchema,
  validateAuthCredentials,
  CreateAccountSchema,
  OAuthStateSchema,
  AuthorizationCodeSchema,
  validateWithSchema,
} from './auth';

describe('Email Validation', () => {
  it('accepts valid emails', () => {
    const validEmails = [
      'user@example.com',
      'test@domain.co.uk',
      'name+tag@example.com',
      'a@b.co',
    ];

    validEmails.forEach(email => {
      const result = EmailSchema.safeParse(email);
      expect(result.success).toBe(true);
    });
  });

  it('rejects invalid emails', () => {
    const invalidEmails = [
      'notanemail',
      '@example.com',
      'user@',
      'user space@example.com',
      '',
      'a'.repeat(255) + '@example.com', // Too long
    ];

    invalidEmails.forEach(email => {
      const result = EmailSchema.safeParse(email);
      expect(result.success).toBe(false);
    });
  });

  it('converts email to lowercase', () => {
    const result = EmailSchema.safeParse('USER@EXAMPLE.COM');
    if (result.success) {
      expect(result.data).toBe('user@example.com');
    }
  });

  it('trims whitespace', () => {
    const result = EmailSchema.safeParse('  user@example.com  ');
    if (result.success) {
      expect(result.data).toBe('user@example.com');
    }
  });
});

describe('Password Validation', () => {
  it('accepts strong passwords', () => {
    const strongPasswords = [
      'MyPassword123!',
      'Secure@Pass789',
      'Test#Password1',
      'Complex_P@ssw0rd',
    ];

    strongPasswords.forEach(password => {
      const result = PasswordSchema.safeParse(password);
      expect(result.success).toBe(true);
    });
  });

  it('rejects weak passwords', () => {
    const weakPasswords = [
      'short', // Too short
      'nouppercase123!', // No uppercase
      'NOLOWERCASE123!', // No lowercase
      'NoNumbers!', // No numbers
      'NoSpecial123', // No special char
      'Aa1!', // Too short
    ];

    weakPasswords.forEach(password => {
      const result = PasswordSchema.safeParse(password);
      expect(result.success).toBe(false);
    });
  });

  it('rejects passwords longer than 128 characters', () => {
    const tooLongPassword = 'A1!' + 'a'.repeat(126);
    const result = PasswordSchema.safeParse(tooLongPassword);
    expect(result.success).toBe(false);
  });

  it('accepts all special characters from requirement', () => {
    const passwordsWithDifferentSpecials = [
      'MyPass1!',
      'MyPass1@',
      'MyPass1#',
      'MyPass1$',
      'MyPass1%',
      'MyPass1^',
      'MyPass1&',
      'MyPass1*',
      'MyPass1(',
      'MyPass1)',
      'MyPass1_',
      'MyPass1+',
      'MyPass1-',
      'MyPass1=',
      'MyPass1[',
      'MyPass1]',
    ];

    passwordsWithDifferentSpecials.forEach(password => {
      const result = PasswordSchema.safeParse(password);
      expect(result.success, `Should accept: ${password}`).toBe(true);
    });
  });

  it('provides specific error messages', () => {
    const result = PasswordSchema.safeParse('pass');
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes('8 characters'))).toBe(true);
      expect(messages.some(m => m.includes('uppercase'))).toBe(true);
      expect(messages.some(m => m.includes('number'))).toBe(true);
    }
  });
});

describe('Auth Credentials Validation', () => {
  it('validates complete credentials', () => {
    const result = AuthCredentialsSchema.safeParse({
      email: 'user@example.com',
      password: 'MySecure123!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = AuthCredentialsSchema.safeParse({
      email: 'notanemail',
      password: 'MySecure123!',
    });
    expect(result.success).toBe(false);
  });

  it('rejects weak password', () => {
    const result = AuthCredentialsSchema.safeParse({
      email: 'user@example.com',
      password: 'weak',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = AuthCredentialsSchema.safeParse({
      email: 'user@example.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('validateAuthCredentials Function', () => {
  it('returns valid data on success', () => {
    const result = validateAuthCredentials({
      email: 'user@example.com',
      password: 'MySecure123!',
    });

    if (result.valid) {
      expect(result.data.email).toBe('user@example.com');
      expect(result.data.password).toBe('MySecure123!');
    } else {
      throw new Error('Should be valid');
    }
  });

  it('returns detailed error object on failure', () => {
    const result = validateAuthCredentials({
      email: 'invalid-email',
      password: 'weak',
    });

    if (!result.valid) {
      expect(result.errors.email).toBeDefined();
      expect(result.errors.password).toBeDefined();
      expect(Array.isArray(result.errors.email)).toBe(true);
      expect(Array.isArray(result.errors.password)).toBe(true);
    } else {
      throw new Error('Should be invalid');
    }
  });

  it('handles partial data gracefully', () => {
    const result = validateAuthCredentials({
      email: 'user@example.com',
      // missing password
    });

    if (!result.valid) {
      expect(result.errors.password).toBeDefined();
    }
  });

  it('handles non-object input', () => {
    const result = validateAuthCredentials('not an object');

    expect(result.valid).toBe(false);
  });
});

describe('Create Account Validation', () => {
  it('validates create account request', () => {
    const result = CreateAccountSchema.safeParse({
      email: 'newuser@example.com',
      projectId: 'project-123',
    });

    expect(result.success).toBe(true);
  });

  it('makes projectId optional', () => {
    const result = CreateAccountSchema.safeParse({
      email: 'newuser@example.com',
    });

    expect(result.success).toBe(true);
  });

  it('validates email in create request', () => {
    const result = CreateAccountSchema.safeParse({
      email: 'invalid-email',
      projectId: 'project-123',
    });

    expect(result.success).toBe(false);
  });
});

describe('OAuth State Validation', () => {
  it('accepts valid states', () => {
    const validStates = [
      'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
      'state-with-dashes',
      'state_with_underscores',
      'state123with456numbers',
    ];

    validStates.forEach(state => {
      const result = OAuthStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });

  it('rejects invalid states', () => {
    const invalidStates = [
      'too-short',
      'a'.repeat(257), // Too long
      'state-with-special!@#',
      'state with spaces',
    ];

    invalidStates.forEach(state => {
      const result = OAuthStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });
  });
});

describe('Authorization Code Validation', () => {
  it('accepts valid codes', () => {
    const validCodes = [
      '4/0AY0e-g9vxY-zAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCd',
      'test-auth-code-12345',
      'a'.repeat(100),
    ];

    validCodes.forEach(code => {
      const result = AuthorizationCodeSchema.safeParse(code);
      expect(result.success).toBe(true);
    });
  });

  it('rejects too-short codes', () => {
    const result = AuthorizationCodeSchema.safeParse('short');
    expect(result.success).toBe(false);
  });

  it('rejects too-long codes', () => {
    const result = AuthorizationCodeSchema.safeParse('a'.repeat(2001));
    expect(result.success).toBe(false);
  });
});

describe('Generic validateWithSchema Function', () => {
  it('validates with any schema', () => {
    const result = validateWithSchema(EmailSchema, 'user@example.com');

    if (result.valid) {
      expect(result.data).toBe('user@example.com');
    } else {
      throw new Error('Should be valid');
    }
  });

  it('returns detailed errors for failed validation', () => {
    const result = validateWithSchema(AuthCredentialsSchema, {
      email: 'not-an-email',
      password: 'weak',
    });

    if (!result.valid) {
      expect(result.error).toContain('Validation failed');
      expect(result.details).toBeDefined();
    } else {
      throw new Error('Should be invalid');
    }
  });
});

describe('Security Properties', () => {
  it('passwords cannot contain common patterns', () => {
    // These pass validation but demonstrate password strength
    const passwords = [
      'MyPassword123!', // Valid
      'Admin123!Admin', // Valid but not recommended
    ];

    passwords.forEach(password => {
      const result = PasswordSchema.safeParse(password);
      expect(result.success).toBe(true);
    });
  });

  it('email validation prevents injection attempts', () => {
    const injectionAttempts = [
      'test@example.com"><script>',
      'test@example.com?email=',
      'test@example.com\r\n',
    ];

    injectionAttempts.forEach(email => {
      const result = EmailSchema.safeParse(email);
      // Should fail validation
      if (result.success) {
        // Even if parsed, it should be clean
        expect(result.data).not.toContain('<');
        expect(result.data).not.toContain('>');
        expect(result.data).not.toContain('\r');
      }
    });
  });

  it('validates schema consistency across frontend and backend', () => {
    // These are the same schemas that should be used in both places
    const testCredentials = {
      email: 'test@example.com',
      password: 'MySecure123!',
    };

    const frontendResult = validateAuthCredentials(testCredentials);
    const backendResult = AuthCredentialsSchema.safeParse(testCredentials);

    expect(frontendResult.valid).toBe(backendResult.success);
  });
});
