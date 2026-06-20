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
  subscribe as subscribeWallet,
  ACTIVE_WALLET_STORAGE_KEY,
} from './walletStore';
export type { StoredWallet } from './walletStore';
