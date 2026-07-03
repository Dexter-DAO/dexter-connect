/** Consent-at-birth allowance (Branch rulings 2026-07-02/03).
 *  The user authors the number; zero is not consent; TTL is fixed 30d and
 *  never user-editable; no caller may invent a default. */

export const SESSION_TTL_30D = '2592000';

export interface SpendPolicy {
  /** Role-2 allowance, atomic USDC (6dp), decimal string. User-authored. */
  spendLimitAtomic: string;
  /** Fixed 30d. Present for wire compatibility; always SESSION_TTL_30D. */
  sessionTtlSeconds: string;
}

/** Parse user-entered USD ("5", "$20", "1,000", "20.5") to atomic USDC.
 *  Null on anything invalid — callers must not invent a fallback. */
export function usdToAtomic(input: string): bigint | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  try {
    return BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
  } catch {
    return null;
  }
}

/** Null when invalid or zero (zero is not consent). */
export function authoredPolicy(usdInput: string): SpendPolicy | null {
  const atomic = usdToAtomic(usdInput);
  if (atomic === null || atomic <= 0n) return null;
  return { spendLimitAtomic: atomic.toString(), sessionTtlSeconds: SESSION_TTL_30D };
}
