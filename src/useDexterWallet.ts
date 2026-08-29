'use client';

// @dexterai/connect/react useDexterWallet
//
// React binding over the canonical Wallet roster and the WebAuthn Signal API.
// Disconnect, roster removal, and device-passkey removal remain separate.

import { useCallback, useEffect, useState } from 'react';

import {
  getActiveHandle,
  listWallets,
  ejectActiveWallet,
  disconnectActiveWallet,
  forgetWallet,
  removeWalletFromDeviceRoster,
  switchWallet,
  setActiveHandle,
  setActiveWallet,
  subscribe,
  type DeviceWalletRemovalConfirmation,
  type StoredWallet,
} from './walletStore';
import {
  passkeySignalSupport,
  renamePasskey,
  prunePasskey,
  type PasskeySignalSupport,
} from './signals';
import { walletProofSessionStore } from './walletProofSession';

const NO_SUPPORT: PasskeySignalSupport = { rename: false, prune: false, syncAccepted: false };

export interface RemoveWalletFromDeviceResult {
  removedFromRoster: boolean;
  passkeyPruned: boolean;
}

export interface UseDexterWallet {
  /** Active Wallet handle, or null. */
  activeHandle: string | null;
  /** Active Wallet roster row, or null. */
  activeWallet: StoredWallet | null;
  /** Known Wallets on this browser, most recently used first. */
  wallets: StoredWallet[];
  /** WebAuthn Signal API support in the current browser. */
  support: PasskeySignalSupport;
  /** Leave the active Wallet while keeping its roster row and device passkey. */
  disconnect: () => boolean;
  /** Remove a Wallet from the browser roster while keeping its device passkey. */
  forget: (handle: string) => void;
  /**
   * Deprecated compatibility alias. The default disconnects. `forget: true`
   * removes the roster row. Neither form removes an OS passkey.
   */
  eject: (opts?: { forget?: boolean }) => void;
  /**
   * Remove a Wallet from this device. The confirmation literal is required;
   * this is the only hook action that may prune an OS passkey.
   */
  removeFromDevice: (
    handle: string,
    confirmation: DeviceWalletRemovalConfirmation,
  ) => Promise<RemoveWalletFromDeviceResult>;
  /** Switch the active Wallet to a known handle. */
  switchTo: (handle: string) => boolean;
  /** Backward-compatible handle activation helper. */
  setActive: (handle: string, label?: string, credentialId?: string) => void;
  /** Activate a Wallet while retaining all server-returned roster facts. */
  activate: (wallet: StoredWallet) => boolean;
  /**
   * Rename the active passkey. Returns false when unsupported or unsuccessful.
   */
  rename: (name: string, displayName?: string) => Promise<boolean>;
}

export function useDexterWallet(): UseDexterWallet {
  const [activeHandle, setHandle] = useState<string | null>(() => getActiveHandle());
  const [wallets, setWallets] = useState<StoredWallet[]>(() => listWallets());
  // Detect after hydration so the server and initial client render match.
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

  const disconnect = useCallback(() => disconnectActiveWallet(), []);

  const forget = useCallback((handle: string) => forgetWallet(handle), []);

  const eject = useCallback((opts?: { forget?: boolean }) => ejectActiveWallet(opts), []);

  const removeFromDevice = useCallback(
    async (
      handle: string,
      confirmation: DeviceWalletRemovalConfirmation,
    ): Promise<RemoveWalletFromDeviceResult> => {
      const removed = removeWalletFromDeviceRoster(handle, confirmation);
      if (!removed) return { removedFromRoster: false, passkeyPruned: false };
      walletProofSessionStore.handleLifecycle({
        type: 'wallet_removed_from_device',
        handle,
      });
      const passkeyPruned = removed.credentialId
        ? await prunePasskey({ credentialId: removed.credentialId })
        : false;
      return { removedFromRoster: true, passkeyPruned };
    },
    [],
  );

  const rename = useCallback(async (name: string, displayName?: string): Promise<boolean> => {
    const handle = getActiveHandle();
    if (!handle) return false;
    const ok = await renamePasskey({ userId: handle, name, displayName });
    if (ok) setActiveHandle(handle, name);
    return ok;
  }, []);

  const switchTo = useCallback((handle: string) => switchWallet(handle), []);
  const setActive = useCallback(
    (handle: string, label?: string, credentialId?: string) =>
      setActiveHandle(handle, label, credentialId),
    [],
  );
  const activate = useCallback((wallet: StoredWallet) => setActiveWallet(wallet), []);

  return {
    activeHandle,
    activeWallet: activeHandle ? wallets.find((w) => w.handle === activeHandle) ?? null : null,
    wallets,
    support,
    disconnect,
    forget,
    eject,
    removeFromDevice,
    switchTo,
    setActive,
    activate,
    rename,
  };
}
