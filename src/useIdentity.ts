// useIdentity: React presentation over a verified relation snapshot.

import { useMemo } from 'react';

import { useDexterWallet } from './useDexterWallet';
import { resolveIdentity, type ResolvedIdentity } from './identity';
import type { WalletAccountRelationSnapshot } from './relationController';

export interface UseIdentityConfig {
  /** Current relation-controller snapshot. */
  relation: WalletAccountRelationSnapshot;
  /** Candidate account token. It remains absent from the result until bound. */
  accountToken: string | null;
}

export function useIdentity({ relation, accountToken }: UseIdentityConfig): ResolvedIdentity {
  const { activeHandle, activeWallet } = useDexterWallet();
  const walletLabel = activeWallet?.label ?? null;

  return useMemo(
    () =>
      resolveIdentity({
        relation,
        accountToken: accountToken ?? null,
        userHandle: activeHandle ?? null,
        walletLabel,
      }),
    [relation, accountToken, activeHandle, walletLabel],
  );
}
