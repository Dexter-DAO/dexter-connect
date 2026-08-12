import { describe, it, expect, vi, afterEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { buildPasskeyAuthorizationChallenge } from '@dexterai/vault';
import { createAnonServerPolicy } from './anon-policy';
import { ConnectError } from './types';
import {
  base64urlToBytes,
  base64ToBytes,
  bytesToBase64url,
  compactSignatureToDer,
} from './base64';

const API = 'https://api.dexter.cash';

// userHandle is 16 bytes (the server enforces it); operationHash is 32 (sha256).
const userHandle = new Uint8Array(16).map((_, i) => i + 1);
const operationMessage = new Uint8Array([1, 2, 3, 4]);
const operationHash = new Uint8Array(32).map((_, i) => i + 100);
const credentialIdBytes = new Uint8Array([9, 8, 7, 6, 5]);
const challenge = buildPasskeyAuthorizationChallenge({
  vault: new PublicKey(new Uint8Array(32).fill(1)),
  nonce: 7n,
  operationHash,
  ceremonyNonce: new Uint8Array(32).fill(9),
});
const issueArgs = {
  userHandle,
  operationMessage,
  operationHash,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createAnonServerPolicy.issueChallenge', () => {
  it('POSTs the operation context and decodes the canonical challenge envelope', async () => {
    const serverResp = {
      options: {
        challenge: bytesToBase64url(challenge),
        rpId: 'dexter.cash',
        allowCredentials: [
          { id: bytesToBase64url(credentialIdBytes), type: 'public-key', transports: ['internal'] },
        ],
      },
    };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => serverResp }));
    vi.stubGlobal('fetch', fetchMock);

    const policy = createAnonServerPolicy(`${API}/`);
    const result = await policy.issueChallenge(issueArgs);

    // URL
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/api/passkey-anon/sign/challenge`);
    expect(init.method).toBe('POST');

    // The server receives enough raw context to classify operation-specific consent.
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      userHandle: bytesToBase64url(userHandle),
      operationHash: bytesToBase64url(operationHash),
      operationMessage: bytesToBase64url(operationMessage),
      operation: 'vault_operation',
    });

    // Decoded result is Uint8Arrays + passthrough rpId/transports.
    expect(result.challenge).toEqual(challenge);
    expect(result.credentialId).toEqual(credentialIdBytes);
    expect(result.rpId).toBe('dexter.cash');
    expect(result.transports).toEqual(['internal']);
  });

  it('rejects a caller-controlled signing server before any request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() => createAnonServerPolicy('https://attacker.example')).toThrowError(
      expect.objectContaining({ code: 'untrusted_api_base' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the envelope through for the SDK to validate before WebAuthn', async () => {
    const substitutedEnvelope = challenge.slice();
    substitutedEnvelope[96] ^= 0xff;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        options: {
          challenge: bytesToBase64url(substitutedEnvelope),
          rpId: 'dexter.cash',
          allowCredentials: [{ id: bytesToBase64url(credentialIdBytes) }],
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const policy = createAnonServerPolicy();
    await expect(policy.issueChallenge(issueArgs)).resolves.toMatchObject({
      challenge: substitutedEnvelope,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws ConnectError with the server error code on a non-ok /challenge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: 'credential_not_found' }),
        text: async () => JSON.stringify({ error: 'credential_not_found' }),
      })),
    );
    const policy = createAnonServerPolicy(API);
    await expect(policy.issueChallenge(issueArgs)).rejects.toMatchObject({
      code: 'credential_not_found',
    });
    await expect(policy.issueChallenge(issueArgs)).rejects.toBeInstanceOf(ConnectError);
  });

  it('throws a typed error when the response has no allow-listed credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          options: { challenge: bytesToBase64url(challenge), allowCredentials: [] },
        }),
      })),
    );
    const policy = createAnonServerPolicy(API);
    await expect(policy.issueChallenge(issueArgs)).rejects.toMatchObject({
      code: 'no_credential',
    });
  });
});

describe('createAnonServerPolicy.verify', () => {
  // A real-ish compact signature (64 bytes) so the compact→DER re-encode runs.
  const signature = new Uint8Array(64).map((_, i) => (i * 7 + 3) & 0xff);
  const clientDataJSON = new TextEncoder().encode('{"type":"webauthn.get"}');
  const authenticatorData = new Uint8Array([0xaa, 0xbb, 0xcc, 0x01, 0x00, 0x00, 0x00, 0x05]);

  it('POSTs the credential JSON + base64url userHandle to /verify with a DER signature', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ verified: true }) }));
    vi.stubGlobal('fetch', fetchMock);

    const policy = createAnonServerPolicy(API);
    await policy.verify({
      userHandle,
      credentialId: credentialIdBytes,
      signature,
      clientDataJSON,
      authenticatorData,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/api/passkey-anon/sign/verify`);
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string);
    expect(body.userHandle).toBe(bytesToBase64url(userHandle));

    const cred = body.credential;
    // id + rawId are the base64url credentialId; type is public-key.
    expect(cred.id).toBe(bytesToBase64url(credentialIdBytes));
    expect(cred.rawId).toBe(bytesToBase64url(credentialIdBytes));
    expect(cred.type).toBe('public-key');

    // clientDataJSON / authenticatorData are base64url of the raw bytes.
    expect(base64urlToBytes(cred.response.clientDataJSON)).toEqual(clientDataJSON);
    expect(base64urlToBytes(cred.response.authenticatorData)).toEqual(authenticatorData);

    // signature is base64url of DER(compact) — NOT the raw compact bytes.
    const expectedDer = compactSignatureToDer(signature);
    expect(base64urlToBytes(cred.response.signature)).toEqual(expectedDer);
    // sanity: a DER ECDSA sig starts with the SEQUENCE tag 0x30.
    expect(base64urlToBytes(cred.response.signature)[0]).toBe(0x30);

    expect(cred.response.userHandle).toBeNull();
  });

  it('throws ConnectError with the server error code on a non-ok /verify', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'verification_failed' }),
        text: async () => JSON.stringify({ error: 'verification_failed' }),
      })),
    );
    const policy = createAnonServerPolicy(API);
    await expect(
      policy.verify({ userHandle, credentialId: credentialIdBytes, signature, clientDataJSON, authenticatorData }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });

  it('throws when the server returns verified=false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ verified: false }) })));
    const policy = createAnonServerPolicy(API);
    await expect(
      policy.verify({ userHandle, credentialId: credentialIdBytes, signature, clientDataJSON, authenticatorData }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });

  it.each([
    ['missing', {}],
    ['null', { verified: null }],
    ['string', { verified: 'true' }],
  ])('rejects a 2xx response with %s verified truth', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
    const policy = createAnonServerPolicy(API);
    await expect(
      policy.verify({ userHandle, credentialId: credentialIdBytes, signature, clientDataJSON, authenticatorData }),
    ).rejects.toMatchObject({ code: 'verification_failed' });
  });
});

describe('compactSignatureToDer (round-trip sanity)', () => {
  it('produces canonical DER that base64-decodes to a 0x30 SEQUENCE', () => {
    const sig = new Uint8Array(64).fill(0x80); // high bit set in both r and s
    const der = compactSignatureToDer(sig);
    expect(der[0]).toBe(0x30);
    // r and s each get a 0x00 pad (high bit set) → 33 content bytes + 2 header = 35 each.
    expect(der[1]).toBe(70);
    // round-trip through base64 just to exercise the codec the policy uses.
    expect(base64ToBytes(btoa(String.fromCharCode(...der)))).toEqual(der);
  });

  it('rejects a non-64-byte signature', () => {
    expect(() => compactSignatureToDer(new Uint8Array(32))).toThrow();
  });
});
