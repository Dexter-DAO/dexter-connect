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

// The branded wallet kit — the chip (header trigger) and the menu (manage / save
// / start fresh). One branded wallet surface for every consumer (Rule #7);
// themeable via --dx-* CSS vars. Presentational: the consumer feeds computed
// labels + wires action callbacks.
export { DexterWalletChip } from './DexterWalletChip';
export type { DexterWalletChipProps } from './DexterWalletChip';
export { DexterWalletMenu } from './DexterWalletMenu';
export type { DexterWalletMenuProps } from './DexterWalletMenu';

// useIdentity: the React binding for the identity resolver — combines the wallet
// store (passkey) with the account token the consumer passes in. One "who is
// active" for every surface and every consumer (Rule #7).
export { useIdentity } from './useIdentity';
export type { UseIdentityConfig } from './useIdentity';

// Consent-at-birth chrome (Branch rulings 2026-07-02/03). AllowanceChips = the
// $5/$20/$50/Custom allowance primitive (NONE preselected; zero is not consent);
// CreateWalletPanel = the turnkey create surface that collects the authored
// number and gates the branded Create CTA shut until it's valid, then runs the
// full createWallet ceremony. One consent surface for every door (Rule #7);
// themeable via --dx-* CSS vars.
export { AllowanceChips } from './AllowanceChips';
export type { AllowanceChipsProps } from './AllowanceChips';
export { CreateWalletPanel } from './CreateWalletPanel';
export type { CreateWalletPanelProps } from './CreateWalletPanel';
