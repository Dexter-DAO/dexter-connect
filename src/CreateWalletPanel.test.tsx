// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the create ceremony so gating/flow can be driven deterministically.
const createWallet = vi.fn();
vi.mock('./enroll', () => ({ createWallet: (cfg: unknown) => createWallet(cfg) }));

import { CreateWalletPanel } from './CreateWalletPanel';
import { ConnectError } from './types';
import type { CreateWalletResult } from './enroll';
import { render, click, type, flush } from './testRender';

function cta(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector('button.dx-cwp__cta');
  if (!btn) throw new Error('CTA button not found');
  return btn as HTMLButtonElement;
}
function radio(container: HTMLElement, label: string): HTMLElement {
  const el = Array.from(container.querySelectorAll('[role="radio"]')).find(
    (c) => (c.textContent ?? '').trim().toUpperCase() === label.toUpperCase(),
  );
  if (!el) throw new Error(`chip "${label}" not found`);
  return el as HTMLElement;
}

const OK: CreateWalletResult = {
  handle: 'h',
  credentialId: 'c',
  vault: {
    vaultPda: 'v',
    swigAddress: 's',
    receiveAddress: null,
    usdcAta: null,
    publicKey: 'p',
    userHandle: 'h',
    credentialId: 'c',
  },
};

beforeEach(() => {
  createWallet.mockReset();
});

describe('CreateWalletPanel — gating (the money perimeter)', () => {
  it('CTA is disabled until an allowance is authored (none selected initially)', async () => {
    const { container } = await render(<CreateWalletPanel />);
    expect(cta(container).textContent).toMatch(/Create your Dexter Wallet/i);
    expect(cta(container).disabled).toBe(true);
  });

  it('zero is not consent: custom "0" leaves the CTA disabled', async () => {
    const { container } = await render(<CreateWalletPanel />);
    await click(radio(container, 'Custom'));
    await type(container.querySelector('input[inputmode="decimal"]'), '0');
    expect(cta(container).disabled).toBe(true);
  });

  it('a valid authored amount enables the CTA', async () => {
    const { container } = await render(<CreateWalletPanel />);
    await click(radio(container, '$20'));
    expect(cta(container).disabled).toBe(false);
  });
});

describe('CreateWalletPanel — composition', () => {
  it('renders the name field (default), the spend label, and the fine print', async () => {
    const { container } = await render(<CreateWalletPanel />);
    expect(container.textContent).toContain('Name your wallet');
    expect(container.textContent).toContain('What agents may spend, per 30 days');
    expect(container.textContent).toContain(
      'Agents can never spend past it, and you can revoke anytime.',
    );
    const name = container.querySelector('input[maxlength="40"]') as HTMLInputElement | null;
    expect(name).not.toBeNull();
    expect(name!.getAttribute('placeholder')).toBe('Dexter Wallet');
  });

  it('hides the name field when showName is false', async () => {
    const { container } = await render(<CreateWalletPanel showName={false} />);
    expect(container.textContent).not.toContain('Name your wallet');
  });
});

describe('CreateWalletPanel — ceremony flow', () => {
  it('calls createWallet with the authored policy + trimmed name and fires onCreated', async () => {
    createWallet.mockResolvedValue(OK);
    const onCreated = vi.fn();
    const { container } = await render(
      <CreateWalletPanel onCreated={onCreated} apiBase="https://api.test" transport="inline" />,
    );
    await type(container.querySelector('input[maxlength="40"]'), '  My Wallet  ');
    await click(radio(container, '$20'));
    await click(cta(container));
    await flush();

    expect(createWallet).toHaveBeenCalledTimes(1);
    const arg = createWallet.mock.calls[0][0];
    expect(arg.name).toBe('My Wallet');
    expect(arg.spendPolicy).toEqual({ spendLimitAtomic: '20000000', sessionTtlSeconds: '2592000' });
    expect(arg.apiBase).toBe('https://api.test');
    expect(arg.transport).toBe('inline');
    expect(onCreated).toHaveBeenCalledWith(OK);
  });

  it('defaults the name to "Dexter Wallet" when blank', async () => {
    createWallet.mockResolvedValue(OK);
    const { container } = await render(<CreateWalletPanel />);
    await click(radio(container, '$5'));
    await click(cta(container));
    await flush();
    expect(createWallet.mock.calls[0][0].name).toBe('Dexter Wallet');
  });

  it('surfaces a ConnectError inline + via onError, then offers Retry (state preserved)', async () => {
    createWallet.mockRejectedValue(new ConnectError('initialize_failed', 'boom'));
    const onError = vi.fn();
    const { container } = await render(<CreateWalletPanel onError={onError} />);
    await click(radio(container, '$20'));
    await click(cta(container));
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as ConnectError).code).toBe('initialize_failed');
    expect(cta(container).textContent).toMatch(/Retry/i);
    expect(cta(container).disabled).toBe(false);
    // authored state preserved
    expect(radio(container, '$20').getAttribute('aria-checked')).toBe('true');
    // an inline error node exists
    const err = container.querySelector('[role="alert"], .dx-cwp__err');
    expect(err).not.toBeNull();
    expect((err!.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('ignores clicks while a ceremony is already in flight (busy guard)', async () => {
    let resolve!: (r: CreateWalletResult) => void;
    createWallet.mockImplementation(() => new Promise<CreateWalletResult>((r) => (resolve = r)));
    const { container } = await render(<CreateWalletPanel />);
    await click(radio(container, '$20'));
    await click(cta(container)); // starts ceremony
    await click(cta(container)); // should be ignored (disabled/loading)
    expect(createWallet).toHaveBeenCalledTimes(1);
    resolve(OK);
    await flush();
  });
});
