// @dexterai/connect — framework-free entry.
// The React surface (<SignInWithDexter/> + useSignInWithDexter()) is in ./react.

export { passkeyLogin, continueWithDexter } from './relay';
export type { ContinueResult } from './relay';
export { ConnectError } from './types';
export type {
  PasskeyLoginTokens,
  ConnectVault,
  SignInResult,
  DexterConnectConfig,
} from './types';
export { createAnonServerPolicy } from './anon-policy';
export type { AnonServerPolicy, AnonChallengeResult } from './anon-policy';
export { createPasskeySigner } from './signer';
// The identity resolver: the single "who is active" combiner (account session +
// passkey-vault handle). Pure, framework-free, passkey-vault-FIRST. The SDK stays
// auth-agnostic — the consumer passes its account token in. Identity = WHO; facts
// (balance/claimed) stay server-side. One resolver for every consumer (Rule #7).
export { resolveIdentity } from './identity';
export type { IdentityKind, IdentityInput, ResolvedIdentity } from './identity';
// Wallet creation: mint a brand-new passkey + vault, named at birth. The
// lifecycle verb that was missing — pairs with passkeyLogin (sign in an existing
// wallet) so any consumer can create one, not just dexter-fe.
export { createWallet } from './enroll';
export type { CreateWalletConfig, CreateWalletResult } from './enroll';
export type { CeremonyPhase } from './types';
// Human label for a ceremony phase — one source of truth for "connecting steps"
// copy across sign-in and consumer create flows (Rule #7).
export { ceremonyPhaseLabel } from './phase';
// Wallet-identity store: the canonical owner of the active wallet handle, with
// first-class eject/switch/list. Consumers MUST read/write through here instead
// of touching localStorage by hand (the welded-wallet bug fix).
export {
  getActiveHandle,
  setActiveHandle,
  ejectActiveWallet,
  listWallets,
  switchWallet,
  forgetWallet,
  getCredentialId,
  subscribe as subscribeWallet,
  ACTIVE_WALLET_STORAGE_KEY,
} from './walletStore';
export type { StoredWallet } from './walletStore';
// WebAuthn Signal API: keep the OS keychain in sync — rename a passkey
// post-creation, auto-prune deleted/stale passkeys. Feature-detected; no-op
// where the browser lacks support (naming-at-creation stays the floor).
export {
  passkeySignalSupport,
  renamePasskey,
  prunePasskey,
  syncAcceptedPasskeys,
} from './signals';
export type { PasskeySignalSupport } from './signals';
// Agent-spend control surface (Layer 2 — the honest two-mode read). ONE primitive
// (an agent can spend from your vault), TWO grant modes over ONE balance: the
// automatic role-2 rail + explicit Tabs. Pure assembler: reads `agentSpendArmed`
// (the on-chain authority.signer decode), NEVER `liveSessionCount` (the trap).
export { assembleAgentSpendStatus } from './agentSpend';
export type {
  AgentSpendStatus,
  AutomaticAgentSpend,
  AgentSpendTab,
  RawAgentSpendStatus,
  RawAgentSpendSession,
} from './agentSpend';
// Agent-spend VERBS — the off/on switch for the automatic role-2 rail (the WRITE
// side of the read above). Migrated out of dexter-fe so every consumer shares ONE
// implementation (Rule #7). Framework-free: the verbs take `apiOrigin` as a param
// (connect reads no env) and a minimal `{ kind, userHandle }` identity.
export { revokeAgentSpend, enableAgentSpend, AgentSpendError, describeAgentSpendError } from './agentSpend';
export type {
  AgentSpendIdentity,
  RevokeAgentSpendResult,
  EnableAgentSpendResult,
} from './agentSpend';
