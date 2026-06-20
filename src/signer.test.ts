import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPasskeySigner } from './signer';
import { bytesToBase64, bytesToBase64url } from './base64';
import type { ConnectVault } from './types';

const fakeVault: ConnectVault = {
  vaultPda: 'pda',
  swigAddress: 'swig',
  receiveAddress: null,
  usdcAta: null,
  // publicKey is base64 (33-byte SEC1); userHandle is base64url.
  publicKey: bytesToBase64(new Uint8Array(33).fill(2)),
  userHandle: bytesToBase64url(new Uint8Array(16).map((_, i) => i + 1)),
  credentialId: 'cred',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createPasskeySigner', () => {
  it('builds a signer exposing signOperation()', () => {
    const signer = createPasskeySigner(fakeVault, 'https://api.dexter.cash');
    expect(typeof signer.signOperation).toBe('function');
  });

  it('signOperation drives the anon policy (challenge → verify) and returns the assertion', async () => {
    const credentialIdBytes = new Uint8Array([9, 8, 7]);
    const compactSig = new Uint8Array(64).map((_, i) => (i * 7 + 3) & 0xff);
    const clientDataJSON = new TextEncoder().encode('{"type":"webauthn.get"}');
    const authenticatorData = new Uint8Array([0xaa, 0xbb]);

    const fetchMock = vi
      .fn()
      // /challenge — server reflects opHash as challenge + resolves a credential
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          options: {
            challenge: bytesToBase64url(new Uint8Array(32).fill(5)),
            rpId: 'dexter.cash',
            allowCredentials: [{ id: bytesToBase64url(credentialIdBytes), transports: ['internal'] }],
          },
        }),
      })
      // /verify
      .mockResolvedValueOnce({ ok: true, json: async () => ({ verified: true }) });
    vi.stubGlobal('fetch', fetchMock);

    // Inject a fake assertion so no real WebAuthn is needed.
    const signer = createPasskeySigner(fakeVault, 'https://api.dexter.cash', {
      __assertion: {
        credentialId: credentialIdBytes,
        assertOver: async () => ({ signature: compactSig, clientDataJSON, authenticatorData }),
      },
    });

    const result = await signer.signOperation(new Uint8Array([1, 2, 3, 4]));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/passkey-anon/sign/challenge');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/passkey-anon/sign/verify');
    // The signer returns the compact signature (what the on-chain precompile wants).
    expect(result.signature).toEqual(compactSig);
  });
});
