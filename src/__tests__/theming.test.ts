// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureDexterButtonStyles } from '../DexterButton';
import { ensureWalletKitStyles } from '../walletKitStyles';
import { ensureConsentStyles } from '../consentStyles';

// Injected-style contract: components must CONSUME tokens with fallbacks
// (var(--dx-x, default)) and never DECLARE them on their own class — a
// self-declared custom property beats an ancestor override, which breaks
// the documented "theme from any ancestor" contract.
function styleText(id: string): string {
  return document.getElementById(id)?.textContent ?? '';
}

describe('dx-* theming contract', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    // ensure* checks for its style id and re-injects when absent — the head
    // was just cleared above, so these run against a clean slate every time.
    ensureDexterButtonStyles();
    ensureWalletKitStyles();
    ensureConsentStyles();
  });

  it('never declares --dx tokens on component classes', () => {
    const all =
      styleText('dexter-connect-button-styles') +
      styleText('dexter-connect-wallet-kit-styles') +
      styleText('dexter-connect-consent-styles');
    expect(all).not.toMatch(/--dx-(ember|ember-2|fg|radius|danger)\s*:/);
  });

  it('consumes every token with a fallback', () => {
    const all =
      styleText('dexter-connect-button-styles') +
      styleText('dexter-connect-wallet-kit-styles') +
      styleText('dexter-connect-consent-styles');
    expect(all).toMatch(/var\(--dx-ember\s*,\s*#f26c18\)/);
    expect(all).toMatch(/var\(--dx-ember-2\s*,\s*#ba3a00\)/);
    expect(all).toMatch(/var\(--dx-fg\s*,\s*#fff4ea\)/);
    expect(all).toMatch(/var\(--dx-radius\s*,\s*0px?\)/);
    expect(all).toMatch(/var\(--dx-danger\s*,\s*#e5552e\)/);
    expect(all).not.toMatch(/var\(--dx-ember\)[^,]/); // no bare consumption left
  });
});
