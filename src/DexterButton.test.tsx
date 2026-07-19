// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';

import { DexterButton, ensureDexterButtonStyles } from './DexterButton';
import { render } from './testRender';

function btn(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector('button.dx-btn');
  if (!el) throw new Error('dx-btn not found');
  return el as HTMLButtonElement;
}

describe('DexterButton size variant', () => {
  it('defaults to md — no sm class', async () => {
    const { container } = await render(<DexterButton>Sign in with Dexter</DexterButton>);
    expect(btn(container).classList.contains('dx-btn--sm')).toBe(false);
  });

  it("size='sm' applies the mini class alongside variant/block", async () => {
    const { container } = await render(
      <DexterButton size="sm" variant="secondary" block>
        Sign in with Dexter
      </DexterButton>,
    );
    const el = btn(container);
    expect(el.classList.contains('dx-btn--sm')).toBe(true);
    expect(el.classList.contains('dx-btn--secondary')).toBe(true);
    expect(el.classList.contains('dx-btn--block')).toBe(true);
  });

  it('injected CSS carries the sm rules (padding + scaled mark)', () => {
    ensureDexterButtonStyles();
    const css = document.getElementById('dexter-connect-button-styles')?.textContent ?? '';
    expect(css).toContain('.dx-btn--sm{');
    expect(css).toContain('.dx-btn--sm .dx-btn__mark');
  });
});
