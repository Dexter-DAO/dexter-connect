import type { ConnectVault, RecoverVault, WalletIdentityProof } from './types';
import { parseWalletIdentityProof } from './types';
import { setActiveWallet } from './walletStore';
import { walletProofSessionStore } from './walletProofSession';

/** Retain the complete Wallet facts returned by a full sign-in or creation. */
export function activateConnectVault(
  vault: ConnectVault,
  walletIdentityProof: WalletIdentityProof,
): boolean {
  const proof = parseWalletIdentityProof(walletIdentityProof);
  const proofSession = walletProofSessionStore.save(vault.userHandle, proof);
  if (!proofSession) return false;
  const activated = setActiveWallet({
    handle: vault.userHandle,
    label: vault.walletLabel ?? undefined,
    credentialId: vault.credentialId,
    vaultPda: vault.vaultPda,
    swigAddress: vault.swigAddress,
    walletAddress: vault.swigAddress,
    receiveAddress: vault.receiveAddress,
    network: 'solana-mainnet',
    verificationState: 'unverified',
  });
  if (!activated) walletProofSessionStore.clear(vault.userHandle);
  return activated;
}

/** Retain the Wallet facts returned by the Wallet-only recovery ceremony. */
export function activateRecoveredVault(
  userHandle: string,
  credentialId: string,
  vault: RecoverVault,
  walletIdentityProof: WalletIdentityProof,
): boolean {
  const proof = parseWalletIdentityProof(walletIdentityProof);
  const proofSession = walletProofSessionStore.save(userHandle, proof);
  if (!proofSession) return false;
  const activated = setActiveWallet({
    handle: userHandle,
    label: vault.walletLabel ?? undefined,
    credentialId,
    vaultPda: vault.vaultPda,
    swigAddress: vault.swigAddress,
    walletAddress: vault.swigAddress,
    receiveAddress: vault.receiveAddress,
    network: 'solana-mainnet',
    verificationState: 'unverified',
  });
  if (!activated) walletProofSessionStore.clear(userHandle);
  return activated;
}
