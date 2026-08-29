import { describe, expect, it, vi } from 'vitest';

import {
  WalletAccountRelationController,
  type ServerRelationVerificationResult,
} from './relationController';

interface WalletCandidate {
  handle: string;
  vaultPda: string;
  proof: string;
}

interface AccountCandidate {
  session: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wallet(name: string): WalletCandidate {
  return { handle: `handle-${name}`, vaultPda: `vault-${name}`, proof: `proof-${name}` };
}

function account(name: string): AccountCandidate {
  return { session: `session-${name}` };
}

describe('WalletAccountRelationController', () => {
  it('starts hydrating with every private capability withheld', () => {
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(),
    });

    expect(controller.getSnapshot()).toMatchObject({
      relation: 'none',
      runtime: { phase: 'hydrating' },
      walletPresent: false,
      accountPresent: false,
      privateAccountAccess: false,
      quarantined: false,
      verifiedAt: null,
    });
  });

  it.each([
    [{ wallet: null, account: null }, 'none'],
    [{ wallet: wallet('a'), account: null }, 'wallet_only'],
    [{ wallet: null, account: account('a') }, 'account_only'],
  ] as const)('restores a single local axis as %s without calling the verifier', async (candidates, relation) => {
    const verify = vi.fn();
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({ verify });

    await controller.restore(candidates);

    expect(controller.getSnapshot()).toMatchObject({
      relation,
      runtime: { phase: 'ready' },
      privateAccountAccess: false,
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps a restored pair provisional until server verification returns bound', async () => {
    const result = deferred<ServerRelationVerificationResult>();
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(() => result.promise),
      now: () => 1234,
    });

    const restoring = controller.restore({ wallet: wallet('a'), account: account('a') });
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'checking', reason: 'restore' },
      walletPresent: true,
      accountPresent: true,
      privateAccountAccess: false,
      verifiedAt: null,
    });

    result.resolve({ ok: true, relation: 'bound' });
    await restoring;

    expect(controller.getSnapshot()).toMatchObject({
      relation: 'bound',
      runtime: { phase: 'ready' },
      privateAccountAccess: true,
      quarantined: false,
      verifiedAt: 1234,
    });
  });

  it('returns to hydrating immediately when the host account session reloads', async () => {
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(async () => ({ ok: true as const, relation: 'bound' as const })),
    });
    await controller.restore({ wallet: wallet('a'), account: account('a') });
    expect(controller.getSnapshot().privateAccountAccess).toBe(true);

    controller.beginRestore();

    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'hydrating' },
      walletPresent: true,
      accountPresent: true,
      privateAccountAccess: false,
      verifiedAt: null,
    });
  });

  it('invalidates a bound relation synchronously when the Wallet changes', async () => {
    const checks: Array<ReturnType<typeof deferred<ServerRelationVerificationResult>>> = [];
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(() => {
        const check = deferred<ServerRelationVerificationResult>();
        checks.push(check);
        return check.promise;
      }),
    });

    const restored = controller.restore({ wallet: wallet('a'), account: account('a') });
    checks[0].resolve({ ok: true, relation: 'bound' });
    await restored;
    expect(controller.getSnapshot().privateAccountAccess).toBe(true);

    const switching = controller.setWallet(wallet('b'));
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'checking', reason: 'wallet_change' },
      privateAccountAccess: false,
      verifiedAt: null,
    });

    checks[1].resolve({ ok: true, relation: 'bound' });
    await switching;
    expect(controller.getSnapshot().privateAccountAccess).toBe(true);
  });

  it('invalidates a bound relation synchronously when the account changes', async () => {
    const checks: Array<ReturnType<typeof deferred<ServerRelationVerificationResult>>> = [];
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(() => {
        const check = deferred<ServerRelationVerificationResult>();
        checks.push(check);
        return check.promise;
      }),
    });

    const restored = controller.restore({ wallet: wallet('a'), account: account('a') });
    checks[0].resolve({ ok: true, relation: 'bound' });
    await restored;

    const switching = controller.setAccount(account('b'));
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'checking', reason: 'account_change' },
      privateAccountAccess: false,
    });

    checks[1].resolve({ ok: true, relation: 'conflict' });
    await switching;
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'conflict',
      runtime: { phase: 'ready' },
      privateAccountAccess: false,
      quarantined: true,
    });
  });

  it('discards an older check after a newer Wallet event', async () => {
    const checks: Array<ReturnType<typeof deferred<ServerRelationVerificationResult>>> = [];
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(() => {
        const check = deferred<ServerRelationVerificationResult>();
        checks.push(check);
        return check.promise;
      }),
    });

    const first = controller.restore({ wallet: wallet('a'), account: account('a') });
    const second = controller.setWallet(wallet('b'));

    checks[0].resolve({ ok: true, relation: 'bound' });
    await first;
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'checking', reason: 'wallet_change' },
      privateAccountAccess: false,
    });

    checks[1].resolve({ ok: true, relation: 'bound' });
    await second;
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'bound',
      privateAccountAccess: true,
    });
  });

  it('quarantines a server-verified Wallet A plus Account B mismatch', async () => {
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(async () => ({ ok: true, relation: 'conflict', verifiedAt: 444 }) as const),
    });

    await controller.restore({ wallet: wallet('a'), account: account('b') });
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'conflict',
      runtime: { phase: 'ready' },
      walletPresent: true,
      accountPresent: true,
      privateAccountAccess: false,
      quarantined: true,
      verifiedAt: 444,
    });

    await controller.setAccount(null);
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'ready' },
      accountPresent: false,
      quarantined: false,
    });
  });

  it.each([
    [{ ok: false, reason: 'offline' } as const, { phase: 'offline' }],
    [
      { ok: false, reason: 'expired', subject: 'wallet' } as const,
      { phase: 'expired', subject: 'wallet' },
    ],
    [
      { ok: false, reason: 'error', code: 'binding_lookup_failed' } as const,
      { phase: 'error', code: 'binding_lookup_failed' },
    ],
  ])('withholds account access when verification returns %j', async (result, runtime) => {
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(async () => result),
    });

    await controller.restore({ wallet: wallet('a'), account: account('a') });

    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime,
      privateAccountAccess: false,
      verifiedAt: null,
    });
  });

  it('treats malformed verifier output and thrown failures as locked errors', async () => {
    const malformed = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(async () => ({ ok: true, relation: 'wallet_only' }) as never),
    });
    await malformed.restore({ wallet: wallet('a'), account: account('a') });
    expect(malformed.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'error', code: 'invalid_verification_result' },
      privateAccountAccess: false,
    });

    const thrown = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(async () => {
        throw Object.assign(new Error('failed'), { code: 'api_unavailable' });
      }),
    });
    await thrown.restore({ wallet: wallet('a'), account: account('a') });
    expect(thrown.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'error', code: 'api_unavailable' },
      privateAccountAccess: false,
    });
  });

  it('notifies subscribers before the verifier can resolve and isolates subscriber failures', async () => {
    const result = deferred<ServerRelationVerificationResult>();
    const controller = new WalletAccountRelationController<WalletCandidate, AccountCandidate>({
      verify: vi.fn(() => result.promise),
    });
    const phases: string[] = [];
    controller.subscribe(() => {
      throw new Error('listener failed');
    });
    controller.subscribe((snapshot) => phases.push(snapshot.runtime.phase));

    const restoring = controller.restore({ wallet: wallet('a'), account: account('a') });
    expect(phases).toEqual(['hydrating', 'checking']);

    result.resolve({ ok: true, relation: 'bound' });
    await restoring;
    expect(phases).toEqual(['hydrating', 'checking', 'ready']);
  });
});
