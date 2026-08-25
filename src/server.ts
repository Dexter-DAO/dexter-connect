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
import { base64urlToBytes, bytesToBase64url } from './base64';

export const DEFAULT_ISS = 'https://qdgumpoqnthrjfmqziwm.supabase.co/auth/v1';
export const DEFAULT_AUDIENCE = 'authenticated';

/** The namespaced claim sealed into the token by the access-token hook. */
export interface DexterClaim {
  ver: 1;
  /** Swig state address (base58) — the canonical Dexter Wallet identity. */
  vault: string;
  /** 16-byte passkey handle, base64url; absent on rows without one. */
  userHandle?: string;
  origin?: string;
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
const INVALID_CLAIM = Symbol('invalid-claim');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a canonical padless base64url-encoded 16-byte passkey handle. */
function isUserHandle(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(value)) return false;
  try {
    const bytes = base64urlToBytes(value);
    return bytes.length === 16 && bytesToBase64url(bytes) === value;
  } catch {
    return false;
  }
}

/** Validate that a base58 string canonically represents one 32-byte Solana address. */
function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;

  // Little-endian base-256 conversion. This stays dependency-free so the server
  // entry remains usable in Node and edge runtimes without a Solana peer package.
  const bytes = [0];
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit === undefined) return false;
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // The initial zero accounts for one leading `1`; each additional leading
  // `1` is another zero byte in the decoded address.
  let leadingZeroes = 0;
  while (leadingZeroes < value.length - 1 && value[leadingZeroes] === '1') {
    bytes.push(0);
    leadingZeroes += 1;
  }
  return bytes.length === 32;
}

function parseDexterClaim(value: unknown): DexterClaim | null | typeof INVALID_CLAIM {
  // Pre-hook sessions deliberately have no Dexter claim yet.
  if (value === undefined) return null;
  if (!isRecord(value) || value.ver !== 1 || !isSolanaAddress(value.vault)) {
    return INVALID_CLAIM;
  }
  if (value.userHandle !== undefined && !isUserHandle(value.userHandle)) {
    return INVALID_CLAIM;
  }
  if (value.origin !== undefined && typeof value.origin !== 'string') {
    return INVALID_CLAIM;
  }
  return {
    ver: 1,
    vault: value.vault,
    ...(value.userHandle === undefined ? {} : { userHandle: value.userHandle }),
    ...(value.origin === undefined ? {} : { origin: value.origin }),
    ...(value.agentGrant === undefined ? {} : { agentGrant: value.agentGrant }),
  };
}

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
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return { isSignedIn: false, reason: 'invalid' };
      }
      const sessionId = (payload as { session_id?: unknown }).session_id;
      const aal = (payload as { aal?: unknown }).aal;
      if (
        (sessionId !== undefined && sessionId !== null && typeof sessionId !== 'string') ||
        (aal !== undefined && aal !== null && typeof aal !== 'string')
      ) {
        return { isSignedIn: false, reason: 'invalid' };
      }
      const dexter = parseDexterClaim((payload as { dexter?: unknown }).dexter);
      if (dexter === INVALID_CLAIM) {
        return { isSignedIn: false, reason: 'invalid' };
      }
      return {
        isSignedIn: true,
        sub: payload.sub,
        vaultAddress: dexter?.vault ?? null,
        userHandle: dexter?.userHandle ?? null,
        agentGrant: dexter?.agentGrant ?? null,
        sessionId: sessionId ?? null,
        aal: aal ?? null,
        claims: payload as JWTPayload & { dexter?: DexterClaim },
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
