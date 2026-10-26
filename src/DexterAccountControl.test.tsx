// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, click, keydown, type RenderHandle } from './testRender';
import { DexterAccountControl } from './DexterAccountControl';
import type { UseDexterConnection } from './useDexterConnection';

const balance = vi.hoisted(() => vi.fn(() => ({ amount: '$236.00', loading: false, partial: false, refresh: vi.fn(async () => undefined) })));
vi.mock('./useAccountPortfolio', () => ({ useAccountPortfolio: balance }));
vi.mock('framer-motion', async (original) => ({ ...await original<typeof import('framer-motion')>(), useReducedMotion: () => true }));
let view: RenderHandle | undefined;
afterEach(async () => { await view?.unmount(); view = undefined; vi.clearAllMocks(); });

function connection(ready = false): UseDexterConnection {
  return {
    model: { intent: 'wallet', stage: ready ? 'ready' : 'connect', primaryAction: ready ? 'use_another_wallet' : 'connect', permissions: {
      capabilities: [], walletIdentityVisible: ready, walletDataVisible: ready, ownerWalletUseEnabled: ready, accountContentVisible: ready, agentAuthorityVisible: false,
    } },
    identity: { kind: ready ? 'bound' : 'none', userHandle: ready ? 'AAAAAAAAAAAAAAAAAAAAAA' : null, walletLabel: ready ? 'BranchWallet' : null,
      hasWallet: ready, hasPasskeyVault: ready, hasAccount: ready, hasAccountAccess: ready, quarantined: false },
    relation: {} as UseDexterConnection['relation'], operation: 'idle', error: null,
    activeWallet: ready ? { userHandle: 'AAAAAAAAAAAAAAAAAAAAAA', label: 'BranchWallet', vaultPda: '11111111111111111111111111111111', swigAddress: null,
      walletAddress: '11111111111111111111111111111111', receiveAddress: 'So11111111111111111111111111111111111111112', network: 'solana-mainnet' } : null,
    connect: vi.fn(), useAnotherDexterWallet: vi.fn(), retry: vi.fn(), disconnectDexter: vi.fn(), removeFromThisDevice: vi.fn(),
  };
}
function button(label: string): HTMLButtonElement {
  const found = Array.from(view!.container.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function open() { await click(button('Open Dexter account')); }

 describe('shared account control', () => {
  it('ships its marks and styling without site asset paths, with one guest panel brand', async () => {
    const c = connection();
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    expect(view.container.querySelector('.dx-account-identity svg')).not.toBeNull();
    expect(button('Sign in with Dexter').querySelector('svg')).toBeNull();
    expect(view.container.querySelector('[src^="/assets"]')).toBeNull();
    expect(view.container.querySelector('style')?.textContent).toContain('.dx-account-panel');
    expect(button('Create account')).toBeTruthy();
    await click(button('Sign in with Dexter'));
    expect(c.connect).toHaveBeenCalledTimes(1);
    expect(balance).not.toHaveBeenCalled();
  });

  it('provides balance and money actions by default and keeps connection actions under the gear', async () => {
    const c = connection(true);
    view = await render(<DexterAccountControl connection={c}/>);
    expect(balance).not.toHaveBeenCalled();
    await open();
    expect(view.container.textContent).toContain('$236.00');
    expect(view.container.querySelector('a[href^="https://dexter.cash/wallet/withdraw?"]')?.textContent).toBe('Send');
    expect(view.container.querySelector('a[href^="https://dexter.cash/wallet/withdraw?"]')?.getAttribute('href')).toContain('dexter_account=AAAAAAAAAAAAAAAAAAAAAA');
    expect(view.container.querySelector('a[href^="https://dexter.cash/wallet/deposit?"]')?.textContent).toBe('Receive');
    expect(view.container.textContent).not.toContain('Switch account');
    await click(button('Account settings'));
    await click(button('Switch account'));
    expect(c.useAnotherDexterWallet).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).not.toMatch(/remove|forget|eject/i);
    await click(button('Disconnect Dexter'));
    expect(c.disconnectDexter).toHaveBeenCalledTimes(1);
    expect(c.removeFromThisDevice).not.toHaveBeenCalled();
  });

  it('withdraws private data when verification is lost, even with retained profile and menu items', async () => {
    const c = connection(true);
    const props = { profile: { name: 'Owner', email: 'private@example.com' }, items: [{ id:'seller', label:'Your servers', href:'/origins', requires:'account' as const }] };
    view = await render(<DexterAccountControl connection={c} {...props}/>);
    await open();
    expect(view.container.textContent).toContain('Your servers');
    const guest = connection();
    const checking: UseDexterConnection = { ...guest, model: { ...guest.model, stage: 'checking' } };
    await view.rerender(<DexterAccountControl connection={checking} {...props}/>);
    expect(view.container.textContent).not.toContain('$236.00');
    expect(view.container.textContent).not.toContain('private@example.com');
    expect(view.container.textContent).not.toContain('Your servers');
    expect(view.container.textContent).toContain('Checking your connection...');
  });

  it('uses configured app destinations and supports disabling hosted links', async () => {
    view = await render(<DexterAccountControl connection={connection(true)} navigation={{ money: {href:'/money'}, send:false, profile:false }} />);
    await open();
    expect(view.container.querySelector('a[href="/money"]')).not.toBeNull();
    expect(view.container.querySelector('a[href$="/withdraw"]')).toBeNull();
    expect(view.container.querySelector('a[href$="/profile"]')).toBeNull();
  });

  it('can use a host portfolio reader without making a second SDK request', async () => {
    view = await render(<DexterAccountControl connection={connection(true)} renderSummary={()=><div>Host balance</div>}/>);
    await open();
    expect(view.container.textContent).toContain('Host balance');
    expect(balance).not.toHaveBeenCalled();
  });

  it('has instance-specific IDs and restores focus after Escape', async () => {
    view = await render(<><DexterAccountControl connection={connection()}/><DexterAccountControl connection={connection()}/></>);
    const triggers = Array.from(view.container.querySelectorAll('button'));
    expect(triggers[0].getAttribute('aria-controls')).not.toBe(triggers[1].getAttribute('aria-controls'));
    await click(triggers[0]);
    await act(async () => button('Sign in with Dexter').focus());
    await keydown(window.document.body, 'Escape');
    expect(document.activeElement).toBe(triggers[0]);
  });
});
