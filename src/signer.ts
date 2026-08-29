// Build the guest passkey signer for a connected vault. The hardened
// `DexterApiBrowserPasskeySigner` owns the WebAuthn ceremony + sha256(op) hashing;
// the connector supplies the anon ServerPolicy (the /challenge + /verify bridge)
// and decodes the vault's authority key + userHandle from the login payload.
//
// One method drives it: `signer.signOperation(operationMessage)` (NOT `.sign()`).

import { DexterApiBrowserPasskeySigner } from '@dexterai/vault/signers/browser';
import type { PasskeySignerWithPublicKey } from '@dexterai/vault/signers';
import {
  parseStrictCollectedClientData,
  validatePasskeyAuthorizationChallenge,
} from '@dexterai/vault';
import { PublicKey } from '@solana/web3.js';
import { createAnonServerPolicy } from './anon-policy';
import { base64ToBytes, base64urlToBytes, bytesToBase64url } from './base64';
import { openCeremonyPopup, shouldUsePopup } from './popup';
import { ConnectError, type ConnectVault, type HostedSignResult } from './types';
import { bytesEqual, resolveDexterApiBase } from './trust';

/** Test seam mirroring the SDK's injected-assertion shape (production omits it). */
type AssertionLike = {
  credentialId: Uint8Array;
  assertOver(challenge: Uint8Array): Promise<{
    signature: Uint8Array;
    clientDataJSON: Uint8Array;
    authenticatorData: Uint8Array;
  }>;
};

export interface CreatePasskeySignerOptions {
  /** Compatibility-only hosted page; omitted or exactly Dexter's pinned URL. */
  connectHost?: string;
  /** Test-only injected assertion. Never used by the off-origin hosted path. */
  __assertion?: AssertionLike;
}

class HostedPopupPasskeySigner implements PasskeySignerWithPublicKey {
  readonly credentialId: Uint8Array;
  readonly publicKey: Uint8Array;
  private readonly vault: ConnectVault;

  constructor(
    vault: ConnectVault,
    private readonly expectedVault: PublicKey,
    private readonly connectHost?: string,
  ) {
    this.vault = { ...vault };
    this.credentialId = base64urlToBytes(vault.credentialId);
    this.publicKey = base64ToBytes(vault.publicKey);
  }

  async signOperation(operationMessage: Uint8Array): Promise<HostedSignResult> {
    if (!(operationMessage instanceof Uint8Array) || operationMessage.length === 0) {
      throw new ConnectError('invalid_operation', 'signOperation requires non-empty bytes');
    }
    const exactOperationMessage = new Uint8Array(operationMessage);
    const result = await openCeremonyPopup<HostedSignResult>('sign', {
      ...(this.connectHost ? { connectHost: this.connectHost } : {}),
      signRequest: {
        operationMessage: exactOperationMessage,
        vault: {
          vaultPda: this.vault.vaultPda,
          publicKey: this.vault.publicKey,
          userHandle: this.vault.userHandle,
          credentialId: this.vault.credentialId,
          ...(this.vault.walletLabel !== undefined
            ? { walletLabel: this.vault.walletLabel }
            : {}),
        },
      },
    });
    return validateHostedSignResult(result, exactOperationMessage, this.expectedVault);
  }
}

/**
 * Construct the guest signer from a connected `ConnectVault`.
 *
 * `vault.publicKey` is base64 (33-byte SEC1 compressed P-256); `vault.userHandle`
 * is base64url (server-minted). Both are decoded to the Uint8Arrays the SDK wants.
 *
 * @param vault    the Wallet returned by a verified Dexter ceremony
 * @param apiBase  compatibility-only; omitted or exactly https://api.dexter.cash
 * @param opts.__assertion  test-only injected assertion (skips real WebAuthn)
 */
export function createPasskeySigner(
  vault: ConnectVault,
  apiBase?: string,
  opts: CreatePasskeySignerOptions = {},
): PasskeySignerWithPublicKey {
  // Validate the historical API option even when this origin will use the
  // popup. No caller-controlled server is allowed to survive construction.
  resolveDexterApiBase(apiBase);
  const expectedVault = new PublicKey(vault.vaultPda);

  // A dexter.cash RP credential cannot be asserted inside an unrelated
  // merchant page. Production browser callers therefore always use the pinned
  // hosted consent window; the injected assertion seam remains inline only in
  // non-browser tests or on Dexter's canonical origin.
  if (shouldUsePopup()) {
    return new HostedPopupPasskeySigner(vault, expectedVault, opts.connectHost);
  }

  return new DexterApiBrowserPasskeySigner({
    identity: { kind: 'guest', userHandle: base64urlToBytes(vault.userHandle) },
    publicKey: base64ToBytes(vault.publicKey),
    anonPolicy: createAnonServerPolicy(apiBase),
    // The API resolves the authorization envelope, but this browser still
    // knows which connected vault the caller selected. Pin that exact PDA so a
    // valid Dexter envelope for another vault cannot reach WebAuthn.
    expectedVault,
    ...(opts.__assertion ? { __assertion: opts.__assertion } : {}),
  });
}

async function validateHostedSignResult(
  result: HostedSignResult,
  operationMessage: Uint8Array,
  expectedVault: PublicKey,
): Promise<HostedSignResult> {
  if (
    !result ||
    !(result.signature instanceof Uint8Array) ||
    result.signature.length !== 64 ||
    !(result.clientDataJSON instanceof Uint8Array) ||
    result.clientDataJSON.length === 0 ||
    !(result.authenticatorData instanceof Uint8Array) ||
    result.authenticatorData.length < 37
  ) {
    throw new ConnectError('popup_result_malformed', 'hosted signer returned malformed assertion bytes');
  }

  let clientData;
  try {
    clientData = parseStrictCollectedClientData(result.clientDataJSON);
  } catch {
    throw new ConnectError('popup_result_malformed', 'hosted signer returned invalid clientDataJSON');
  }
  if (
    clientData.type !== 'webauthn.get' ||
    clientData.origin !== 'https://dexter.cash' ||
    clientData.crossOrigin !== false ||
    !/^[A-Za-z0-9_-]+$/.test(clientData.challenge)
  ) {
    throw new ConnectError('popup_result_malformed', 'hosted signer returned invalid WebAuthn client data');
  }

  const expectedRpHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dexter.cash')),
  );
  const flags = result.authenticatorData[32] ?? 0;
  if (
    !bytesEqual(result.authenticatorData.subarray(0, 32), expectedRpHash) ||
    (flags & 0x01) === 0 ||
    (flags & 0x04) === 0
  ) {
    throw new ConnectError('popup_result_malformed', 'hosted signer returned invalid authenticator context');
  }

  let challenge: Uint8Array;
  try {
    challenge = base64urlToBytes(clientData.challenge);
    if (bytesToBase64url(challenge) !== clientData.challenge) throw new Error('non-canonical');
  } catch {
    throw new ConnectError('popup_result_malformed', 'hosted signer returned an invalid challenge encoding');
  }

  try {
    const operationHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(operationMessage)),
    );
    validatePasskeyAuthorizationChallenge({ challenge, operationHash, expectedVault });
  } catch {
    throw new ConnectError(
      'popup_result_unbound',
      'hosted signer returned an assertion for a different operation or vault',
    );
  }

  return {
    signature: new Uint8Array(result.signature),
    clientDataJSON: new Uint8Array(result.clientDataJSON),
    authenticatorData: new Uint8Array(result.authenticatorData),
  };
}
