import { describe, expect, it, vi } from 'vitest';

import {
  WALLET_PROOF_SESSION_STORAGE_PREFIX,
  createWalletProofSessionStore,
  type WalletProofStorageEvent,
  type WalletProofStorageEventSource,
  type WalletProofSessionStorage,
} from './walletProofSession';

class MemoryStorage implements WalletProofSessionStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class StorageEvents implements WalletProofStorageEventSource {
  private readonly listeners = new Set<(event: WalletProofStorageEvent) => void>();

  addEventListener(
    _type: 'storage',
    listener: (event: WalletProofStorageEvent) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: 'storage',
    listener: (event: WalletProofStorageEvent) => void,
  ): void {
    this.listeners.delete(listener);
  }

  dispatch(event: WalletProofStorageEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  count(): number {
    return this.listeners.size;
  }
}

function proof(token: string, expiresAt: number) {
  return {
    token,
    tokenType: 'Bearer' as const,
    expiresAt,
    expiresIn: 3_600,
  };
}

const HANDLE_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const HANDLE_B = 'AQEBAQEBAQEBAQEBAQEBAQ';
const VAULT_A = '11111111111111111111111111111111';
const VAULT_B = 'So11111111111111111111111111111111111111112';

describe('Wallet proof-session store', () => {
  it('retains independent inactive Wallet proofs without exposing either proof', () => {
    const storage = new MemoryStorage();
    const store = createWalletProofSessionStore({
      storage,
      nowEpochSeconds: () => 1_000,
    });

    const walletA = store.save(HANDLE_A, proof('proof-a', 4_000));
    const walletB = store.save(HANDLE_B, proof('proof-b', 5_000));

    expect(store.load(HANDLE_A)).toEqual(walletA);
    expect(store.load(HANDLE_B)).toEqual(walletB);
    expect(Object.keys(walletA ?? {})).toEqual(['kind', 'handle', 'expiresAt']);
    expect(JSON.stringify(walletA)).not.toContain('proof-a');
    expect(JSON.stringify(walletB)).not.toContain('proof-b');

    const candidateA = store.bindingCandidate(HANDLE_A, {
      userHandle: HANDLE_A,
      vaultPda: VAULT_A,
    });
    const candidateB = store.bindingCandidate(HANDLE_B, {
      userHandle: HANDLE_B,
      vaultPda: VAULT_B,
    });
    expect(candidateA).toEqual({ kind: 'dexter_wallet_identity_proof' });
    expect(candidateB).toEqual({ kind: 'dexter_wallet_identity_proof' });
    expect(JSON.stringify(candidateA)).not.toContain('proof-a');
    expect(JSON.stringify(candidateB)).not.toContain('proof-b');
    expect('list' in store).toBe(false);

    const rawA = storage.getItem(`${WALLET_PROOF_SESSION_STORAGE_PREFIX}${HANDLE_A}`);
    expect(rawA).toContain('"proof":"proof-a"');
    expect(rawA).not.toContain('walletIdentityProof');
  });

  it('clears only the removed device Wallet', () => {
    const storage = new MemoryStorage();
    const store = createWalletProofSessionStore({
      storage,
      nowEpochSeconds: () => 1_000,
    });
    store.save('AAAA', proof('proof-a', 4_000));
    store.save('BBBB', proof('proof-b', 4_000));

    expect(
      store.handleLifecycle({ type: 'browser_disconnected', handle: 'AAAA' }),
    ).toBe(false);
    expect(store.handleLifecycle({ type: 'account_signed_out' })).toBe(false);
    expect(store.load('AAAA')).not.toBeNull();
    expect(store.load('BBBB')).not.toBeNull();

    expect(
      store.handleLifecycle({ type: 'wallet_removed_from_device', handle: 'AAAA' }),
    ).toBe(true);
    expect(store.load('AAAA')).toBeNull();
    expect(store.load('BBBB')).not.toBeNull();
  });

  it('removes expired sessions before they become binding candidates', () => {
    const storage = new MemoryStorage();
    let now = 1_000;
    const store = createWalletProofSessionStore({
      storage,
      nowEpochSeconds: () => now,
    });
    const events: unknown[] = [];
    store.subscribe((event) => events.push(event));
    store.save(HANDLE_A, proof('proof-a', 1_001));

    now = 1_001;
    expect(
      store.bindingCandidate(HANDLE_A, {
        userHandle: HANDLE_A,
        vaultPda: VAULT_A,
      }),
    ).toBeNull();
    expect(storage.getItem(`${WALLET_PROOF_SESSION_STORAGE_PREFIX}${HANDLE_A}`)).toBeNull();
    expect(events.at(-1)).toEqual({
      operation: 'expired',
      handle: HANDLE_A,
      session: null,
    });
    expect(JSON.stringify(events)).not.toContain('proof-a');
  });

  it('rejects already-expired ceremony results instead of persisting them', () => {
    const storage = new MemoryStorage();
    const store = createWalletProofSessionStore({
      storage,
      nowEpochSeconds: () => 1_000,
    });

    expect(() => store.save('AAAA', proof('proof-a', 1_000))).toThrowError(
      expect.objectContaining({ code: 'wallet_identity_proof_expired' }),
    );
    expect(storage.values.size).toBe(0);
  });

  it('drops malformed storage without throwing or leaking its contents', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      `${WALLET_PROOF_SESSION_STORAGE_PREFIX}AAAA`,
      '{"v":1,"proof":"secret-fragment"',
    );
    const store = createWalletProofSessionStore({
      storage,
      nowEpochSeconds: () => 1_000,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() => store.load('AAAA')).not.toThrow();
    expect(store.load('AAAA')).toBeNull();
    expect(storage.getItem(`${WALLET_PROOF_SESSION_STORAGE_PREFIX}AAAA`)).toBeNull();
    expect(listener).toHaveBeenCalledWith({
      operation: 'corrupted',
      handle: 'AAAA',
      session: null,
    });
    expect(JSON.stringify(listener.mock.calls)).not.toContain('secret-fragment');
  });

  it('notifies other tabs with metadata and handles all-storage clearing', () => {
    const storage = new MemoryStorage();
    const eventSource = new StorageEvents();
    const store = createWalletProofSessionStore({
      storage,
      eventSource,
      nowEpochSeconds: () => 1_000,
    });
    const events: unknown[] = [];
    const unsubscribe = store.subscribe((event) => events.push(event));
    expect(eventSource.count()).toBe(1);

    const key = `${WALLET_PROOF_SESSION_STORAGE_PREFIX}AAAA`;
    eventSource.dispatch({
      key,
      newValue: '{"v":1,"proof":"proof-a","expiresAt":4000}',
      storageArea: storage,
    });
    expect(events.at(-1)).toEqual({
      operation: 'external',
      handle: 'AAAA',
      session: {
        kind: 'dexter_wallet_proof_session',
        handle: 'AAAA',
        expiresAt: 4_000,
      },
    });
    expect(JSON.stringify(events)).not.toContain('proof-a');

    eventSource.dispatch({ key: null, newValue: null, storageArea: storage });
    expect(events.at(-1)).toEqual({
      operation: 'external',
      handle: null,
      session: null,
    });

    unsubscribe();
    expect(eventSource.count()).toBe(0);
  });

  it('uses browser localStorage by default', () => {
    const storage = new MemoryStorage();
    const eventSource = new StorageEvents();
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      localStorage: storage,
      addEventListener: eventSource.addEventListener.bind(eventSource),
      removeEventListener: eventSource.removeEventListener.bind(eventSource),
    };

    try {
      const store = createWalletProofSessionStore({
        nowEpochSeconds: () => 1_000,
      });
      expect(store.save('AAAA', proof('proof-a', 4_000))).toMatchObject({
        handle: 'AAAA',
      });
      expect(store.load('AAAA')).toMatchObject({ handle: 'AAAA' });
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    }
  });

  it('is inert during SSR', () => {
    const previousWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;

    try {
      const store = createWalletProofSessionStore();
      const unsubscribe = store.subscribe(() => undefined);

      expect(() => store.load('AAAA')).not.toThrow();
      expect(store.load('AAAA')).toBeNull();
      expect(store.save('AAAA', proof('proof-a', 9_999_999_999))).toBeNull();
      expect(store.clear('AAAA')).toBe(false);
      expect(
        store.bindingCandidate(HANDLE_A, {
          userHandle: HANDLE_A,
          vaultPda: VAULT_A,
        }),
      ).toBeNull();
      expect(() => unsubscribe()).not.toThrow();
      expect(() => store.dispose()).not.toThrow();
    } finally {
      if (previousWindow !== undefined) {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    }
  });
});
