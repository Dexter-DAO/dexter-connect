import {
  walletBindingCandidate,
  type ActiveWalletBindingIdentity,
  type WalletBindingCandidate,
} from './bindingResolver';
import {
  ConnectError,
  parseWalletIdentityProof,
  type WalletIdentityProof,
} from './types';

const STORAGE_VERSION = 1 as const;

/** One localStorage entry per Wallet keeps inactive Wallet proofs independent. */
export const WALLET_PROOF_SESSION_STORAGE_PREFIX =
  'dexter:wallet-identity-proof-session:' as const;

declare const walletProofSessionBrand: unique symbol;

/**
 * Public metadata for a locally retained Wallet proof. The signed proof is held
 * out of enumerable properties, JSON, events, and roster state.
 */
export interface WalletProofSession {
  readonly kind: 'dexter_wallet_proof_session';
  readonly handle: string;
  /** Epoch seconds, matching the Dexter API ceremony response. */
  readonly expiresAt: number;
  readonly [walletProofSessionBrand]: true;
}

export type WalletProofSessionOperation =
  | 'saved'
  | 'cleared'
  | 'expired'
  | 'corrupted'
  | 'external';

/** Subscription events carry metadata only. */
export interface WalletProofSessionEvent {
  readonly operation: WalletProofSessionOperation;
  /** Null means another tab cleared all localStorage. */
  readonly handle: string | null;
  readonly session: WalletProofSession | null;
}

export type WalletProofLifecycleEvent =
  | { readonly type: 'wallet_removed_from_device'; readonly handle: string }
  | { readonly type: 'browser_disconnected'; readonly handle: string }
  | { readonly type: 'account_signed_out' };

export interface WalletProofSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WalletProofStorageEvent {
  readonly key: string | null;
  readonly newValue: string | null;
  readonly storageArea?: WalletProofSessionStorage | null;
}

export interface WalletProofStorageEventSource {
  addEventListener(
    type: 'storage',
    listener: (event: WalletProofStorageEvent) => void,
  ): void;
  removeEventListener(
    type: 'storage',
    listener: (event: WalletProofStorageEvent) => void,
  ): void;
}

export interface WalletProofSessionStoreOptions {
  /** Omit for browser localStorage. Pass null in non-browser adapters. */
  readonly storage?: WalletProofSessionStorage | null;
  /** Omit for the browser window. Pass null to disable cross-tab events. */
  readonly eventSource?: WalletProofStorageEventSource | null;
  /** Injectable clock returning epoch seconds. */
  readonly nowEpochSeconds?: () => number;
}

export interface WalletProofSessionStore {
  /** Persist the proof returned as `walletIdentityProof` by a ceremony. */
  save(
    handle: string,
    walletIdentityProof: WalletIdentityProof,
  ): WalletProofSession | null;
  /** Load unexpired metadata for one Wallet. */
  load(handle: string): WalletProofSession | null;
  /** Build an opaque API candidate without returning the proof string. */
  bindingCandidate(
    handle: string,
    activeWallet: ActiveWalletBindingIdentity,
  ): WalletBindingCandidate | null;
  /** Clear one Wallet's retained proof. */
  clear(handle: string): boolean;
  /**
   * Apply explicit lifecycle meaning. Only device removal clears a proof;
   * browser disconnect and account sign-out are separate state changes.
   */
  handleLifecycle(event: WalletProofLifecycleEvent): boolean;
  /** Subscribe to local and cross-tab proof metadata changes. */
  subscribe(listener: (event: WalletProofSessionEvent) => void): () => void;
  dispose(): void;
}

interface StoredProofSession {
  readonly v: typeof STORAGE_VERSION;
  /** Generic internal field; the API wire field remains walletIdentityProof. */
  readonly proof: string;
  readonly expiresAt: number;
}

const proofBySession = new WeakMap<WalletProofSession, string>();

function browserStorage(): WalletProofSessionStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function browserEventSource(): WalletProofStorageEventSource | null {
  try {
    return typeof window !== 'undefined'
      ? (window as unknown as WalletProofStorageEventSource)
      : null;
  } catch {
    return null;
  }
}

function requireWalletHandle(handle: string): string {
  if (
    typeof handle !== 'string' ||
    handle.length === 0 ||
    handle.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/.test(handle)
  ) {
    throw new ConnectError('invalid_wallet_handle');
  }
  return handle;
}

function keyForHandle(handle: string): string {
  return `${WALLET_PROOF_SESSION_STORAGE_PREFIX}${requireWalletHandle(handle)}`;
}

function handleFromKey(key: string): string | null {
  if (!key.startsWith(WALLET_PROOF_SESSION_STORAGE_PREFIX)) return null;
  const handle = key.slice(WALLET_PROOF_SESSION_STORAGE_PREFIX.length);
  try {
    return requireWalletHandle(handle);
  } catch {
    return null;
  }
}

function parseStoredProofSession(raw: string): StoredProofSession | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (
      value.v !== STORAGE_VERSION ||
      typeof value.proof !== 'string' ||
      value.proof.length === 0 ||
      /\s/.test(value.proof) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= 0
    ) {
      return null;
    }
    return {
      v: STORAGE_VERSION,
      proof: value.proof,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

function sessionFromRecord(
  handle: string,
  record: StoredProofSession,
): WalletProofSession {
  const session = Object.freeze({
    kind: 'dexter_wallet_proof_session',
    handle,
    expiresAt: record.expiresAt,
  }) as WalletProofSession;
  proofBySession.set(session, record.proof);
  return session;
}

function frozenEvent(
  operation: WalletProofSessionOperation,
  handle: string | null,
  session: WalletProofSession | null,
): WalletProofSessionEvent {
  return Object.freeze({ operation, handle, session });
}

/**
 * Create the framework-neutral Wallet proof-session adapter. The default uses
 * browser localStorage and listens for cross-tab changes. It remains inert on
 * the server and in storage-restricted browsers.
 */
export function createWalletProofSessionStore(
  options: WalletProofSessionStoreOptions = {},
): WalletProofSessionStore {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const eventSource =
    options.eventSource === undefined
      ? options.storage === undefined
        ? browserEventSource()
        : null
      : options.eventSource;
  const nowEpochSeconds =
    options.nowEpochSeconds ?? (() => Date.now() / 1000);
  const listeners = new Set<(event: WalletProofSessionEvent) => void>();
  let listening = false;

  const publish = (event: WalletProofSessionEvent): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // One consumer cannot prevent the remaining consumers from invalidating.
      }
    }
  };

  const safeRemove = (key: string): boolean => {
    if (!storage) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  };

  const load = (handleValue: string): WalletProofSession | null => {
    const handle = requireWalletHandle(handleValue);
    if (!storage) return null;
    const key = keyForHandle(handle);
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return null;
    }
    if (raw === null) return null;

    const record = parseStoredProofSession(raw);
    if (!record) {
      safeRemove(key);
      publish(frozenEvent('corrupted', handle, null));
      return null;
    }
    if (record.expiresAt <= nowEpochSeconds()) {
      safeRemove(key);
      publish(frozenEvent('expired', handle, null));
      return null;
    }
    return sessionFromRecord(handle, record);
  };

  const clear = (handleValue: string): boolean => {
    const handle = requireWalletHandle(handleValue);
    if (!storage) return false;
    const key = keyForHandle(handle);
    let existed = false;
    try {
      existed = storage.getItem(key) !== null;
    } catch {
      return false;
    }
    if (!existed || !safeRemove(key)) return false;
    publish(frozenEvent('cleared', handle, null));
    return true;
  };

  const save = (
    handleValue: string,
    walletIdentityProof: WalletIdentityProof,
  ): WalletProofSession | null => {
    const handle = requireWalletHandle(handleValue);
    const parsed = parseWalletIdentityProof(walletIdentityProof);
    if (parsed.expiresAt <= nowEpochSeconds()) {
      throw new ConnectError('wallet_identity_proof_expired');
    }
    if (!storage) return null;

    const record: StoredProofSession = {
      v: STORAGE_VERSION,
      proof: parsed.token,
      expiresAt: parsed.expiresAt,
    };
    try {
      storage.setItem(keyForHandle(handle), JSON.stringify(record));
    } catch {
      return null;
    }
    const session = sessionFromRecord(handle, record);
    publish(frozenEvent('saved', handle, session));
    return session;
  };

  const bindingCandidate = (
    handle: string,
    activeWallet: ActiveWalletBindingIdentity,
  ): WalletBindingCandidate | null => {
    if (activeWallet.userHandle !== handle) {
      throw new ConnectError('invalid_active_wallet');
    }
    const session = load(handle);
    if (!session) return null;
    const proof = proofBySession.get(session);
    return proof ? walletBindingCandidate(proof, activeWallet) : null;
  };

  const handleLifecycle = (event: WalletProofLifecycleEvent): boolean => {
    if (event.type === 'wallet_removed_from_device') {
      return clear(event.handle);
    }
    return false;
  };

  const onStorage = (event: WalletProofStorageEvent): void => {
    if (event.storageArea && storage && event.storageArea !== storage) return;
    if (event.key === null) {
      publish(frozenEvent('external', null, null));
      return;
    }
    const handle = handleFromKey(event.key);
    if (!handle) return;

    const record = event.newValue === null
      ? null
      : parseStoredProofSession(event.newValue);
    const session =
      record && record.expiresAt > nowEpochSeconds()
        ? sessionFromRecord(handle, record)
        : null;
    publish(frozenEvent('external', handle, session));
  };

  const subscribe = (
    listener: (event: WalletProofSessionEvent) => void,
  ): (() => void) => {
    listeners.add(listener);
    if (!listening && eventSource) {
      eventSource.addEventListener('storage', onStorage);
      listening = true;
    }
    return () => {
      listeners.delete(listener);
      if (listening && listeners.size === 0 && eventSource) {
        eventSource.removeEventListener('storage', onStorage);
        listening = false;
      }
    };
  };

  const dispose = (): void => {
    if (listening && eventSource) {
      eventSource.removeEventListener('storage', onStorage);
      listening = false;
    }
    listeners.clear();
  };

  return Object.freeze({
    save,
    load,
    bindingCandidate,
    clear,
    handleLifecycle,
    subscribe,
    dispose,
  });
}

/** Shared browser store used by Connect ceremonies and Wallet lifecycle verbs. */
export const walletProofSessionStore = createWalletProofSessionStore();
