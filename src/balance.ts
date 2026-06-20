// USDC balance read for the connected chip.
//
// Raw JSON-RPC `getAccountInfo` over `fetch` (zero deps) against Dexter's
// Helius proxy. Mirrors the off-curve-safe decode in dexter-fe
// app/hooks/useVaultBalance.ts: read the SPL token account and decode `amount`
// (u64 LE at offset 64) / 1e6. We `getAccountInfo` a KNOWN ATA (the
// server-resolved `usdcAta`), NOT `getParsedTokenAccountsByOwner` — which our
// own code documents silently returns $0 for the off-curve swig owner.

/**
 * Best-effort USDC balance (human units) of a known token account.
 * - number  → the balance (0 if the ATA doesn't exist yet / unfunded)
 * - null    → unknown (any RPC failure); caller shows wallet-only, never errors.
 */
export async function fetchUsdcBalance(
  rpcUrl: string,
  usdcAta: string,
): Promise<number | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [usdcAta, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: { value?: { data?: [string, string] | string } | null };
    };
    const value = json?.result?.value;
    if (!value || !value.data) return 0; // ATA absent / unfunded
    const b64 = Array.isArray(value.data) ? value.data[0] : value.data;
    const bytes = base64ToBytes(b64);
    if (bytes.length < 72) return 0; // not an SPL token account layout
    return Number(readU64LE(bytes, 64)) / 1e6;
  } catch {
    return null; // best-effort — never throw
  }
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(bytes[offset + i]);
  return v;
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
