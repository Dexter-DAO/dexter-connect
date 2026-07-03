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

// setActiveHandle is the persistence sink under test — spy on it.
vi.mock('./walletStore', () => ({
  setActiveHandle: vi.fn(),
}));

import { createWallet } from './enroll';
import { SESSION_TTL_30D, authoredPolicy } from './policy';
import { ConnectError } from './types';
import { startRegistration } from '@simplewebauthn/browser';
import { openCeremonyPopup } from './popup';
import { setActiveHandle } from './walletStore';

const mockStartReg = vi.mocked(startRegistration);
const mockPopup = vi.mocked(openCeremonyPopup);
const mockSetActiveHandle = vi.mocked(setActiveHandle);

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

const enrolledResp = { credentialId: 'cred-abc', publicKey: 'pubkey', userHandle: 'handle-xyz' };
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

// ── Third-party-origin create runs in the hosted popup. The bug: the popup
//    early-return handed back the CreateWalletResult without persisting, so the
//    caller's localStorage stayed empty after a successful create. Fix persists
//    from the returned result on the CALLER's origin.
describe('createWallet — popup persistence', () => {
  const popupResult = {
    handle: 'popup-handle',
    credentialId: 'popup-cred',
    vault: {
      vaultPda: 'vpda',
      swigAddress: 'swig',
      receiveAddress: null,
      usdcAta: null,
      publicKey: 'pub',
      userHandle: 'popup-handle',
      credentialId: 'popup-cred',
    },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('persists the active handle from the CreateWalletResult (label = name)', async () => {
    mockPopup.mockResolvedValueOnce(popupResult);

    const out = await createWallet({ transport: 'popup', name: 'Popup Wallet' });

    expect(mockPopup).toHaveBeenCalledWith('create', expect.anything());
    expect(mockSetActiveHandle).toHaveBeenCalledWith('popup-handle', 'Popup Wallet', 'popup-cred');
    expect(out).toEqual(popupResult);
  });

  it('does NOT persist when the ceremony is rejected', async () => {
    mockPopup.mockRejectedValueOnce(new ConnectError('popup_closed'));

    await expect(createWallet({ transport: 'popup' })).rejects.toMatchObject({
      code: 'popup_closed',
    });
    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });
});
