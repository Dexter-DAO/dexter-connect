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
