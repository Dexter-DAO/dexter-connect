import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// immediate.ts memoizes the capability probe at module scope (user-gesture
// rule: the tap-time read must already be resolved). Tests therefore import a
// FRESH module per case via resetModules + dynamic import — no test-only
// reset hooks in production code.
async function freshImmediate() {
  vi.resetModules();
  return import('./immediate');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('immediateGetSupported', () => {
  it('is false when PublicKeyCredential is absent', async () => {
    vi.stubGlobal('window', {});
    const { immediateGetSupported } = await freshImmediate();
    await expect(immediateGetSupported()).resolves.toBe(false);
  });

  it('is false when getClientCapabilities is missing', async () => {
    const pkc = {};
    vi.stubGlobal('PublicKeyCredential', pkc);
    vi.stubGlobal('window', { PublicKeyCredential: pkc });
    const { immediateGetSupported } = await freshImmediate();
    await expect(immediateGetSupported()).resolves.toBe(false);
  });

  it('is false when getClientCapabilities throws', async () => {
    const pkc = { getClientCapabilities: () => Promise.reject(new Error('nope')) };
    vi.stubGlobal('PublicKeyCredential', pkc);
    vi.stubGlobal('window', { PublicKeyCredential: pkc });
    const { immediateGetSupported } = await freshImmediate();
    await expect(immediateGetSupported()).resolves.toBe(false);
  });

  it('is false when capabilities lack immediateGet', async () => {
    const pkc = { getClientCapabilities: () => Promise.resolve({ conditionalGet: true }) };
    vi.stubGlobal('PublicKeyCredential', pkc);
    vi.stubGlobal('window', { PublicKeyCredential: pkc });
    const { immediateGetSupported } = await freshImmediate();
    await expect(immediateGetSupported()).resolves.toBe(false);
  });

  it('is true when immediateGet is reported, and the probe is memoized', async () => {
    const gcc = vi.fn().mockResolvedValue({ immediateGet: true });
    const pkc = { getClientCapabilities: gcc };
    vi.stubGlobal('PublicKeyCredential', pkc);
    vi.stubGlobal('window', { PublicKeyCredential: pkc });
    const { immediateGetSupported } = await freshImmediate();
    await expect(immediateGetSupported()).resolves.toBe(true);
    await expect(immediateGetSupported()).resolves.toBe(true);
    expect(gcc).toHaveBeenCalledTimes(1);
  });
});

describe('immediateAuthentication', () => {
  // base64url("test-challenge") — matches the enroll.test.ts fixture style.
  const options = {
    challenge: 'dGVzdC1jaGFsbGVuZ2U',
    rpId: 'dexter.cash',
    timeout: 60000,
    userVerification: 'required' as const,
  };

  function stubCredentialsGet(result: unknown) {
    const get = vi.fn().mockResolvedValue(result);
    vi.stubGlobal('navigator', { credentials: { get } });
    return get;
  }

  it('passes uiMode:"immediate" at the TOP LEVEL of the get() options (not inside publicKey)', async () => {
    const get = stubCredentialsGet(null);
    const { immediateAuthentication } = await freshImmediate();
    await immediateAuthentication(options).catch(() => {});
    const arg = get.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.uiMode).toBe('immediate');
    expect((arg.publicKey as Record<string, unknown>).uiMode).toBeUndefined();
    expect((arg.publicKey as { rpId?: string }).rpId).toBe('dexter.cash');
  });

  it('throws NotAllowedError when the browser returns null', async () => {
    stubCredentialsGet(null);
    const { immediateAuthentication } = await freshImmediate();
    await expect(immediateAuthentication(options)).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('shapes the credential into AuthenticationResponseJSON with base64url fields', async () => {
    const bytes = (s: string) => new TextEncoder().encode(s).buffer;
    stubCredentialsGet({
      id: 'cred-abc',
      rawId: bytes('rawid'),
      response: {
        clientDataJSON: bytes('cdj'),
        authenticatorData: bytes('ad'),
        signature: bytes('sig'),
        userHandle: bytes('uh'),
      },
      getClientExtensionResults: () => ({ appid: true }),
      authenticatorAttachment: 'platform',
    });
    const { immediateAuthentication } = await freshImmediate();
    const out = await immediateAuthentication(options);
    expect(out).toEqual({
      id: 'cred-abc',
      rawId: 'cmF3aWQ',
      response: {
        clientDataJSON: 'Y2Rq',
        authenticatorData: 'YWQ',
        signature: 'c2ln',
        userHandle: 'dWg',
      },
      clientExtensionResults: { appid: true },
      type: 'public-key',
      authenticatorAttachment: 'platform',
    });
  });
});

describe('classifyWebAuthnRejection', () => {
  it('is true for a raw DOMException NotAllowedError (the immediate bridge throws this)', async () => {
    const { classifyWebAuthnRejection } = await freshImmediate();
    expect(classifyWebAuthnRejection(new DOMException('no credential', 'NotAllowedError'))).toBe(true);
  });

  it('is true when the rejection is wrapped with the DOMException in cause (simplewebauthn WebAuthnError)', async () => {
    const { classifyWebAuthnRejection } = await freshImmediate();
    const wrapped = new Error('authentication ceremony was sent an abort signal');
    (wrapped as { cause?: unknown }).cause = new DOMException('x', 'AbortError');
    expect(classifyWebAuthnRejection(wrapped)).toBe(true);
  });

  it('is true for user-cancel phrasings in the message alone', async () => {
    const { classifyWebAuthnRejection } = await freshImmediate();
    expect(classifyWebAuthnRejection(new Error('The operation timed out'))).toBe(true);
    expect(classifyWebAuthnRejection(new Error('Request cancelled by user'))).toBe(true);
  });

  it('is false for unrelated failures (network, programmer errors)', async () => {
    const { classifyWebAuthnRejection } = await freshImmediate();
    expect(classifyWebAuthnRejection(new TypeError('Failed to fetch'))).toBe(false);
    expect(classifyWebAuthnRejection(new Error('challenge_failed'))).toBe(false);
    expect(classifyWebAuthnRejection(null)).toBe(false);
  });
});
