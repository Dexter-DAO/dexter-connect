// @dexterai/connect — wallet-identity store.
//
// THE single canonical owner of the browser's active Dexter wallet handle.
//
// Why this exists: the "welded wallet" bug. Every app was hand-rolling its own
// `localStorage.getItem('dexter:passkey:userHandle')` and NONE wrote a clear
// path — so a browser got permanently bound to one (possibly broken) wallet
// with no way to switch, eject, or start fresh. Centralizing the handle here,
// with a first-class `eject`/`switch`, kills that bug class for every consumer:
// hooks and UI read/write THROUGH this module and never touch localStorage by
// hand again.
//
// Framework-free on purpose (no React) so non-React consumers use it too; the
// React binding (`useDexterWallet`) lives in ./react and is a thin subscriber.
//
// SSR-safe: every accessor no-ops / returns empty when `window` is absent.

/** localStorage key for the ACTIVE wallet handle (base64url 16-byte). Kept at
 *  the historical key so existing browsers are recognized, not orphaned. */
const ACTIVE_HANDLE_KEY = 'dexter:passkey:userHandle';
/** localStorage key for the known-wallet roster (enables switch/list). */
const ROSTER_KEY = 'dexter:passkey:wallets';

/** A wallet this browser knows about. `handle` is the identity; the rest is UX. */
export interface StoredWallet {
  /** base64url 16-byte user handle — the vault identity. */
  handle: string;
  /** Human label for switch UIs (e.g. an email, or "Dexter Wallet"). */
  label?: string;
  /** Epoch ms of last activation — for ordering the switcher. */
  lastUsedAt?: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function readRoster(): StoredWallet[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(ROSTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is StoredWallet =>
        !!w && typeof w === 'object' && typeof (w as StoredWallet).handle === 'string',
    );
  } catch {
    return [];
  }
}

function writeRoster(wallets: StoredWallet[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(ROSTER_KEY, JSON.stringify(wallets));
  } catch {
    // storage quota / private-mode — non-fatal; active handle is the source of truth.
  }
}

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // a misbehaving listener must not break the others.
    }
  }
}

// ── Active wallet ────────────────────────────────────────────────────────────

/** The active wallet handle, or null if this browser has no active wallet. */
export function getActiveHandle(): string | null {
  if (!hasStorage()) return null;
  try {
    return window.localStorage.getItem(ACTIVE_HANDLE_KEY);
  } catch {
    return null;
  }
}

/**
 * Set the active wallet handle (e.g. after enroll or recover), upserting it into
 * the roster with a fresh `lastUsedAt`. Idempotent. Fires subscribers.
 */
export function setActiveHandle(handle: string, label?: string): void {
  if (!hasStorage() || !handle) return;
  try {
    window.localStorage.setItem(ACTIVE_HANDLE_KEY, handle);
  } catch {
    return; // can't persist — don't pretend we did.
  }
  const roster = readRoster();
  const existing = roster.find((w) => w.handle === handle);
  const now = Date.now();
  if (existing) {
    existing.lastUsedAt = now;
    if (label !== undefined) existing.label = label;
  } else {
    roster.push({ handle, label, lastUsedAt: now });
  }
  writeRoster(roster);
  emit();
}

/**
 * EJECT — clear the active wallet so the browser is no longer bound to it. This
 * is "switch / start fresh / sign out of this wallet". The wallet stays in the
 * roster (so the user can switch back) unless `forget` is true. After eject,
 * `getActiveHandle()` is null and the next enroll/recover starts clean. Fires
 * subscribers. This is the function whose absence WAS the welded-wallet bug.
 */
export function ejectActiveWallet(opts?: { forget?: boolean }): void {
  if (!hasStorage()) return;
  const current = getActiveHandle();
  try {
    window.localStorage.removeItem(ACTIVE_HANDLE_KEY);
  } catch {
    // ignore — best effort.
  }
  if (opts?.forget && current) {
    writeRoster(readRoster().filter((w) => w.handle !== current));
  }
  emit();
}

// ── Roster (switch / list) ───────────────────────────────────────────────────

/** Every wallet this browser knows about, most-recently-used first. */
export function listWallets(): StoredWallet[] {
  return readRoster().sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

/**
 * Switch the active wallet to a handle ALREADY in the roster. Returns false (and
 * does nothing) if the handle is unknown — switching is only ever to a wallet
 * this browser has seen, never to an arbitrary string.
 */
export function switchWallet(handle: string): boolean {
  if (!readRoster().some((w) => w.handle === handle)) return false;
  setActiveHandle(handle);
  return true;
}

/** Remove a wallet from the roster entirely; clears active if it was active. */
export function forgetWallet(handle: string): void {
  if (getActiveHandle() === handle) {
    ejectActiveWallet({ forget: true });
    return;
  }
  writeRoster(readRoster().filter((w) => w.handle !== handle));
  emit();
}

// ── Subscription (for React/UI) ──────────────────────────────────────────────

/**
 * Subscribe to active-wallet/roster changes. Returns an unsubscribe fn. Also
 * wires the cross-tab `storage` event once, so ejecting in one tab updates the
 * others. The React hook (`useDexterWallet`) is a thin wrapper over this.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (hasStorage() && listeners.size === 1) {
    window.addEventListener('storage', onStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (hasStorage() && listeners.size === 0) {
      window.removeEventListener('storage', onStorageEvent);
    }
  };
}

function onStorageEvent(e: StorageEvent): void {
  if (e.key === ACTIVE_HANDLE_KEY || e.key === ROSTER_KEY || e.key === null) emit();
}

/** Exposed for consumers that must reference the canonical key (migrations,
 *  tests). Prefer the accessors above — do NOT read localStorage by hand. */
export const ACTIVE_WALLET_STORAGE_KEY = ACTIVE_HANDLE_KEY;
