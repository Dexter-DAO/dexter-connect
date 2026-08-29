// @dexterai/connect/react — React surface.
// Recover-mode outcome types re-exported here so a react-only consumer never
// needs a second import from the root entry (Rule #7 — one obvious path).
export type {
  ConnectVault,
  RecoverOutcome,
  RecoverVault,
  SignInResult,
  WalletIdentityProof,
} from './types';
export type { CreateWalletResult } from './enroll';
export type { WalletAccountRelationSnapshot } from './relationController';

// Dexter's branded action button. Consumers can wire it to the canonical
// control or a Wallet-creation action.
export { DexterButton, DexterMark } from './DexterButton';
export type { DexterButtonProps } from './DexterButton';

export type { DexterAccountSession } from './useDexterIdentity';
export {
  useDexterConnection,
  REMOVE_DEXTER_FROM_DEVICE_CONFIRMATION,
} from './useDexterConnection';
export type {
  DexterConnectionOperation,
  DexterIdentityView,
  DexterWalletView,
  RemoveDexterFromDeviceConfirmation,
  RemoveDexterFromDeviceResult,
  UseDexterConnectionConfig,
  UseDexterConnection,
} from './useDexterConnection';
export type {
  DexterConnectionIntent,
  DexterConnectionCapability,
  DexterControlStage,
  DexterControlPrimaryAction,
  DexterConnectionPermissions,
  DexterControlModel,
} from './connectionContract';

// Wallet-creation chrome. AllowanceChips is the $5/$20/$50/Custom primitive
// (none preselected; zero is not consent). CreateWalletPanel either collects an
// authored allowance or, when explicitly deferred, creates owner-only. One
// creation surface for every door; themeable via --dx-* CSS vars.
export { AllowanceChips } from './AllowanceChips';
export type { AllowanceChipsProps } from './AllowanceChips';
export { CreateWalletPanel } from './CreateWalletPanel';
export type { CreateWalletPanelProps } from './CreateWalletPanel';

export {
  AppInstallButtons,
  claudeWebConnectorUrl,
  chatgptPluginsUrl,
  cursorInstallUrl,
  vscodeInstallUrl,
  hermesInstallCommand,
  hermesOpenUrl,
  claudeCodeInstallCommand,
} from './AppInstallButtons';
export type { AppInstallButtonsProps, InstallApp } from './AppInstallButtons';
