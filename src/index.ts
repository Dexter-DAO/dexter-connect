// @dexterai/connect framework-neutral entry.

export { ConnectError } from './types';
export type {
  PasskeyLoginTokens,
  ConnectVault,
  SignInResult,
  DexterConnectConfig,
  AgentDelegationMode,
  WalletIdentityProof,
} from './types';
export { createAnonServerPolicy } from './anon-policy';
export type { AnonServerPolicy, AnonChallengeResult } from './anon-policy';
export { createPasskeySigner } from './signer';
export type { CreatePasskeySignerOptions } from './signer';
// Wallet creation: mint a brand-new passkey + vault, named at birth. The
// lifecycle verb that was missing — pairs with passkeyLogin (sign in an existing
// wallet) so any consumer can create one, not just dexter-fe.
export { createWallet } from './enroll';
export type { CreateWalletConfig, CreateWalletResult } from './enroll';
// Wallet-only sign-in (P0c): re-point this browser at an existing wallet via a
// discoverable passkey — NO account session (the wallet IS the sign-in,
// 2026-07-05 ruling). This is the verb dexter-fe's header hand-rolled before
// 0.21.0; the fork dies with this export (Rule #7). Fire on tap only — never
// on mount. UI copy stays "Sign in with Dexter"; "recover" never reaches users.
export { recoverWallet } from './recover';
export type { RecoverOutcome, RecoverVault, RecoverWalletConfig } from './types';
// Wallet/account relationship state. A consumer supplies the API verifier;
// this controller keeps account data closed while restoring, switching, or
// completing a full sign-in, and exposes it only after the exact pair is bound.
export { WalletAccountRelationController } from './relationController';
export type {
  WalletAccountRelation,
  RelationCheckReason,
  RelationRuntime,
  WalletAccountRelationSnapshot,
  ServerRelationVerificationResult,
  ServerRelationVerificationRequest,
  ServerRelationVerifier,
  WalletAccountRelationControllerOptions,
  RelationCandidates,
} from './relationController';
export {
  WALLET_ACCOUNT_BINDING_PATH,
  walletBindingCandidate,
  accountBindingCandidate,
  createWalletAccountBindingClient,
} from './bindingResolver';
export type {
  ResolvedWalletAccountRelation,
  WalletBindingCandidate,
  AccountBindingCandidate,
  BindingResolutionResult,
  ResolveWalletAccountBindingInput,
  BindingFetch,
  WalletAccountBindingClientConfig,
  WalletAccountBindingClient,
} from './bindingResolver';
export {
  createWalletProofSessionStore,
  walletProofSessionStore,
  WALLET_PROOF_SESSION_STORAGE_PREFIX,
} from './walletProofSession';
export { createDexterIdentityCoordinator } from './identityCoordinator';
export type {
  DexterIdentityCoordinator,
  DexterIdentityCoordinatorOptions,
} from './identityCoordinator';
export {
  connectDexterIdentity,
  disconnectDexterIdentity,
} from './identityTransition';
export type {
  AccountSessionInstaller,
  AccountSessionClearer,
  ConnectDexterIdentityConfig,
  DisconnectDexterIdentityConfig,
} from './identityTransition';
export { createDexterControlModel } from './connectionContract';
export type {
  DexterConnectionIntent,
  DexterConnectionCapability,
  DexterControlStage,
  DexterControlPrimaryAction,
  DexterConnectionPermissions,
  DexterControlModel,
} from './connectionContract';
export type {
  WalletProofSession,
  WalletProofSessionOperation,
  WalletProofSessionEvent,
  WalletProofLifecycleEvent,
  WalletProofSessionStorage,
  WalletProofStorageEvent,
  WalletProofStorageEventSource,
  WalletProofSessionStoreOptions,
  WalletProofSessionStore,
} from './walletProofSession';
export type {
  CeremonyPhase,
  CeremonyOperation,
  HostedSignRequestPayload,
  HostedSignResult,
  HostedSignVaultIdentity,
} from './types';
// Consent-at-birth policy helpers (Branch rulings 2026-07-02/03). The SINGLE
// source for the fixed-30d TTL and the USD→atomic parse — consumers stop
// re-declaring SESSION_TTL_30D / usdToAtomic (Rule #7). The user authors the
// number (zero is not consent; no caller invents a default); createWallet
// threads the returned SpendPolicy into the /initialize body.
export { SESSION_TTL_30D, usdToAtomic, authoredPolicy } from './policy';
export type { SpendPolicy } from './policy';
// Human label for a ceremony phase — one source of truth for "connecting steps"
// copy across sign-in and consumer create flows (Rule #7).
export { ceremonyPhaseLabel } from './phase';
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

// Persistent agent authority. One owner-authorized grant can bind an OAuth or
// device-code connection to x402 payments and additional governed actions.
// The front end no longer needs to re-create this protocol privately.
export {
  AGENT_AUTHORITY_NAMESPACE,
  AGENT_AUTHORITY_STATUS_NAMESPACE,
  X402_PROTOCOL_ID,
  X402_PROTOCOL_VERSION,
  X402_ALLOWED_SCHEMES,
  X402_ASSET,
  X402_COUNTERPARTY_SCOPE,
  MAX_AUTHORITY_AMOUNT_ATOMIC,
  AgentAuthorityError,
  BoundedX402AuthorityError,
  noCustomX402Limits,
  validateBoundedX402Draft,
  buildX402PaymentRule,
  buildAgentAuthorityRequest,
  buildBoundedX402BootstrapRequest,
  beginAgentAuthority,
  stageAgentAuthority,
  beginBoundedX402Authority,
  stageBoundedX402Authority,
  exactAgentAuthorityApprovalRedirect,
  exactBoundedX402ApprovalRedirect,
  readAgentAuthority,
} from './agentAuthority';
export type {
  AgentAuthorityTarget,
  AgentAuthorityApprovalMode,
  AgentAuthorityRuleBase,
  X402PaymentAuthorityRule,
  TradeAuthorityRule,
  AgentAuthorityRule,
  AgentAuthorityBootstrapRequest,
  StagedAgentAuthorityRule,
  AgentAuthorityAuthorization,
  AgentAuthorityStagedReceipt,
  AgentAuthorityCapacity,
  AgentAuthorityActiveRole,
  AgentAuthorityStatus,
  X402LimitDraft,
  X402Limits,
  X402LimitValidation,
  BoundedX402Draft,
  BoundedX402Limits,
  BoundedX402Validation,
  BoundedX402Rule,
  BoundedX402BootstrapRequest,
  BoundedX402Authorization,
  BoundedX402StagedReceipt,
} from './agentAuthority';
