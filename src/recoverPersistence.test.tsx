// @vitest-environment happy-dom
//
// P0c.2 — the recover mode exercised end-to-end on the REAL surface: the actual
// <SignInWithDexter mode="recover"> component and useSignInWithDexter hook, the
// REAL recoverWallet ceremony, and the REAL walletStore — mocking only the
// WebAuthn browser API and fetch. Origin pinned to dexter.cash so the inline
// leg runs (the dexter-fe header path this mode replaces).

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
import type { RecoverOutcome } from './types';
import { render, click } from './testRender';

const mockStartAuth = vi.mocked(startAuthentication);

interface HappyWindow {
  happyDOM?: { setURL?: (url: string) => void };
}

const authResponse = {
  id: 'cred-abc',
  rawId: 'cred-abc',
  response: {},
  clientExtensionResults: {},
  type: 'public-key',
} as unknown as Awaited<ReturnType<typeof startAuthentication>>;

/** fetch mock: recover-challenge → recover-verify → vault status. */
function stubRecoverFetch(): void {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ options: { challenge: 'ch' } }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true, credentialId: 'cred-abc', userHandle: 'handle-xyz' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        enrolled: true,
        hasVault: true,
        vault: {
          vaultPda: 'vpda',
          swigAddress: 'swig-addr',
          receiveAddress: null,
          isActivated: true,
          walletLabel: 'BranchWallet',
        },
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

describe('SignInWithDexter mode="recover"', () => {
  it('persists handle + label + credentialId, fires onRecovered, mints NO session, then renders null', async () => {
    stubRecoverFetch();
    expect(getActiveHandle()).toBeNull();

    let settle!: (o: RecoverOutcome) => void;
    const outcome = new Promise<RecoverOutcome>((res) => {
      settle = res;
    });

    const { container } = await render(
      <SignInWithDexter mode="recover" preferImmediate onRecovered={settle} />,
    );

    await click(container.querySelector('button'));
    let o!: RecoverOutcome;
    await act(async () => {
      o = await outcome;
    });

    expect(o.ok).toBe(true);
    expect(getActiveHandle()).toBe('handle-xyz');
    expect(window.localStorage.getItem(ACTIVE_WALLET_STORAGE_KEY)).toBe('handle-xyz');
    const row = listWallets().find((w) => w.handle === 'handle-xyz');
    expect(row?.credentialId).toBe('cred-abc');
    expect(row?.label).toBe('BranchWallet');
    // Wallet-only: the component disappears after success — identity display
    // belongs to DexterWalletChip/useIdentity, and no session exists anywhere.
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('.dx-chip')).toBeNull();
  });

  it('dismissing the sheet → onRecovered({cancelled}), nothing persisted, onError NOT fired', async () => {
    stubRecoverFetch();
    mockStartAuth.mockRejectedValue(new DOMException('dismissed', 'NotAllowedError'));

    let settle!: (o: RecoverOutcome) => void;
    const outcome = new Promise<RecoverOutcome>((res) => {
      settle = res;
    });
    const onError = vi.fn();

    const { container } = await render(
      <SignInWithDexter mode="recover" onRecovered={settle} onError={onError} />,
    );

    await click(container.querySelector('button'));
    let o!: RecoverOutcome;
    await act(async () => {
      o = await outcome;
    });

    expect(o).toEqual({ ok: false, reason: 'cancelled' });
    expect(getActiveHandle()).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    // Cancel is a normal outcome — the button stays available for another tap.
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('hook surface: recover() resolves the outcome, session stays null, status done', async () => {
    stubRecoverFetch();

    let hook!: ReturnType<typeof useSignInWithDexter>;
    function Harness() {
      hook = useSignInWithDexter();
      return null;
    }
    await render(<Harness />);

    let out!: RecoverOutcome;
    await act(async () => {
      out = await hook.recover();
    });

    expect(out.ok).toBe(true);
    expect(hook.recovered).toEqual(out);
    expect(hook.session).toBeNull();
    expect(hook.status).toBe('done');
    expect(getActiveHandle()).toBe('handle-xyz');
  });
});
