// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAccountPortfolio, type AccountPortfolio } from './accountPortfolio';
import { useAccountPortfolio, type UseAccountPortfolio } from './useAccountPortfolio';
import type { DexterWalletView } from './useDexterConnection';
import { render, type RenderHandle } from './testRender';

vi.mock('./accountPortfolio', () => ({ fetchAccountPortfolio: vi.fn() }));
const read = vi.mocked(fetchAccountPortfolio);
const wallet: DexterWalletView = {
  userHandle: 'AAAAAAAAAAAAAAAAAAAAAA', label: 'First account',
  vaultPda: 'EfPoo4wWgxKVToit7yX5VtXXBrhao4G8L7vrbKy6pump',
  walletAddress: '11111111111111111111111111111111',
  swigAddress: '11111111111111111111111111111111',
  receiveAddress: 'So11111111111111111111111111111111111111112', network: 'solana-mainnet',
};
let latest: UseAccountPortfolio;
let renders: Array<{ handle: string | null; amount: string | null; loading: boolean }>;
let mounted: RenderHandle | null;

function Probe({ selected }: { selected: DexterWalletView | null }) {
  latest = useAccountPortfolio(selected);
  renders.push({ handle: selected?.userHandle ?? null, amount: latest.amount, loading: latest.loading });
  return <output>{latest.amount ?? (latest.loading ? 'loading' : 'unavailable')}</output>;
}

function deferred() {
  let resolve!: (value: AccountPortfolio) => void;
  const promise = new Promise<AccountPortfolio>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { read.mockReset(); renders = []; mounted = null; });
afterEach(async () => { await mounted?.unmount(); });

describe('useAccountPortfolio', () => {
  it('reads the selected account and shows the result', async () => {
    read.mockResolvedValue({ amount: '$1.15', partial: false });
    mounted = await render(<Probe selected={wallet}/>);
    expect(latest).toMatchObject({ amount: '$1.15', partial: false, loading: false });
    expect(read).toHaveBeenCalledWith(wallet, { signal: expect.any(AbortSignal) });
  });

  it('makes no request without an eligible active account', async () => {
    mounted = await render(<Probe selected={null}/>);
    expect(read).not.toHaveBeenCalled();
    expect(latest).toMatchObject({ amount: null, partial: false, loading: false });
  });

  it('clears a previous balance during the first render of a different selected account', async () => {
    const next = deferred();
    read.mockResolvedValueOnce({ amount: '$1.15', partial: false }).mockReturnValueOnce(next.promise);
    mounted = await render(<Probe selected={wallet}/>);
    const second = { ...wallet, userHandle: 'AQEBAQEBAQEBAQEBAQEBAQ', vaultPda: wallet.receiveAddress };
    await mounted.rerender(<Probe selected={second}/>);
    expect(renders.filter((x) => x.handle === second.userHandle).every((x) => x.amount === null)).toBe(true);
    await act(async () => next.resolve({ amount: '$4.00', partial: false }));
    expect(latest.amount).toBe('$4.00');
  });

  it('discards a slow previous account response even when the reader ignores abort', async () => {
    const first = deferred();
    const second = deferred();
    read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mounted = await render(<Probe selected={wallet}/>);
    const originalSignal = read.mock.calls[0][1]?.signal;
    await mounted.rerender(<Probe selected={{ ...wallet, userHandle: 'AQEBAQEBAQEBAQEBAQEBAQ' }}/>);
    expect(originalSignal?.aborted).toBe(true);
    await act(async () => second.resolve({ amount: '$4.00', partial: false }));
    await act(async () => first.resolve({ amount: '$999.00', partial: false }));
    expect(latest.amount).toBe('$4.00');
    expect(renders.some((x) => x.amount === '$999.00')).toBe(false);
  });

  it('also clears balances when the receive address changes under the same handle', async () => {
    read.mockResolvedValueOnce({ amount: '$1.15', partial: false })
      .mockReturnValueOnce(new Promise(() => undefined));
    mounted = await render(<Probe selected={wallet}/>);
    renders = [];
    await mounted.rerender(<Probe selected={{ ...wallet, receiveAddress: wallet.vaultPda }}/>);
    expect(renders.every((x) => x.amount === null)).toBe(true);
  });

  it('coalesces refresh clicks while a read is outstanding', async () => {
    const pending = deferred();
    read.mockReturnValue(pending.promise);
    mounted = await render(<Probe selected={wallet}/>);
    const a = latest.refresh();
    const b = latest.refresh();
    expect(a).toBe(b);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ amount: '$0.00', partial: false }));
    expect(latest.amount).toBe('$0.00');
  });

  it('shows unavailable on failure and recovers on refresh', async () => {
    read.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ amount: '$1.15', partial: true });
    mounted = await render(<Probe selected={wallet}/>);
    expect(latest).toMatchObject({ amount: null, partial: false, loading: false });
    await act(async () => latest.refresh());
    expect(latest).toMatchObject({ amount: '$1.15', partial: true, loading: false });
  });

  it('clears displayed balance and aborts when access is removed', async () => {
    read.mockResolvedValue({ amount: '$1.15', partial: false });
    mounted = await render(<Probe selected={wallet}/>);
    await mounted.rerender(<Probe selected={null}/>);
    expect(latest).toMatchObject({ amount: null, partial: false, loading: false });
  });

  it('aborts on unmount and ignores completion after the panel closes', async () => {
    const pending = deferred();
    read.mockReturnValue(pending.promise);
    mounted = await render(<Probe selected={wallet}/>);
    const signal = read.mock.calls[0][1]?.signal;
    await mounted.unmount();
    mounted = null;
    const count = renders.length;
    await act(async () => pending.resolve({ amount: '$9.00', partial: false }));
    expect(signal?.aborted).toBe(true);
    expect(renders).toHaveLength(count);
  });
});
