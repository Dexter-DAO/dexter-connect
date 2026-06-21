import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DexterApiBrowserPasskeySigner } from '@dexterai/vault/signers/browser';
import { passkeyLogin } from './relay';
import { fetchUsdcBalance } from './balance';
import { createPasskeySigner } from './signer';
import { ConnectError } from './types';
import type { ConnectVault, PasskeyLoginTokens, SignInResult, CeremonyPhase } from './types';

/** Dexter's Helius proxy — authoritative for browser Solana reads. */
const DEFAULT_RPC = 'https://api.dexter.cash/proxy/helius/rpc';

export type ConnectStatus = 'idle' | 'pending' | 'done' | 'error';

export interface UseSignInWithDexterConfig {
  /** dexter-api base. Default https://api.dexter.cash. */
  apiBase?: string;
  /** RPC for the connected-chip balance read. Default: Dexter's Helius proxy. */
  rpcUrl?: string;
}

export interface UseSignInWithDexter {
  status: ConnectStatus;
  /** Live ceremony phase while status==='pending' (challenge → passkey →
   *  verifying); null otherwise. Drives the button's "connecting steps". */
  phase: CeremonyPhase | null;
  isVaultConnected: boolean;
  /** Run the ceremony. Resolves with the result; throws ConnectError on failure
   *  (error is also captured in `error` + `status==='error'` for declarative UI). */
  signIn: () => Promise<SignInResult>;
  disconnect: () => void;
  session: PasskeyLoginTokens | null;
  vault: ConnectVault | null;
  /** Dexter Wallet address (swigAddress, base58). */
  vaultAddress: string | null;
  vaultPda: string | null;
  credentialId: string | null;
  /** Guest passkey signer for authorizing spends / opening x402 tabs. null until
   *  a vault is connected. Drive it via `passkeySigner.signOperation(op)`. */
  passkeySigner: DexterApiBrowserPasskeySigner | null;
  /** USD available. number once read; null = unknown → chip shows wallet only. */
  usdcBalance: number | null;
  refreshBalance: () => Promise<void>;
  error: ConnectError | null;
}

/**
 * "Sign in with Dexter" — React surface over the login ceremony.
 *
 * Returns the Supabase session (always) plus the vault identity + USD balance
 * (vault-review's login payload is live). dexter.cash login needs only
 * `session`; the vault fields + balance drive the connected chip. The
 * passkeySigner (for opening x402 tabs — dexter-agents) lands next, on the
 * anon ServerPolicy bridge over the now-live publicKey/credentialId.
 */
export function useSignInWithDexter(
  config: UseSignInWithDexterConfig = {},
): UseSignInWithDexter {
  const { apiBase, rpcUrl = DEFAULT_RPC } = config;
  const [status, setStatus] = useState<ConnectStatus>('idle');
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const [session, setSession] = useState<PasskeyLoginTokens | null>(null);
  const [vault, setVault] = useState<ConnectVault | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [error, setError] = useState<ConnectError | null>(null);

  const refreshBalance = useCallback(async () => {
    const ata = vault?.usdcAta;
    if (!ata) return; // no swig/ATA yet → leave balance unknown
    setUsdcBalance(await fetchUsdcBalance(rpcUrl, ata));
  }, [vault, rpcUrl]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    setError(null);
    setPhase(null);
    setStatus('pending');
    try {
      const result = await passkeyLogin(apiBase ? { apiBase } : {}, setPhase);
      setSession(result.session);
      setVault(result.vault ?? null);
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
  }, [apiBase]);

  const disconnect = useCallback(() => {
    setSession(null);
    setVault(null);
    setUsdcBalance(null);
    setError(null);
    setStatus('idle');
  }, []);

  // The guest passkey signer for the connected vault. The SDK signer owns the
  // WebAuthn ceremony + sha256(op) hashing; the connector supplies the anon
  // ServerPolicy. Rebuilt only when the vault (or apiBase) changes.
  const passkeySigner = useMemo(
    () => (vault ? createPasskeySigner(vault, apiBase) : null),
    [vault, apiBase],
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
    disconnect,
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
