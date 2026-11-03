// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, click, keydown, type as typeText, type RenderHandle } from './testRender';
import { DexterAccountControl } from './DexterAccountControl';
import type { UseDexterConnection } from './useDexterConnection';

const credentials = vi.hoisted(() => ({ enroll: vi.fn(), signIn: vi.fn() }));
vi.mock('./accountIdentity', () => ({ enrollAccountIdentity: credentials.enroll, signInAccountIdentity: credentials.signIn }));
const creation = vi.hoisted(() => vi.fn());
vi.mock('./enroll', () => ({ createWallet: creation }));
vi.mock('./popup', () => ({ shouldUsePopup: () => false }));
const balance = vi.hoisted(() => vi.fn(() => ({ amount: '$236.00', loading: false, partial: false, refresh: vi.fn(async () => undefined) })));
vi.mock('./useAccountPortfolio', () => ({ useAccountPortfolio: balance }));
vi.mock('framer-motion', async (original) => ({ ...await original<typeof import('framer-motion')>(), useReducedMotion: () => true }));
let view: RenderHandle | undefined;
afterEach(async () => { await view?.unmount(); view = undefined; vi.clearAllMocks(); vi.unstubAllGlobals(); });

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
function clipboard(writeText: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText }, configurable: true } }));
}

 describe('shared account control', () => {
  it('uses credential ceremonies for the opted-in guest header and preserves the wallet action', async () => {
    const c = connection(), access = { signedIn: false, loading: false, accept: vi.fn(), clear: vi.fn() };
    const result = { profile: 'account-identity-v1' };
    credentials.signIn.mockResolvedValue(result); credentials.enroll.mockResolvedValue(result);
    view = await render(<DexterAccountControl connection={c} credentialAccess={access}/>);
    await open(); await click(button('Sign in with Dexter'));
    expect(access.accept).toHaveBeenCalledWith(result);
    await open(); await click(button('Create an account')); await click(button('Create my account'));
    expect(credentials.enroll).toHaveBeenCalledOnce();
    expect(access.accept).toHaveBeenCalledTimes(2);
    expect(creation).not.toHaveBeenCalled(); expect(c.connect).not.toHaveBeenCalled();
    await open(); await click(button('Use an existing wallet'));
    expect(c.connect).toHaveBeenCalledOnce();
  });
  it('exposes no wallet summary to an identity-only person and signs out of that profile', async () => {
    const c = connection(), access = { signedIn: true, loading: false, accept: vi.fn(), clear: vi.fn() };
    view = await render(<DexterAccountControl connection={c} credentialAccess={access}/>);
    await open();
    expect(view.container.textContent).toContain('signed in with your passkey');
    expect(balance).not.toHaveBeenCalled();
    expect(view.container.querySelector('a[href*="wallet"]')).toBeNull();
    await click(button('Sign out'));
    expect(access.clear).toHaveBeenCalledOnce(); expect(c.disconnectDexter).not.toHaveBeenCalled();
  });

  it('ships its marks and styling without site asset paths, with one guest panel brand', async () => {
    const c = connection();
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    expect(view.container.querySelector('.dx-account-identity svg')).not.toBeNull();
    expect(button('Sign in with Dexter').querySelector('svg')).toBeNull();
    expect(view.container.querySelector('[src^="/assets"]')).toBeNull();
    expect(view.container.querySelector('style')?.textContent).toContain('.dx-account-panel');
    expect(button('Create an account')).toBeTruthy();
    await click(button('Sign in with Dexter'));
    expect(c.connect).toHaveBeenCalledTimes(1);
    expect(button('Open Dexter account').getAttribute('aria-expanded')).toBe('false');
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

  it('opens the selected wallet from the account name using the host link adapter', async () => {
    const c = connection(true);
    view = await render(<DexterAccountControl connection={c} LinkComponent={props => <a {...props} data-host-link="true"/>}/>);
    await open();
    const link = view.container.querySelector('h3 a')!;
    expect(link.textContent).toBe('BranchWallet');
    expect(link.getAttribute('data-host-link')).toBe('true');
    expect(link.getAttribute('href')).toBe('https://dexter.cash/wallet?section=money&dexter_account=AAAAAAAAAAAAAAAAAAAAAA');
    await click(link);
    expect(button('Open Dexter account').getAttribute('aria-expanded')).toBe('false');
  });

  it('copies the receive address and reports success only after the clipboard accepts it', async () => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    clipboard(writeText);
    const c = connection(true);
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    expect(button('Copy receive address').textContent).toContain('So11…1112');
    await click(button('Copy receive address'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(c.activeWallet!.receiveAddress);
    expect(writeText).not.toHaveBeenCalledWith(c.activeWallet!.walletAddress);
    expect(button('Copy receive address').disabled).toBe(true);
    expect(view.container.textContent).not.toContain('Copied');
    await act(async () => finish());
    expect(view.container.querySelector('.dx-account-copyFeedback')?.textContent).toBe('Copied');
    expect(button('Copy receive address').disabled).toBe(false);
  });

  it.each(['switch', 'disconnect', 'verification loss'])('ignores an old clipboard completion after %s', async change => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    clipboard(writeText);
    const c = connection(true);
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    await click(button('Copy receive address'));
    let next = connection();
    if (change === 'switch') next = {
      ...c,
      identity: { ...c.identity, userHandle: 'BBBBBBBBBBBBBBBBBBBBBB', walletLabel: 'Other account' },
      activeWallet: { ...c.activeWallet!, userHandle: 'BBBBBBBBBBBBBBBBBBBBBB', receiveAddress: 'SysvarRent111111111111111111111111111111111' },
    };
    if (change === 'verification loss') next = { ...c, model: { ...c.model, stage: 'checking', permissions: connection().model.permissions } };
    await view!.rerender(<DexterAccountControl connection={next}/>);
    await act(async () => finish());
    expect(view!.container.textContent).not.toContain('Copied');
    if (change === 'switch') {
      expect(button('Copy receive address').title).toBe(next.activeWallet!.receiveAddress);
      expect(view!.container.querySelector('h3 a')?.getAttribute('href')).toContain('dexter_account=BBBBBBBBBBBBBBBBBBBBBB');
      expect(button('Copy receive address').disabled).toBe(false);
    } else {
      expect(view!.container.querySelector('.dx-account-copy')).toBeNull();
      expect(view!.container.querySelector('h3 a')).toBeNull();
    }
  });

  it.each(['Switch account', 'Disconnect Dexter'])('withdraws wallet header actions during %s', async action => {
    const c = connection(true);
    let finish!: () => void;
    if (action === 'Switch account') c.useAnotherDexterWallet = vi.fn(() => new Promise<Awaited<ReturnType<UseDexterConnection['useAnotherDexterWallet']>>>(resolve => { finish = () => resolve({} as never); }));
    else c.disconnectDexter = vi.fn(() => new Promise<boolean>(resolve => { finish = () => resolve(true); }));
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    await click(button('Account settings'));
    await click(button(action));
    expect(view.container.querySelector('.dx-account-copy')).toBeNull();
    expect(view.container.querySelector('h3 a')).toBeNull();
    await act(async () => finish());
  });

  it('keeps clipboard failure distinct from success and lets the user retry', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    clipboard(writeText);
    view = await render(<DexterAccountControl connection={connection(true)}/>);
    await open();
    await click(button('Copy receive address'));
    expect(view.container.querySelector('.dx-account-copyFeedback')?.textContent).toBe('Copy failed. Try again.');
    expect(view.container.textContent).not.toContain('Copied');
    expect(button('Copy receive address').disabled).toBe(false);
    await click(button('Copy receive address'));
    expect(view.container.querySelector('.dx-account-copyFeedback')?.textContent).toBe('Copied');
  });

  it('reports an unavailable clipboard without claiming the address was copied', async () => {
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: undefined, configurable: true } }));
    view = await render(<DexterAccountControl connection={connection(true)}/>);
    await open();
    await click(button('Copy receive address'));
    expect(view.container.querySelector('.dx-account-copyFeedback')?.textContent).toBe('Copy failed. Try again.');
    expect(view.container.textContent).not.toContain('Copied');
  });

  it('never substitutes the control address when the receive address is absent', async () => {
    const c = connection(true);
    view = await render(<DexterAccountControl connection={{ ...c, activeWallet: { ...c.activeWallet!, receiveAddress: null } }}/>);
    await open();
    expect(view.container.querySelector('.dx-account-copy')).toBeNull();
    expect(view.container.querySelector('h3 a')).not.toBeNull();
  });

  it('shows welcome only on creation and returns to entry without starting a ceremony', async () => {
    const c = connection();
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    expect(view.container.querySelector('h2')).toBeNull();
    await click(button('Create an account'));
    const heading = view.container.querySelector('h2')!;
    expect(heading.textContent).toBe('Welcome to Dexter');
    expect(view.container.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(document.activeElement).toBe(heading);
    const create = button('Create my account');
    expect(document.getElementById(create.getAttribute('aria-describedby')!)?.textContent).toBe('Your device will ask for a passkey.');
    expect(view.container.querySelector('details')?.open).toBe(false);
    await click(button('Sign in instead'));
    expect(document.activeElement).toBe(button('Sign in with Dexter'));
    await click(button('Create an account'));
    await click(button('Close'));
    expect(document.activeElement).toBe(button('Open Dexter account'));
    expect(creation).not.toHaveBeenCalled();
    expect(c.connect).not.toHaveBeenCalled();
  });

  it.each([false, true])('leaves the next focus or reopened menu alone after late sign-in (reopen=%s)', async reopen => {
    let finish!: () => void;
    const c = connection();
    c.connect = vi.fn(() => new Promise<Awaited<ReturnType<typeof c.connect>>>(resolve => { finish = () => resolve({} as never); }));
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    await click(button('Sign in with Dexter'));
    const field = document.createElement('input');
    view.container.append(field);
    await act(async () => field.focus());
    expect(button('Open Dexter account').getAttribute('aria-expanded')).toBe('false');
    if (reopen) await open();
    await act(async () => finish());
    if (reopen) expect(button('Close Dexter account').getAttribute('aria-expanded')).toBe('true');
    else expect(document.activeElement).toBe(field);
  });

  it('finishes a newly created account through its targeted host sign-in', async () => {
    const handle = 'AAAAAAAAAAAAAAAAAAAAAA';
    creation.mockResolvedValue({ handle, vault: { userHandle: handle } });
    const c = connection();
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    await click(button('Create an account'));
    await click(view.container.querySelector('summary'));
    await typeText(view.container.querySelector('input'), 'Branch');
    await click(button('Create my account'));
    expect(creation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Branch', agentDelegation: 'deferred', spendPolicy: undefined }));
    await click(button('Finish signing in'));
    expect(c.connect).toHaveBeenCalledExactlyOnceWith({ userHandle: handle });
  });

  it.each(['Switch account', 'Disconnect Dexter'])('clears unfinished creation after %s', async action => {
    const handle = 'AAAAAAAAAAAAAAAAAAAAAA';
    creation.mockResolvedValue({ handle, vault: { userHandle: handle } });
    const c = connection();
    view = await render(<DexterAccountControl connection={c}/>);
    await open();
    await click(button('Create an account'));
    await click(button('Create my account'));
    const ready = connection(true);
    const walletOnly = { ...ready, model: { ...ready.model, permissions: { ...ready.model.permissions, accountContentVisible: false } } };
    await view.rerender(<DexterAccountControl connection={walletOnly}/>);
    expect(button('Finish signing in')).toBeTruthy();
    await click(button('Account settings'));
    await click(button(action));
    await view.rerender(<DexterAccountControl connection={connection()}/>);
    if (action === 'Disconnect Dexter') await open();
    expect(view.container.textContent).not.toContain('Finish signing in');
  });

  it('lets a wallet-only connection finish host sign-in with its exact account', async () => {
    const ready = connection(true);
    const walletOnly = { ...ready, model: { ...ready.model, permissions: { ...ready.model.permissions, accountContentVisible: false } } };
    view = await render(<DexterAccountControl connection={walletOnly}/>);
    await open();
    await click(button('Account settings'));
    await click(button('Sign in to this app'));
    expect(walletOnly.connect).toHaveBeenCalledExactlyOnceWith({ userHandle: 'AAAAAAAAAAAAAAAAAAAAAA' });
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
    expect(view.container.querySelector('h3 a')?.getAttribute('href')).toBe('/money');
    expect(view.container.querySelector('a[href$="/withdraw"]')).toBeNull();
    expect(view.container.querySelector('a[href$="/profile"]')).toBeNull();
    await view.rerender(<DexterAccountControl connection={connection(true)} navigation={{ money: false }}/>);
    expect(view.container.querySelector('h3 a')).toBeNull();
  });

  it('can use a host portfolio reader without making a second SDK request', async () => {
    view = await render(<DexterAccountControl connection={connection(true)} renderSummary={()=><div>Host balance</div>}/>);
    await open();
    expect(view.container.textContent).toContain('Host balance');
    expect(balance).not.toHaveBeenCalled();
    expect(view.container.querySelector('h3 a')?.getAttribute('href')).toContain('dexter_account=AAAAAAAAAAAAAAAAAAAAAA');
    expect(button('Copy receive address').title).toBe(connection(true).activeWallet!.receiveAddress);
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
