// @dexterai/connect/react — React surface.

export { useSignInWithDexter } from './useSignInWithDexter';
export type {
  UseSignInWithDexter,
  UseSignInWithDexterConfig,
  ConnectStatus,
} from './useSignInWithDexter';

export { SignInWithDexter } from './SignInWithDexter';
export type { SignInWithDexterProps } from './SignInWithDexter';

// The one branded button — used by SignInWithDexter and by the wallet create
// flow (wire it to your own action). One button, many surfaces (Rule #7).
export { DexterButton, DexterMark } from './DexterButton';
export type { DexterButtonProps } from './DexterButton';

export { useDexterWallet } from './useDexterWallet';
export type { UseDexterWallet } from './useDexterWallet';
