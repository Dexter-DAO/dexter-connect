/**
 * Framework-neutral Wallet/account relationship controller.
 *
 * Browser presence is insufficient to establish a bound identity. The injected
 * verifier is the only path to `bound` or `conflict`; every local identity
 * change immediately falls back to a provisional relation while verification
 * runs. Candidate objects should be immutable for the duration of a check.
 */

export type WalletAccountRelation =
  | 'none'
  | 'wallet_only'
  | 'account_only'
  | 'bound'
  | 'conflict';

export type RelationCheckReason =
  | 'restore'
  | 'wallet_change'
  | 'account_change'
  | 'retry';

export type RelationRuntime =
  | { readonly phase: 'hydrating' }
  | { readonly phase: 'checking'; readonly reason: RelationCheckReason }
  | { readonly phase: 'ready' }
  | { readonly phase: 'offline' }
  | {
      readonly phase: 'expired';
      readonly subject: 'wallet' | 'account' | 'both';
    }
  | { readonly phase: 'error'; readonly code: string };

export interface WalletAccountRelationSnapshot {
  readonly relation: WalletAccountRelation;
  readonly runtime: RelationRuntime;
  readonly walletPresent: boolean;
  readonly accountPresent: boolean;
  /** Account-scoped data and actions stay locked unless the server verified the pair. */
  readonly privateAccountAccess: boolean;
  /** A verified mismatch. Consumers should expose only their repair path. */
  readonly quarantined: boolean;
  readonly verifiedAt: number | null;
  readonly revision: number;
}

export type ServerRelationVerificationResult =
  | {
      readonly ok: true;
      readonly relation: 'bound' | 'conflict';
      readonly verifiedAt?: number;
    }
  | { readonly ok: false; readonly reason: 'offline' }
  | {
      readonly ok: false;
      readonly reason: 'expired';
      readonly subject: 'wallet' | 'account' | 'both';
    }
  | { readonly ok: false; readonly reason: 'error'; readonly code: string };

export interface ServerRelationVerificationRequest<TWallet, TAccount> {
  readonly wallet: TWallet;
  readonly account: TAccount;
  readonly reason: RelationCheckReason;
  readonly signal: AbortSignal;
}

export type ServerRelationVerifier<TWallet, TAccount> = (
  request: ServerRelationVerificationRequest<TWallet, TAccount>,
) => Promise<ServerRelationVerificationResult>;

export interface WalletAccountRelationControllerOptions<TWallet, TAccount> {
  /**
   * Call the Dexter API with proof for both candidates. Local equality checks
   * are not verification and must not be substituted here.
   */
  readonly verify: ServerRelationVerifier<TWallet, TAccount>;
  readonly now?: () => number;
}

export interface RelationCandidates<TWallet, TAccount> {
  readonly wallet: TWallet | null;
  readonly account: TAccount | null;
}

type Listener = (snapshot: WalletAccountRelationSnapshot) => void;

function provisionalRelation(walletPresent: boolean, accountPresent: boolean): WalletAccountRelation {
  if (walletPresent) return 'wallet_only';
  if (accountPresent) return 'account_only';
  return 'none';
}

function frozenRuntime(runtime: RelationRuntime): RelationRuntime {
  return Object.freeze({ ...runtime });
}

function frozenSnapshot(
  relation: WalletAccountRelation,
  runtime: RelationRuntime,
  walletPresent: boolean,
  accountPresent: boolean,
  verifiedAt: number | null,
  revision: number,
): WalletAccountRelationSnapshot {
  const readyAndBound = relation === 'bound' && runtime.phase === 'ready';
  return Object.freeze({
    relation,
    runtime: frozenRuntime(runtime),
    walletPresent,
    accountPresent,
    privateAccountAccess: readyAndBound,
    quarantined: relation === 'conflict',
    verifiedAt: readyAndBound || relation === 'conflict' ? verifiedAt : null,
    revision,
  });
}

function isVerifiedResult(value: unknown): value is Extract<ServerRelationVerificationResult, { ok: true }> {
  if (!value || typeof value !== 'object') return false;
  const result = value as { ok?: unknown; relation?: unknown; verifiedAt?: unknown };
  if (result.ok !== true) return false;
  if (result.relation !== 'bound' && result.relation !== 'conflict') return false;
  return result.verifiedAt === undefined || Number.isFinite(result.verifiedAt);
}

function isFailureResult(value: unknown): value is Extract<ServerRelationVerificationResult, { ok: false }> {
  if (!value || typeof value !== 'object') return false;
  const result = value as { ok?: unknown; reason?: unknown; subject?: unknown; code?: unknown };
  if (result.ok !== false) return false;
  if (result.reason === 'offline') return true;
  if (result.reason === 'expired') {
    return result.subject === 'wallet' || result.subject === 'account' || result.subject === 'both';
  }
  return result.reason === 'error' && typeof result.code === 'string' && result.code.length > 0;
}

/**
 * Owns relationship state without owning storage, HTTP, React, or credentials.
 * Consumers feed it Wallet/account candidates and provide the API verifier.
 */
export class WalletAccountRelationController<TWallet, TAccount> {
  private wallet: TWallet | null = null;
  private account: TAccount | null = null;
  private revision = 0;
  private activeCheck: AbortController | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly verify: ServerRelationVerifier<TWallet, TAccount>;
  private readonly now: () => number;
  private snapshot: WalletAccountRelationSnapshot;

  constructor(options: WalletAccountRelationControllerOptions<TWallet, TAccount>) {
    this.verify = options.verify;
    this.now = options.now ?? Date.now;
    this.snapshot = frozenSnapshot('none', { phase: 'hydrating' }, false, false, null, 0);
  }

  getSnapshot(): WalletAccountRelationSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Restore cached candidates, then verify the exact pair before unlocking account access. */
  restore(candidates: RelationCandidates<TWallet, TAccount>): Promise<WalletAccountRelationSnapshot> {
    this.replaceCandidates(candidates.wallet, candidates.account, { phase: 'hydrating' });
    return this.settle('restore');
  }

  /** Lock account-owned data while the host restores its account session. */
  beginRestore(): void {
    this.invalidate({ phase: 'hydrating' });
  }

  /** An explicit Wallet event always invalidates prior binding, even for the same object. */
  setWallet(wallet: TWallet | null): Promise<WalletAccountRelationSnapshot> {
    this.replaceCandidates(wallet, this.account, this.runtimeAfterChange('wallet_change', wallet, this.account));
    return this.settle('wallet_change');
  }

  /** An explicit account event always invalidates prior binding, even for the same object. */
  setAccount(account: TAccount | null): Promise<WalletAccountRelationSnapshot> {
    this.replaceCandidates(this.wallet, account, this.runtimeAfterChange('account_change', this.wallet, account));
    return this.settle('account_change');
  }

  retry(): Promise<WalletAccountRelationSnapshot> {
    this.invalidate(this.runtimeAfterChange('retry', this.wallet, this.account));
    return this.settle('retry');
  }

  dispose(): void {
    this.activeCheck?.abort();
    this.activeCheck = null;
    this.listeners.clear();
  }

  private runtimeAfterChange(
    reason: RelationCheckReason,
    wallet: TWallet | null,
    account: TAccount | null,
  ): RelationRuntime {
    return wallet !== null && account !== null ? { phase: 'checking', reason } : { phase: 'ready' };
  }

  private replaceCandidates(
    wallet: TWallet | null,
    account: TAccount | null,
    runtime: RelationRuntime,
  ): void {
    this.wallet = wallet;
    this.account = account;
    this.invalidate(runtime);
  }

  private invalidate(runtime: RelationRuntime): void {
    this.activeCheck?.abort();
    this.activeCheck = null;
    this.revision += 1;
    const walletPresent = this.wallet !== null;
    const accountPresent = this.account !== null;
    this.publish(
      provisionalRelation(walletPresent, accountPresent),
      runtime,
      walletPresent,
      accountPresent,
      null,
      this.revision,
    );
  }

  private settle(reason: RelationCheckReason): Promise<WalletAccountRelationSnapshot> {
    if (this.wallet !== null && this.account !== null) return this.runCheck(reason);
    if (this.snapshot.runtime.phase !== 'ready') {
      this.publish(
        provisionalRelation(this.wallet !== null, this.account !== null),
        { phase: 'ready' },
        this.wallet !== null,
        this.account !== null,
        null,
        this.revision,
      );
    }
    return Promise.resolve(this.snapshot);
  }

  private async runCheck(reason: RelationCheckReason): Promise<WalletAccountRelationSnapshot> {
    const wallet = this.wallet;
    const account = this.account;
    if (wallet === null || account === null) return this.settle(reason);

    const revision = this.revision;
    const check = new AbortController();
    this.activeCheck?.abort();
    this.activeCheck = check;

    if (this.snapshot.runtime.phase !== 'checking' || this.snapshot.runtime.reason !== reason) {
      this.publish(
        provisionalRelation(true, true),
        { phase: 'checking', reason },
        true,
        true,
        null,
        revision,
      );
    }

    try {
      const result = await this.verify({ wallet, account, reason, signal: check.signal });
      if (!this.isCurrentCheck(check, revision)) return this.snapshot;
      this.activeCheck = null;

      if (isVerifiedResult(result)) {
        this.publish(result.relation, { phase: 'ready' }, true, true, result.verifiedAt ?? this.now(), revision);
        return this.snapshot;
      }

      if (isFailureResult(result)) {
        const runtime: RelationRuntime =
          result.reason === 'offline'
            ? { phase: 'offline' }
            : result.reason === 'expired'
              ? { phase: 'expired', subject: result.subject }
              : { phase: 'error', code: result.code };
        this.publish('wallet_only', runtime, true, true, null, revision);
        return this.snapshot;
      }

      this.publish('wallet_only', { phase: 'error', code: 'invalid_verification_result' }, true, true, null, revision);
    } catch (error) {
      if (!this.isCurrentCheck(check, revision)) return this.snapshot;
      this.activeCheck = null;
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'verification_failed';
      this.publish('wallet_only', { phase: 'error', code }, true, true, null, revision);
    }

    return this.snapshot;
  }

  private isCurrentCheck(check: AbortController, revision: number): boolean {
    return this.activeCheck === check && this.revision === revision && !check.signal.aborted;
  }

  private publish(
    relation: WalletAccountRelation,
    runtime: RelationRuntime,
    walletPresent: boolean,
    accountPresent: boolean,
    verifiedAt: number | null,
    revision: number,
  ): void {
    this.snapshot = frozenSnapshot(
      relation,
      runtime,
      walletPresent,
      accountPresent,
      verifiedAt,
      revision,
    );
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // One subscriber cannot block the rest of the state transition.
      }
    }
  }
}
