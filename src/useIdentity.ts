// useIdentity — the React binding for the identity resolver.
//
// Combines the connect wallet store (the passkey handle, via useDexterWallet)
// with the account token the CONSUMER passes in — the SDK is auth-agnostic, so it
// never imports a consumer's auth context. Returns the canonical ResolvedIdentity
// so every surface (header chip, wallet menu, …) reads ONE "who is active".
//
// Carries NO server/chain facts (balance, activation, claimed). Those stay
// server-authoritative in the consumer.

import { useMemo } from 'react';

import { useDexterWallet } from './useDexterWallet';
import { resolveIdentity, type ResolvedIdentity } from './identity';

export interface UseIdentityConfig {
  /** The account session token (e.g. a Supabase access_token), or null when the
   *  user has no account session. The SDK is auth-agnostic — pass your own. */
  accountToken: string | null;
}

export function useIdentity({ accountToken }: UseIdentityConfig): ResolvedIdentity {
  const { activeHandle } = useDexterWallet();

  return useMemo(
    () =>
      resolveIdentity({
        accountToken: accountToken ?? null,
        userHandle: activeHandle ?? null,
      }),
    [accountToken, activeHandle],
  );
}
