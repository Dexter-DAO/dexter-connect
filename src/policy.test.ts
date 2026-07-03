import { describe, it, expect } from 'vitest';
import { usdToAtomic, authoredPolicy, SESSION_TTL_30D } from './policy';

describe('usdToAtomic', () => {
  it('parses whole dollars', () => {
    expect(usdToAtomic('5')).toBe(5_000_000n);
    expect(usdToAtomic('50')).toBe(50_000_000n);
  });
  it('accepts $ prefix, commas, and up to 6 decimals', () => {
    expect(usdToAtomic('$20')).toBe(20_000_000n);
    expect(usdToAtomic('1,000')).toBe(1_000_000_000n);
    expect(usdToAtomic('20.5')).toBe(20_500_000n);
    expect(usdToAtomic('0.000001')).toBe(1n);
  });
  it('rejects garbage, negatives, and >6dp', () => {
    expect(usdToAtomic('abc')).toBeNull();
    expect(usdToAtomic('-5')).toBeNull();
    expect(usdToAtomic('1.0000001')).toBeNull();
    expect(usdToAtomic('')).toBeNull();
  });
  it('is exact at magnitudes where float math diverges', () => {
    expect(usdToAtomic('9999999999.999999')).toBe(9_999_999_999_999_999n);
    expect(usdToAtomic('999999999999.999999')).toBe(999_999_999_999_999_999n);
  });
});

describe('authoredPolicy', () => {
  it('builds a policy with the fixed 30d TTL', () => {
    const p = authoredPolicy('20');
    expect(p).not.toBeNull();
    expect(p!.spendLimitAtomic).toBe('20000000');
    expect(p!.sessionTtlSeconds).toBe(SESSION_TTL_30D);
  });
  it('rejects zero and invalid amounts (no invented defaults)', () => {
    expect(authoredPolicy('0')).toBeNull();
    expect(authoredPolicy('nope')).toBeNull();
  });
  it('always stamps the fixed 30d TTL (2592000), never user-editable', () => {
    expect(authoredPolicy('5')!.sessionTtlSeconds).toBe('2592000');
    expect(SESSION_TTL_30D).toBe('2592000');
  });
});
