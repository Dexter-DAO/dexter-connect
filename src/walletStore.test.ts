import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory localStorage + window mock so the store's SSR guards and
// cross-tab listener wiring run against a real-ish browser surface in node.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

beforeEach(async () => {
  const storage = new MemStorage();
  (globalThis as any).window = {
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  // Re-import fresh each test so the module-level listener Set is clean.
  vi.resetModules();
});

async function load() {
  return await import('./walletStore.js');
}

describe('walletStore', () => {
  it('starts with no active wallet', async () => {
    const s = await load();
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets()).toEqual([]);
  });

  it('setActiveHandle persists active + upserts roster', async () => {
    const s = await load();
    s.setActiveHandle('AAAA', 'Dexter Wallet');
    expect(s.getActiveHandle()).toBe('AAAA');
    const roster = s.listWallets();
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ handle: 'AAAA', label: 'Dexter Wallet' });
    expect(roster[0]?.verificationState).toBe('unverified');
  });

  it('migrates historical roster rows without treating them as verified', async () => {
    window.localStorage.setItem(
      'dexter:passkey:wallets',
      JSON.stringify([{ handle: 'AAAA', label: 'Old row', credentialId: 'cred-a' }]),
    );
    const s = await load();
    expect(s.listWallets()).toEqual([
      {
        handle: 'AAAA',
        label: 'Old row',
        credentialId: 'cred-a',
        rosterState: 'known',
        verificationState: 'unverified',
      },
    ]);
  });

  it('retains ceremony facts in the active Wallet roster row', async () => {
    const s = await load();
    s.setActiveWallet({
      handle: 'AAAA',
      credentialId: 'cred-a',
      vaultPda: 'vault-a',
      swigAddress: 'swig-a',
      walletAddress: 'wallet-a',
      receiveAddress: 'receive-a',
      network: 'solana-mainnet',
      verificationState: 'verified',
    });
    expect(s.getActiveWallet()).toMatchObject({
      handle: 'AAAA',
      credentialId: 'cred-a',
      vaultPda: 'vault-a',
      swigAddress: 'swig-a',
      walletAddress: 'wallet-a',
      receiveAddress: 'receive-a',
      network: 'solana-mainnet',
      rosterState: 'known',
      verificationState: 'verified',
    });

    s.setActiveHandle('AAAA', 'Renamed');
    expect(s.getActiveWallet()).toMatchObject({
      handle: 'AAAA',
      label: 'Renamed',
      vaultPda: 'vault-a',
      credentialId: 'cred-a',
      verificationState: 'verified',
    });
  });

  it('eject clears active but keeps the wallet in the roster (switch back)', async () => {
    const s = await load();
    s.setActiveHandle('AAAA');
    s.ejectActiveWallet();
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets().map((w) => w.handle)).toEqual(['AAAA']);
  });

  it('disconnect, roster forget, and device removal stay distinct', async () => {
    const s = await load();
    s.setActiveWallet({ handle: 'AAAA', credentialId: 'cred-a' });

    expect(s.disconnectActiveWallet()).toBe(true);
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets().map((wallet) => wallet.handle)).toEqual(['AAAA']);

    expect(s.switchWallet('AAAA')).toBe(true);
    s.forgetWallet('AAAA');
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets()).toEqual([]);

    s.setActiveWallet({ handle: 'BBBB', credentialId: 'cred-b' });
    expect(s.removeWalletFromDeviceRoster('BBBB', 'wrong' as never)).toBeNull();
    expect(s.getActiveHandle()).toBe('BBBB');
    expect(
      s.removeWalletFromDeviceRoster('BBBB', s.DEVICE_WALLET_REMOVAL_CONFIRMATION),
    ).toMatchObject({ handle: 'BBBB', credentialId: 'cred-b' });
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets()).toEqual([]);
  });

  it('eject({forget}) removes the wallet entirely', async () => {
    const s = await load();
    s.setActiveHandle('AAAA');
    s.ejectActiveWallet({ forget: true });
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets()).toEqual([]);
  });

  it('switchWallet only switches to a known handle', async () => {
    const s = await load();
    s.setActiveHandle('AAAA');
    s.setActiveHandle('BBBB');
    expect(s.getActiveHandle()).toBe('BBBB');
    expect(s.switchWallet('AAAA')).toBe(true);
    expect(s.getActiveHandle()).toBe('AAAA');
    expect(s.switchWallet('NOPE')).toBe(false);
    expect(s.getActiveHandle()).toBe('AAAA');
  });

  it('listWallets is most-recently-used first', async () => {
    const s = await load();
    s.setActiveHandle('AAAA');
    await new Promise((r) => setTimeout(r, 2));
    s.setActiveHandle('BBBB');
    expect(s.listWallets().map((w) => w.handle)).toEqual(['BBBB', 'AAAA']);
  });

  it('subscribers fire on change and stop after unsubscribe', async () => {
    const s = await load();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.setActiveHandle('AAAA');
    s.ejectActiveWallet();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.setActiveHandle('BBBB');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('emits typed synchronous invalidation events for identity changes', async () => {
    const s = await load();
    const events: import('./walletStore').WalletMutationEvent[] = [];
    const off = s.subscribe((event) => events.push(event));

    s.setActiveWallet({ handle: 'AAAA', credentialId: 'cred-a', vaultPda: 'vault-a' });
    expect(events.at(-1)).toMatchObject({
      operation: 'activate',
      previousActiveWallet: null,
      activeWallet: { handle: 'AAAA' },
      invalidatesAccountBinding: true,
    });

    s.setActiveWallet({ handle: 'AAAA', label: 'Renamed' });
    expect(events.at(-1)).toMatchObject({
      operation: 'update',
      invalidatesAccountBinding: false,
    });

    s.setActiveWallet({ handle: 'AAAA', vaultPda: 'vault-b' });
    expect(events.at(-1)).toMatchObject({
      operation: 'update',
      invalidatesAccountBinding: true,
    });

    s.setActiveWallet({ handle: 'BBBB', credentialId: 'cred-b', vaultPda: 'vault-b' });
    expect(events.at(-1)).toMatchObject({
      operation: 'switch',
      previousActiveWallet: { handle: 'AAAA' },
      activeWallet: { handle: 'BBBB' },
      invalidatesAccountBinding: true,
    });

    expect(s.disconnectActiveWallet()).toBe(true);
    expect(events.at(-1)).toMatchObject({
      operation: 'disconnect',
      previousActiveWallet: { handle: 'BBBB' },
      activeWallet: null,
      invalidatesAccountBinding: true,
    });
    off();
  });

  it('does not invalidate the active identity when another Wallet is removed', async () => {
    const s = await load();
    s.setActiveWallet({ handle: 'AAAA', credentialId: 'cred-a', vaultPda: 'vault-a' });
    s.setActiveWallet({ handle: 'BBBB', credentialId: 'cred-b', vaultPda: 'vault-b' });
    expect(s.switchWallet('AAAA')).toBe(true);

    const events: import('./walletStore').WalletMutationEvent[] = [];
    const off = s.subscribe((event) => events.push(event));
    expect(
      s.removeWalletFromDeviceRoster('BBBB', s.DEVICE_WALLET_REMOVAL_CONFIRMATION),
    ).toMatchObject({ handle: 'BBBB' });

    expect(s.getActiveHandle()).toBe('AAAA');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'remove-device',
      activeWallet: { handle: 'AAAA' },
      invalidatesAccountBinding: false,
    });
    off();
  });

  it('invalidates cross-tab changes only when the active Wallet identity changes', async () => {
    const s = await load();
    s.setActiveWallet({ handle: 'AAAA', credentialId: 'cred-a', vaultPda: 'vault-a' });
    const events: import('./walletStore').WalletMutationEvent[] = [];
    s.subscribe((event) => events.push(event));

    const addEventListener = vi.mocked(window.addEventListener);
    const storageListener = addEventListener.mock.calls.find(([name]) => name === 'storage')?.[1] as
      | ((event: StorageEvent) => void)
      | undefined;
    expect(storageListener).toBeTypeOf('function');

    window.localStorage.setItem(
      s.WALLET_ROSTER_STORAGE_KEY,
      JSON.stringify([
        {
          handle: 'AAAA',
          label: 'Renamed elsewhere',
          credentialId: 'cred-a',
          vaultPda: 'vault-a',
        },
      ]),
    );
    storageListener?.({ key: s.WALLET_ROSTER_STORAGE_KEY } as StorageEvent);
    expect(events.at(-1)).toMatchObject({
      operation: 'external',
      previousActiveWallet: { handle: 'AAAA' },
      activeWallet: { handle: 'AAAA' },
      invalidatesAccountBinding: false,
    });

    window.localStorage.setItem(
      s.WALLET_ROSTER_STORAGE_KEY,
      JSON.stringify([
        {
          handle: 'AAAA',
          label: 'Renamed elsewhere',
          credentialId: 'cred-a',
          vaultPda: 'vault-a',
        },
        { handle: 'BBBB', credentialId: 'cred-b', vaultPda: 'vault-b' },
      ]),
    );
    storageListener?.({ key: s.WALLET_ROSTER_STORAGE_KEY } as StorageEvent);
    expect(events.at(-1)?.invalidatesAccountBinding).toBe(false);

    window.localStorage.setItem(
      s.WALLET_ROSTER_STORAGE_KEY,
      JSON.stringify([
        {
          handle: 'AAAA',
          credentialId: 'cred-a-replaced',
          vaultPda: 'vault-a',
        },
        { handle: 'BBBB', credentialId: 'cred-b', vaultPda: 'vault-b' },
      ]),
    );
    storageListener?.({ key: s.WALLET_ROSTER_STORAGE_KEY } as StorageEvent);
    expect(events.at(-1)).toMatchObject({
      operation: 'external',
      previousActiveWallet: { handle: 'AAAA', credentialId: 'cred-a' },
      activeWallet: { handle: 'AAAA', credentialId: 'cred-a-replaced' },
      invalidatesAccountBinding: true,
    });

    window.localStorage.setItem(s.ACTIVE_WALLET_STORAGE_KEY, 'BBBB');
    storageListener?.({ key: s.ACTIVE_WALLET_STORAGE_KEY } as StorageEvent);
    expect(events.at(-1)).toMatchObject({
      operation: 'external',
      previousActiveWallet: { handle: 'AAAA' },
      activeWallet: { handle: 'BBBB' },
      invalidatesAccountBinding: true,
    });

    window.localStorage.removeItem(s.ACTIVE_WALLET_STORAGE_KEY);
    storageListener?.({ key: s.ACTIVE_WALLET_STORAGE_KEY } as StorageEvent);
    expect(events.at(-1)).toMatchObject({
      operation: 'external',
      previousActiveWallet: { handle: 'BBBB' },
      activeWallet: null,
      invalidatesAccountBinding: true,
    });
  });

  it('SSR-safe: no window → no throw, null/empty', async () => {
    delete (globalThis as any).window;
    const s = await load();
    expect(() => s.setActiveHandle('AAAA')).not.toThrow();
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets()).toEqual([]);
    expect(() => s.ejectActiveWallet()).not.toThrow();
  });
});
