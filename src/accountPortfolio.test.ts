import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAccountPortfolio } from './accountPortfolio';
import type { DexterWalletView } from './useDexterConnection';

const VAULT = 'EfPoo4wWgxKVToit7yX5VtXXBrhao4G8L7vrbKy6pump';
const RECEIVE = 'So11111111111111111111111111111111111111112';
const CONTROL = '11111111111111111111111111111111';
const wallet: DexterWalletView = {
  userHandle: 'AAAAAAAAAAAAAAAAAAAAAA', label: 'Test account', vaultPda: VAULT,
  walletAddress: CONTROL, swigAddress: CONTROL, receiveAddress: RECEIVE,
  network: 'solana-mainnet',
};

function portfolio(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, network: 'solana-mainnet', walletAddress: RECEIVE, vaultPda: VAULT,
    observedAt: '2026-10-26T03:30:00.000Z', holdingsComplete: true,
    pricedHoldings: 2, unpricedHoldings: 0, omittedHoldings: 0,
    pricedValueUsd: '1.15', portfolioValueUsd: '1.15', ...overrides,
  };
}

function fetchResponse(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

afterEach(() => vi.useRealTimers());

describe('account portfolio read', () => {
  it('uses the receive address and selected handle with distinct control and asset accounts', async () => {
    const fetch = fetchResponse({ ok: true, portfolio: portfolio() });
    await expect(fetchAccountPortfolio(wallet, { fetch })).resolves.toEqual({ amount: '$1.15', partial: false });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.dexter.cash/api/passkey-vault-anon/portfolio?user_handle=AAAAAAAAAAAAAAAAAAAAAA',
      expect.objectContaining({ cache: 'no-store', credentials: 'omit', signal: expect.any(AbortSignal) }),
    );
  });

  it('accepts the API-resolved receive address when the selected vault has no retained receive address', async () => {
    await expect(fetchAccountPortfolio({ ...wallet, receiveAddress: null }, {
      fetch: fetchResponse({ ok: true, portfolio: portfolio() }),
    })).resolves.toEqual({ amount: '$1.15', partial: false });
  });

  it('accepts a canonical 32-byte address containing leading zero bytes', async () => {
    await expect(fetchAccountPortfolio({ ...wallet, receiveAddress: CONTROL }, {
      fetch: fetchResponse({ ok: true, portfolio: portfolio({ walletAddress: CONTROL }) }),
    })).resolves.toEqual({ amount: '$1.15', partial: false });
  });

  it.each(['1'.repeat(33), 'z'.repeat(44), '2'.repeat(32), '0'.repeat(32)])(
    'rejects a matching address that does not decode to 32 bytes: %s', async (address) => {
      const fetch = fetchResponse({ ok: true, portfolio: portfolio({ walletAddress: address }) });
      await expect(fetchAccountPortfolio({ ...wallet, receiveAddress: address }, { fetch }))
        .rejects.toThrow('unavailable');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['wrong receive address', { walletAddress: CONTROL }],
    ['wrong selected vault', { vaultPda: CONTROL }],
    ['wrong network', { network: 'solana-devnet' }],
    ['missing schema', { schemaVersion: undefined }],
    ['invalid timestamp', { observedAt: 'not a date' }],
    ['invalid public key', { walletAddress: 'not-an-address' }],
    ['NaN price', { pricedValueUsd: 'NaN' }],
    ['exponential price', { portfolioValueUsd: '1e20' }],
    ['negative price', { portfolioValueUsd: '-1' }],
    ['noncanonical price', { pricedValueUsd: '01.15' }],
    ['unsafe counter', { pricedHoldings: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing counter', { unpricedHoldings: undefined }],
    ['missing completeness', { holdingsComplete: undefined }],
    ['inconsistent complete total', { portfolioValueUsd: '9' }],
    ['nonzero total without priced assets', { pricedHoldings: 0 }],
  ])('rejects %s', async (_, overrides) => {
    await expect(fetchAccountPortfolio(wallet, {
      fetch: fetchResponse({ ok: true, portfolio: portfolio(overrides) }),
    })).rejects.toThrow('unavailable');
  });

  it('uses the priced subtotal for a partial portfolio', async () => {
    await expect(fetchAccountPortfolio(wallet, {
      fetch: fetchResponse({ ok: true, portfolio: portfolio({
        holdingsComplete: false, omittedHoldings: 3, unpricedHoldings: 2, portfolioValueUsd: null,
      }) }),
    })).resolves.toEqual({ amount: '$1.15', partial: true });
  });

  it('does not turn unknown holdings into a zero balance', async () => {
    await expect(fetchAccountPortfolio(wallet, {
      fetch: fetchResponse({ ok: true, portfolio: portfolio({
        pricedHoldings: 0, unpricedHoldings: 1, pricedValueUsd: '0', portfolioValueUsd: null,
      }) }),
    })).resolves.toEqual({ amount: null, partial: true });
  });

  it('shows actual complete zero', async () => {
    await expect(fetchAccountPortfolio(wallet, {
      fetch: fetchResponse({ ok: true, portfolio: portfolio({
        pricedHoldings: 0, pricedValueUsd: '0', portfolioValueUsd: '0',
      }) }),
    })).resolves.toEqual({ amount: '$0.00', partial: false });
  });

  it.each([
    ['9007199254740993.995', '$9,007,199,254,740,994.00'],
    ['1.005', '$1.01'],
    ['0.00012345', '$0.00012'],
    ['0.009999', '$0.01'],
  ])('formats %s without floating-point conversion', async (value, amount) => {
    await expect(fetchAccountPortfolio(wallet, {
      fetch: fetchResponse({ ok: true, portfolio: portfolio({ pricedValueUsd: value, portfolioValueUsd: value }) }),
    })).resolves.toEqual({ amount, partial: false });
  });

  it('rejects invalid response envelopes and HTTP failures', async () => {
    for (const body of [{}, { ok: false, portfolio: portfolio() }, { ok: true }]) {
      await expect(fetchAccountPortfolio(wallet, { fetch: fetchResponse(body) })).rejects.toThrow('unavailable');
    }
    await expect(fetchAccountPortfolio(wallet, {
      fetch: vi.fn(async () => new Response('', { status: 503 })) as typeof fetch,
    })).rejects.toThrow('unavailable');
  });

  it('rejects oversized responses', async () => {
    await expect(fetchAccountPortfolio(wallet, {
      fetch: vi.fn(async () => new Response(' '.repeat(256 * 1024 + 1))) as typeof fetch,
    })).rejects.toThrow('unavailable');
  });

  it('stops after twelve seconds even when fetch ignores cancellation', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof globalThis.fetch;
    const result = expect(fetchAccountPortfolio(wallet, { fetch })).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(12_000);
    await result;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels when the caller changes identity or unmounts', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(() => new Promise<Response>(() => undefined)) as typeof globalThis.fetch;
    const result = expect(fetchAccountPortfolio(wallet, { fetch, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await result;
  });
});
