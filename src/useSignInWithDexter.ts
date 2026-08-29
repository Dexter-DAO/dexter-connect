import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PasskeySignerWithPublicKey } from '@dexterai/vault/signers';
import { passkeyLogin, continueWithDexter, type ContinueResult } from './relay';
import { recoverWallet } from './recover';
import { fetchUsdcBalance } from './balance';
import { createPasskeySigner } from './signer';
import { ConnectError } from './types';
import type {
  AgentDelegationMode,
  ConnectVault,
  PasskeyLoginTokens,
  SignInResult,
  CeremonyPhase,
  RecoverOutcome,
} from './types';

/** Dexter's Helius proxy for browser Solana reads. */
const DEFAULT_RPC = 'https://api.dexter.cash/proxy/helius/rpc';

export type ConnectStatus = 'idle' | 'pending' | 'done' | 'error';

export interface UseSignInWithDexterConfig {
  /** Compatibility-only: omitted or exactly https://api.dexter.cash. */
  apiBase?: string;
  /** RPC for the connected-chip balance read. Default: Dexter's Helius proxy. */
  rpcUrl?: string;
  /** Ceremony transport (both verbs). 'auto' (default) = inline on dexter.cash,
   *  popup anywhere else. Tests and staging may force one transport.
   *  CreateWalletPanel already had this knob; the sign-in surface was the odd
   *  one out. */
  transport?: 'auto' | 'popup' | 'inline';
  /** Hosted ceremony page for the popup transport. Default dexter.cash/connect. */
  connectHost?: string;
  /** Chrome-149+ immediate UI mode for the wallet-only verb: instant fast-fail
   *  when this device holds no passkey. Ignored by signIn(). */
  preferImmediate?: boolean;
  /**
   * Continue-mode wallet birth behavior. `deferred` creates an owner-only
   * wallet without asking for agent spending authority. Existing-wallet
   * sign-in is unchanged.
   */
  agentDelegation?: AgentDelegationMode;
}

export interface UseSignInWithDexter {
  status: ConnectStatus;
  /** Live ceremony phase while status==='pending' (challenge, passkey,
   *  verifying); null otherwise. Drives the button's connecting state. */
  phase: CeremonyPhase | null;
  isVaultConnected: boolean;
  /** Run the ceremony. Resolves with the result; throws ConnectError on failure
   *  (error is also captured in `error` + `status==='error'` for declarative UI). */
  signIn: () => Promise<SignInResult>;
  /** Wallet-only sign-in (P0c): re-points this browser at an existing wallet,
   *  mints NO session. Returns a discriminated outcome; cancel is a normal
   *  result, never a throw. Identity surfaces (useIdentity/useDexterWallet)
   *  light up via the wallet store; `session`/`vault` here stay null. Fire on
   *  tap only and never on mount (iOS gesture rule). */
  recover: () => Promise<RecoverOutcome>;
  /** One-button register-or-sign-in (keychain-first; see continueWithDexter).
   *  Terminal kinds update session/vault state; needs_create / needs_choice /
   *  cancelled return with status back at idle for the caller to route. */
  continueWith: () => Promise<ContinueResult>;
  /** Last recover outcome; null until recover() settles. */
  recovered: RecoverOutcome | null;
  /** Clear the account session and ceremony result held by this hook. */
  signOutAccount: () => void;
  /**
   * @deprecated Use `signOutAccount()`. To disconnect the active Wallet while
   * retaining it on this device, use `useDexterWallet().disconnect()`.
   */
  disconnect: () => void;
  session: PasskeyLoginTokens | null;
  vault: ConnectVault | null;
  /** Dexter Wallet address (swigAddress, base58). */
  vaultAddress: string | null;
  vaultPda: string | null;
  credentialId: string | null;
  /** Guest passkey signer for authorizing spends / opening x402 tabs. null until
   *  a vault is connected. Drive it via `passkeySigner.signOperation(op)`. */
  passkeySigner: PasskeySignerWithPublicKey | null;
  /** USD available. A null value means the balance has not loaded. */
  usdcBalance: number | null;
  refreshBalance: () => Promise<void>;
  error: ConnectError | null;
}

/**
 * React surface for the Sign in with Dexter ceremony.
 *
 * Returns the Supabase session (always) plus the vault identity + USD balance
 * (vault-review's login payload is live). dexter.cash login needs only
 * `session`; the vault fields + balance drive the connected chip. The
 * passkeySigner for dexter-agents x402 tabs uses the
 * anon ServerPolicy bridge over the now-live publicKey/credentialId.
 */
export function useSignInWithDexter(
  config: UseSignInWithDexterConfig = {},
): UseSignInWithDexter {
  const {
    apiBase,
    rpcUrl = DEFAULT_RPC,
    transport,
    connectHost,
    preferImmediate,
    agentDelegation,
  } = config;
  const [status, setStatus] = useState<ConnectStatus>('idle');
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const [session, setSession] = useState<PasskeyLoginTokens | null>(null);
  const [vault, setVault] = useState<ConnectVault | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [error, setError] = useState<ConnectError | null>(null);
  const [recovered, setRecovered] = useState<RecoverOutcome | null>(null);

  const refreshBalance = useCallback(async () => {
    const ata = vault?.usdcAta;
    if (!ata) return; // no swig/ATA yet; leave balance unknown
    setUsdcBalance(await fetchUsdcBalance(rpcUrl, ata));
  }, [vault, rpcUrl]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    setError(null);
    setPhase(null);
    setStatus('pending');
    try {
      const result = await passkeyLogin(
        {
          ...(apiBase ? { apiBase } : {}),
          ...(transport ? { transport } : {}),
          ...(connectHost ? { connectHost } : {}),
        },
        setPhase,
      );
      setSession(result.session);
      setVault(result.vault);
      setStatus('done');
      setPhase(null);
      return result;
    } catch (err) {
      const e =
        err instanceof ConnectError ? err : new ConnectError('sign_in_failed', String(err));
      setError(e);
      setStatus('error');
      setPhase(null);
      throw e;
    }
  }, [apiBase, transport, connectHost]);

  const recover = useCallback(async (): Promise<RecoverOutcome> => {
    setError(null);
    setPhase(null);
    setStatus('pending');
    const outcome = await recoverWallet({
      ...(apiBase ? { apiBase } : {}),
      ...(transport ? { transport } : {}),
      ...(connectHost ? { connectHost } : {}),
      ...(preferImmediate ? { preferImmediate } : {}),
      onPhase: setPhase,
    });
    setPhase(null);
    setRecovered(outcome);
    if (outcome.ok) {
      setStatus('done');
    } else if (outcome.reason === 'error') {
      setError(outcome.error ?? new ConnectError('recover_failed'));
      setStatus('error');
    } else {
      // no_credential and cancelled return to an immediately tappable idle state.
      setStatus('idle');
    }
    return outcome;
  }, [apiBase, transport, connectHost, preferImmediate]);

  const continueWith = useCallback(async (): Promise<ContinueResult> => {
    setError(null);
    setPhase(null);
    setStatus('pending');
    try {
      const result = await continueWithDexter(
        {
          ...(apiBase ? { apiBase } : {}),
          ...(transport ? { transport } : {}),
          ...(connectHost ? { connectHost } : {}),
          ...(agentDelegation ? { agentDelegation } : {}),
        },
        setPhase,
      );
      setPhase(null);
      if (result.kind === 'signin') {
        setSession(result.session);
        setVault(result.vault);
        setStatus('done');
      } else if (result.kind === 'create') {
        setVault(result.vault);
        setStatus('done');
      } else {
        // These outcomes return to an immediately tappable idle state.
        setStatus('idle');
      }
      return result;
    } catch (err) {
      const e =
        err instanceof ConnectError ? err : new ConnectError('continue_failed', String(err));
      setError(e);
      setStatus('error');
      setPhase(null);
      throw e;
    }
  }, [apiBase, transport, connectHost, agentDelegation]);

  const signOutAccount = useCallback(() => {
    setSession(null);
    setVault(null);
    setUsdcBalance(null);
    setError(null);
    setRecovered(null);
    setStatus('idle');
  }, []);

  // The guest passkey signer for the connected vault. On dexter.cash the SDK
  // signer runs inline; every unrelated origin uses the pinned hosted consent
  // popup so the Dexter RP credential never runs in a merchant page.
  const passkeySigner = useMemo(
    () =>
      vault
        ? createPasskeySigner(vault, apiBase, {
            ...(connectHost ? { connectHost } : {}),
          })
        : null,
    [vault, apiBase, connectHost],
  );

  // Best-effort balance read once a vault with a resolved ATA is connected.
  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  return {
    status,
    phase,
    isVaultConnected: status === 'done' && vault !== null,
    signIn,
    recover,
    continueWith,
    recovered,
    signOutAccount,
    disconnect: signOutAccount,
    session,
    vault,
    vaultAddress: vault?.swigAddress ?? null,
    vaultPda: vault?.vaultPda ?? null,
    credentialId: vault?.credentialId ?? null,
    passkeySigner,
    usdcBalance,
    refreshBalance,
    error,
  };
}
