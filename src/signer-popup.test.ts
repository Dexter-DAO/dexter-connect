// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { buildPasskeyAuthorizationChallenge } from '@dexterai/vault';

import { createPasskeySigner } from './signer';
import { bytesToBase64, bytesToBase64url } from './base64';
import type { ConnectVault } from './types';

const EXPECTED_VAULT = new PublicKey(new Uint8Array(32).fill(1));
const OTHER_VAULT = new PublicKey(new Uint8Array(32).fill(2));

const vault: ConnectVault = {
  vaultPda: EXPECTED_VAULT.toBase58(),
  swigAddress: 'swig-address',
  receiveAddress: null,
  usdcAta: null,
  publicKey: bytesToBase64(new Uint8Array(33).fill(2)),
  userHandle: bytesToBase64url(new Uint8Array(16).fill(3)),
  credentialId: bytesToBase64url(new Uint8Array([4, 5, 6])),
  walletLabel: 'Merchant wallet',
};

async function clientDataFor(
  operationMessage: Uint8Array,
  challengeVault: PublicKey = EXPECTED_VAULT,
): Promise<Uint8Array> {
  const operationHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new Uint8Array(operationMessage)),
  );
  const challenge = buildPasskeyAuthorizationChallenge({
    vault: challengeVault,
    nonce: 7n,
    operationHash,
    ceremonyNonce: new Uint8Array(32).fill(6),
  });
  return clientDataWithChallenge(challenge);
}

function clientDataWithChallenge(challenge: Uint8Array): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: bytesToBase64url(challenge),
      origin: 'https://dexter.cash',
      crossOrigin: false,
    }),
  );
}

function validAuthenticatorData(): Uint8Array {
  const data = new Uint8Array(37);
  data.set(createHash('sha256').update('dexter.cash').digest(), 0);
  data[32] = 0x05;
  return data;
}

function assertionResult(
  clientDataJSON: Uint8Array,
  authenticatorData = validAuthenticatorData(),
) {
  return {
    signature: new Uint8Array(64).fill(8),
    clientDataJSON,
    authenticatorData,
  };
}

function beginHostedSign(operationMessage: Uint8Array) {
  const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  const signer = createPasskeySigner(vault, 'https://api.dexter.cash', {
    connectHost: 'https://dexter.cash/connect',
  });
  const pending = signer.signOperation(operationMessage);
  const openedUrl = new URL(vi.mocked(window.open).mock.calls.at(-1)?.[0] as string);
  const requestId = openedUrl.searchParams.get('requestId') ?? '';
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://dexter.cash',
      source: popup as unknown as WindowProxy,
      data: { v: 1, type: 'dexter-connect:hello', requestId, op: 'sign' },
    }),
  );
  return { popup, pending, requestId };
}

function returnHostedResult(
  popup: { closed: boolean; close: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> },
  requestId: string,
  result: unknown,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://dexter.cash',
      source: popup as unknown as WindowProxy,
      data: {
        v: 1,
        type: 'dexter-connect:result',
        requestId,
        op: 'sign',
        ok: true,
        result,
      },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('third-party hosted operation signing', () => {
  it('completes from an unrelated opener without local WebAuthn or caller-selected API fetches', async () => {
    expect(window.location.origin).not.toBe('https://dexter.cash');

    const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const inlineAssertion = vi.fn();

    const signer = createPasskeySigner(vault, 'https://api.dexter.cash', {
      connectHost: 'https://dexter.cash/connect',
      __assertion: {
        credentialId: new Uint8Array([4, 5, 6]),
        assertOver: inlineAssertion,
      },
    });
    const operationMessage = new Uint8Array([20, 21, 22]);
    const requestedOperation = new Uint8Array(operationMessage);
    const pending = signer.signOperation(operationMessage);
    // The caller cannot mutate either what the popup reviews or what the
    // parent later hashes while validating the returned assertion.
    operationMessage.fill(99);
    const openedUrl = new URL(vi.mocked(window.open).mock.calls[0]?.[0] as string);
    const requestId = openedUrl.searchParams.get('requestId') ?? '';

    expect(openedUrl.origin).toBe('https://dexter.cash');
    expect(openedUrl.searchParams.get('op')).toBe('sign');
    expect(openedUrl.searchParams.has('apiBase')).toBe(false);
    expect(openedUrl.search).not.toContain('vault-pda');
    expect(inlineAssertion).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://dexter.cash',
        source: popup as unknown as WindowProxy,
        data: {
          v: 1,
          type: 'dexter-connect:hello',
          requestId,
          op: 'sign',
        },
      }),
    );

    expect(popup.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        v: 1,
        type: 'dexter-connect:sign-request',
        requestId,
        op: 'sign',
        payload: {
          operationMessage: new Uint8Array([20, 21, 22]),
          vault: expect.objectContaining({
            vaultPda: vault.vaultPda,
            userHandle: vault.userHandle,
            credentialId: vault.credentialId,
          }),
        },
      }),
      'https://dexter.cash',
    );

    const result = assertionResult(await clientDataFor(requestedOperation));
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://dexter.cash',
        source: popup as unknown as WindowProxy,
        data: {
          v: 1,
          type: 'dexter-connect:result',
          requestId,
          op: 'sign',
          ok: true,
          result,
        },
      }),
    );

    await expect(pending).resolves.toEqual(result);
    expect(inlineAssertion).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a returned challenge bound to tampered operation bytes', async () => {
    const requestedOperation = new Uint8Array([30, 31, 32]);
    const { popup, pending, requestId } = beginHostedSign(requestedOperation);
    const result = assertionResult(await clientDataFor(new Uint8Array([30, 31, 99])));

    returnHostedResult(popup, requestId, result);

    await expect(pending).rejects.toMatchObject({ code: 'popup_result_unbound' });
  });

  it('rejects a returned canonical challenge for a different vault', async () => {
    const operationMessage = new Uint8Array([40, 41, 42]);
    const { popup, pending, requestId } = beginHostedSign(operationMessage);
    const result = assertionResult(await clientDataFor(operationMessage, OTHER_VAULT));

    returnHostedResult(popup, requestId, result);

    await expect(pending).rejects.toMatchObject({ code: 'popup_result_unbound' });
  });

  it('rejects a hostile shape-only assertion result without a signed challenge', async () => {
    const operationMessage = new Uint8Array([50, 51, 52]);
    const { popup, pending, requestId } = beginHostedSign(operationMessage);
    const result = assertionResult(
      new TextEncoder().encode('{"type":"webauthn.get","origin":"https://dexter.cash"}'),
    );

    returnHostedResult(popup, requestId, result);

    await expect(pending).rejects.toMatchObject({ code: 'popup_result_malformed' });
  });

  it.each([
    ['hostile origin', { origin: 'https://merchant.example', crossOrigin: false }],
    ['Dexter suffix origin', { origin: 'https://dexter.cash.attacker.example', crossOrigin: false }],
    ['cross-origin ceremony', { origin: 'https://dexter.cash', crossOrigin: true }],
  ] as const)('rejects %s in a hosted result', async (_label, context) => {
    const operationMessage = new Uint8Array([55, 56, 57]);
    const { popup, pending, requestId } = beginHostedSign(operationMessage);
    const canonical = JSON.parse(
      new TextDecoder().decode(await clientDataFor(operationMessage)),
    ) as Record<string, unknown>;
    const result = assertionResult(new TextEncoder().encode(JSON.stringify({
      ...canonical,
      ...context,
    })));

    returnHostedResult(popup, requestId, result);
    await expect(pending).rejects.toMatchObject({ code: 'popup_result_malformed' });
  });

  it('rejects wrong RP hash and missing UP/UV flags in a hosted result', async () => {
    const operationMessage = new Uint8Array([60, 61, 62]);
    const clientDataJSON = await clientDataFor(operationMessage);

    for (const authenticatorData of [
      (() => {
        const data = validAuthenticatorData();
        data.set(createHash('sha256').update('merchant.example').digest(), 0);
        return data;
      })(),
      (() => {
        const data = validAuthenticatorData();
        data[32] = 0x01;
        return data;
      })(),
    ]) {
      const { popup, pending, requestId } = beginHostedSign(operationMessage);
      returnHostedResult(popup, requestId, assertionResult(clientDataJSON, authenticatorData));
      await expect(pending).rejects.toMatchObject({ code: 'popup_result_malformed' });
    }
  });

  it('rejects duplicate signed client-data keys', async () => {
    const operationMessage = new Uint8Array([70, 71, 72]);
    const canonical = new TextDecoder().decode(await clientDataFor(operationMessage));
    const duplicate = canonical.replace(
      '"origin":"https://dexter.cash"',
      '"origin":"https://dexter.cash","origin":"https://dexter.cash"',
    );
    const { popup, pending, requestId } = beginHostedSign(operationMessage);
    returnHostedResult(popup, requestId, assertionResult(new TextEncoder().encode(duplicate)));

    await expect(pending).rejects.toMatchObject({ code: 'popup_result_malformed' });
  });

  it('rejects an escaped origin alias that would overwrite a hostile origin under JSON.parse', async () => {
    const operationMessage = new Uint8Array([73, 74, 75]);
    const canonical = JSON.parse(
      new TextDecoder().decode(await clientDataFor(operationMessage)),
    ) as Record<string, unknown>;
    const escapedAlias = JSON.stringify({
      ...canonical,
      origin: 'https://attacker.invalid',
    }).replace(
      '"crossOrigin":false',
      '"or\\u0069gin":"https://dexter.cash","crossOrigin":false',
    );
    const { popup, pending, requestId } = beginHostedSign(operationMessage);
    returnHostedResult(
      popup,
      requestId,
      assertionResult(new TextEncoder().encode(escapedAlias)),
    );

    await expect(pending).rejects.toMatchObject({ code: 'popup_result_malformed' });
  });

  it('rejects a hostile API base before opening the hosted signer', () => {
    const open = vi.spyOn(window, 'open');

    expect(() => createPasskeySigner(vault, 'https://attacker.example')).toThrowError(
      expect.objectContaining({ code: 'untrusted_api_base' }),
    );
    expect(open).not.toHaveBeenCalled();
  });
});
