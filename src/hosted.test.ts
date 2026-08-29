// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const relay = vi.hoisted(() => ({
  passkeyLogin: vi.fn(),
  continueWithDexter: vi.fn(),
}));
const enrollment = vi.hoisted(() => ({ createWallet: vi.fn() }));
const recovery = vi.hoisted(() => ({ recoverWallet: vi.fn() }));

vi.mock('./relay', () => relay);
vi.mock('./enroll', () => enrollment);
vi.mock('./recover', () => recovery);

import {
  DEXTER_HOSTED_CEREMONY_ORIGIN,
  runHostedCeremony,
} from './hosted';

interface HappyWindow extends Window {
  happyDOM?: { setURL(url: string): void };
}

describe('hosted ceremony entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as HappyWindow).happyDOM?.setURL?.(
      `${DEXTER_HOSTED_CEREMONY_ORIGIN}/connect`,
    );
  });

  it('refuses inline credential work outside the Dexter-hosted origin', async () => {
    (window as unknown as HappyWindow).happyDOM?.setURL?.('https://merchant.example/connect');

    await expect(runHostedCeremony({ operation: 'signin' })).rejects.toMatchObject({
      code: 'hosted_ceremony_origin_required',
    });
    expect(relay.passkeyLogin).not.toHaveBeenCalled();
  });

  it('runs sign-in inline against the pinned API without exposing transport controls', async () => {
    const onPhase = vi.fn();
    relay.passkeyLogin.mockResolvedValue({ session: {}, vault: {} });

    await runHostedCeremony({ operation: 'signin', onPhase });

    expect(relay.passkeyLogin).toHaveBeenCalledWith(
      {
        apiBase: 'https://api.dexter.cash',
        transport: 'inline',
      },
      onPhase,
    );
  });

  it('preserves provisional keychain-first continuation and owner-only creation intent', async () => {
    relay.continueWithDexter.mockResolvedValue({ kind: 'needs_choice' });

    await expect(
      runHostedCeremony({
        operation: 'continue',
        walletStore: 'provisional',
        name: 'Branch Wallet',
        agentDelegation: 'deferred',
      }),
    ).resolves.toEqual({ kind: 'needs_choice' });
    expect(relay.continueWithDexter).toHaveBeenCalledWith(
      {
        apiBase: 'https://api.dexter.cash',
        transport: 'inline',
        walletStore: 'provisional',
        name: 'Branch Wallet',
        agentDelegation: 'deferred',
      },
      undefined,
    );
  });

  it('passes only hosted creation inputs to the pinned inline ceremony', async () => {
    const spendPolicy = {
      spendLimitAtomic: '20000000',
      sessionTtlSeconds: '2592000',
    };
    enrollment.createWallet.mockResolvedValue({ handle: 'wallet-handle' });

    await runHostedCeremony({
      operation: 'create',
      name: 'Branch Wallet',
      spendPolicy,
      agentDelegation: 'configure-now',
      walletStore: 'provisional',
    });

    expect(enrollment.createWallet).toHaveBeenCalledWith({
      apiBase: 'https://api.dexter.cash',
      transport: 'inline',
      walletStore: 'provisional',
      name: 'Branch Wallet',
      spendPolicy,
      agentDelegation: 'configure-now',
    });
  });

  it('keeps recovery provisional and forwards immediate-mode intent', async () => {
    recovery.recoverWallet.mockResolvedValue({ ok: false, reason: 'cancelled' });

    await expect(
      runHostedCeremony({
        operation: 'recover',
        preferImmediate: true,
        walletStore: 'provisional',
      }),
    ).resolves.toEqual({ ok: false, reason: 'cancelled' });
    expect(recovery.recoverWallet).toHaveBeenCalledWith({
      apiBase: 'https://api.dexter.cash',
      transport: 'inline',
      walletStore: 'provisional',
      preferImmediate: true,
    });
  });

  it('rejects an adjacent persistence value before any ceremony', async () => {
    await expect(
      runHostedCeremony({
        operation: 'signin',
        walletStore: 'provisionally',
      } as never),
    ).rejects.toMatchObject({ code: 'invalid_wallet_store_mode' });
    expect(relay.passkeyLogin).not.toHaveBeenCalled();
  });

  it('requires an authored policy when agent setup is requested now', async () => {
    await expect(
      runHostedCeremony({
        operation: 'continue',
        agentDelegation: 'configure-now',
      } as never),
    ).rejects.toMatchObject({ code: 'missing_spend_policy' });
    expect(relay.continueWithDexter).not.toHaveBeenCalled();
    expect(enrollment.createWallet).not.toHaveBeenCalled();
  });

  it('rejects a policy when agent setup is deferred', async () => {
    await expect(
      runHostedCeremony({
        operation: 'create',
        agentDelegation: 'deferred',
        spendPolicy: {
          spendLimitAtomic: '20000000',
          sessionTtlSeconds: '2592000',
        },
      } as never),
    ).rejects.toMatchObject({ code: 'conflicting_agent_delegation' });
    expect(relay.continueWithDexter).not.toHaveBeenCalled();
    expect(enrollment.createWallet).not.toHaveBeenCalled();
  });
});
