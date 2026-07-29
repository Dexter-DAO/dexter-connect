// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openCeremonyPopup } from './popup';

type PopupHarness = {
  pending: Promise<{ connected: true }>;
  popup: { closed: boolean; close: ReturnType<typeof vi.fn> };
  requestId: string;
};

function beginPopup(): PopupHarness {
  const popup = { closed: false, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  const pending = openCeremonyPopup<{ connected: true }>('signin', {
    connectHost: 'https://dexter.cash/connect',
  });
  const openedUrl = new URL(vi.mocked(window.open).mock.calls[0]?.[0] as string);
  return {
    pending,
    popup,
    requestId: openedUrl.searchParams.get('requestId') ?? '',
  };
}

function postResult(
  origin: string,
  requestId: string,
  result: { connected: true } = { connected: true },
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      data: {
        v: 1,
        type: 'dexter-connect:result',
        requestId,
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
  it('accepts only the matching request from the configured hosted origin', async () => {
    const { pending, popup, requestId } = beginPopup();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    postResult('https://attacker.example', requestId);
    postResult('https://dexter.cash', 'different-request');
    await Promise.resolve();
    expect(settled).toBe(false);

    postResult('https://dexter.cash', requestId);
    await expect(pending).resolves.toEqual({ connected: true });
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it('removes the exact message listener after a matching result', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { pending, requestId } = beginPopup();
    const messageCall = add.mock.calls.find(([type]) => type === 'message');
    expect(messageCall).toBeTruthy();

    postResult('https://dexter.cash', requestId);
    await pending;

    expect(remove).toHaveBeenCalledWith('message', messageCall?.[1]);
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
