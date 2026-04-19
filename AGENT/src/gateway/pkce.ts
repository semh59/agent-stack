import { randomBytes, createHash } from 'node:crypto';

/**
 * PKCE (Proof Key for Code Exchange) Utility
 */
export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Generates a random code verifier and its corresponding SHA-256 code challenge.
 */
export function generatePKCE(): PKCEPair {
  // 1. Generate random verifier (at least 43 characters long)
  const verifier = randomBytes(32).toString('base64url');
  
  // 2. Hash it with SHA-256
  const hash = createHash('sha256').update(verifier).digest();
  
  // 3. Base64URL encode the hash
  const challenge = hash.toString('base64url');
  
  return {
    codeVerifier: verifier,
    codeChallenge: challenge
  };
}
