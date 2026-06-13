/**
 * TokenSigner abstraction
 *
 * Production swap (RS256):
 *   1. Generate an RSA key pair and store the private key in Vault (KV v2).
 *   2. Implement Rs256TokenSigner below using `jsonwebtoken.sign` with
 *      `algorithm: 'RS256'` and the PEM private key loaded from Vault at boot.
 *   3. Expose the public key via /.well-known/jwks.json (JwksController).
 *   4. Set JWT_ALGORITHM=RS256 in env and swap the provider in AuthModule.
 *
 * The HS256 default is safe for single-node dev where the secret never leaves
 * the process. For multi-node prod, RS256 (asymmetric) is mandatory so
 * gateway nodes can verify tokens without sharing the signing secret.
 */

import * as jwt from 'jsonwebtoken';

export interface TokenPayload {
  sub: string;
  iss: string;
  aud?: string | string[];
  scope: string;
  role: string;
  /** Patient launch context — set when grant carries launch/patient scope */
  patient?: string;
  /** Share-token client id — set for client_credentials share tokens */
  client_id?: string;
  jti?: string;
}

export interface TokenSignOptions {
  expiresIn: number; // seconds
}

export interface TokenSigner {
  /**
   * Sign a JWT and return the compact serialization.
   * Production implementors use RS256; the default dev impl uses HS256.
   */
  sign(payload: TokenPayload, options: TokenSignOptions): string;

  /**
   * Verify a JWT and return the decoded payload.
   * Throws on invalid/expired tokens.
   */
  verify(token: string): TokenPayload;

  /**
   * Returns the JWKS (JSON Web Key Set) for the /.well-known/jwks.json endpoint.
   * HS256: returns empty keys array (symmetric — key is secret, not published).
   * RS256: returns the RSA public key as JWK.
   */
  jwks(): { keys: unknown[] };
}

// ── HS256 implementation (development default) ────────────────────────────────

export class Hs256TokenSigner implements TokenSigner {
  constructor(private readonly secret: string) {}

  sign(payload: TokenPayload, options: TokenSignOptions): string {
    return jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      expiresIn: options.expiresIn,
    });
  }

  verify(token: string): TokenPayload {
    const decoded = jwt.verify(token, this.secret, {
      algorithms: ['HS256'],
    });
    if (typeof decoded === 'string') {
      throw new Error('Invalid token payload');
    }
    return decoded as TokenPayload;
  }

  jwks(): { keys: unknown[] } {
    // HS256 uses a symmetric secret — not published as JWK
    return { keys: [] };
  }
}

/*
 * ── RS256 stub (production swap) ─────────────────────────────────────────────
 *
 * To enable: implement this class and swap the provider.
 *
 * import * as jwt from 'jsonwebtoken';
 *
 * export class Rs256TokenSigner implements TokenSigner {
 *   constructor(
 *     private readonly privateKeyPem: string,
 *     private readonly publicKeyPem: string,
 *     private readonly kid: string,
 *   ) {}
 *
 *   sign(payload: TokenPayload, options: TokenSignOptions): string {
 *     return jwt.sign(payload, this.privateKeyPem, {
 *       algorithm: 'RS256',
 *       keyid: this.kid,
 *       expiresIn: options.expiresIn,
 *     });
 *   }
 *
 *   verify(token: string): TokenPayload {
 *     const decoded = jwt.verify(token, this.publicKeyPem, {
 *       algorithms: ['RS256'],
 *     });
 *     if (typeof decoded === 'string') throw new Error('Invalid token payload');
 *     return decoded as TokenPayload;
 *   }
 *
 *   jwks(): { keys: unknown[] } {
 *     // Convert PEM → JWK using e.g. jose or node-jose
 *     // Return { keys: [{ kty: 'RSA', kid: this.kid, ... }] }
 *     throw new Error('Implement JWK export for RS256');
 *   }
 * }
 */
