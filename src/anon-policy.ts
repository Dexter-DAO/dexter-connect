// The anon ServerPolicy — the HTTP bridge the @dexterai/vault guest signer calls
// during signOperation(). The SDK owns the WebAuthn ceremony, operation hashing,
// and canonical-envelope validation; this supplies the two dexter-api round-trips
// using the same wire contract as dexter-fe/app/lib/passkey-signer.ts.

import { ConnectError } from './types';
import { base64urlToBytes, bytesToBase64url, compactSignatureToDer } from './base64';
import { readErrorCode } from './httpError';
import { resolveDexterApiBase, resolveDexterRpId } from './trust';

const ANON_SIGN_BASE = '/api/passkey-anon/sign';

/** What `issueChallenge` returns to the SDK signer. */
export interface AnonChallengeResult {
  /** Server-issued canonical 200-byte passkey-authorization envelope. */
  challenge: Uint8Array;
  /** Credential id the server resolved from the userHandle (allowCredentials[0]). */
  credentialId: Uint8Array;
  rpId?: string;
  transports?: AuthenticatorTransport[];
}

/** The policy the SDK's guest `DexterApiBrowserPasskeySigner` consumes. */
export interface AnonServerPolicy {
  issueChallenge(args: {
    userHandle: Uint8Array;
    operationMessage: Uint8Array;
    operationHash: Uint8Array;
  }): Promise<AnonChallengeResult>;
  verify(args: {
    userHandle: Uint8Array;
    credentialId: Uint8Array;
    signature: Uint8Array;
    clientDataJSON: Uint8Array;
    authenticatorData: Uint8Array;
  }): Promise<void>;
}

/**
 * Build the anon ServerPolicy for a given dexter-api base.
 *
 * `issueChallenge` → POST /challenge
 *   { userHandle, operationHash, operationMessage,
 *     operation: 'vault_operation' }.
 *   The server returns the canonical authorization envelope; the SDK validates
 *   its operation/program/vault binding before invoking WebAuthn.
 * `verify` → POST /verify { credential, userHandle }. NOTE: the SDK hands us the
 *   COMPACT 64-byte signature; dexter-api's WebAuthn verifier wants DER, so we
 *   re-encode compact → DER here (compactSignatureToDer).
 */
export function createAnonServerPolicy(apiBase?: string): AnonServerPolicy {
  const base = resolveDexterApiBase(apiBase);

  return {
    async issueChallenge({ userHandle, operationMessage, operationHash }) {
      const res = await fetch(`${base}${ANON_SIGN_BASE}/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userHandle: bytesToBase64url(userHandle),
          operationHash: bytesToBase64url(operationHash),
          operationMessage: bytesToBase64url(operationMessage),
          operation: 'vault_operation',
        }),
      });
      if (!res.ok) throw new ConnectError(await readErrorCode(res), `challenge ${res.status}`);

      const data = (await res.json()) as {
        options?: {
          challenge?: string;
          rpId?: string;
          allowCredentials?: { id: string; transports?: AuthenticatorTransport[] }[];
        };
      };
      const options = data?.options;
      if (!options?.challenge) {
        throw new ConnectError('challenge_malformed', 'no challenge in response');
      }
      const challenge = base64urlToBytes(options.challenge);
      const cred = options.allowCredentials?.[0];
      if (!cred?.id) {
        throw new ConnectError('no_credential', 'no allow-listed credential for this userHandle');
      }
      return {
        challenge,
        credentialId: base64urlToBytes(cred.id),
        rpId: resolveDexterRpId(options.rpId),
        transports: cred.transports,
      };
    },

    async verify({ userHandle, credentialId, signature, clientDataJSON, authenticatorData }) {
      const credential = {
        id: bytesToBase64url(credentialId),
        rawId: bytesToBase64url(credentialId),
        type: 'public-key' as const,
        response: {
          clientDataJSON: bytesToBase64url(clientDataJSON),
          authenticatorData: bytesToBase64url(authenticatorData),
          // The SDK passes the COMPACT sig; dexter-api's verifier wants DER.
          signature: bytesToBase64url(compactSignatureToDer(signature)),
          userHandle: null,
        },
        clientExtensionResults: {},
        authenticatorAttachment: null,
      };

      const res = await fetch(`${base}${ANON_SIGN_BASE}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential, userHandle: bytesToBase64url(userHandle) }),
      });
      if (!res.ok) throw new ConnectError(await readErrorCode(res), `verify ${res.status}`);

      const data = (await res.json()) as { verified?: boolean };
      if (data?.verified !== true) {
        throw new ConnectError('verification_failed', 'server did not return verified=true');
      }
    },
  };
}
