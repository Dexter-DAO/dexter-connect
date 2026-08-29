// @dexterai/connect framework-neutral Wallet roster and lifecycle store.
//
// This module owns two separate browser facts:
//   1. which Wallet is active in this browser;
//   2. which Wallets this browser has seen before.
//
// Leaving a Wallet, forgetting its roster entry, and deleting its device
// passkey are distinct actions. The store never removes a passkey on its own.

/** Historical active-handle key. Keeping it preserves existing browsers. */
const ACTIVE_HANDLE_KEY = 'dexter:passkey:userHandle';
/** Known-Wallet roster. */
const ROSTER_KEY = 'dexter:passkey:wallets';

export type WalletRosterState = 'known' | 'unavailable';
export type WalletVerificationState = 'unverified' | 'verified' | 'quarantined';

/** A Wallet this browser knows about. `handle` is the local roster identity. */
export interface StoredWallet {
  /** Base64url 16-byte user handle. */
  handle: string;
  /** Human-readable Wallet label. */
  label?: string;
  /** Base64url credential id used by explicit device-passkey removal. */
  credentialId?: string;
  /** Canonical on-chain Vault PDA returned by Dexter. */
  vaultPda?: string;
  /** Canonical Swig address returned by Dexter. */
  swigAddress?: string;
  /** Wallet address when a ceremony returns one independently of receiveAddress. */
  walletAddress?: string;
  /** Address shown for deposits. Some older Wallets legitimately return null. */
  receiveAddress?: string | null;
  /** Network identifier such as `solana-mainnet`. */
  network?: string;
  /** Whether the roster expects this Wallet to remain available on the device. */
  rosterState?: WalletRosterState;
  /** Server-proof state. Presence in localStorage never makes a Wallet verified. */
  verificationState?: WalletVerificationState;
  /** Epoch milliseconds of last activation. */
  lastUsedAt?: number;
}

export type WalletMutationOperation =
  | 'activate'
  | 'update'
  | 'switch'
  | 'disconnect'
  | 'forget'
  | 'remove-device'
  | 'external';

/** Synchronous mutation notice for controllers and UI subscribers. */
export interface WalletMutationEvent {
  operation: WalletMutationOperation;
  previousActiveWallet: StoredWallet | null;
  activeWallet: StoredWallet | null;
  /** The roster row directly changed by this operation, when one exists. */
  wallet: StoredWallet | null;
  /** Clear or suspend any account binding before the mutation returns. */
  invalidatesAccountBinding: boolean;
}

export const DEVICE_WALLET_REMOVAL_CONFIRMATION = 'remove-wallet-from-device' as const;
export type DeviceWalletRemovalConfirmation = typeof DEVICE_WALLET_REMOVAL_CONFIRMATION;

type Listener = (event: WalletMutationEvent) => void;

const listeners = new Set<Listener>();
let lastObservedActiveWallet: StoredWallet | null = null;

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeWallet(value: unknown, migrateHistoricalRow = true): StoredWallet | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const handle = optionalString(raw.handle);
  if (!handle) return null;

  const rosterState: WalletRosterState | undefined =
    raw.rosterState === 'unavailable' || raw.rosterState === 'known'
      ? raw.rosterState
      : migrateHistoricalRow
        ? 'known'
        : undefined;
  const verificationState: WalletVerificationState | undefined =
    raw.verificationState === 'verified' ||
    raw.verificationState === 'quarantined' ||
    raw.verificationState === 'unverified'
      ? raw.verificationState
      : migrateHistoricalRow
        ? 'unverified'
        : undefined;

  return {
    handle,
    ...(optionalString(raw.label) ? { label: optionalString(raw.label) } : {}),
    ...(optionalString(raw.credentialId)
      ? { credentialId: optionalString(raw.credentialId) }
      : {}),
    ...(optionalString(raw.vaultPda) ? { vaultPda: optionalString(raw.vaultPda) } : {}),
    ...(optionalString(raw.swigAddress)
      ? { swigAddress: optionalString(raw.swigAddress) }
      : {}),
    ...(optionalString(raw.walletAddress)
      ? { walletAddress: optionalString(raw.walletAddress) }
      : {}),
    ...(raw.receiveAddress === null
      ? { receiveAddress: null }
      : optionalString(raw.receiveAddress)
        ? { receiveAddress: optionalString(raw.receiveAddress) }
        : {}),
    ...(optionalString(raw.network) ? { network: optionalString(raw.network) } : {}),
    ...(rosterState ? { rosterState } : {}),
    ...(verificationState ? { verificationState } : {}),
    ...(typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt)
      ? { lastUsedAt: raw.lastUsedAt }
      : {}),
  };
}

function readRoster(): StoredWallet[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(ROSTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const wallets = new Map<string, StoredWallet>();
    for (const value of parsed) {
      const wallet = normalizeWallet(value);
      if (wallet) wallets.set(wallet.handle, wallet);
    }
    return [...wallets.values()];
  } catch {
    return [];
  }
}

function writeRoster(wallets: StoredWallet[]): boolean {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(ROSTER_KEY, JSON.stringify(wallets));
    return true;
  } catch {
    return false;
  }
}

function walletForHandle(handle: string | null, roster = readRoster()): StoredWallet | null {
  if (!handle) return null;
  return (
    roster.find((wallet) => wallet.handle === handle) ?? {
      handle,
      rosterState: 'known',
      verificationState: 'unverified',
    }
  );
}

function emit(event: WalletMutationEvent): void {
  lastObservedActiveWallet = event.activeWallet;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // One subscriber cannot prevent the remaining subscribers from running.
    }
  }
}

function mutationEvent(
  operation: WalletMutationOperation,
  previousActiveWallet: StoredWallet | null,
  activeWallet: StoredWallet | null,
  wallet: StoredWallet | null,
): WalletMutationEvent {
  const activeIdentityFactsChanged =
    previousActiveWallet?.handle === activeWallet?.handle &&
    (previousActiveWallet?.vaultPda !== activeWallet?.vaultPda ||
      previousActiveWallet?.credentialId !== activeWallet?.credentialId);
  return {
    operation,
    previousActiveWallet,
    activeWallet,
    wallet,
    invalidatesAccountBinding:
      previousActiveWallet?.handle !== activeWallet?.handle ||
      activeIdentityFactsChanged,
  };
}

function mergeDefinedWallet(existing: StoredWallet | undefined, incoming: StoredWallet): StoredWallet {
  const base: StoredWallet = existing ?? {
    handle: incoming.handle,
    rosterState: 'known',
    verificationState: 'unverified',
  };
  return {
    ...base,
    handle: incoming.handle,
    ...(incoming.label !== undefined ? { label: incoming.label } : {}),
    ...(incoming.credentialId !== undefined ? { credentialId: incoming.credentialId } : {}),
    ...(incoming.vaultPda !== undefined ? { vaultPda: incoming.vaultPda } : {}),
    ...(incoming.swigAddress !== undefined ? { swigAddress: incoming.swigAddress } : {}),
    ...(incoming.walletAddress !== undefined ? { walletAddress: incoming.walletAddress } : {}),
    ...(incoming.receiveAddress !== undefined
      ? { receiveAddress: incoming.receiveAddress }
      : {}),
    ...(incoming.network !== undefined ? { network: incoming.network } : {}),
    ...(incoming.rosterState !== undefined ? { rosterState: incoming.rosterState } : {}),
    ...(incoming.verificationState !== undefined
      ? { verificationState: incoming.verificationState }
      : {}),
    rosterState: incoming.rosterState || base.rosterState || 'known',
    verificationState: incoming.verificationState || base.verificationState || 'unverified',
    lastUsedAt: Date.now(),
  };
}

function activateWallet(wallet: StoredWallet, requestedOperation?: 'activate' | 'switch'): boolean {
  if (!hasStorage()) return false;
  const normalized = normalizeWallet(wallet, false);
  if (!normalized) return false;

  const roster = readRoster();
  const previousActiveWallet = walletForHandle(getActiveHandle(), roster);
  const existingIndex = roster.findIndex((row) => row.handle === normalized.handle);
  const nextWallet = mergeDefinedWallet(
    existingIndex >= 0 ? roster[existingIndex] : undefined,
    normalized,
  );
  if (existingIndex >= 0) roster[existingIndex] = nextWallet;
  else roster.push(nextWallet);

  const previousRoster = readRoster();
  if (!writeRoster(roster)) return false;
  try {
    window.localStorage.setItem(ACTIVE_HANDLE_KEY, normalized.handle);
  } catch {
    writeRoster(previousRoster);
    return false;
  }

  const changedHandle = previousActiveWallet?.handle !== normalized.handle;
  const operation: WalletMutationOperation = changedHandle
    ? requestedOperation ?? (previousActiveWallet ? 'switch' : 'activate')
    : 'update';
  emit(mutationEvent(operation, previousActiveWallet, nextWallet, nextWallet));
  return true;
}

function removeRosterWallet(
  handle: string,
  operation: 'forget' | 'remove-device',
): StoredWallet | null {
  if (!hasStorage() || !handle) return null;
  const roster = readRoster();
  const removedWallet = roster.find((wallet) => wallet.handle === handle) ?? null;
  if (!removedWallet) return null;

  const previousActiveWallet = walletForHandle(getActiveHandle(), roster);
  const wasActive = previousActiveWallet?.handle === handle;
  const nextRoster = roster.filter((wallet) => wallet.handle !== handle);
  if (!writeRoster(nextRoster)) return null;
  if (wasActive) {
    try {
      window.localStorage.removeItem(ACTIVE_HANDLE_KEY);
    } catch {
      writeRoster(roster);
      return null;
    }
  }
  const activeWallet = wasActive ? null : previousActiveWallet;
  emit(mutationEvent(operation, previousActiveWallet, activeWallet, removedWallet));
  return removedWallet;
}

// Active Wallet

/** The active Wallet handle, or null. */
export function getActiveHandle(): string | null {
  if (!hasStorage()) return null;
  try {
    return window.localStorage.getItem(ACTIVE_HANDLE_KEY);
  } catch {
    return null;
  }
}

/** The active Wallet's normalized roster row, or null. */
export function getActiveWallet(): StoredWallet | null {
  return walletForHandle(getActiveHandle());
}

/** Activate or update a complete Wallet roster row. */
export function setActiveWallet(wallet: StoredWallet): boolean {
  return activateWallet(wallet);
}

/**
 * Backward-compatible activation helper. New ceremonies should call
 * `setActiveWallet` so they can retain the server-returned Wallet facts.
 */
export function setActiveHandle(handle: string, label?: string, credentialId?: string): void {
  activateWallet({ handle, label, credentialId });
}

/** Look up a known Wallet's stored credential id. */
export function getCredentialId(handle: string): string | undefined {
  return readRoster().find((wallet) => wallet.handle === handle)?.credentialId;
}

/** Leave the active Wallet in this browser while keeping its roster row. */
export function disconnectActiveWallet(): boolean {
  if (!hasStorage()) return false;
  const previousActiveWallet = getActiveWallet();
  if (!previousActiveWallet) return false;
  try {
    window.localStorage.removeItem(ACTIVE_HANDLE_KEY);
  } catch {
    return false;
  }
  emit(mutationEvent('disconnect', previousActiveWallet, null, previousActiveWallet));
  return true;
}

/**
 * Deprecated compatibility alias. It no longer removes an OS passkey.
 * `forget: true` drops the roster row; the default only disconnects.
 */
export function ejectActiveWallet(opts?: { forget?: boolean }): void {
  const handle = getActiveHandle();
  if (opts?.forget && handle) {
    forgetWallet(handle);
    return;
  }
  disconnectActiveWallet();
}

// Roster

/** Every Wallet this browser knows about, most recently used first. */
export function listWallets(): StoredWallet[] {
  return readRoster().sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

/** Activate a Wallet already present in the roster. */
export function switchWallet(handle: string): boolean {
  const wallet = readRoster().find((row) => row.handle === handle);
  if (!wallet) return false;
  return activateWallet(wallet, 'switch');
}

/** Remove a Wallet from the browser roster. This never removes its OS passkey. */
export function forgetWallet(handle: string): void {
  removeRosterWallet(handle, 'forget');
}

/**
 * Remove a roster row as part of an explicit device-passkey removal. The React
 * hook performs the OS signal after this guarded state change.
 */
export function removeWalletFromDeviceRoster(
  handle: string,
  confirmation: DeviceWalletRemovalConfirmation,
): StoredWallet | null {
  if (confirmation !== DEVICE_WALLET_REMOVAL_CONFIRMATION) return null;
  return removeRosterWallet(handle, 'remove-device');
}

// Subscription

/**
 * Subscribe to synchronous Wallet mutations. The callback receives the
 * operation plus previous and current active Wallets. Cross-tab storage changes
 * arrive as `external` mutations.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (hasStorage() && listeners.size === 1) {
    lastObservedActiveWallet = getActiveWallet();
    window.addEventListener('storage', onStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (hasStorage() && listeners.size === 0) {
      window.removeEventListener('storage', onStorageEvent);
    }
  };
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== ACTIVE_HANDLE_KEY && event.key !== ROSTER_KEY && event.key !== null) return;
  const previousActiveWallet = lastObservedActiveWallet;
  const activeWallet = getActiveWallet();
  emit(mutationEvent('external', previousActiveWallet, activeWallet, activeWallet));
}

/** Canonical storage keys for migration and test harnesses. */
export const ACTIVE_WALLET_STORAGE_KEY = ACTIVE_HANDLE_KEY;
export const WALLET_ROSTER_STORAGE_KEY = ROSTER_KEY;
