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
  });

  it('eject clears active but keeps the wallet in the roster (switch back)', async () => {
    const s = await load();
    s.setActiveHandle('AAAA');
    s.ejectActiveWallet();
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets().map((w) => w.handle)).toEqual(['AAAA']);
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

  it('SSR-safe: no window → no throw, null/empty', async () => {
    delete (globalThis as any).window;
    const s = await load();
    expect(() => s.setActiveHandle('AAAA')).not.toThrow();
    expect(s.getActiveHandle()).toBeNull();
    expect(s.listWallets()).toEqual([]);
    expect(() => s.ejectActiveWallet()).not.toThrow();
  });
});
