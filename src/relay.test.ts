import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// passkeyLogin now delegates the WebAuthn get() + base64url marshalling to
// @simplewebauthn/browser, so we mock at THAT boundary: control the library's
// output and assert passkeyLogin's own behavior (challenge → assert → login).
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

import { passkeyLogin } from './relay';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

const mockStartAuth = vi.mocked(startAuthentication);
const mockSupports = vi.mocked(browserSupportsWebAuthn);

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

// What startAuthentication() resolves to — the server-ready credential JSON.
const authResponse = {
  id: 'cred-abc',
  rawId: 'cred-abc',
  response: {
    clientDataJSON: 'AA',
    authenticatorData: 'AA',
    signature: 'AA',
    userHandle: 'AA',
  },
  clientExtensionResults: {},
  type: 'public-key' as const,
};

describe('passkeyLogin', () => {
  beforeEach(() => {
    mockSupports.mockReturnValue(true);
    mockStartAuth.mockResolvedValue(authResponse);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
    // the server's options are handed to the library verbatim
    expect(mockStartAuth).toHaveBeenCalledWith({ optionsJSON: challengeResp.options });
    expect(fetchMock.mock.calls[0][0]).toContain('/api/passkey-anon/sign/login-challenge');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/passkey-anon/sign/passkey-login');
    // the credential POSTed is exactly the library's response JSON
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).credential).toEqual(authResponse);
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

  it('throws webauthn_unsupported (fail-fast) when WebAuthn is unavailable', async () => {
    mockSupports.mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(passkeyLogin()).rejects.toMatchObject({ code: 'webauthn_unsupported' });
    expect(fetchMock).not.toHaveBeenCalled(); // bails before any network
    expect(mockStartAuth).not.toHaveBeenCalled();
  });
});
