import type { RegistrationResponseJSON } from '@simplewebauthn/browser';
import type { SpendPolicy } from './policy';
import { ConnectError, parseWalletIdentityProof, type WalletIdentityProof } from './types';

const KEY = 'dexter:pending-wallet-creation:v1';

export interface EnrolledCredential {
  userHandle: string;
  credentialId: string;
  publicKey: string;
  walletIdentityProof: WalletIdentityProof;
}

export interface PendingCreation {
  version: 1;
  credentialId: string;
  name: string;
  spendPolicy?: SpendPolicy;
  registration: RegistrationResponseJSON;
  enrolled?: EnrolledCredential;
}

let retained: PendingCreation | null = null;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A checkpoint is never an active Wallet or authority to spend. */
export function readPendingCreation(): PendingCreation | null {
  const store = storage();
  if (!store) return retained;
  let raw: string | null;
  try { raw = store.getItem(KEY); } catch { return retained; }
  if (!raw) return retained = null;
  try {
    const value = JSON.parse(raw) as PendingCreation;
    if (value.version !== 1 || !value.credentialId || typeof value.name !== 'string'
      || value.registration?.id !== value.credentialId) throw new Error();
    if (value.enrolled) {
      if (value.enrolled.credentialId !== value.credentialId || !value.enrolled.userHandle
        || !value.enrolled.publicKey) throw new Error();
      value.enrolled.walletIdentityProof = parseWalletIdentityProof(value.enrolled.walletIdentityProof);
    }
    return retained = value;
  } catch {
    throw new ConnectError('pending_creation_invalid', 'Sign in with your saved passkey to finish setting up your wallet.');
  }
}

export function savePendingCreation(value: PendingCreation): void {
  retained = value;
  try { storage()?.setItem(KEY, JSON.stringify(value)); } catch { /* Keep the in-page retry. */ }
}

export function clearPendingCreation(credentialId: string): void {
  let current;
  try { current = readPendingCreation(); } catch { return; }
  if (current?.credentialId !== credentialId) return;
  retained = null;
  try { storage()?.removeItem(KEY); } catch { /* Recovery can repeat safely. */ }
}
