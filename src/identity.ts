// @dexterai/connect — the identity resolver.
//
// resolveIdentity is the PURE "who is active" combiner. It unifies the two
// BROWSER-ONLY identity inputs into one canonical answer:
//   - an account session token (e.g. a Supabase access_token), and
//   - the passkey-vault handle (the connect wallet store).
//
// It MUST be client-side: no server endpoint knows both inputs unless the client
// tells it which to pass. It answers WHO is active and deliberately carries NO
// server/chain FACTS (vault balance, activation, claimed-status) — caching facts
// here would recreate a split-brain one layer down. Identity = WHO; the consumer
// (or server) owns WHAT'S TRUE.
//
// Passkey-vault-FIRST: the passkey vault is Dexter's primary identity axis (the
// Dexter Wallet — agent-pay, card spending, and credit all key off user_handle +
// swig + vault_pda); the account is the secondary/legacy axis. When both are
// present on a device, the passkey vault leads.
//
// Pure (no React, no fetch). The SDK is auth-agnostic: the consumer passes its
// own account token in. Each consumer layers its own derivations (display, roles)
// on top of this core, so every surface reads ONE "who is active" (Rule #7).

export type IdentityKind = 'passkey-vault' | 'account' | 'none';

export interface IdentityInput {
  /** An account session token (e.g. Supabase access_token) when present, else null. */
  accountToken: string | null;
  /** The passkey-vault user handle (the connect wallet store), else null. */
  userHandle: string | null;
}

export interface ResolvedIdentity {
  /** The primary identity axis, passkey-vault-first. */
  kind: IdentityKind;
  /** Passkey-vault identity (FIRST-CLASS): the wallet handle, or null. */
  userHandle: string | null;
  /** Account identity (secondary/legacy axis): bearer for account-scoped fetches, or null. */
  accountToken: string | null;
  /** A passkey vault is present on this device. */
  hasPasskeyVault: boolean;
  /** An account session is present. */
  hasAccount: boolean;
  /** Any identity at all — drives "show the wallet" vs "Sign in with Dexter". */
  hasWallet: boolean;
}

function presentOrNull(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

export function resolveIdentity(input: IdentityInput): ResolvedIdentity {
  const userHandle = presentOrNull(input.userHandle);
  const accountToken = presentOrNull(input.accountToken);

  const hasPasskeyVault = userHandle !== null;
  const hasAccount = accountToken !== null;
  const hasWallet = hasPasskeyVault || hasAccount;

  // Passkey-vault-FIRST: the passkey vault leads when both axes are present.
  const kind: IdentityKind = hasPasskeyVault
    ? 'passkey-vault'
    : hasAccount
      ? 'account'
      : 'none';

  return { kind, userHandle, accountToken, hasPasskeyVault, hasAccount, hasWallet };
}
