// Shared byte ↔ base64 / base64url helpers.
//
// Mirrors the encodings dexter-fe/app/lib/passkey-signer.ts uses on the wire
// and that dexter-api's /api/passkey-anon/sign/{challenge,verify} handlers
// parse. Factored out of relay.ts so the anon ServerPolicy + signer reuse the
// exact same codecs (no second, drifting copy).

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return base64ToBytes(b64);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function bytesToBase64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encode a 64-byte compact r||s P-256 signature as DER (ASN.1 SEQUENCE of two
 * INTEGERs).
 *
 * Why this exists: the @dexterai/vault 0.19 signer hands its ServerPolicy the
 * *compact* 64-byte signature (`WebAuthnAssertionResult.signature`); it drops
 * `signatureDer` before calling the policy. But dexter-api verifies the
 * assertion with @simplewebauthn/server, whose `unwrapEC2Signature` runs
 * `AsnParser.parse(signature, ECDSASigValue)` — i.e. it requires the DER form
 * in `credential.response.signature`. So the anon ServerPolicy must re-encode
 * compact → DER on the verify leg. This is pure ASN.1 serialization (no
 * cryptography), the deterministic inverse of the SDK's
 * `derSignatureToCompactLowS` decode.
 */
export function compactSignatureToDer(compact: Uint8Array): Uint8Array {
  if (compact.length !== 64) {
    throw new Error(`expected 64-byte compact signature, got ${compact.length}`);
  }
  const r = derInteger(compact.subarray(0, 32));
  const s = derInteger(compact.subarray(32, 64));
  const body = new Uint8Array(r.length + s.length);
  body.set(r, 0);
  body.set(s, r.length);
  // SEQUENCE tag (0x30) + length + body. r and s are each ≤ 33 content bytes,
  // so the SEQUENCE body is ≤ 70 bytes — always a single (short-form) length.
  const out = new Uint8Array(2 + body.length);
  out[0] = 0x30;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

/** Encode one big-endian unsigned component as a DER INTEGER (tag 0x02). */
function derInteger(component: Uint8Array): Uint8Array {
  // Strip leading zero bytes (DER INTEGERs are minimal), but keep at least one.
  let start = 0;
  while (start < component.length - 1 && component[start] === 0) start += 1;
  let content = component.subarray(start);
  // If the high bit of the first byte is set, the value would read as negative;
  // prepend a 0x00 so it stays positive.
  if (content[0] & 0x80) {
    const padded = new Uint8Array(content.length + 1);
    padded[0] = 0x00;
    padded.set(content, 1);
    content = padded;
  }
  const out = new Uint8Array(2 + content.length);
  out[0] = 0x02; // INTEGER
  out[1] = content.length;
  out.set(content, 2);
  return out;
}
