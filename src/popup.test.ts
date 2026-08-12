// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCeremonyPopup } from './popup';
import type { CeremonyOperation } from './types';

type PopupHarness<T = { connected: true }> = {
  pending: Promise<T>;
  popup: {
    closed: boolean;
    close: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  };
  requestId: string;
  openedUrl: URL;
  op: CeremonyOperation;
};

function beginPopup(op: CeremonyOperation = 'signin'): PopupHarness {
  const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  const pending = openCeremonyPopup<{ connected: true }>(op, {
    connectHost: 'https://dexter.cash/connect',
  });
  const openedUrl = new URL(vi.mocked(window.open).mock.calls[0]?.[0] as string);
  return {
    pending,
    popup,
    requestId: openedUrl.searchParams.get('requestId') ?? '',
    openedUrl,
    op,
  };
}

function postHello(
  harness: PopupHarness,
  overrides: {
    origin?: string;
    requestId?: string;
    op?: CeremonyOperation;
    source?: MessageEventSource | null;
  } = {},
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: overrides.origin ?? 'https://dexter.cash',
      source: overrides.source === undefined
        ? (harness.popup as unknown as WindowProxy)
        : overrides.source,
      data: {
        v: 1,
        type: 'dexter-connect:hello',
        requestId: overrides.requestId ?? harness.requestId,
        op: overrides.op ?? harness.op,
      },
    }),
  );
}

function postResult(
  harness: PopupHarness,
  origin: string,
  requestId: string,
  result: { connected: true } = { connected: true },
  op: CeremonyOperation = harness.op,
  source: MessageEventSource | null = harness.popup as unknown as WindowProxy,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source,
      data: {
        v: 1,
        type: 'dexter-connect:result',
        requestId,
        op,
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
  vi.useRealTimers();
});

describe('hosted popup result boundary', () => {
  it('rejects a caller-controlled ceremony host before opening a window', async () => {
    const open = vi.spyOn(window, 'open');
    expect(() =>
      openCeremonyPopup('signin', { connectHost: 'https://attacker.example/connect' }),
    ).toThrowError(expect.objectContaining({ code: 'untrusted_connect_host' }));

    expect(open).not.toHaveBeenCalled();
  });

  it('rejects an adjacent wallet-store value before opening a window', () => {
    const open = vi.spyOn(window, 'open');

    expect(() =>
      openCeremonyPopup('signin', { walletStore: 'provisionally' as never }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_wallet_store_mode' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects third-party account-claim proofs before opening a window', () => {
    const open = vi.spyOn(window, 'open');
    const operationMessage = new Uint8Array(42);
    operationMessage.set(new TextEncoder().encode('siwx_login'));

    expect(() => openCeremonyPopup('sign', {
      signRequest: {
        operationMessage,
        vault: {
          vaultPda: 'vault-pda',
          publicKey: 'public-key-b64',
          userHandle: 'user-handle-b64url',
          credentialId: 'credential-b64url',
        },
      },
    })).toThrowError(expect.objectContaining({ code: 'unsupported_operation' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('sends raw signing input once, only after the exact hosted hello, and never in the URL', async () => {
    const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const operationMessage = new Uint8Array([11, 22, 33, 44]);
    const pending = openCeremonyPopup<{
      signature: Uint8Array;
      clientDataJSON: Uint8Array;
      authenticatorData: Uint8Array;
    }>('sign', {
      connectHost: 'https://dexter.cash/connect',
      signRequest: {
        operationMessage,
        vault: {
          vaultPda: 'vault-pda',
          publicKey: 'public-key-b64',
          userHandle: 'user-handle-b64url',
          credentialId: 'credential-b64url',
          walletLabel: 'Travel agent',
        },
      },
    });
    const openedUrl = new URL(vi.mocked(window.open).mock.calls[0]?.[0] as string);
    const requestId = openedUrl.searchParams.get('requestId') ?? '';
    const harness: PopupHarness = {
      pending: pending as unknown as Promise<{ connected: true }>,
      popup,
      requestId,
      openedUrl,
      op: 'sign',
    };

    expect([...openedUrl.searchParams.keys()].sort()).toEqual(
      ['op', 'origin', 'requestId', 'v'].sort(),
    );
    expect(openedUrl.search).not.toContain('vault-pda');
    expect(openedUrl.search).not.toContain('user-handle');
    expect(openedUrl.searchParams.has('operationMessage')).toBe(false);

    // The caller cannot mutate the bytes after opening but before handshake.
    operationMessage.fill(99);
    postHello(harness, { origin: 'https://attacker.example' });
    postHello(harness, { source: {} as WindowProxy });
    expect(popup.postMessage).not.toHaveBeenCalled();

    postHello(harness);
    expect(popup.postMessage).toHaveBeenNthCalledWith(
      1,
      {
        v: 1,
        type: 'dexter-connect:hello-ack',
        requestId,
        op: 'sign',
      },
      'https://dexter.cash',
    );
    expect(popup.postMessage).toHaveBeenNthCalledWith(
      2,
      {
        v: 1,
        type: 'dexter-connect:sign-request',
        requestId,
        op: 'sign',
        payload: {
          operationMessage: new Uint8Array([11, 22, 33, 44]),
          vault: {
            vaultPda: 'vault-pda',
            publicKey: 'public-key-b64',
            userHandle: 'user-handle-b64url',
            credentialId: 'credential-b64url',
            walletLabel: 'Travel agent',
          },
        },
      },
      'https://dexter.cash',
    );

    // A repeated exact hello cannot disclose/send a second operation request.
    postHello(harness);
    expect(popup.postMessage).toHaveBeenCalledTimes(2);

    const result = {
      signature: new Uint8Array(64).fill(7),
      clientDataJSON: new Uint8Array([1, 2, 3]),
      authenticatorData: new Uint8Array(37).fill(4),
    };
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
  });

  it('keeps arbitrary website integration while opening only the hosted Dexter URL', async () => {
    const harness = beginPopup();

    expect(harness.openedUrl.origin).toBe('https://dexter.cash');
    expect(harness.openedUrl.pathname).toBe('/connect');
    expect(harness.openedUrl.searchParams.get('origin')).toBe(window.location.origin);
    expect(harness.openedUrl.searchParams.get('op')).toBe('signin');
    expect(harness.openedUrl.searchParams.has('apiBase')).toBe(false);
    expect(harness.openedUrl.searchParams.has('walletStore')).toBe(false);

    postHello(harness);
    postResult(harness, 'https://dexter.cash', harness.requestId);
    await expect(harness.pending).resolves.toEqual({ connected: true });
  });

  it('adds only the exact provisional wallet-store popup parameter', async () => {
    const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const pending = openCeremonyPopup<{ connected: true }>('signin', {
      walletStore: 'provisional',
    });
    const openedUrl = new URL(vi.mocked(window.open).mock.calls[0]?.[0] as string);
    const harness: PopupHarness = {
      pending,
      popup,
      requestId: openedUrl.searchParams.get('requestId') ?? '',
      openedUrl,
      op: 'signin',
    };

    expect(openedUrl.searchParams.get('walletStore')).toBe('provisional');
    expect([...openedUrl.searchParams.keys()].sort()).toEqual(
      ['op', 'origin', 'requestId', 'v', 'walletStore'].sort(),
    );

    postHello(harness);
    postResult(harness, 'https://dexter.cash', harness.requestId);
    await expect(pending).resolves.toEqual({ connected: true });
  });

  it('omits the wallet-store parameter for explicit commit mode', async () => {
    const popup = { closed: false, close: vi.fn(), postMessage: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const pending = openCeremonyPopup<{ connected: true }>('signin', {
      walletStore: 'commit',
    });
    const openedUrl = new URL(vi.mocked(window.open).mock.calls[0]?.[0] as string);
    const harness: PopupHarness = {
      pending,
      popup,
      requestId: openedUrl.searchParams.get('requestId') ?? '',
      openedUrl,
      op: 'signin',
    };

    expect(openedUrl.searchParams.has('walletStore')).toBe(false);
    postHello(harness);
    postResult(harness, 'https://dexter.cash', harness.requestId);
    await expect(pending).resolves.toEqual({ connected: true });
  });

  it('handshakes and accepts a result only from the exact popup, hosted origin, request, and op', async () => {
    const harness = beginPopup();
    const { pending, popup, requestId } = harness;
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    // Even a syntactically valid result is inert until the browser-stamped
    // opener/popup handshake has happened.
    postResult(harness, 'https://dexter.cash', requestId);
    postHello(harness, { origin: 'https://attacker.example' });
    postHello(harness, { source: {} as WindowProxy });
    postHello(harness, { requestId: 'different-request' });
    postHello(harness, { op: 'create' });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(popup.postMessage).not.toHaveBeenCalled();

    postHello(harness);
    expect(popup.postMessage).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'dexter-connect:hello-ack',
        requestId,
        op: 'signin',
      },
      'https://dexter.cash',
    );

    postResult(harness, 'https://attacker.example', requestId);
    postResult(harness, 'https://dexter.cash', requestId, { connected: true }, 'create');
    postResult(harness, 'https://dexter.cash', 'different-request');
    postResult(harness, 'https://dexter.cash', requestId, { connected: true }, 'signin', {} as WindowProxy);
    await Promise.resolve();
    expect(settled).toBe(false);

    postResult(harness, 'https://dexter.cash', requestId);
    await expect(pending).resolves.toEqual({ connected: true });
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it('consumes a matching result once and removes the exact message listener', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const harness = beginPopup();
    const { pending, requestId } = harness;
    const messageCall = add.mock.calls.find(([type]) => type === 'message');
    expect(messageCall).toBeTruthy();

    postHello(harness);
    postResult(harness, 'https://dexter.cash', requestId);
    await pending;

    expect(remove).toHaveBeenCalledWith('message', messageCall?.[1]);
    postResult(harness, 'https://dexter.cash', requestId);
    expect(harness.popup.close).toHaveBeenCalledOnce();
  });

  it('fails closed when the popup is closed before a result', async () => {
    const { pending, popup } = beginPopup();
    popup.closed = true;
    const rejection = expect(pending).rejects.toMatchObject({ code: 'popup_closed' });

    await vi.advanceTimersByTimeAsync(500);
    await rejection;
  });

  it('fails closed when the hosted ceremony times out', async () => {
    const { pending } = beginPopup();
    const rejection = expect(pending).rejects.toMatchObject({ code: 'popup_timeout' });

    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
  });
});
