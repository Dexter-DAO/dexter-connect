import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchUsdcBalance } from './balance';

/** Build a base64 SPL token account (165 bytes) with `amount` at offset 64 (u64 LE). */
function tokenAccountBase64(atomic: bigint): string {
  const buf = new Uint8Array(165);
  let v = atomic;
  for (let i = 0; i < 8; i += 1) {
    buf[64 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe('fetchUsdcBalance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('decodes the USDC balance from getAccountInfo (amount @ offset 64, /1e6)', async () => {
    const data = tokenAccountBase64(1_500_000n); // $1.50
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ result: { value: { data: [data, 'base64'] } } }) })),
    );
    expect(await fetchUsdcBalance('https://rpc', 'ata')).toBe(1.5);
  });

  it('returns 0 when the ATA does not exist (unfunded)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ result: { value: null } }) })),
    );
    expect(await fetchUsdcBalance('https://rpc', 'ata')).toBe(0);
  });

  it('returns null (best-effort) on RPC failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await fetchUsdcBalance('https://rpc', 'ata')).toBeNull();
  });
});
