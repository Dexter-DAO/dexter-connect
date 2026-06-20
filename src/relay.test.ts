import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { passkeyLogin } from './relay';

const challengeResp = {
  options: {
    challenge: 'dGVzdC1jaGFsbGVuZ2U', // base64url("test-challenge")
    rpId: 'dexter.cash',
    timeout: 60000,
    userVerification: 'required',
  },
};

const tokensResp = {
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt: 123,
  expiresIn: 3600,
  tokenType: 'bearer',
};

function fakeCredential(): unknown {
  const buf = (n: number) => new Uint8Array([n]).buffer;
  return {
    id: 'cred-abc',
    rawId: buf(1),
    type: 'public-key',
    response: {
      clientDataJSON: buf(2),
      authenticatorData: buf(3),
      signature: buf(4),
      userHandle: buf(5),
    },
    getClientExtensionResults: () => ({}),
  };
}

describe('passkeyLogin', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      credentials: { get: vi.fn(async () => fakeCredential()) },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs challenge -> assert -> login and returns the session tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: true, json: async () => tokensResp });
    vi.stubGlobal('fetch', fetchMock);

    const result = await passkeyLogin({ apiBase: 'https://api.dexter.cash' });

    expect(result.session.accessToken).toBe('at');
    expect(result.session.tokenType).toBe('bearer');
    expect(result.vault).toBeUndefined(); // vault-review hasn't shipped the vault payload yet
    expect(fetchMock.mock.calls[0][0]).toContain('/api/passkey-anon/sign/login-challenge');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/passkey-anon/sign/passkey-login');
  });

  it('includes vault when the server returns it (forward-compat with ASK 1)', async () => {
    const vault = {
      vaultPda: 'v',
      swigAddress: 's',
      publicKey: 'p',
      userHandle: 'u',
      credentialId: 'c',
      receiveAddress: 'r',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...tokensResp, vault }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await passkeyLogin();
    expect(result.vault).toEqual(vault);
  });

  it('maps a 404 credential_not_found body to a typed ConnectError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'credential_not_found' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(passkeyLogin()).rejects.toMatchObject({ code: 'credential_not_found' });
  });

  it('throws webauthn_unsupported when navigator.credentials is absent', async () => {
    vi.stubGlobal('navigator', {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp });
    vi.stubGlobal('fetch', fetchMock);

    await expect(passkeyLogin()).rejects.toMatchObject({ code: 'webauthn_unsupported' });
  });
});
