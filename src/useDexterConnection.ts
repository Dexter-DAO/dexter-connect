'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createDexterControlModel,
  type DexterConnectionIntent,
  type DexterControlModel,
} from './connectionContract';
import {
  connectDexterIdentity,
  disconnectDexterIdentity,
  type AccountSessionClearer,
  type AccountSessionInstaller,
} from './identityTransition';
import type { BindingFetch } from './bindingResolver';
import { resolveIdentity } from './identity';
import type {
  RelationCheckReason,
  WalletAccountRelationSnapshot,
} from './relationController';
import { ConnectError, type PasskeyLoginConfig, type SignInResult } from './types';
import {
  useDexterIdentity,
  type DexterAccountSession,
} from './useDexterIdentity';
import { useDexterWallet } from './useDexterWallet';

export type DexterConnectionOperation =
  | 'idle'
  | 'connecting'
  | 'disconnecting'
  | 'removing';

type DexterConnectionAction = DexterConnectionOperation | 'retrying';

export const REMOVE_DEXTER_FROM_DEVICE_CONFIRMATION =
  'remove-dexter-from-device' as const;
export type RemoveDexterFromDeviceConfirmation =
  typeof REMOVE_DEXTER_FROM_DEVICE_CONFIRMATION;

export interface RemoveDexterFromDeviceResult {
  readonly removedFromRoster: boolean;
  readonly passkeyPruned: boolean;
}

export interface DexterIdentityView {
  readonly kind: WalletAccountRelationSnapshot['relation'];
  readonly userHandle: string | null;
  readonly walletLabel: string | null;
  readonly hasPasskeyVault: boolean;
  readonly hasAccount: boolean;
  readonly hasWallet: boolean;
  readonly hasAccountAccess: boolean;
  readonly quarantined: boolean;
}

export interface DexterWalletView {
  readonly userHandle: string;
  readonly label: string | null;
  readonly vaultPda: string | null;
  readonly swigAddress: string | null;
  readonly walletAddress: string | null;
  readonly receiveAddress: string | null;
  readonly network: string | null;
}

export interface UseDexterConnectionConfig {
  readonly intent: DexterConnectionIntent;
  readonly accountSession: DexterAccountSession;
  readonly installAccountSession: AccountSessionInstaller;
  readonly clearAccountSession: AccountSessionClearer;
  readonly apiBase?: string;
  readonly fetch?: BindingFetch;
  readonly passkey?: Omit<PasskeyLoginConfig, 'apiBase' | 'walletStore'>;
}

export interface UseDexterConnection {
  readonly model: DexterControlModel;
  readonly identity: DexterIdentityView;
  readonly relation: WalletAccountRelationSnapshot;
  readonly operation: DexterConnectionOperation;
  readonly activeWallet: DexterWalletView | null;
  readonly error: ConnectError | null;
  connect(): Promise<SignInResult>;
  useAnotherDexterWallet(): Promise<SignInResult>;
  disconnectDexter(): Promise<boolean>;
  removeFromThisDevice(
    confirmation: RemoveDexterFromDeviceConfirmation,
  ): Promise<RemoveDexterFromDeviceResult>;
  retry(): Promise<void>;
}

function checkingSnapshot(
  snapshot: WalletAccountRelationSnapshot,
  reason: RelationCheckReason,
): WalletAccountRelationSnapshot {
  return Object.freeze({
    ...snapshot,
    relation: 'none' as const,
    runtime: Object.freeze({ phase: 'checking' as const, reason }),
    walletPresent: false,
    accountPresent: false,
    privateAccountAccess: false,
    quarantined: false,
    verifiedAt: null,
  });
}

function errorSnapshot(
  snapshot: WalletAccountRelationSnapshot,
  error: ConnectError,
): WalletAccountRelationSnapshot {
  return Object.freeze({
    ...snapshot,
    runtime: Object.freeze({ phase: 'error' as const, code: error.code }),
    privateAccountAccess: false,
  });
}

function unsettledBindingError(
  snapshot: WalletAccountRelationSnapshot,
): ConnectError | null {
  if (
    snapshot.relation === 'bound' &&
    snapshot.runtime.phase === 'ready' &&
    snapshot.privateAccountAccess
  ) {
    return null;
  }
  if (snapshot.relation === 'conflict') {
    return new ConnectError('identity_binding_conflict');
  }
  if (snapshot.runtime.phase === 'offline') {
    return new ConnectError('identity_binding_offline');
  }
  if (snapshot.runtime.phase === 'expired') {
    return new ConnectError(`identity_${snapshot.runtime.subject}_expired`);
  }
  if (snapshot.runtime.phase === 'error') {
    return new ConnectError(snapshot.runtime.code);
  }
  return new ConnectError('identity_binding_unverified');
}

/**
 * Canonical React control for one active Dexter identity and Wallet.
 * Consumers supply their account-session adapter and render from `model`.
 */
export function useDexterConnection(
  config: UseDexterConnectionConfig,
): UseDexterConnection {
  const {
    intent,
    accountSession,
    installAccountSession,
    clearAccountSession,
    passkey,
    apiBase,
    fetch,
  } = config;
  const dexterIdentity = useDexterIdentity({
    ...(apiBase ? { apiBase } : {}),
    ...(fetch ? { fetch } : {}),
    accountSession,
  });
  const wallet = useDexterWallet();
  const [operation, setOperation] =
    useState<DexterConnectionOperation>('idle');
  const [targetHandle, setTargetHandle] = useState<string | null>(null);
  const [targetAccessToken, setTargetAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<ConnectError | null>(null);
  const action = useRef<DexterConnectionAction>('idle');

  const beginAction = useCallback(
    (next: Exclude<DexterConnectionAction, 'idle'>) => {
      if (action.current !== 'idle') {
        throw new ConnectError('identity_operation_in_progress');
      }
      action.current = next;
      if (next !== 'retrying') setOperation(next);
    },
    [],
  );

  const finishAction = useCallback(
    (expected: Exclude<DexterConnectionAction, 'idle'>) => {
      if (action.current !== expected) return;
      action.current = 'idle';
      if (expected !== 'retrying') setOperation('idle');
    },
    [],
  );

  useEffect(() => {
    if (
      operation === 'connecting' &&
      targetHandle !== null &&
      targetAccessToken !== null &&
      wallet.activeHandle === targetHandle &&
      accountSession.status === 'authenticated' &&
      accountSession.accessToken === targetAccessToken &&
      dexterIdentity.relation.relation === 'bound' &&
      dexterIdentity.relation.privateAccountAccess
    ) {
      finishAction('connecting');
      setTargetHandle(null);
      setTargetAccessToken(null);
    }
    if (
      (operation === 'disconnecting' || operation === 'removing') &&
      dexterIdentity.relation.relation === 'none'
    ) {
      finishAction(operation);
    }
  }, [
    dexterIdentity.relation,
    operation,
    targetHandle,
    targetAccessToken,
    wallet.activeHandle,
    accountSession,
    finishAction,
  ]);

  const operationRelation =
    operation === 'idle'
      ? dexterIdentity.relation
      : checkingSnapshot(
          dexterIdentity.relation,
          operation === 'connecting' ? 'wallet_change' : 'account_change',
        );
  const modelRelation =
    error !== null && operation === 'idle'
      ? errorSnapshot(operationRelation, error)
      : operationRelation;
  const model = useMemo(
    () => createDexterControlModel(intent, modelRelation),
    [intent, modelRelation],
  );
  const relation = modelRelation;
  const accountToken =
    accountSession.status === 'authenticated'
      ? accountSession.accessToken
      : null;
  const identity = useMemo((): DexterIdentityView => {
    const resolved = resolveIdentity({
      relation,
      accountToken,
      userHandle: wallet.activeHandle,
      walletLabel: wallet.activeWallet?.label ?? null,
    });
    return {
      kind: resolved.kind,
      userHandle: model.permissions.walletIdentityVisible
        ? resolved.userHandle
        : null,
      walletLabel: model.permissions.walletIdentityVisible
        ? resolved.walletLabel
        : null,
      hasPasskeyVault: resolved.hasPasskeyVault,
      hasAccount: resolved.hasAccount,
      hasWallet: resolved.hasWallet,
      hasAccountAccess:
        model.permissions.accountContentVisible && resolved.hasAccountAccess,
      quarantined: resolved.quarantined,
    };
  }, [
      accountToken,
      relation,
      model.permissions.accountContentVisible,
      model.permissions.walletIdentityVisible,
      wallet.activeHandle,
      wallet.activeWallet?.label,
    ]);
  const activeWallet = useMemo((): DexterWalletView | null => {
    if (!model.permissions.walletIdentityVisible) return null;
    const active = wallet.activeWallet;
    if (!active) return null;
    return {
      userHandle: active.handle,
      label: active.label ?? null,
      vaultPda: active.vaultPda ?? null,
      swigAddress: active.swigAddress ?? null,
      walletAddress: active.walletAddress ?? null,
      receiveAddress: active.receiveAddress ?? null,
      network: active.network ?? null,
    };
  }, [model.permissions.walletIdentityVisible, wallet.activeWallet]);

  const connect = useCallback(async (): Promise<SignInResult> => {
    beginAction('connecting');
    setError(null);
    setTargetHandle(null);
    setTargetAccessToken(null);
    try {
      const result = await connectDexterIdentity({
        ...passkey,
        ...(apiBase ? { apiBase } : {}),
        ...(fetch ? { bindingFetch: fetch } : {}),
        installAccountSession: async (session) => {
          dexterIdentity.allowAccountSession(session.accessToken);
          await installAccountSession(session);
          const settled = await dexterIdentity.settleAccountSession(
            session.accessToken,
          );
          const settleError = unsettledBindingError(settled);
          if (settleError) {
            try {
              await clearAccountSession();
            } catch (cause) {
              throw new ConnectError(
                'account_session_clear_failed',
                cause instanceof Error ? cause.message : String(cause),
              );
            }
            throw settleError;
          }
        },
      });
      setTargetHandle(result.vault.userHandle);
      setTargetAccessToken(result.session.accessToken);
      return result;
    } catch (cause) {
      await dexterIdentity.reconcile().catch(() => undefined);
      const nextError =
        cause instanceof ConnectError
          ? cause
          : new ConnectError('identity_transition_failed', String(cause));
      setError(nextError);
      setTargetHandle(null);
      setTargetAccessToken(null);
      finishAction('connecting');
      throw nextError;
    }
  }, [
    dexterIdentity,
    apiBase,
    fetch,
    installAccountSession,
    clearAccountSession,
    passkey,
    beginAction,
    finishAction,
  ]);

  const disconnectDexter = useCallback(async (): Promise<boolean> => {
    beginAction('disconnecting');
    setError(null);
    try {
      const disconnected = await disconnectDexterIdentity({
        clearAccountSession,
      });
      if (!disconnected) finishAction('disconnecting');
      return disconnected;
    } catch (cause) {
      await dexterIdentity.reconcile().catch(() => undefined);
      const nextError =
        cause instanceof ConnectError
          ? cause
          : new ConnectError('identity_disconnect_failed', String(cause));
      setError(nextError);
      finishAction('disconnecting');
      throw nextError;
    }
  }, [
    beginAction,
    clearAccountSession,
    dexterIdentity,
    finishAction,
  ]);

  const removeFromThisDevice = useCallback(
    async (
      confirmation: RemoveDexterFromDeviceConfirmation,
    ): Promise<RemoveDexterFromDeviceResult> => {
      if (confirmation !== REMOVE_DEXTER_FROM_DEVICE_CONFIRMATION) {
        return { removedFromRoster: false, passkeyPruned: false };
      }
      const handle = wallet.activeHandle;
      if (!handle) {
        return { removedFromRoster: false, passkeyPruned: false };
      }
      beginAction('removing');
      setError(null);
      try {
        const result = await wallet.removeFromDevice(
          handle,
          'remove-wallet-from-device',
        );
        if (!result.removedFromRoster) {
          throw new ConnectError('identity_device_removal_failed');
        }
        await clearAccountSession();
        return result;
      } catch (cause) {
        await dexterIdentity.reconcile().catch(() => undefined);
        const nextError =
          cause instanceof ConnectError
            ? cause
            : new ConnectError(
                'identity_device_removal_failed',
                String(cause),
              );
        setError(nextError);
        finishAction('removing');
        throw nextError;
      }
    },
    [
      beginAction,
      clearAccountSession,
      dexterIdentity,
      finishAction,
      wallet,
    ],
  );

  const retry = useCallback(async (): Promise<void> => {
    beginAction('retrying');
    setError(null);
    try {
      await dexterIdentity.retry();
    } catch (cause) {
      const nextError =
        cause instanceof ConnectError
          ? cause
          : new ConnectError('identity_retry_failed', String(cause));
      setError(nextError);
      throw nextError;
    } finally {
      finishAction('retrying');
    }
  }, [beginAction, dexterIdentity, finishAction]);

  return {
    model,
    identity,
    relation,
    operation,
    activeWallet,
    error,
    connect,
    useAnotherDexterWallet: connect,
    disconnectDexter,
    removeFromThisDevice,
    retry,
  };
}
