import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// createWallet delegates the WebAuthn create() + base64url marshalling to
// @simplewebauthn/browser, so we mock at THAT boundary and drive the ceremony
// via mocked fetch — asserting the /initialize body the SDK actually POSTs.
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(),
}));

// Popup transport mocked at the boundary so the third-party-origin create path
// can be driven without a real window.open. shouldUsePopup routes on transport:
// 'popup' → popup, else inline (the inline tests below pass transport:'inline').
vi.mock('./popup', () => ({
  shouldUsePopup: vi.fn((t?: string) => t === 'popup'),
  openCeremonyPopup: vi.fn(),
}));

// setActiveWallet is the persistence sink under test.
vi.mock('./walletStore', () => ({
  setActiveWallet: vi.fn(() => true),
}));

vi.mock('./walletProofSession', () => ({
  walletProofSessionStore: {
    save: vi.fn(() => ({ kind: 'dexter_wallet_proof_session' })),
    clear: vi.fn(() => true),
  },
}));

import { createWallet } from './enroll';
import { SESSION_TTL_30D, authoredPolicy } from './policy';
import { ConnectError } from './types';
import { startRegistration } from '@simplewebauthn/browser';
import { openCeremonyPopup } from './popup';
import { setActiveWallet } from './walletStore';

const mockStartReg = vi.mocked(startRegistration);
const mockPopup = vi.mocked(openCeremonyPopup);
const mockSetActiveWallet = vi.mocked(setActiveWallet);

const challengeResp = {
  options: {
    challenge: 'dGVzdC1jaGFsbGVuZ2U', // base64url("test-challenge")
    rp: { id: 'dexter.cash' },
    user: { id: 'dXNlcg', name: '', displayName: '' },
    pubKeyCredParams: [],
  },
};

// What startRegistration() resolves to — server-ready credential JSON.
const regResponse = {
  id: 'cred-abc',
  rawId: 'cred-abc',
  response: { attestationObject: 'AA', clientDataJSON: 'AA' },
  clientExtensionResults: {},
  type: 'public-key' as const,
};

const walletIdentityProof = {
  token: 'wallet-proof',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};
const enrolledResp = {
  credentialId: 'cred-abc',
  publicKey: 'pubkey',
  userHandle: 'handle-xyz',
  walletIdentityProof,
};
const initResp = { vaultPda: 'vpda', receiveAddress: null, swigStateAddress: 'swig' };

/** Mock the three-leg ceremony: challenge → complete → initialize. */
function mockCeremonyFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
    .mockResolvedValueOnce({ ok: true, json: async () => enrolledResp })
    .mockResolvedValueOnce({ ok: true, json: async () => initResp });
}

/** Find the /initialize POST body among the fetch calls. */
function initBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/initialize'));
  if (!call) throw new Error('no /initialize call recorded');
  return JSON.parse((call[1] as { body: string }).body);
}

describe('createWallet — spendPolicy on the /initialize body', () => {
  beforeEach(() => {
    mockStartReg.mockResolvedValue(regResponse);
    // navigator.credentials must be truthy so the inline path proceeds; the
    // real create() is intercepted by the startRegistration mock above.
    vi.stubGlobal('navigator', { credentials: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('omits the policy fields when no spendPolicy is authored', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    await createWallet({ transport: 'inline' });

    const body = initBody(fetchMock);
    expect(body.userHandle).toBe('handle-xyz');
    expect(body.coolingOffSeconds).toBe(0);
    expect(body).not.toHaveProperty('spendLimitAtomic');
    expect(body).not.toHaveProperty('sessionTtlSeconds');
  });

  it('creates an explicit deferred wallet owner-only with no spend policy fields', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    await createWallet({ transport: 'inline', agentDelegation: 'deferred' });

    const body = initBody(fetchMock);
    expect(body.userHandle).toBe('handle-xyz');
    expect(body).not.toHaveProperty('spendLimitAtomic');
    expect(body).not.toHaveProperty('sessionTtlSeconds');
  });

  it('rejects a deferred wallet carrying a spend policy before any ceremony side effect', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createWallet({
        transport: 'inline',
        agentDelegation: 'deferred',
        spendPolicy: authoredPolicy('20')!,
      }),
    ).rejects.toMatchObject({ code: 'conflicting_agent_delegation' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockStartReg).not.toHaveBeenCalled();
  });

  it('carries the authored allowance + fixed TTL when a spendPolicy is present', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    await createWallet({ transport: 'inline', spendPolicy: authoredPolicy('20')! });

    const body = initBody(fetchMock);
    expect(body.spendLimitAtomic).toBe('20000000');
    expect(body.sessionTtlSeconds).toBe(SESSION_TTL_30D);
  });

  it('overwrites a tampered sessionTtlSeconds with the fixed 30d TTL (TTL is ruled)', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    // A caller hands a policy object whose TTL was tampered to something short.
    await createWallet({
      transport: 'inline',
      spendPolicy: { spendLimitAtomic: '5000000', sessionTtlSeconds: '999' },
    });

    const body = initBody(fetchMock);
    expect(body.spendLimitAtomic).toBe('5000000');
    // The wire ALWAYS carries SESSION_TTL_30D regardless of the caller's object.
    expect(body.sessionTtlSeconds).toBe('2592000');
    expect(body.sessionTtlSeconds).not.toBe('999');
  });
});

describe('createWallet — wallet-store modes', () => {
  beforeEach(() => {
    mockStartReg.mockResolvedValue(regResponse);
    vi.stubGlobal('navigator', { credentials: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps the historical inline commit behavior when walletStore is omitted', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await createWallet({ transport: 'inline', name: 'Committed Wallet' });

    expect(result).toMatchObject({
      handle: 'handle-xyz',
      credentialId: 'cred-abc',
      vault: { vaultPda: 'vpda', userHandle: 'handle-xyz' },
    });
    expect(mockSetActiveWallet).toHaveBeenCalledOnce();
    expect(mockSetActiveWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'handle-xyz',
        label: 'Committed Wallet',
        credentialId: 'cred-abc',
        vaultPda: 'vpda',
      }),
    );
  });

  it('returns the completed inline wallet provisionally without active-handle or roster writes', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await createWallet({
      transport: 'inline',
      name: 'Provisional Wallet',
      walletStore: 'provisional',
    });

    expect(result).toMatchObject({
      handle: 'handle-xyz',
      credentialId: 'cred-abc',
      vault: { vaultPda: 'vpda', userHandle: 'handle-xyz' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockStartReg).toHaveBeenCalledOnce();
    expect(mockSetActiveWallet).not.toHaveBeenCalled();
  });
});

// ── Third-party-origin create runs in the hosted popup. Commit mode mirrors the
//    returned wallet on the CALLER's origin. Provisional mode passes the exact
//    host flag and keeps both host and caller stores untouched.
describe('createWallet — popup persistence', () => {
  const popupResult = {
    handle: 'popup-handle',
    credentialId: 'popup-cred',
    label: 'Popup Wallet',
    walletIdentityProof,
    vault: {
      vaultPda: 'vpda',
      swigAddress: 'swig',
      receiveAddress: null,
      usdcAta: null,
      publicKey: 'pub',
      userHandle: 'popup-handle',
      credentialId: 'popup-cred',
      walletLabel: 'Popup Wallet',
    },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('persists the active handle from the CreateWalletResult (label = name)', async () => {
    mockPopup.mockResolvedValueOnce(popupResult);

    const out = await createWallet({
      transport: 'popup',
      name: 'Popup Wallet',
      apiBase: 'https://api.dexter.cash',
    });

    expect(mockPopup).toHaveBeenCalledWith('create', {
      connectHost: undefined,
      name: 'Popup Wallet',
      agentDelegation: 'deferred',
    });
    expect(mockSetActiveWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'popup-handle',
        label: 'Popup Wallet',
        credentialId: 'popup-cred',
      }),
    );
    expect(out).toEqual(popupResult);
  });

  it('keeps explicit popup commit mode backward-compatible and out of the URL', async () => {
    mockPopup.mockResolvedValueOnce(popupResult);

    const out = await createWallet({
      transport: 'popup',
      name: 'Popup Wallet',
      walletStore: 'commit',
    });

    expect(mockPopup).toHaveBeenCalledWith('create', {
      connectHost: undefined,
      name: 'Popup Wallet',
      agentDelegation: 'deferred',
    });
    expect(mockSetActiveWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'popup-handle',
        label: 'Popup Wallet',
        credentialId: 'popup-cred',
      }),
    );
    expect(out).toEqual(popupResult);
  });

  it('requests exact provisional host behavior and does not commit on the caller origin', async () => {
    mockPopup.mockResolvedValueOnce(popupResult);

    const out = await createWallet({
      transport: 'popup',
      name: 'Popup Wallet',
      walletStore: 'provisional',
    });

    expect(mockPopup).toHaveBeenCalledWith('create', {
      connectHost: undefined,
      name: 'Popup Wallet',
      walletStore: 'provisional',
      agentDelegation: 'deferred',
    });
    expect(mockSetActiveWallet).not.toHaveBeenCalled();
    expect(out).toEqual(popupResult);
  });

  it('requests the explicit deferred agent flow from the hosted ceremony', async () => {
    mockPopup.mockResolvedValueOnce(popupResult);

    await createWallet({
      transport: 'popup',
      name: 'Cattle Rider',
      agentDelegation: 'deferred',
    });

    expect(mockPopup).toHaveBeenCalledWith('create', {
      connectHost: undefined,
      name: 'Cattle Rider',
      agentDelegation: 'deferred',
    });
  });

  it('does NOT persist when the ceremony is rejected', async () => {
    mockPopup.mockRejectedValueOnce(new ConnectError('popup_closed'));

    await expect(createWallet({ transport: 'popup' })).rejects.toMatchObject({
      code: 'popup_closed',
    });
    expect(mockSetActiveWallet).not.toHaveBeenCalled();
  });

  it('rejects a hostile API base before popup, fetch, or WebAuthn', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createWallet({ transport: 'popup', apiBase: 'https://attacker.example' }),
    ).rejects.toMatchObject({ code: 'untrusted_api_base' });
    expect(mockPopup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockStartReg).not.toHaveBeenCalled();
  });

  it('rejects an adjacent wallet-store mode before popup, fetch, or WebAuthn', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createWallet({
        transport: 'popup',
        walletStore: 'provisionally' as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid_wallet_store_mode' });
    expect(mockPopup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockStartReg).not.toHaveBeenCalled();
    expect(mockSetActiveWallet).not.toHaveBeenCalled();
  });

  it('rejects an adjacent agent-delegation mode before popup, fetch, or WebAuthn', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createWallet({
        transport: 'popup',
        agentDelegation: 'later' as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid_agent_delegation_mode' });
    expect(mockPopup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockStartReg).not.toHaveBeenCalled();
  });
});

describe('createWallet — name-at-birth on the /initialize body', () => {
  beforeEach(() => {
    mockStartReg.mockResolvedValue(regResponse);
    vi.stubGlobal('navigator', { credentials: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sends the chosen name as label and echoes the server-confirmed label on the result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
      .mockResolvedValueOnce({ ok: true, json: async () => enrolledResp })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...initResp, walletLabel: 'voice test' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createWallet({ transport: 'inline', name: 'voice test' });

    expect(initBody(fetchMock).label).toBe('voice test');
    expect(result.label).toBe('voice test');
    expect(result.vault.walletLabel).toBe('voice test');
  });

  it('omits label when no name is chosen; result.label is null', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await createWallet({ transport: 'inline' });

    expect(initBody(fetchMock)).not.toHaveProperty('label');
    expect(result.label).toBeNull();
  });
});
