// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';

import { DexterWalletMenu } from '../DexterWalletMenu';
import { render } from '../testRender';

describe('DexterWalletMenu — startFreshLabel', () => {
  it('defaults the eject row to "Eject wallet" (the old "Start fresh" label is gone)', async () => {
    const { container } = await render(
      <DexterWalletMenu walletLabel="Test" onStartFresh={() => {}} />,
    );
    expect(container.textContent).toContain('Eject wallet');
    expect(container.textContent).not.toContain('Start fresh');
  });

  it('renders a custom startFreshLabel when provided', async () => {
    const { container } = await render(
      <DexterWalletMenu
        walletLabel="Test"
        onStartFresh={() => {}}
        startFreshLabel="Remove from this device"
      />,
    );
    expect(container.textContent).toContain('Remove from this device');
    expect(container.textContent).not.toContain('Eject wallet');
  });
});
