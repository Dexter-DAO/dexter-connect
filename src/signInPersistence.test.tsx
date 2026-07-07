// @vitest-environment happy-dom
//
// Regression guard for the ledger-flagged gap: "SignInWithDexter never persists
// active handle." This exercises the REAL surface end-to-end — the actual
// <SignInWithDexter> component and useSignInWithDexter hook, the REAL passkeyLogin
// ceremony, and the REAL walletStore (NOT mocked) — mocking only the WebAuthn
// browser API and fetch. Success MUST leave getActiveHandle() === the vault's
// userHandle; that is the assertion that was failing when the note was written.
//
// Origin is set to the canonical Dexter origin so shouldUsePopup() routes inline
// (the dexter-fe production path); the component/hook expose no transport knob, so
// origin is the only lever — a fetch to /login-challenge proves the inline leg ran.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

import { startAuthentication } from '@simplewebauthn/browser';
import { SignInWithDexter } from './SignInWithDexter';
import { useSignInWithDexter } from './useSignInWithDexter';
import { getActiveHandle, listWallets, ACTIVE_WALLET_STORAGE_KEY } from './walletStore';
import type { SignInResult } from './types';
import { render, click } from './testRender';

const mockStartAuth = vi.mocked(startAuthentication);

interface HappyWindow {
  happyDOM?: { setURL?: (url: string) => void };
}

const fullVault = {
  vaultPda: 'vpda',
  swigAddress: 'swig-addr',
  receiveAddress: null,
  usdcAta: null,
  publicKey: 'pub',
  userHandle: 'handle-xyz',
  credentialId: 'cred-abc',
};

const authResponse = {
  id: 'cred-abc',
  rawId: 'cred-abc',
  response: {},
  clientExtensionResults: {},
  type: 'public-key',
} as unknown as Awaited<ReturnType<typeof startAuthentication>>;

/** fetch mock: /login-challenge then /passkey-login (with a vault in the payload). */
function stubLoginFetchWithVault(vault: unknown = fullVault): void {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ options: { challenge: 'ch' } }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: 1,
        expiresIn: 1,
        tokenType: 'bearer',
        vault,
      }),
    });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  (window as unknown as HappyWindow).happyDOM?.setURL?.('https://dexter.cash/wallet');
  window.localStorage.clear();
  mockStartAuth.mockResolvedValue(authResponse);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SignInWithDexter — active-handle persistence', () => {
  it('persists the active handle after a successful sign-in (component surface)', async () => {
    stubLoginFetchWithVault();
    // No active wallet before the ceremony.
    expect(getActiveHandle()).toBeNull();

    let settle!: (v: { ok: true; result: SignInResult } | { ok: false; error: unknown }) => void;
    const outcome = new Promise<
      { ok: true; result: SignInResult } | { ok: false; error: unknown }
    >((res) => {
      settle = res;
    });

    const { container } = await render(
      <SignInWithDexter
        onSuccess={(result) => settle({ ok: true, result })}
        onError={(error) => settle({ ok: false, error })}
      />,
    );

    await click(container.querySelector('button'));
    let o!: { ok: true; result: SignInResult } | { ok: false; error: unknown };
    await act(async () => {
      o = await outcome;
    });

    expect(o.ok).toBe(true);
    // THE regression assertion: the wallet store reflects the signed-in wallet.
    expect(getActiveHandle()).toBe('handle-xyz');
    expect(window.localStorage.getItem(ACTIVE_WALLET_STORAGE_KEY)).toBe('handle-xyz');
    // …and it was upserted into the roster (so switch/list see it too).
    expect(listWallets().map((w) => w.handle)).toContain('handle-xyz');
    // credentialId carried through for later Signal-API prune on eject.
    expect(listWallets().find((w) => w.handle === 'handle-xyz')?.credentialId).toBe('cred-abc');
  });

  it('does NOT persist a handle when the ceremony rejects (hook surface)', async () => {
    // login-challenge succeeds, passkey-login 401s → ConnectError, no vault.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ options: { challenge: 'ch' } }) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'nope' }) });
    vi.stubGlobal('fetch', fetchMock);

    let hook!: ReturnType<typeof useSignInWithDexter>;
    function Harness() {
      hook = useSignInWithDexter();
      return null;
    }
    await render(<Harness />);

    await act(async () => {
      await expect(hook.signIn()).rejects.toMatchObject({ code: 'nope' });
    });

    expect(getActiveHandle()).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_WALLET_STORAGE_KEY)).toBeNull();
  });
});
