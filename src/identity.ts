// @dexterai/connect: presentation identity derived from the relation controller.

import type { WalletAccountRelationSnapshot } from './relationController';

export type IdentityKind = 'wallet_only' | 'account_only' | 'bound' | 'conflict' | 'none';

export interface IdentityInput {
  /** Current relation-controller snapshot. */
  relation: WalletAccountRelationSnapshot;
  /** Candidate account session. It is withheld from the result until bound. */
  accountToken: string | null;
  /** Active Wallet handle from the Wallet roster. */
  userHandle: string | null;
  /** Active Wallet display name from the Wallet roster. */
  walletLabel?: string | null;
}

export interface ResolvedIdentity {
  /** The relationship state supplied by the controller. */
  kind: IdentityKind;
  /** Active Wallet handle, or null. */
  userHandle: string | null;
  /** Active Wallet display name, or null. */
  walletLabel: string | null;
  /** Account bearer only when the exact Wallet/account pair is bound. */
  accountToken: string | null;
  /** An active Wallet candidate is present. */
  hasPasskeyVault: boolean;
  /** An account-session candidate is present. */
  hasAccount: boolean;
  /** An active Wallet is present. Account presence alone does not create one. */
  hasWallet: boolean;
  /** Account-owned data and destinations may render. */
  hasAccountAccess: boolean;
  /** A verified mismatch is waiting for repair. */
  quarantined: boolean;
}

function presentOrNull(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

export function resolveIdentity(input: IdentityInput): ResolvedIdentity {
  const hasPasskeyVault = input.relation.walletPresent;
  const hasAccount = input.relation.accountPresent;
  const userHandle = hasPasskeyVault ? presentOrNull(input.userHandle) : null;
  const walletLabel = userHandle ? presentOrNull(input.walletLabel ?? null) : null;
  const hasAccountAccess = input.relation.privateAccountAccess;
  const accountToken = hasAccountAccess ? presentOrNull(input.accountToken) : null;

  return {
    kind: input.relation.relation,
    userHandle,
    walletLabel,
    accountToken,
    hasPasskeyVault,
    hasAccount,
    hasWallet: hasPasskeyVault,
    hasAccountAccess,
    quarantined: input.relation.quarantined,
  };
}
