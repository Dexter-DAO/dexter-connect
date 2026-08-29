import { decodeJwt } from 'jose';

import { ConnectError } from './types';

import {
  accountBindingCandidate,
  createWalletAccountBindingClient,
  type AccountBindingCandidate,
  type BindingFetch,
  type WalletAccountBindingClient,
  type WalletBindingCandidate,
} from './bindingResolver';
import {
  WalletAccountRelationController,
  type ServerRelationVerificationResult,
  type WalletAccountRelationSnapshot,
} from './relationController';
import {
  getActiveWallet,
  subscribe as subscribeWallet,
  type StoredWallet,
} from './walletStore';
import {
  walletProofSessionStore,
  type WalletProofSessionStore,
} from './walletProofSession';

const CANONICAL_ACCOUNT_SUBJECT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface ActiveWalletCandidate {
  readonly handle: string;
  readonly wallet: StoredWallet;
  readonly proof: WalletBindingCandidate | null;
}

export interface DexterIdentityCoordinatorOptions {
  /** Compatibility option; only the canonical Dexter API origin is accepted. */
  readonly apiBase?: string;
  /** Injectable for tests and hosts with a custom fetch adapter. */
  readonly fetch?: BindingFetch;
  /** Injectable browser proof store. The shared Connect store is the default. */
  readonly proofSessionStore?: WalletProofSessionStore;
  /** Injectable binding client for non-browser runtimes and tests. */
  readonly bindingClient?: WalletAccountBindingClient;
}

export interface DexterIdentityCoordinator {
  getSnapshot(): WalletAccountRelationSnapshot;
  subscribe(listener: (snapshot: WalletAccountRelationSnapshot) => void): () => void;
  /** Restore the active Wallet and current account session as one relationship. */
  restore(accountAccessToken: string | null): Promise<WalletAccountRelationSnapshot>;
  /** Update only the account session. Account sign-out keeps the Wallet session. */
  setAccountSession(accountAccessToken: string | null): Promise<WalletAccountRelationSnapshot>;
  /** Lock account-owned data while the host restores its account session. */
  setAccountLoading(): void;
  /** Admit only the exact account token returned by the verified transition. */
  allowAccountSession(accountAccessToken: string): void;
  retry(): Promise<WalletAccountRelationSnapshot>;
  dispose(): void;
}

function walletCandidate(
  wallet: StoredWallet | null,
  proofStore: WalletProofSessionStore,
): ActiveWalletCandidate | null {
  if (!wallet) return null;
  let proof: WalletBindingCandidate | null = null;
  try {
    proof = wallet.vaultPda
      ? proofStore.bindingCandidate(wallet.handle, {
          userHandle: wallet.handle,
          vaultPda: wallet.vaultPda,
        })
      : null;
  } catch {
    proof = null;
  }
  return Object.freeze({ handle: wallet.handle, wallet, proof });
}

function accountCandidate(
  accessToken: string | null,
): AccountBindingCandidate | null {
  return accessToken ? accountBindingCandidate(accessToken) : null;
}

/** Decode only to prevent a stale account from surviving a Wallet change. */
function canonicalAccountSubject(accessToken: string): string | null {
  try {
    const subject = decodeJwt(accessToken).sub;
    return typeof subject === 'string' && CANONICAL_ACCOUNT_SUBJECT.test(subject)
      ? subject
      : null;
  } catch {
    return null;
  }
}

/**
 * Own the browser's Wallet/account relationship as one package-level session.
 * Consumers supply the current account access token; Connect owns Wallet
 * changes, retained Wallet proof loading, server verification, and stale-check
 * cancellation.
 */
export function createDexterIdentityCoordinator(
  options: DexterIdentityCoordinatorOptions = {},
): DexterIdentityCoordinator {
  const proofStore = options.proofSessionStore ?? walletProofSessionStore;
  const bindingClient =
    options.bindingClient ??
    createWalletAccountBindingClient({
      ...(options.apiBase ? { apiBase: options.apiBase } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });

  const controller = new WalletAccountRelationController<
    ActiveWalletCandidate,
    AccountBindingCandidate
  >({
    verify: async ({ wallet, account, reason, signal }) => {
      if (!wallet.proof) {
        return {
          ok: false,
          reason: 'expired',
          subject: 'wallet',
        } satisfies ServerRelationVerificationResult;
      }
      return bindingClient.verify({
        wallet: wallet.proof,
        account,
        reason,
        signal,
      });
    },
  });

  let currentAccount: AccountBindingCandidate | null = null;
  let currentAccountAccessToken: string | null = null;
  let currentAccountSubject: string | null = null;
  let invalidatedAccountSubject: string | null = null;
  let allowedAccountAccessToken: string | null = null;
  let pendingAccountSettlement: {
    readonly accessToken: string;
    readonly promise: Promise<WalletAccountRelationSnapshot>;
  } | null = null;
  let accountLoading = false;
  let disposed = false;
  let started = false;
  let unsubscribeWallet: (() => void) | null = null;
  let unsubscribeProof: (() => void) | null = null;
  let proofExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  const currentWallet = (): ActiveWalletCandidate | null =>
    walletCandidate(getActiveWallet(), proofStore);

  const clearCurrentAccount = (): void => {
    currentAccount = null;
    currentAccountAccessToken = null;
    currentAccountSubject = null;
    pendingAccountSettlement = null;
  };

  const setCurrentAccount = (accountAccessToken: string): void => {
    currentAccount = accountCandidate(accountAccessToken);
    currentAccountAccessToken = accountAccessToken;
    currentAccountSubject = canonicalAccountSubject(accountAccessToken);
  };

  const keepAccountLoadingLocked = (
    wallet: ActiveWalletCandidate | null,
  ): void => {
    clearCurrentAccount();
    void controller.restore({ wallet, account: null });
    controller.beginRestore();
  };

  const clearProofExpiryTimer = (): void => {
    if (proofExpiryTimer !== null) clearTimeout(proofExpiryTimer);
    proofExpiryTimer = null;
  };

  const scheduleProofExpiry = (): void => {
    clearProofExpiryTimer();
    const active = getActiveWallet();
    if (!active) return;
    const session = proofStore.load(active.handle);
    if (!session) return;
    const remainingMs = Math.max(0, session.expiresAt * 1_000 - Date.now());
    const delayMs = Math.min(remainingMs, 2_147_000_000);
    proofExpiryTimer = setTimeout(() => {
      proofExpiryTimer = null;
      if (Date.now() < session.expiresAt * 1_000) {
        scheduleProofExpiry();
        return;
      }
      void controller.setWallet(currentWallet());
      scheduleProofExpiry();
    }, delayMs);
  };

  const start = (): void => {
    if (started || disposed) return;
    started = true;
    unsubscribeWallet = subscribeWallet((event) => {
      if (disposed || !event.invalidatesAccountBinding) return;
      scheduleProofExpiry();
      const wallet = currentWallet();

      if (accountLoading) {
        keepAccountLoadingLocked(wallet);
        return;
      }

      // A Wallet identity change ends the account binding. Returning to a
      // remembered Wallet cannot revive the prior account token; the next
      // full passkey sign-in must supply a fresh matching account session.
      invalidatedAccountSubject =
        currentAccountSubject ?? invalidatedAccountSubject;
      clearCurrentAccount();
      void controller.restore({ wallet, account: null });
    });
    unsubscribeProof = proofStore.subscribe((event) => {
      if (disposed) return;
      const active = getActiveWallet();
      if (!active) return;
      if (event.handle !== null && event.handle !== active.handle) return;
      scheduleProofExpiry();
      const wallet = walletCandidate(active, proofStore);
      if (accountLoading) {
        keepAccountLoadingLocked(wallet);
        return;
      }
      void controller.setWallet(wallet);
    });
    scheduleProofExpiry();
  };

  const restore = (accountAccessToken: string | null) => {
    start();
    accountLoading = false;
    invalidatedAccountSubject = null;
    allowedAccountAccessToken = null;
    if (accountAccessToken) setCurrentAccount(accountAccessToken);
    else clearCurrentAccount();
    return controller.restore({
      wallet: currentWallet(),
      account: currentAccount,
    });
  };

  const setAccountSession = (accountAccessToken: string | null) => {
    start();
    const wasAccountLoading = accountLoading;
    accountLoading = false;
    if (accountAccessToken) {
      if (
        accountAccessToken === currentAccountAccessToken &&
        !wasAccountLoading
      ) {
        return pendingAccountSettlement?.accessToken === accountAccessToken
          ? pendingAccountSettlement.promise
          : Promise.resolve(controller.getSnapshot());
      }
      const nextSubject = canonicalAccountSubject(accountAccessToken);
      const allowed = accountAccessToken === allowedAccountAccessToken;
      if (
        nextSubject === null ||
        (!allowed &&
          invalidatedAccountSubject !== null &&
          nextSubject === invalidatedAccountSubject)
      ) {
        clearCurrentAccount();
        return controller.setAccount(null);
      }
      allowedAccountAccessToken = null;
      invalidatedAccountSubject = null;
      setCurrentAccount(accountAccessToken);
    } else {
      allowedAccountAccessToken = null;
      clearCurrentAccount();
    }
    const settlement = controller.setAccount(currentAccount);
    if (accountAccessToken) {
      const tracked = { accessToken: accountAccessToken, promise: settlement };
      pendingAccountSettlement = tracked;
      const clearTrackedSettlement = () => {
        if (pendingAccountSettlement === tracked) {
          pendingAccountSettlement = null;
        }
      };
      void settlement.then(clearTrackedSettlement, clearTrackedSettlement);
    } else {
      pendingAccountSettlement = null;
    }
    return settlement;
  };

  return Object.freeze({
    getSnapshot: () => controller.getSnapshot(),
    subscribe: (listener: (snapshot: WalletAccountRelationSnapshot) => void) =>
      controller.subscribe(listener),
    restore,
    setAccountSession,
    setAccountLoading: () => {
      start();
      accountLoading = true;
      controller.beginRestore();
    },
    allowAccountSession: (accountAccessToken: string) => {
      if (canonicalAccountSubject(accountAccessToken) === null) {
        throw new ConnectError('invalid_account_access_token');
      }
      allowedAccountAccessToken = accountAccessToken;
    },
    retry: () => {
      start();
      return controller.retry();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearProofExpiryTimer();
      unsubscribeWallet?.();
      unsubscribeProof?.();
      controller.dispose();
    },
  });
}
