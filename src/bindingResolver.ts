import { PublicKey } from '@solana/web3.js';

import { base64urlToBytes, bytesToBase64url } from './base64';
import type {
  ServerRelationVerificationResult,
  ServerRelationVerifier,
} from './relationController';
import { resolveDexterApiBase } from './trust';
import { ConnectError } from './types';

export const WALLET_ACCOUNT_BINDING_PATH = '/api/passkey-anon/binding/resolve';

export type ResolvedWalletAccountRelation =
  | 'wallet_only'
  | 'account_only'
  | 'bound'
  | 'conflict';

declare const walletBindingCandidateBrand: unique symbol;
declare const accountBindingCandidateBrand: unique symbol;

/** Opaque bearer for a server-issued Dexter Wallet identity proof. */
export interface WalletBindingCandidate {
  readonly kind: 'dexter_wallet_identity_proof';
  readonly [walletBindingCandidateBrand]: true;
}

/** The exact active Wallet selected by the consumer for this relation check. */
export interface ActiveWalletBindingIdentity {
  readonly userHandle: string;
  readonly vaultPda: string;
}

/** Opaque bearer for an authenticated Dexter account session. */
export interface AccountBindingCandidate {
  readonly kind: 'dexter_account_session';
  readonly [accountBindingCandidateBrand]: true;
}

interface WalletBindingMaterial {
  readonly identityProof: string;
  readonly activeWallet: ActiveWalletBindingIdentity;
}

const walletBindings = new WeakMap<WalletBindingCandidate, WalletBindingMaterial>();
const accountTokens = new WeakMap<AccountBindingCandidate, string>();

function requireHeaderToken(value: string, code: string): string {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) {
    throw new ConnectError(code);
  }
  return value;
}

function requireActiveWalletIdentity(
  value: ActiveWalletBindingIdentity,
): ActiveWalletBindingIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectError('invalid_active_wallet');
  }
  const { userHandle, vaultPda } = value;
  if (typeof userHandle !== 'string' || typeof vaultPda !== 'string') {
    throw new ConnectError('invalid_active_wallet');
  }

  try {
    const handleBytes = base64urlToBytes(userHandle);
    const canonicalVaultPda = new PublicKey(vaultPda).toBase58();
    if (
      handleBytes.length !== 16 ||
      bytesToBase64url(handleBytes) !== userHandle ||
      canonicalVaultPda !== vaultPda
    ) {
      throw new ConnectError('invalid_active_wallet');
    }
  } catch (cause) {
    if (cause instanceof ConnectError) throw cause;
    throw new ConnectError('invalid_active_wallet');
  }

  return Object.freeze({ userHandle, vaultPda });
}

/**
 * Wrap a Wallet proof before giving it to the relationship controller. The
 * proof stays outside enumerable object properties, JSON, and snapshots.
 */
export function walletBindingCandidate(
  identityProof: string,
  activeWallet: ActiveWalletBindingIdentity,
): WalletBindingCandidate {
  const canonicalActiveWallet = requireActiveWalletIdentity(activeWallet);
  const candidate = Object.freeze({
    kind: 'dexter_wallet_identity_proof',
  }) as WalletBindingCandidate;
  walletBindings.set(candidate, Object.freeze({
    identityProof: requireHeaderToken(
      identityProof,
      'invalid_wallet_identity_proof',
    ),
    activeWallet: canonicalActiveWallet,
  }));
  return candidate;
}

/**
 * Wrap an account access token before giving it to the relationship controller.
 * The token stays outside enumerable object properties, JSON, and snapshots.
 */
export function accountBindingCandidate(accessToken: string): AccountBindingCandidate {
  const candidate = Object.freeze({
    kind: 'dexter_account_session',
  }) as AccountBindingCandidate;
  accountTokens.set(
    candidate,
    requireHeaderToken(accessToken, 'invalid_account_access_token'),
  );
  return candidate;
}

export type BindingResolutionResult =
  | { readonly ok: true; readonly relation: ResolvedWalletAccountRelation }
  | { readonly ok: false; readonly reason: 'offline' }
  | {
      readonly ok: false;
      readonly reason: 'expired';
      readonly subject: 'wallet' | 'account' | 'both';
    }
  | { readonly ok: false; readonly reason: 'error'; readonly code: string };

export interface ResolveWalletAccountBindingInput {
  readonly wallet?: WalletBindingCandidate | null;
  readonly account?: AccountBindingCandidate | null;
  readonly signal?: AbortSignal;
}

export type BindingFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface WalletAccountBindingClientConfig {
  /** Compatibility option; only the canonical Dexter API origin is accepted. */
  readonly apiBase?: string;
  /** Injectable for tests, edge runtimes, and hosts with a custom fetch adapter. */
  readonly fetch?: BindingFetch;
}

export interface WalletAccountBindingClient {
  resolve(input: ResolveWalletAccountBindingInput): Promise<BindingResolutionResult>;
  readonly verify: ServerRelationVerifier<WalletBindingCandidate, AccountBindingCandidate>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResolution(value: unknown): ResolvedWalletAccountRelation | null {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null;
  const relation = value.relation;
  return relation === 'wallet_only' ||
    relation === 'account_only' ||
    relation === 'bound' ||
    relation === 'conflict'
    ? relation
    : null;
}

type BindingApiError =
  | 'identity_required'
  | 'invalid_active_wallet'
  | 'active_wallet_required'
  | 'wallet_proof_required'
  | 'invalid_wallet_proof'
  | 'invalid_account_session'
  | 'wallet_not_initialized'
  | 'temporarily_unavailable';

function parseApiError(value: unknown): BindingApiError | null {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null;
  const code = value.error;
  return code === 'identity_required' ||
    code === 'invalid_active_wallet' ||
    code === 'active_wallet_required' ||
    code === 'wallet_proof_required' ||
    code === 'invalid_wallet_proof' ||
    code === 'invalid_account_session' ||
    code === 'wallet_not_initialized' ||
    code === 'temporarily_unavailable'
    ? code
    : null;
}

function expectedApiError(status: number, code: BindingApiError): boolean {
  if (status === 400) {
    return code === 'identity_required' ||
      code === 'invalid_active_wallet' ||
      code === 'active_wallet_required' ||
      code === 'wallet_proof_required';
  }
  if (status === 401) {
    return code === 'invalid_wallet_proof' || code === 'invalid_account_session';
  }
  if (status === 409) return code === 'wallet_not_initialized';
  if (status === 503) return code === 'temporarily_unavailable';
  return false;
}

function relationMatchesSuppliedProofs(
  relation: ResolvedWalletAccountRelation,
  walletPresent: boolean,
  accountPresent: boolean,
): boolean {
  if (walletPresent && accountPresent) return relation === 'bound' || relation === 'conflict';
  if (walletPresent) return relation === 'wallet_only' || relation === 'conflict';
  if (accountPresent) return relation === 'account_only';
  return false;
}

function globalFetch(): BindingFetch | null {
  return typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : null;
}

/**
 * Create the API adapter that resolves Wallet/account relation from two
 * independently issued proofs. It never compares browser identifiers.
 */
export function createWalletAccountBindingClient(
  config: WalletAccountBindingClientConfig = {},
): WalletAccountBindingClient {
  const apiBase = resolveDexterApiBase(config.apiBase);
  const fetchImpl = config.fetch ?? globalFetch();

  const resolve = async (
    input: ResolveWalletAccountBindingInput,
  ): Promise<BindingResolutionResult> => {
    const walletPresent = input.wallet != null;
    const accountPresent = input.account != null;

    if (!walletPresent && !accountPresent) {
      return { ok: false, reason: 'error', code: 'missing_binding_proof' };
    }
    if (!fetchImpl) {
      return { ok: false, reason: 'offline' };
    }

    const walletBinding = input.wallet ? walletBindings.get(input.wallet) : undefined;
    const accountToken = input.account ? accountTokens.get(input.account) : undefined;
    if (walletPresent && !walletBinding) {
      return { ok: false, reason: 'error', code: 'invalid_wallet_candidate' };
    }
    if (accountPresent && !accountToken) {
      return { ok: false, reason: 'error', code: 'invalid_account_candidate' };
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (accountToken) headers.Authorization = `Bearer ${accountToken}`;
    if (walletBinding) {
      headers['X-Dexter-Wallet-Proof'] = walletBinding.identityProof;
    }
    const requestBody = JSON.stringify(
      walletBinding ? { activeWallet: walletBinding.activeWallet } : {},
    );

    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${WALLET_ACCOUNT_BINDING_PATH}`, {
        method: 'POST',
        headers,
        cache: 'no-store',
        credentials: 'omit',
        body: requestBody,
        signal: input.signal,
      });
    } catch {
      if (input.signal?.aborted) {
        return { ok: false, reason: 'error', code: 'binding_request_aborted' };
      }
      return { ok: false, reason: 'offline' };
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        return { ok: false, reason: 'error', code: 'malformed_binding_response' };
      }

      const code = parseApiError(errorBody);
      if (!code || !expectedApiError(response.status, code)) {
        return { ok: false, reason: 'error', code: 'malformed_binding_response' };
      }
      if (code === 'invalid_wallet_proof') {
        return walletPresent
          ? { ok: false, reason: 'expired', subject: 'wallet' }
          : { ok: false, reason: 'error', code: 'malformed_binding_response' };
      }
      if (code === 'invalid_account_session') {
        return accountPresent
          ? { ok: false, reason: 'expired', subject: 'account' }
          : { ok: false, reason: 'error', code: 'malformed_binding_response' };
      }
      return {
        ok: false,
        reason: 'error',
        code,
      };
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      return { ok: false, reason: 'error', code: 'malformed_binding_response' };
    }

    const relation = parseResolution(responseBody);
    if (!relation || !relationMatchesSuppliedProofs(relation, walletPresent, accountPresent)) {
      return { ok: false, reason: 'error', code: 'malformed_binding_response' };
    }
    return { ok: true, relation };
  };

  const verify: ServerRelationVerifier<WalletBindingCandidate, AccountBindingCandidate> = async ({
    wallet,
    account,
    signal,
  }): Promise<ServerRelationVerificationResult> => {
    const result = await resolve({ wallet, account, signal });
    if (!result.ok) return result;
    if (result.relation === 'bound' || result.relation === 'conflict') {
      return { ok: true, relation: result.relation };
    }
    return { ok: false, reason: 'error', code: 'incomplete_binding_relation' };
  };

  return Object.freeze({ resolve, verify });
}
