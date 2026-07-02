import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, type JWK } from 'jose';
import { createDexterClient, verifyDexterSession, DEFAULT_ISS } from './server';
import { base64urlToBytes, bytesToBase64url } from './base64';

const utf8 = { enc: new TextEncoder(), dec: new TextDecoder() };
const b64urlToJson = (s: string) => JSON.parse(utf8.dec.decode(base64urlToBytes(s)));
const jsonToB64url = (v: unknown) => bytesToBase64url(utf8.enc.encode(JSON.stringify(v)));

/** Mint a Supabase-shaped ES256 access token with optional dexter claim. */
let privateKey: CryptoKey;
let publicJwk: JWK;
let rotatedPrivateKey: CryptoKey;
let rotatedJwk: JWK;

const ISS = 'https://test-project.supabase.co/auth/v1';
const SUB = '6d1c74d2-6f5a-4a3e-9d0e-6a1e2b3c4d5e';
const DEXTER = {
  ver: 1,
  vault: 'SwigState1111111111111111111111111111111111',
  userHandle: 'q80s3xhZQGO2fBjW9BqZzg',
  agentGrant: null,
};

async function mintToken(opts: {
  iss?: string;
  aud?: string;
  dexter?: object | undefined;
  expiresIn?: string;
  key?: CryptoKey;
  kid?: string;
  alg?: string;
} = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    session_id: 'sess-123',
    aal: 'aal1',
    role: 'authenticated',
  };
  if (opts.dexter !== undefined) payload.dexter = opts.dexter;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: opts.alg ?? 'ES256', kid: opts.kid ?? 'key-1' })
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? 'authenticated')
    .setSubject(SUB)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(opts.key ?? privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair('ES256', { extractable: true });
  privateKey = kp.privateKey as CryptoKey;
  publicJwk = { ...(await exportJWK(kp.publicKey)), alg: 'ES256', kid: 'key-1' };
  const kp2 = await generateKeyPair('ES256', { extractable: true });
  rotatedPrivateKey = kp2.privateKey as CryptoKey;
  rotatedJwk = { ...(await exportJWK(kp2.publicKey)), alg: 'ES256', kid: 'key-2' };
});

afterEach(() => vi.restoreAllMocks());

describe('verifyDexterSession (networkless via jwtKey)', () => {
  it('verifies a token carrying the dexter claim and surfaces vault + userHandle', async () => {
    const token = await mintToken({ dexter: DEXTER });
    const result = await verifyDexterSession(token, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(true);
    if (!result.isSignedIn) return;
    expect(result.sub).toBe(SUB);
    expect(result.vaultAddress).toBe(DEXTER.vault);
    expect(result.userHandle).toBe(DEXTER.userHandle);
    expect(result.agentGrant).toBeNull();
    expect(result.sessionId).toBe('sess-123');
    expect(result.claims.role).toBe('authenticated');
  });

  it('verifies a PRE-HOOK token (no dexter claim) as signed-in with vaultAddress null', async () => {
    const token = await mintToken({ dexter: undefined });
    const result = await verifyDexterSession(token, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(true);
    if (!result.isSignedIn) return;
    expect(result.vaultAddress).toBeNull();
    expect(result.userHandle).toBeNull();
  });

  it('performs zero network calls when jwtKey is provided', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const token = await mintToken({ dexter: DEXTER });
    const result = await verifyDexterSession(token, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a token from a different issuer', async () => {
    const token = await mintToken({ iss: 'https://evil.example.com' });
    const result = await verifyDexterSession(token, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(false);
    if (result.isSignedIn) return;
    expect(result.reason).toBe('issuer_mismatch');
  });

  it('rejects a token minted for a different audience', async () => {
    const token = await mintToken({ aud: 'some-other-rp' });
    const result = await verifyDexterSession(token, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(false);
    if (result.isSignedIn) return;
    expect(result.reason).toBe('audience_mismatch');
  });

  it('rejects an expired token with reason "expired"', async () => {
    const token = await mintToken({ expiresIn: '-1m' });
    const result = await verifyDexterSession(token, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(false);
    if (result.isSignedIn) return;
    expect(result.reason).toBe('expired');
  });

  it('rejects a non-ES256 token (alg pinning defeats alg confusion)', async () => {
    const { privateKey: rsaKey } = await generateKeyPair('RS256', { extractable: true });
    const token = await mintToken({ key: rsaKey as CryptoKey, alg: 'RS256' });
    const result = await verifyDexterSession(token, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(false);
  });

  it('rejects a tampered payload (signature check)', async () => {
    const token = await mintToken({ dexter: DEXTER });
    const [h, p, s] = token.split('.');
    const payload = b64urlToJson(p);
    payload.dexter.vault = 'AttackerVault111111111111111111111111111111';
    const tampered = [h, jsonToB64url(payload), s].join('.');
    const result = await verifyDexterSession(tampered, { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(false);
    if (result.isSignedIn) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects garbage input without throwing', async () => {
    const result = await verifyDexterSession('not-a-jwt', { iss: ISS, jwtKey: publicJwk });
    expect(result.isSignedIn).toBe(false);
  });

  it('selects the right key by kid from a multi-key JWKS (rotation)', async () => {
    const token = await mintToken({ key: rotatedPrivateKey, kid: 'key-2' });
    const result = await verifyDexterSession(token, {
      iss: ISS,
      jwtKey: { keys: [publicJwk, rotatedJwk] },
    });
    expect(result.isSignedIn).toBe(true);
  });
});

describe('createDexterClient (remote JWKS)', () => {
  function stubJwks(keys: JWK[]) {
    const fetchSpy = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  it('fetches the JWKS from jwksUrl and verifies', async () => {
    const fetchSpy = stubJwks([publicJwk]);
    const client = createDexterClient({ iss: ISS, jwksUrl: 'https://test-project.supabase.co/auth/v1/.well-known/jwks.json' });
    const token = await mintToken({ dexter: DEXTER });
    const result = await client.verifyDexterSession(token);
    expect(result.isSignedIn).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/.well-known/jwks.json');
  });

  it('caches the JWKS across verifications (one fetch for two verifies)', async () => {
    const fetchSpy = stubJwks([publicJwk]);
    const client = createDexterClient({ iss: ISS, jwksUrl: 'https://test-project.supabase.co/auth/v1/.well-known/jwks.json' });
    const r1 = await client.verifyDexterSession(await mintToken({}));
    const r2 = await client.verifyDexterSession(await mintToken({ dexter: DEXTER }));
    expect(r1.isSignedIn).toBe(true);
    expect(r2.isSignedIn).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults iss + jwksUrl to the live Dexter Supabase project when unconfigured', async () => {
    const fetchSpy = stubJwks([publicJwk]);
    const client = createDexterClient();
    await client.verifyDexterSession(await mintToken({ iss: DEFAULT_ISS }));
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${DEFAULT_ISS}/.well-known/jwks.json`);
  });
});

describe('authenticateRequest', () => {
  it('extracts a Bearer token from a fetch-API Request and verifies it', async () => {
    const client = createDexterClient({ iss: ISS, jwtKey: publicJwk });
    const token = await mintToken({ dexter: DEXTER });
    const req = new Request('https://example.com/api', {
      headers: { authorization: `Bearer ${token}` },
    });
    const result = await client.authenticateRequest(req);
    expect(result.isSignedIn).toBe(true);
    if (!result.isSignedIn) return;
    expect(result.vaultAddress).toBe(DEXTER.vault);
  });

  it('accepts a plain node-style headers object', async () => {
    const client = createDexterClient({ iss: ISS, jwtKey: publicJwk });
    const token = await mintToken({ dexter: DEXTER });
    const result = await client.authenticateRequest({ headers: { authorization: `Bearer ${token}` } });
    expect(result.isSignedIn).toBe(true);
  });

  it('returns no_token when the Authorization header is missing or malformed', async () => {
    const client = createDexterClient({ iss: ISS, jwtKey: publicJwk });
    const r1 = await client.authenticateRequest(new Request('https://example.com'));
    const r2 = await client.authenticateRequest({ headers: { authorization: 'Basic abc' } });
    expect(r1.isSignedIn).toBe(false);
    expect(r2.isSignedIn).toBe(false);
    if (!r1.isSignedIn) expect(r1.reason).toBe('no_token');
    if (!r2.isSignedIn) expect(r2.reason).toBe('no_token');
  });
});
