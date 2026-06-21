// @dexterai/connect — framework-free entry.
// The React surface (<SignInWithDexter/> + useSignInWithDexter()) is in ./react.

export { passkeyLogin } from './relay';
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
