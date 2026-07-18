import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// recoverWallet delegates WebAuthn to @simplewebauthn/browser (modal path) or
// the immediate bridge, so we mock at those boundaries and drive the ceremony
// via mocked fetch — asserting the exact endpoint order and bodies.
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

vi.mock('./popup', () => ({
  shouldUsePopup: vi.fn((t?: string) => t === 'popup'),
  openCeremonyPopup: vi.fn(),
}));

vi.mock('./walletStore', () => ({
  setActiveHandle: vi.fn(),
}));

// Keep the REAL rejection classifier; mock only the capability probe + bridge.
vi.mock('./immediate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./immediate')>();
  return {
    ...orig,
    primeImmediateSupport: vi.fn(),
    immediateGetSupported: vi.fn(async () => false),
    immediateAuthentication: vi.fn(),
  };
});

import { recoverWallet } from './recover';
import { startAuthentication } from '@simplewebauthn/browser';
import { openCeremonyPopup } from './popup';
import { setActiveHandle } from './walletStore';
import { immediateGetSupported, immediateAuthentication } from './immediate';
import { ConnectError } from './types';

const mockStartAuth = vi.mocked(startAuthentication);
const mockPopup = vi.mocked(openCeremonyPopup);
const mockSetActiveHandle = vi.mocked(setActiveHandle);
const mockImmediateSupported = vi.mocked(immediateGetSupported);
const mockImmediateAuth = vi.mocked(immediateAuthentication);

const challengeResp = {
  options: { challenge: 'dGVzdC1jaGFsbGVuZ2U', rpId: 'dexter.cash', userVerification: 'required' },
};

const assertionResp = {
  id: 'cred-abc',
  rawId: 'cred-abc',
  response: { clientDataJSON: 'AA', authenticatorData: 'AA', signature: 'AA' },
  clientExtensionResults: {},
  type: 'public-key' as const,
};

const verifyResp = { verified: true, credentialId: 'cred-abc', userHandle: 'handle-xyz' };

const statusResp = {
  enrolled: true,
  hasVault: true,
  vault: {
    vaultPda: 'vpda',
    swigAddress: 'swig',
    receiveAddress: 'recv',
    isActivated: true,
    walletLabel: 'BranchWallet',
  },
  credentialId: 'cred-abc',
};

/** Mock the three-leg ceremony: recover-challenge → recover-verify → vault status. */
function mockCeremonyFetch(overrides?: { verify?: unknown; status?: unknown }) {
  return vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => challengeResp })
    .mockResolvedValueOnce(overrides?.verify ?? { ok: true, json: async () => verifyResp })
    .mockResolvedValueOnce(overrides?.status ?? { ok: true, json: async () => statusResp });
}

beforeEach(() => {
  mockStartAuth.mockResolvedValue(assertionResp);
  vi.stubGlobal('navigator', { credentials: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('recoverWallet — inline leg', () => {
  it('runs challenge → verify → status, persists AFTER vault confirmation, returns the vault', async () => {
    const fetchMock = mockCeremonyFetch();
    vi.stubGlobal('fetch', fetchMock);

    const phases: string[] = [];
    const out = await recoverWallet({ transport: 'inline', onPhase: (p) => phases.push(p) });

    expect(out).toEqual({
      ok: true,
      userHandle: 'handle-xyz',
      credentialId: 'cred-abc',
      vault: {
        vaultPda: 'vpda',
        swigAddress: 'swig',
        receiveAddress: 'recv',
        isActivated: true,
        walletLabel: 'BranchWallet',
      },
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('/api/passkey-anon/sign/recover-challenge');
    expect(urls[1]).toContain('/api/passkey-anon/sign/recover-verify');
    expect(urls[2]).toContain('/api/passkey-vault-anon/status?user_handle=handle-xyz');
    expect(JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)).toEqual({
      credential: assertionResp,
    });
    // Persistence carries label + credentialId (richer than the fe donor, which dropped both).
    expect(mockSetActiveHandle).toHaveBeenCalledWith('handle-xyz', 'BranchWallet', 'cred-abc');
    expect(phases).toEqual(['challenge', 'passkey', 'verifying']);
  });

  it('verify 404 (passkey with no server row) → no_credential, nothing persisted', async () => {
    const fetchMock = mockCeremonyFetch({
      verify: { ok: false, status: 404, json: async () => ({ error: 'credential_not_found' }) },
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await recoverWallet({ transport: 'inline' });
    expect(out).toEqual({ ok: false, reason: 'no_credential' });
    expect(mockSetActiveHandle).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2); // no status fetch after a failed verify
  });

  it('modal dismissal (NotAllowedError) → cancelled, nothing persisted', async () => {
    vi.stubGlobal('fetch', mockCeremonyFetch());
    mockStartAuth.mockRejectedValue(new DOMException('dismissed', 'NotAllowedError'));

    const out = await recoverWallet({ transport: 'inline' });
    expect(out).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });

  it('immediate mode: uses the bridge; instant rejection → no_credential (no wallet on this device)', async () => {
    vi.stubGlobal('fetch', mockCeremonyFetch());
    mockImmediateSupported.mockResolvedValue(true);
    mockImmediateAuth.mockRejectedValue(new DOMException('no credential', 'NotAllowedError'));

    const out = await recoverWallet({ transport: 'inline', preferImmediate: true });
    expect(out).toEqual({ ok: false, reason: 'no_credential' });
    expect(mockImmediateAuth).toHaveBeenCalled();
    expect(mockStartAuth).not.toHaveBeenCalled();
  });

  it('preferImmediate without browser support falls back to the modal', async () => {
    vi.stubGlobal('fetch', mockCeremonyFetch());
    mockImmediateSupported.mockResolvedValue(false);

    const out = await recoverWallet({ transport: 'inline', preferImmediate: true });
    expect(out.ok).toBe(true);
    expect(mockStartAuth).toHaveBeenCalled();
    expect(mockImmediateAuth).not.toHaveBeenCalled();
  });

  it('credential verified but no vault → error vault_not_found, nothing persisted (donor-quirk fix)', async () => {
    const fetchMock = mockCeremonyFetch({
      status: { ok: true, json: async () => ({ enrolled: true, hasVault: false, vault: null }) },
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await recoverWallet({ transport: 'inline' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('error');
      expect(out.error?.code).toBe('vault_not_found');
    }
    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });

  it('challenge failure surfaces the server code as an error outcome', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'challenge_failed' }) });
    vi.stubGlobal('fetch', fetchMock);

    const out = await recoverWallet({ transport: 'inline' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('error');
      expect(out.error?.code).toBe('challenge_failed');
    }
  });

  it('non-browser / no WebAuthn → error webauthn_unsupported (never throws)', async () => {
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
    vi.mocked(browserSupportsWebAuthn).mockReturnValueOnce(false);

    const out = await recoverWallet({ transport: 'inline' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error?.code).toBe('webauthn_unsupported');
  });
});

describe('recoverWallet — popup leg', () => {
  const okOutcome = {
    ok: true,
    userHandle: 'handle-xyz',
    credentialId: 'cred-abc',
    vault: {
      vaultPda: 'vpda',
      swigAddress: 'swig',
      receiveAddress: 'recv',
      isActivated: true,
      walletLabel: 'BranchWallet',
    },
  };

  it("sends op='recover' with preferImmediate, relays the outcome, re-persists on the consumer origin", async () => {
    mockPopup.mockResolvedValue(okOutcome);

    const out = await recoverWallet({ transport: 'popup', preferImmediate: true });
    expect(out).toEqual(okOutcome);
    expect(mockPopup).toHaveBeenCalledWith('recover', expect.objectContaining({ preferImmediate: true }));
    // The receiver's inline run wrote dexter.cash localStorage only — the SDK
    // must re-persist on the CALLER's origin (enroll.ts popup precedent).
    expect(mockSetActiveHandle).toHaveBeenCalledWith('handle-xyz', 'BranchWallet', 'cred-abc');
  });

  it('relays a not-ok outcome verbatim without persisting', async () => {
    mockPopup.mockResolvedValue({ ok: false, reason: 'no_credential' });
    const out = await recoverWallet({ transport: 'popup' });
    expect(out).toEqual({ ok: false, reason: 'no_credential' });
    expect(mockSetActiveHandle).not.toHaveBeenCalled();
  });

  it('popup_closed (user shut the window) → cancelled', async () => {
    mockPopup.mockRejectedValue(new ConnectError('popup_closed', 'the sign-in window was closed'));
    const out = await recoverWallet({ transport: 'popup' });
    expect(out).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('popup_blocked → error outcome carrying the ConnectError', async () => {
    mockPopup.mockRejectedValue(new ConnectError('popup_blocked', 'blocked'));
    const out = await recoverWallet({ transport: 'popup' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('error');
      expect(out.error?.code).toBe('popup_blocked');
    }
  });
});
