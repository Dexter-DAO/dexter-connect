'use client';

// @dexterai/connect/react — useDexterWallet
//
// React binding over the canonical walletStore + the WebAuthn Signal API. Gives
// a component the active wallet, the roster, eject/switch, AND keychain hygiene:
// rename the active passkey in the OS manager, and auto-prune the old passkey on
// eject (where the browser supports it — see ./signals; falls back to no-op).

import { useCallback, useEffect, useState } from 'react';

import {
  getActiveHandle,
  listWallets,
  ejectActiveWallet,
  switchWallet,
  setActiveHandle,
  getCredentialId,
  subscribe,
  type StoredWallet,
} from './walletStore';
import {
  passkeySignalSupport,
  renamePasskey,
  prunePasskey,
  type PasskeySignalSupport,
} from './signals';

const NO_SUPPORT: PasskeySignalSupport = { rename: false, prune: false, syncAccepted: false };

export interface UseDexterWallet {
  /** Active wallet handle, or null if this browser has no active wallet. */
  activeHandle: string | null;
  /** The active wallet's roster entry (handle + label + credentialId), or
   *  null. `activeWallet.label` is the wallet's human name — identity is
   *  first-class, so display surfaces read it here instead of re-fetching. */
  activeWallet: StoredWallet | null;
  /** Known wallets on this browser, most-recently-used first. */
  wallets: StoredWallet[];
  /** What the WebAuthn Signal API supports in THIS browser (rename / prune). */
  support: PasskeySignalSupport;
  /**
   * Eject the active wallet — "switch / start fresh". Clears the local binding
   * and, where supported, prunes the old passkey from the OS manager so it
   * disappears from the user's list. `{ forget: true }` also drops it from the
   * roster.
   */
  eject: (opts?: { forget?: boolean }) => void;
  /** Switch the active wallet to a known handle. No-op if unknown. */
  switchTo: (handle: string) => boolean;
  /** Record/activate a handle (after enroll or recover). Prefer over writing
   *  localStorage by hand so the roster + subscribers stay correct. */
  setActive: (handle: string, label?: string, credentialId?: string) => void;
  /**
   * Rename the ACTIVE passkey in the OS keychain (post-creation). Returns true
   * if the browser supported it and the signal fired; false otherwise (the
   * keychain entry is then just left as-is).
   */
  rename: (name: string, displayName?: string) => Promise<boolean>;
}

export function useDexterWallet(): UseDexterWallet {
  const [activeHandle, setHandle] = useState<string | null>(() => getActiveHandle());
  const [wallets, setWallets] = useState<StoredWallet[]>(() => listWallets());
  // Detected in the effect (not the initial render) to avoid SSR/hydration skew.
  const [support, setSupport] = useState<PasskeySignalSupport>(NO_SUPPORT);

  useEffect(() => {
    const sync = () => {
      setHandle(getActiveHandle());
      setWallets(listWallets());
    };
    setSupport(passkeySignalSupport());
    sync();
    return subscribe(sync);
  }, []);

  const eject = useCallback((opts?: { forget?: boolean }) => {
    // Capture the credentialId BEFORE clearing so we can prune that passkey from
    // the OS manager (where supported) — the welded-old-wallet auto-cleanup.
    const handle = getActiveHandle();
    const credentialId = handle ? getCredentialId(handle) : undefined;
    ejectActiveWallet(opts);
    if (credentialId) void prunePasskey({ credentialId });
  }, []);

  const rename = useCallback(async (name: string, displayName?: string): Promise<boolean> => {
    const handle = getActiveHandle();
    if (!handle) return false;
    const ok = await renamePasskey({ userId: handle, name, displayName });
    if (ok) setActiveHandle(handle, name); // reflect the new label in our roster too
    return ok;
  }, []);

  return {
    activeHandle,
    activeWallet: activeHandle ? wallets.find((w) => w.handle === activeHandle) ?? null : null,
    wallets,
    support,
    eject,
    switchTo: useCallback((handle: string) => switchWallet(handle), []),
    setActive: useCallback(
      (handle: string, label?: string, credentialId?: string) =>
        setActiveHandle(handle, label, credentialId),
      [],
    ),
    rename,
  };
}
