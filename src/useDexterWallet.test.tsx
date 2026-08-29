// @vitest-environment happy-dom

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./signals', () => ({
  passkeySignalSupport: vi.fn(() => ({ rename: true, prune: true, syncAccepted: true })),
  renamePasskey: vi.fn(async () => true),
  prunePasskey: vi.fn(async () => true),
}));

import { prunePasskey } from './signals';
import { DEVICE_WALLET_REMOVAL_CONFIRMATION } from './walletStore';
import { walletProofSessionStore } from './walletProofSession';
import { useDexterWallet, type UseDexterWallet } from './useDexterWallet';
import { render } from './testRender';

const mockPrunePasskey = vi.mocked(prunePasskey);
const walletIdentityProof = {
  token: 'wallet-proof',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mockPrunePasskey.mockResolvedValue(true);
});

async function renderWalletHook(): Promise<{
  current: () => UseDexterWallet;
  unmount: () => Promise<void>;
}> {
  let wallet!: UseDexterWallet;
  function Harness() {
    wallet = useDexterWallet();
    return null;
  }
  const view = await render(<Harness />);
  return { current: () => wallet, unmount: view.unmount };
}

describe('useDexterWallet lifecycle actions', () => {
  it('keeps the OS passkey when disconnecting or forgetting a roster row', async () => {
    const hook = await renderWalletHook();
    await act(async () => {
      hook.current().activate({ handle: 'AAAA', credentialId: 'cred-a' });
      walletProofSessionStore.save('AAAA', walletIdentityProof);
    });

    await act(async () => {
      expect(hook.current().disconnect()).toBe(true);
    });
    expect(hook.current().activeHandle).toBeNull();
    expect(hook.current().wallets.map((wallet) => wallet.handle)).toEqual(['AAAA']);
    expect(walletProofSessionStore.load('AAAA')).not.toBeNull();
    expect(mockPrunePasskey).not.toHaveBeenCalled();

    await act(async () => {
      expect(hook.current().switchTo('AAAA')).toBe(true);
      hook.current().forget('AAAA');
    });
    expect(hook.current().wallets).toEqual([]);
    expect(walletProofSessionStore.load('AAAA')).not.toBeNull();
    expect(mockPrunePasskey).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it('requires explicit device-removal confirmation before pruning a passkey', async () => {
    const hook = await renderWalletHook();
    await act(async () => {
      hook.current().activate({ handle: 'AAAA', credentialId: 'cred-a' });
      walletProofSessionStore.save('AAAA', walletIdentityProof);
    });

    let rejected!: Awaited<ReturnType<UseDexterWallet['removeFromDevice']>>;
    await act(async () => {
      rejected = await hook.current().removeFromDevice('AAAA', 'wrong' as never);
    });
    expect(rejected).toEqual({ removedFromRoster: false, passkeyPruned: false });
    expect(hook.current().activeHandle).toBe('AAAA');
    expect(walletProofSessionStore.load('AAAA')).not.toBeNull();
    expect(mockPrunePasskey).not.toHaveBeenCalled();

    let removed!: Awaited<ReturnType<UseDexterWallet['removeFromDevice']>>;
    await act(async () => {
      removed = await hook
        .current()
        .removeFromDevice('AAAA', DEVICE_WALLET_REMOVAL_CONFIRMATION);
    });
    expect(removed).toEqual({ removedFromRoster: true, passkeyPruned: true });
    expect(hook.current().activeHandle).toBeNull();
    expect(hook.current().wallets).toEqual([]);
    expect(walletProofSessionStore.load('AAAA')).toBeNull();
    expect(mockPrunePasskey).toHaveBeenCalledOnce();
    expect(mockPrunePasskey).toHaveBeenCalledWith({ credentialId: 'cred-a' });
    await hook.unmount();
  });
});
