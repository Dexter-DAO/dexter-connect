// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./relay', () => ({
  passkeyLogin: vi.fn(),
}));

import { passkeyLogin } from './relay';
import type { BindingFetch } from './bindingResolver';
import {
  connectDexterIdentity,
  disconnectDexterIdentity,
} from './identityTransition';
import {
  getActiveWallet,
  listWallets,
  setActiveWallet,
} from './walletStore';

const HANDLE_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const HANDLE_B = 'AQEBAQEBAQEBAQEBAQEBAQ';
const VAULT_A = '11111111111111111111111111111111';
const VAULT_B = 'So11111111111111111111111111111111111111112';

const resultB = {
  session: {
    accessToken: 'account-b',
    refreshToken: 'refresh-b',
    expiresAt: 2_000_000_000,
    expiresIn: 3_600,
    tokenType: 'bearer',
  },
  vault: {
    vaultPda: VAULT_B,
    swigAddress: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
    receiveAddress: null,
    usdcAta: null,
    publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    userHandle: HANDLE_B,
    credentialId: 'credential-b',
    walletLabel: 'Branch Wallet',
  },
  walletIdentityProof: {
    token: 'wallet-proof-b',
    tokenType: 'Bearer' as const,
    expiresAt: 2_000_000_000,
    expiresIn: 2_592_000,
  },
};

function response(relation: 'bound' | 'conflict'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ relation }),
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  setActiveWallet({
    handle: HANDLE_A,
    credentialId: 'credential-a',
    vaultPda: VAULT_A,
    label: 'Current Wallet',
  });
  vi.mocked(passkeyLogin).mockReset();
  vi.mocked(passkeyLogin).mockResolvedValue(resultB);
});

describe('canonical Dexter identity transition', () => {
  it('verifies B/B before replacing A/A', async () => {
    const bindingFetch = vi.fn<BindingFetch>(async () => response('bound'));
    const installAccountSession = vi.fn(async () => undefined);

    await connectDexterIdentity({ bindingFetch, installAccountSession });

    expect(passkeyLogin).toHaveBeenCalledWith(
      { walletStore: 'provisional' },
      undefined,
    );
    expect(bindingFetch).toHaveBeenCalledOnce();
    expect(bindingFetch.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer account-b',
        'X-Dexter-Wallet-Proof': 'wallet-proof-b',
      },
      body: JSON.stringify({
        activeWallet: { userHandle: HANDLE_B, vaultPda: VAULT_B },
      }),
    });
    expect(installAccountSession).toHaveBeenCalledWith(resultB.session);
    expect(getActiveWallet()?.handle).toBe(HANDLE_B);
  });

  it('leaves A active when the account session cannot be installed', async () => {
    await expect(
      connectDexterIdentity({
        bindingFetch: async () => response('bound'),
        installAccountSession: async () => {
          throw new Error('session rejected');
        },
      }),
    ).rejects.toMatchObject({ code: 'account_session_install_failed' });

    expect(getActiveWallet()?.handle).toBe(HANDLE_A);
  });

  it('does not publish B when the server reports a conflict', async () => {
    const installAccountSession = vi.fn(async () => undefined);

    await expect(
      connectDexterIdentity({
        bindingFetch: async () => response('conflict'),
        installAccountSession,
      }),
    ).rejects.toMatchObject({ code: 'identity_binding_conflict' });

    expect(installAccountSession).not.toHaveBeenCalled();
    expect(getActiveWallet()?.handle).toBe(HANDLE_A);
  });

  it('disconnects the active Wallet before clearing the account', async () => {
    const disconnected = await disconnectDexterIdentity({
      clearAccountSession: async () => {
        expect(getActiveWallet()).toBeNull();
      },
    });

    expect(disconnected).toBe(true);
    expect(getActiveWallet()).toBeNull();
    expect(listWallets().map((wallet) => wallet.handle)).toContain(HANDLE_A);
  });

  it('restores the active Wallet when account sign-out fails', async () => {
    await expect(
      disconnectDexterIdentity({
        clearAccountSession: async () => {
          throw new Error('host sign-out failed');
        },
      }),
    ).rejects.toMatchObject({ code: 'account_session_clear_failed' });

    expect(getActiveWallet()?.handle).toBe(HANDLE_A);
  });

  it('reports a failed rollback instead of claiming the prior identity was restored', async () => {
    let blockStorage = false;
    const setItem = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementation((key, value) => {
        if (
          blockStorage &&
          key === 'dexter:passkey:wallets' &&
          value.includes(HANDLE_A)
        ) {
          throw new Error('storage unavailable');
        }
        Storage.prototype.setItem.call(window.localStorage, key, value);
      });

    await expect(
      connectDexterIdentity({
        bindingFetch: async () => response('bound'),
        installAccountSession: async () => {
          blockStorage = true;
          throw new Error('session rejected');
        },
      }),
    ).rejects.toMatchObject({ code: 'identity_rollback_failed' });

    expect(getActiveWallet()?.handle).toBe(HANDLE_B);
    setItem.mockRestore();
  });
});
