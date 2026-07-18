// Chrome-149+ immediate-UI WebAuthn bridge.
//
// Ported from dexter-fe's usePasskeyWalletAnon (the P0c donor) so the SDK owns
// the whole recover ceremony. @simplewebauthn/browser has no immediate UI mode
// yet: for the immediate path we call navigator.credentials.get() natively with
// the top-level `uiMode` member, then shape the result into the library's
// AuthenticationResponseJSON using the SDK's own base64 codecs. DELETE this
// module and route through startAuthentication once the library ships
// immediate support — it exists only to close that gap.

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { base64urlToBytes, bytesToBase64url } from './base64';

// getClientCapabilities() is async, so resolve it ONCE at module load and read
// the cached result at tap time — this keeps the WebAuthn call's user-gesture
// chain clean (no extra await between the tap and navigator.credentials.get()).
// Returns false anywhere the capability/API is absent (iOS Safari today), where
// the normal discoverable modal is used instead.
let immediateCapPromise: Promise<boolean> | null = null;

export function immediateGetSupported(): Promise<boolean> {
  if (!immediateCapPromise) {
    immediateCapPromise = (async () => {
      try {
        if (typeof window === 'undefined') return false;
        const pkc = (window as { PublicKeyCredential?: unknown }).PublicKeyCredential as
          | { getClientCapabilities?: () => Promise<Record<string, boolean>> }
          | undefined;
        if (!pkc || typeof pkc.getClientCapabilities !== 'function') return false;
        const caps = await pkc.getClientCapabilities.call(pkc);
        return caps?.immediateGet === true;
      } catch {
        return false;
      }
    })();
  }
  return immediateCapPromise;
}

/**
 * Prime the memoized capability probe so the tap-time read is already
 * resolved. Call at module scope of any verb that offers preferImmediate —
 * never from inside the tap handler.
 */
export function primeImmediateSupport(): void {
  void immediateGetSupported();
}

/** Native credentials.get() with uiMode:'immediate', shaped to the library's JSON form. */
export async function immediateAuthentication(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  const getOptions = {
    publicKey: {
      challenge: base64urlToBytes(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: options.allowCredentials?.map((c) => ({
        id: base64urlToBytes(c.id),
        type: c.type,
        transports: c.transports as AuthenticatorTransport[] | undefined,
      })),
    } as PublicKeyCredentialRequestOptions,
  } as CredentialRequestOptions;
  // `uiMode` isn't in lib.dom.d.ts yet (Chrome 149+) — top-level member, set via cast.
  (getOptions as { uiMode?: string }).uiMode = 'immediate';
  const cred = (await navigator.credentials.get(getOptions)) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('no credential', 'NotAllowedError');
  const a = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bytesToBase64url(new Uint8Array(cred.rawId)),
    response: {
      clientDataJSON: bytesToBase64url(new Uint8Array(a.clientDataJSON)),
      authenticatorData: bytesToBase64url(new Uint8Array(a.authenticatorData)),
      signature: bytesToBase64url(new Uint8Array(a.signature)),
      userHandle: a.userHandle ? bytesToBase64url(new Uint8Array(a.userHandle)) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    type: 'public-key',
    authenticatorAttachment:
      ((cred as { authenticatorAttachment?: string }).authenticatorAttachment as
        | AuthenticatorAttachment
        | undefined) ?? undefined,
  };
}

/**
 * Was this WebAuthn failure a user-side rejection (dismiss/cancel/timeout,
 * or immediate-mode "no credential"), as opposed to a real error?
 *
 * simplewebauthn wraps DOMExceptions in WebAuthnError with the original in
 * `cause`, so the classifier reads name + cause.name + code + message.
 */
export function classifyWebAuthnRejection(err: unknown): boolean {
  const e = err as
    | { name?: string; code?: unknown; message?: string; cause?: { name?: string } }
    | null;
  if (!e) return false;
  const blob = [e.name, e.cause?.name, typeof e.code === 'string' ? e.code : '', e.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /notallowed|not ?allowed|abort|cancel|timed out|timeout|denied|ceremony/.test(blob);
}
