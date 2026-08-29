'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  createDexterIdentityCoordinator,
  type DexterIdentityCoordinatorOptions,
} from './identityCoordinator';
import { resolveIdentity, type ResolvedIdentity } from './identity';
import type {
  RelationRuntime,
  WalletAccountRelation,
  WalletAccountRelationSnapshot,
} from './relationController';
import { useDexterWallet } from './useDexterWallet';

export type DexterAccountSession =
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out' }
  | { readonly status: 'authenticated'; readonly accessToken: string };

export interface UseDexterIdentityConfig
  extends DexterIdentityCoordinatorOptions {
  readonly accountSession: DexterAccountSession;
}

export interface UseDexterIdentity {
  readonly identity: ResolvedIdentity;
  readonly relation: WalletAccountRelationSnapshot;
  retry(): Promise<void>;
  /** Re-read the active Wallet against the host's current account session. */
  reconcile(): Promise<void>;
  /** Internal handoff for the exact session returned by a verified ceremony. */
  allowAccountSession(accessToken: string): void;
  /** Verify the allowed session against the newly active Wallet. */
  settleAccountSession(
    accessToken: string,
  ): Promise<WalletAccountRelationSnapshot>;
}

interface DesiredAccountSession {
  readonly status: DexterAccountSession['status'];
  readonly accessToken: string | null;
  readonly marker: symbol;
}

function relationForPresence(
  walletPresent: boolean,
  accountPresent: boolean,
): WalletAccountRelation {
  if (walletPresent) return 'wallet_only';
  if (accountPresent) return 'account_only';
  return 'none';
}

function transitionSnapshot(
  current: WalletAccountRelationSnapshot,
  accountSession: DexterAccountSession,
  walletPresent: boolean,
  initial: boolean,
): WalletAccountRelationSnapshot {
  const accountPresent = accountSession.status === 'authenticated';
  const runtime: RelationRuntime =
    initial || accountSession.status === 'loading'
      ? { phase: 'hydrating' }
      : walletPresent && accountPresent
        ? { phase: 'checking', reason: 'account_change' }
        : { phase: 'ready' };
  return Object.freeze({
    relation: relationForPresence(walletPresent, accountPresent),
    runtime: Object.freeze(runtime),
    walletPresent,
    accountPresent,
    privateAccountAccess: false,
    quarantined: false,
    verifiedAt: null,
    revision: current.revision,
  });
}

/**
 * React's single integration point for Dexter Wallet plus host account state.
 * The host supplies only whether its account session is loading, signed out,
 * or authenticated. Connect restores and verifies the exact relationship.
 */
export function useDexterIdentity({
  accountSession,
  ...coordinatorOptions
}: UseDexterIdentityConfig): UseDexterIdentity {
  const [coordinator] = useState(() =>
    createDexterIdentityCoordinator(coordinatorOptions),
  );
  const relation = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  const { activeHandle, activeWallet } = useDexterWallet();
  const initialized = useRef(false);
  const lifecycleGeneration = useRef(0);
  const desired = useRef<DesiredAccountSession>({
    status: accountSession.status,
    accessToken:
      accountSession.status === 'authenticated'
        ? accountSession.accessToken
        : null,
    marker: Symbol('account-session'),
  });
  const nextAccessToken =
    accountSession.status === 'authenticated'
      ? accountSession.accessToken
      : null;
  if (
    desired.current.status !== accountSession.status ||
    desired.current.accessToken !== nextAccessToken
  ) {
    desired.current = {
      status: accountSession.status,
      accessToken: nextAccessToken,
      marker: Symbol('account-session'),
    };
  }
  const desiredMarker = desired.current.marker;
  const [settledMarker, setSettledMarker] = useState<symbol | null>(null);

  useEffect(() => {
    let cancelled = false;
    const marker = desiredMarker;
    if (accountSession.status === 'loading') {
      coordinator.setAccountLoading();
      setSettledMarker(marker);
      return () => {
        cancelled = true;
      };
    }

    const accessToken =
      accountSession.status === 'authenticated'
        ? accountSession.accessToken
        : null;
    const pending = initialized.current
      ? coordinator.setAccountSession(accessToken)
      : coordinator.restore(accessToken);
    initialized.current = true;
    void pending.then(() => {
      if (!cancelled) setSettledMarker(marker);
    });
    return () => {
      cancelled = true;
    };
  }, [accountSession.status, coordinator, desiredMarker, nextAccessToken]);

  useEffect(() => {
    const generation = lifecycleGeneration.current + 1;
    lifecycleGeneration.current = generation;
    return () => {
      queueMicrotask(() => {
        if (lifecycleGeneration.current === generation) {
          coordinator.dispose();
        }
      });
    };
  }, [coordinator]);

  const visibleRelation =
    settledMarker === desiredMarker
      ? relation
      : transitionSnapshot(
          relation,
          accountSession,
          activeHandle !== null,
          !initialized.current,
        );
  const accountToken =
    accountSession.status === 'authenticated'
      ? accountSession.accessToken
      : null;
  const identity = useMemo(
    () =>
      resolveIdentity({
        relation: visibleRelation,
        accountToken,
        userHandle: activeHandle,
        walletLabel: activeWallet?.label ?? null,
      }),
    [visibleRelation, accountToken, activeHandle, activeWallet?.label],
  );

  return {
    identity,
    relation: visibleRelation,
    retry: async () => {
      await coordinator.retry();
    },
    reconcile: async () => {
      if (accountSession.status === 'loading') {
        coordinator.setAccountLoading();
        return;
      }
      await coordinator.restore(
        accountSession.status === 'authenticated'
          ? accountSession.accessToken
          : null,
      );
    },
    allowAccountSession: coordinator.allowAccountSession,
    settleAccountSession: (accessToken: string) =>
      coordinator.setAccountSession(accessToken),
  };
}
