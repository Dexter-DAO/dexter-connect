/**
 * @dexterai/connect/server — offline Dexter session verification.
 *
 * The server half of Sign in with Dexter (CONTRACT-dexter-session-token.md):
 * a local ES256 signature check against the published JWKS — no call to
 * Supabase or dexter-api on the hot path, so it runs on Node and edge
 * runtimes alike. Pre-hook tokens (no `dexter` claim) verify as signed-in
 * with `vaultAddress: null`; once the access-token hook is enabled the
 * claim appears with no code change here.
 *
 * Phase 1 issuer is Supabase (CONTRACT §3); everything is parameterized on
 * (iss, jwksUrl) so the Phase-2 sovereign cutover is a config flip.
 */
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  errors as joseErrors,
  type JWK,
  type JSONWebKeySet,
  type JWTPayload,
} from 'jose';

export const DEFAULT_ISS = 'https://qdgumpoqnthrjfmqziwm.supabase.co/auth/v1';
export const DEFAULT_AUDIENCE = 'authenticated';

/** The namespaced claim sealed into the token by the access-token hook. */
export interface DexterClaim {
  ver: number;
  /** Swig state address (base58) — the canonical Dexter Wallet identity. */
  vault: string;
  /** 16-byte passkey handle, base64url; absent on rows without one. */
  userHandle?: string;
  agentGrant?: unknown;
}

export type VerifyFailureReason =
  | 'no_token'
  | 'invalid'
  | 'expired'
  | 'issuer_mismatch'
  | 'audience_mismatch';

export type DexterSession =
  | {
      isSignedIn: true;
      sub: string;
      vaultAddress: string | null;
      userHandle: string | null;
      agentGrant: unknown;
      sessionId: string | null;
      aal: string | null;
      claims: JWTPayload & { dexter?: DexterClaim };
    }
  | { isSignedIn: false; reason: VerifyFailureReason };

export interface VerifyOptions {
  /** Expected issuer. Phase 1 default: the Dexter Supabase project. */
  iss?: string;
  /** JWKS location; defaults to `${iss}/.well-known/jwks.json`. */
  jwksUrl?: string;
  /**
   * Public key(s) for fully networkless verification (a JWK or a JWKS).
   * When omitted, the JWKS is fetched once and cached in-instance.
   */
  jwtKey?: JWK | JSONWebKeySet;
  /** Expected audience. Default: Supabase's `authenticated`. */
  audience?: string;
}

/** A fetch-API Request or anything with a node-style headers bag. */
export type RequestLike =
  | Request
  | { headers: Record<string, string | string[] | undefined> };

export interface DexterClient {
  verifyDexterSession(token: string): Promise<DexterSession>;
  authenticateRequest(req: RequestLike): Promise<DexterSession>;
}

type GetKey = Parameters<typeof jwtVerify>[1];

function buildGetKey(opts: VerifyOptions): GetKey {
  if (opts.jwtKey) {
    const set: JSONWebKeySet = 'keys' in opts.jwtKey ? opts.jwtKey : { keys: [opts.jwtKey] };
    return createLocalJWKSet(set) as GetKey;
  }
  const iss = opts.iss ?? DEFAULT_ISS;
  const url = new URL(opts.jwksUrl ?? `${iss}/.well-known/jwks.json`);
  // cacheMaxAge stays inside Supabase's ~10-min JWKS edge TTL (CONTRACT §6).
  return createRemoteJWKSet(url, {
    cacheMaxAge: 600_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  }) as GetKey;
}

function failureReason(err: unknown): VerifyFailureReason {
  if (err instanceof joseErrors.JWTExpired) return 'expired';
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    if (err.claim === 'iss') return 'issuer_mismatch';
    if (err.claim === 'aud') return 'audience_mismatch';
    if (err.claim === 'exp') return 'expired';
  }
  return 'invalid';
}

function bearerFrom(req: RequestLike): string | null {
  let raw: string | string[] | undefined | null;
  const headers = (req as { headers: unknown }).headers;
  if (headers && typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('authorization');
  } else {
    const bag = headers as Record<string, string | string[] | undefined>;
    raw = bag.authorization ?? bag.Authorization;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1] : null;
}

export function createDexterClient(options: VerifyOptions = {}): DexterClient {
  const iss = options.iss ?? DEFAULT_ISS;
  const audience = options.audience ?? DEFAULT_AUDIENCE;
  // Built once per client so the remote JWKS caches across verifications.
  const getKey = buildGetKey(options);

  async function verify(token: string): Promise<DexterSession> {
    try {
      const { payload } = await jwtVerify(token, getKey, {
        issuer: iss,
        audience,
        algorithms: ['ES256'], // pinned — defeats alg-confusion / alg:none
      });
      const dexter = (payload as { dexter?: DexterClaim }).dexter;
      return {
        isSignedIn: true,
        sub: payload.sub ?? '',
        vaultAddress: dexter?.vault ?? null,
        userHandle: dexter?.userHandle ?? null,
        agentGrant: dexter?.agentGrant ?? null,
        sessionId: (payload as { session_id?: string }).session_id ?? null,
        aal: (payload as { aal?: string }).aal ?? null,
        claims: payload,
      };
    } catch (err) {
      return { isSignedIn: false, reason: failureReason(err) };
    }
  }

  return {
    verifyDexterSession: verify,
    async authenticateRequest(req: RequestLike): Promise<DexterSession> {
      const token = bearerFrom(req);
      if (!token) return { isSignedIn: false, reason: 'no_token' };
      return verify(token);
    },
  };
}

/**
 * One-off verification. For servers verifying many requests against a
 * remote JWKS, create a client once instead so the key set caches.
 */
export function verifyDexterSession(
  token: string,
  options: VerifyOptions = {},
): Promise<DexterSession> {
  return createDexterClient(options).verifyDexterSession(token);
}
