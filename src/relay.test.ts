import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// passkeyLogin now delegates the WebAuthn get() + base64url marshalling to
// @simplewebauthn/browser, so we mock at THAT boundary: control the library's
// output and assert passkeyLogin's own behavior (challenge → assert → login).
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

// The popup transport is mocked at the module boundary so we can drive the
// popup success/rejection paths deterministically (no real window.open). The
// stubbed shouldUsePopup routes on transport only: 'popup' → popup, else inline
// (matching the real fn's default on a non-canonical origin vs SSR).
vi.mock('./popup', () => ({
  shouldUsePopup: vi.fn((t?: string) => t === 'popup'),
  openCeremonyPopup: vi.fn(),
}));

// setActiveHandle is the persistence sink under test — spy on it. getActiveHandle
// is only read by continueWithDexter's inline branch (not exercised here).
vi.mock('./walletStore', () => ({
  setActiveHandle: vi.fn(),
  getActiveHandle: vi.fn(() => null),
}));

import { passkeyLogin, continueWithDexter } from './relay';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { openCeremonyPopup } from './popup';
import { setActiveHandle } from './walletStore';
import { ConnectError } from './types';

const mockStartAuth = vi.mocked(startAuthentication);
const mockSupports = vi.mocked(browserSupportsWebAuthn);
const mockPopup = vi.mocked(openCeremonyPopup);
const mockSetActiveHandle = vi.mocked(setActiveHandle);

// A full ConnectVault (all fields present) for the persistence assertions.
const fullVault = {
  vaultPda: 'vpda',
  swigAddress: 'swig',
  receiveAddress: null,
  usdcAta: null,
  publicKey: 'pub',
  userHandle: 'u-handle',
  credentialId: 'c-id',
};

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

// ── Active-handle persistence (the bug: successful ceremonies left the store
//    empty because these paths returned the result without calling
//    setActiveHandle). Each path must persist on success and stay silent when
//    there's no vault or the ceremony rejects.
describe('passkeyLogin — active-handle persistence', () => {
  beforeEach(() => {
    mockSupports.mockReturnValue(true);
    mockStartAuth.mockResolvedValue(authResponse);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('inline: persists the active handle when the login returns a vault', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...tokensResp, vault: fullVault }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await passkeyLogin({ transport: 'inline' });

    expect(result.vault).toEqual(fullVault);
    expect(mockSetActiveHandle).toHaveBeenCalledWith('u-handle', undefined, 'c-id');
  });

  it('inline: does NOT persist when the login returns no vault', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: true, json: async () => tokensResp });
    vi.stubGlobal('fetch', fetchMock);

    await passkeyLogin({ transport: 'inline' });

    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });

  it('popup: persists the active handle from the popup vault result', async () => {
    mockPopup.mockResolvedValueOnce({ session: tokensResp, vault: fullVault });

    const result = await passkeyLogin({ transport: 'popup' });

    expect(mockPopup).toHaveBeenCalledWith('signin', expect.anything());
    expect(result.vault).toEqual(fullVault);
    expect(mockSetActiveHandle).toHaveBeenCalledWith('u-handle', undefined, 'c-id');
  });

  it('popup: does NOT persist when the popup result has no vault', async () => {
    mockPopup.mockResolvedValueOnce({ session: tokensResp });

    await passkeyLogin({ transport: 'popup' });

    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });

  it('popup: does NOT persist when the ceremony is rejected', async () => {
    mockPopup.mockRejectedValueOnce(new ConnectError('popup_closed'));

    await expect(passkeyLogin({ transport: 'popup' })).rejects.toMatchObject({
      code: 'popup_closed',
    });
    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });
});

describe('continueWithDexter — popup persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('popup create: persists from the top-level handle/credentialId (label = name)', async () => {
    mockPopup.mockResolvedValueOnce({
      kind: 'create',
      handle: 'new-handle',
      credentialId: 'new-cred',
      vault: { ...fullVault, userHandle: 'new-handle', credentialId: 'new-cred' },
    });

    const result = await continueWithDexter({ transport: 'popup', name: 'My Wallet' });

    expect(result.kind).toBe('create');
    expect(mockPopup).toHaveBeenCalledWith('continue', expect.anything());
    expect(mockSetActiveHandle).toHaveBeenCalledWith('new-handle', 'My Wallet', 'new-cred');
  });

  it('popup signin: persists guarded on the vault userHandle', async () => {
    mockPopup.mockResolvedValueOnce({
      kind: 'signin',
      session: tokensResp,
      vault: { ...fullVault, userHandle: 'signin-handle', credentialId: 'signin-cred' },
    });

    await continueWithDexter({ transport: 'popup' });

    expect(mockSetActiveHandle).toHaveBeenCalledWith('signin-handle', undefined, 'signin-cred');
  });

  it('popup signin without a vault: does NOT persist', async () => {
    mockPopup.mockResolvedValueOnce({ kind: 'signin', session: tokensResp });

    await continueWithDexter({ transport: 'popup' });

    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });

  it('popup: does NOT persist when the ceremony is rejected', async () => {
    mockPopup.mockRejectedValueOnce(new ConnectError('popup_closed'));

    await expect(continueWithDexter({ transport: 'popup' })).rejects.toMatchObject({
      code: 'popup_closed',
    });
    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });
});

// ── continueWithDexter inline — the keychain-first decision rule ─────────────
// localStorage presence is NOT identity: these pin the rule that a synced
// passkey on a fresh device signs in (probe) and is never guess-created over.
vi.mock('./immediate', () => ({
  immediateGetSupported: vi.fn(async () => false),
  immediateAuthentication: vi.fn(),
  classifyWebAuthnRejection: vi.fn(() => false),
  primeImmediateSupport: vi.fn(),
}));
vi.mock('./enroll', () => ({
  createWallet: vi.fn(),
}));

import {
  immediateGetSupported,
  immediateAuthentication,
  classifyWebAuthnRejection,
} from './immediate';
import { createWallet } from './enroll';
import { getActiveHandle } from './walletStore';

const mockImmSupported = vi.mocked(immediateGetSupported);
const mockImmAuth = vi.mocked(immediateAuthentication);
const mockClassify = vi.mocked(classifyWebAuthnRejection);
const mockCreate = vi.mocked(createWallet);
const mockGetHandle = vi.mocked(getActiveHandle);

const vaultWithLabel = { ...fullVault, walletLabel: 'voice test' };

describe('continueWithDexter — keychain-first inline decisions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('immediate probe finds a passkey → full sign-in, label persisted (fresh-device case)', async () => {
    mockImmSupported.mockResolvedValue(true);
    mockImmAuth.mockResolvedValue(authResponse);
    mockGetHandle.mockReturnValue(null); // empty localStorage — must NOT create
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...tokensResp, vault: vaultWithLabel }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await continueWithDexter({ transport: 'inline' });

    expect(result.kind).toBe('signin');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSetActiveHandle).toHaveBeenCalledWith('u-handle', 'voice test', 'c-id');
  });

  it('immediate fast-fail without an authored spendPolicy → needs_create (no consent, no birth)', async () => {
    mockImmSupported.mockResolvedValue(true);
    mockImmAuth.mockRejectedValue(new DOMException('no credential', 'NotAllowedError'));
    mockClassify.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => challengeResp });
    vi.stubGlobal('fetch', fetchMock);

    const result = await continueWithDexter({ transport: 'inline' });

    expect(result.kind).toBe('needs_create');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('immediate fast-fail WITH an authored spendPolicy → auto-create', async () => {
    mockImmSupported.mockResolvedValue(true);
    mockImmAuth.mockRejectedValue(new DOMException('no credential', 'NotAllowedError'));
    mockClassify.mockReturnValue(true);
    mockCreate.mockResolvedValue({
      handle: 'new-h',
      credentialId: 'new-c',
      vault: { ...fullVault, walletLabel: 'fresh' },
      label: 'fresh',
    });
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => challengeResp });
    vi.stubGlobal('fetch', fetchMock);

    const result = await continueWithDexter({
      transport: 'inline',
      spendPolicy: { spendLimitAtomic: '5000000', sessionTtlSeconds: 2592000 },
    });

    expect(result.kind).toBe('create');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('no immediate support + a local handle → modal sign-in (passkey lived here)', async () => {
    mockImmSupported.mockResolvedValue(false);
    mockGetHandle.mockReturnValue('local-h');
    mockSupports.mockReturnValue(true);
    mockStartAuth.mockResolvedValue(authResponse);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...tokensResp, vault: vaultWithLabel }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await continueWithDexter({ transport: 'inline' });

    expect(result.kind).toBe('signin');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('no immediate support + no local handle → needs_choice, never guess-create', async () => {
    mockImmSupported.mockResolvedValue(false);
    mockGetHandle.mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn());

    const result = await continueWithDexter({ transport: 'inline' });

    expect(result.kind).toBe('needs_choice');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockStartAuth).not.toHaveBeenCalled();
  });
});
