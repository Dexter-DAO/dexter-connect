// Build the guest passkey signer for a connected vault. The @dexterai/vault 0.19
// `DexterApiBrowserPasskeySigner` owns the WebAuthn ceremony + sha256(op) hashing;
// the connector supplies the anon ServerPolicy (the /challenge + /verify bridge)
// and decodes the vault's authority key + userHandle from the login payload.
//
// One method drives it: `signer.signOperation(operationMessage)` (NOT `.sign()`).

import { DexterApiBrowserPasskeySigner } from '@dexterai/vault/signers/browser';
import { createAnonServerPolicy } from './anon-policy';
import { base64ToBytes, base64urlToBytes } from './base64';
import type { ConnectVault } from './types';

/** Test seam mirroring the SDK's injected-assertion shape (production omits it). */
type AssertionLike = {
  credentialId: Uint8Array;
  assertOver(challenge: Uint8Array): Promise<{
    signature: Uint8Array;
    clientDataJSON: Uint8Array;
    authenticatorData: Uint8Array;
  }>;
};

/**
 * Construct the guest signer from a connected `ConnectVault`.
 *
 * `vault.publicKey` is base64 (33-byte SEC1 compressed P-256); `vault.userHandle`
 * is base64url (server-minted). Both are decoded to the Uint8Arrays the SDK wants.
 *
 * @param vault    the connected vault from useSignInWithDexter()
 * @param apiBase  dexter-api base (defaults to https://api.dexter.cash via the policy)
 * @param opts.__assertion  test-only injected assertion (skips real WebAuthn)
 */
export function createPasskeySigner(
  vault: ConnectVault,
  apiBase?: string,
  opts: { __assertion?: AssertionLike } = {},
): DexterApiBrowserPasskeySigner {
  return new DexterApiBrowserPasskeySigner({
    identity: { kind: 'guest', userHandle: base64urlToBytes(vault.userHandle) },
    publicKey: base64ToBytes(vault.publicKey),
    anonPolicy: createAnonServerPolicy(apiBase),
    ...(opts.__assertion ? { __assertion: opts.__assertion } : {}),
  });
}
