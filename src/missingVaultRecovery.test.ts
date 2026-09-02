// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://indexter.cash/"}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recoverMissingVaultForAccount } from './missingVaultRecovery';

const ACCESS_TOKEN = 'existing-account-access-token-123456789';
const CHALLENGE = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const CREDENTIAL_ID = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
const USER_HANDLE = 'AwMDAwMDAwMDAwMDAwMDAw';

type MockPopup = {
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};

interface RecoveryHarness {
  pending: ReturnType<typeof recoverMissingVaultForAccount>;
  popup: MockPopup;
  openedUrl: URL;
  requestId: string;
  fetchMock: ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('missing Vault account recovery', () => {
  it('rejects a caller outside Indexter before opening or fetching', async () => {
    const originalHref = window.location.href;
    const open = vi.spyOn(window, 'open');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.location.href = 'https://attacker.example/';

    try {
      await expect(
        recoverMissingVaultForAccount({ accountAccessToken: ACCESS_TOKEN }),
      ).rejects.toMatchObject({
        code: 'untrusted_missing_vault_recovery_opener',
      });
      expect(open).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      window.location.href = originalHref;
    }
  });

  it('opens first, keeps the bearer in the opener, and completes the exact assertion', async () => {
    const order: string[] = [];
    const harness = beginRecovery(order);
    expect(order.slice(0, 2)).toEqual(['open', 'challenge']);
    expect(window.location.origin).toBe('https://indexter.cash');
    expect(harness.openedUrl.search).not.toContain(ACCESS_TOKEN);
    expect(harness.openedUrl.search).not.toContain(CHALLENGE);

    postHello(harness);
    await vi.waitFor(() => expect(harness.popup.postMessage).toHaveBeenCalledTimes(2));
    expect(harness.popup.postMessage.mock.calls[1]?.[0]).toEqual({
      v: 1,
      type: 'dexter-connect:missing-vault-recovery-request',
      requestId: harness.requestId,
      op: 'recover-missing-vault',
      payload: {
        account: { provider: 'x', handle: '@branch' },
        options: {
          challenge: CHALLENGE,
          rpId: 'dexter.cash',
          userVerification: 'required',
          timeout: 60_000,
        },
      },
    });
    expect(JSON.stringify(harness.popup.postMessage.mock.calls)).not.toContain(ACCESS_TOKEN);

    postResult(harness, await validCredential());
    await expect(harness.pending).resolves.toEqual({
      recovered: true,
      alreadyRecovered: false,
      relation: 'bound',
      account: { provider: 'x', handle: '@branch' },
      vault: {
        vaultPda: 'vault-pda',
        swigAddress: 'swig-address',
        receiveAddress: 'receive-address',
        userHandle: USER_HANDLE,
        credentialId: CREDENTIAL_ID,
        state: 'initialized',
      },
    });

    expect(harness.fetchMock).toHaveBeenCalledTimes(2);
    for (const call of harness.fetchMock.mock.calls) {
      expect(call[1]?.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    }
    expect(harness.fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.dexter.cash/api/passkey-vault/recover-missing/complete',
    );
    const completeBody = JSON.parse(harness.fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(completeBody).toEqual({ credential: await validCredential() });
  });

  it('rejects a server request that could select a credential', async () => {
    const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          operation: 'vault_missing_recovery',
          account: { provider: 'x', handle: '@branch' },
          options: {
            challenge: CHALLENGE,
            rpId: 'dexter.cash',
            userVerification: 'required',
            allowCredentials: [{ id: CREDENTIAL_ID, type: 'public-key' }],
          },
        }),
      ),
    );

    const pending = recoverMissingVaultForAccount({ accountAccessToken: ACCESS_TOKEN });
    await expect(pending).rejects.toMatchObject({
      code: 'missing_vault_recovery_challenge_malformed',
    });
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.postMessage).not.toHaveBeenCalled();
  });

  it('rejects a popup assertion not bound to the server challenge', async () => {
    const harness = beginRecovery([]);
    postHello(harness);
    await vi.waitFor(() => expect(harness.popup.postMessage).toHaveBeenCalledTimes(2));
    const credential = await validCredential(
      'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ',
    );
    postResult(harness, credential);

    await expect(harness.pending).rejects.toMatchObject({
      code: 'missing_vault_recovery_assertion_unbound',
    });
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
  });
});

function beginRecovery(order: string[]): RecoveryHarness {
  const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
  vi.spyOn(window, 'open').mockImplementation(() => {
    order.push('open');
    return popup as unknown as Window;
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/challenge')) {
      order.push('challenge');
      return jsonResponse({
        operation: 'vault_missing_recovery',
        account: { provider: 'x', handle: '@branch' },
        options: {
          challenge: CHALLENGE,
          rpId: 'dexter.cash',
          userVerification: 'required',
          timeout: 60_000,
        },
      });
    }
    order.push('complete');
    return jsonResponse({
      recovered: true,
      alreadyRecovered: false,
      relation: 'bound',
      account: { provider: 'x', handle: '@branch' },
      vault: {
        vaultPda: 'vault-pda',
        swigAddress: 'swig-address',
        receiveAddress: 'receive-address',
        userHandle: USER_HANDLE,
        credentialId: CREDENTIAL_ID,
        state: 'initialized',
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const pending = recoverMissingVaultForAccount({ accountAccessToken: ACCESS_TOKEN });
  const openedUrl = new URL(vi.mocked(window.open).mock.calls[0]?.[0] as string);
  return {
    pending,
    popup,
    openedUrl,
    requestId: openedUrl.searchParams.get('requestId') ?? '',
    fetchMock,
  };
}

function postHello(harness: RecoveryHarness): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://dexter.cash',
      source: harness.popup as unknown as WindowProxy,
      data: {
        v: 1,
        type: 'dexter-connect:hello',
        requestId: harness.requestId,
        op: 'recover-missing-vault',
      },
    }),
  );
}

function postResult(harness: RecoveryHarness, result: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://dexter.cash',
      source: harness.popup as unknown as WindowProxy,
      data: {
        v: 1,
        type: 'dexter-connect:result',
        requestId: harness.requestId,
        op: 'recover-missing-vault',
        ok: true,
        result,
      },
    }),
  );
}

async function validCredential(challenge = CHALLENGE) {
  const rpHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dexter.cash')),
  );
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpHash, 0);
  authenticatorData[32] = 0x05;
  const clientData = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'https://dexter.cash',
      crossOrigin: false,
    }),
  );
  return {
    id: CREDENTIAL_ID,
    rawId: CREDENTIAL_ID,
    type: 'public-key' as const,
    response: {
      clientDataJSON: toBase64url(clientData),
      authenticatorData: toBase64url(authenticatorData),
      signature: toBase64url(new Uint8Array(64).fill(7)),
      userHandle: USER_HANDLE,
    },
    clientExtensionResults: {},
    authenticatorAttachment: 'platform' as const,
  };
}

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
