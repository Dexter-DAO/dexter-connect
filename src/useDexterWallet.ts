'use client';

// @dexterai/connect/react — useDexterWallet
//
// React binding over the canonical walletStore. Gives a component the active
// wallet handle, the known-wallet roster, and first-class `eject`/`switchTo`.
// This is what a "switch / start fresh" button calls — no component should ever
// touch localStorage or the handle key directly.

import { useCallback, useEffect, useState } from 'react';

import {
  getActiveHandle,
  listWallets,
  ejectActiveWallet,
  switchWallet,
  setActiveHandle,
  subscribe,
  type StoredWallet,
} from './walletStore';

export interface UseDexterWallet {
  /** Active wallet handle, or null if this browser has no active wallet. */
  activeHandle: string | null;
  /** Known wallets on this browser, most-recently-used first. */
  wallets: StoredWallet[];
  /**
   * Eject the active wallet — "switch / start fresh / sign out of this wallet".
   * The browser is no longer bound to it; the next enroll/recover starts clean.
   * Pass `{ forget: true }` to also drop it from the roster.
   */
  eject: (opts?: { forget?: boolean }) => void;
  /** Switch the active wallet to a known handle. No-op if unknown. */
  switchTo: (handle: string) => boolean;
  /** Record/activate a handle (after enroll or recover). Prefer this over
   *  hand-writing localStorage so the roster + subscribers stay correct. */
  setActive: (handle: string, label?: string) => void;
}

export function useDexterWallet(): UseDexterWallet {
  const [activeHandle, setHandle] = useState<string | null>(() => getActiveHandle());
  const [wallets, setWallets] = useState<StoredWallet[]>(() => listWallets());

  useEffect(() => {
    const sync = () => {
      setHandle(getActiveHandle());
      setWallets(listWallets());
    };
    // Re-sync once on mount: the store may have changed between the initial
    // render snapshot and the effect firing (and covers hydration).
    sync();
    return subscribe(sync);
  }, []);

  return {
    activeHandle,
    wallets,
    eject: useCallback((opts?: { forget?: boolean }) => ejectActiveWallet(opts), []),
    switchTo: useCallback((handle: string) => switchWallet(handle), []),
    setActive: useCallback((handle: string, label?: string) => setActiveHandle(handle, label), []),
  };
}
