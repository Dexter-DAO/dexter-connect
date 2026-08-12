import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { buildPasskeyAuthorizationChallenge } from '@dexterai/vault';

const anonPolicy = vi.hoisted(() => ({
  issueChallenge: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('./anon-policy', () => ({
  createAnonServerPolicy: vi.fn(() => anonPolicy),
}));

import { createPasskeySigner } from './signer';
import { bytesToBase64, bytesToBase64url } from './base64';
import type { ConnectVault } from './types';

const EXPECTED_VAULT = new PublicKey(new Uint8Array(32).fill(1));
const SUBSTITUTED_VAULT = new PublicKey(new Uint8Array(32).fill(2));
const CREDENTIAL_ID = new Uint8Array([7, 8, 9]);

const vault: ConnectVault = {
  vaultPda: EXPECTED_VAULT.toBase58(),
  swigAddress: 'swig',
  receiveAddress: null,
  usdcAta: null,
  publicKey: bytesToBase64(new Uint8Array(33).fill(2)),
  userHandle: bytesToBase64url(new Uint8Array(16).fill(3)),
  credentialId: bytesToBase64url(CREDENTIAL_ID),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('inline signer vault-envelope binding', () => {
  it('passes the selected vault as expectedVault and rejects a substituted envelope before WebAuthn', async () => {
    const operation = new Uint8Array([10, 20, 30, 40]);
    const operationHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(operation)),
    );
    anonPolicy.issueChallenge.mockResolvedValue({
      challenge: buildPasskeyAuthorizationChallenge({
        vault: SUBSTITUTED_VAULT,
        nonce: 4n,
        operationHash,
        ceremonyNonce: new Uint8Array(32).fill(5),
      }),
      credentialId: CREDENTIAL_ID,
      rpId: 'dexter.cash',
    });
    const assertOver = vi.fn();

    const signer = createPasskeySigner(vault, 'https://api.dexter.cash', {
      __assertion: { credentialId: CREDENTIAL_ID, assertOver },
    });

    expect(
      (signer as unknown as { expectedVault: PublicKey }).expectedVault.toBase58(),
    ).toBe(EXPECTED_VAULT.toBase58());
    await expect(signer.signOperation(operation)).rejects.toThrow(
      'passkey authorization vault mismatch',
    );
    expect(assertOver).not.toHaveBeenCalled();
    expect(anonPolicy.verify).not.toHaveBeenCalled();
  });
});
