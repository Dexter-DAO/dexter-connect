import { describe, expect, it, vi } from 'vitest';

import {
  accountBindingCandidate,
  createWalletAccountBindingClient,
  WALLET_ACCOUNT_BINDING_PATH,
  walletBindingCandidate,
  type AccountBindingCandidate,
  type BindingFetch,
  type WalletBindingCandidate,
} from './bindingResolver';
import { WalletAccountRelationController } from './relationController';

const ACTIVE_WALLET = Object.freeze({
  userHandle: 'BwcHBwcHBwcHBwcHBwcHBw',
  vaultPda: '11111111111111111111111111111111',
});

function walletCandidate(
  proof = 'wallet-proof',
  activeWallet = ACTIVE_WALLET,
): WalletBindingCandidate {
  return walletBindingCandidate(proof, activeWallet);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Wallet/account binding resolver', () => {
  it('posts both opaque proofs to the canonical endpoint', async () => {
    const fetch = vi.fn<BindingFetch>(async () => jsonResponse({ relation: 'bound' }));
    const wallet = walletCandidate('wallet-proof-secret');
    const account = accountBindingCandidate('account-token-secret');
    const client = createWalletAccountBindingClient({ fetch });

    await expect(client.resolve({ wallet, account })).resolves.toEqual({
      ok: true,
      relation: 'bound',
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.dexter.cash${WALLET_ACCOUNT_BINDING_PATH}`);
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer account-token-secret',
        'X-Dexter-Wallet-Proof': 'wallet-proof-secret',
      },
    });
    expect(init?.body).toBe(JSON.stringify({ activeWallet: ACTIVE_WALLET }));
  });

  it('keeps proof values out of candidate objects and JSON', () => {
    const wallet = walletCandidate('wallet-proof-secret');
    const account = accountBindingCandidate('account-token-secret');

    expect(JSON.stringify(wallet)).toBe('{"kind":"dexter_wallet_identity_proof"}');
    expect(JSON.stringify(account)).toBe('{"kind":"dexter_account_session"}');
    expect(Object.values(wallet)).not.toContain('wallet-proof-secret');
    expect(Object.values(account)).not.toContain('account-token-secret');
  });

  it.each([
    [{ ...ACTIVE_WALLET, userHandle: 'not-canonical' }],
    [{ ...ACTIVE_WALLET, vaultPda: 'not-a-public-key' }],
    [{ ...ACTIVE_WALLET, userHandle: `${ACTIVE_WALLET.userHandle}=` }],
  ])('requires a canonical active Wallet identity', (activeWallet) => {
    expect(() => walletBindingCandidate('wallet-proof', activeWallet)).toThrowError(
      expect.objectContaining({ code: 'invalid_active_wallet' }),
    );
  });

  it('supports each one-proof relation without browser globals', async () => {
    const fetch = vi
      .fn<BindingFetch>()
      .mockResolvedValueOnce(jsonResponse({ relation: 'wallet_only' }))
      .mockResolvedValueOnce(jsonResponse({ relation: 'account_only' }));
    const client = createWalletAccountBindingClient({ fetch });

    await expect(
      client.resolve({ wallet: walletCandidate() }),
    ).resolves.toEqual({ ok: true, relation: 'wallet_only' });
    await expect(
      client.resolve({ account: accountBindingCandidate('account-token') }),
    ).resolves.toEqual({ ok: true, relation: 'account_only' });

    expect(fetch.mock.calls[0][1]?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Dexter-Wallet-Proof': 'wallet-proof',
    });
    expect(fetch.mock.calls[1][1]?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer account-token',
    });
    expect(fetch.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ activeWallet: ACTIVE_WALLET }),
    );
    expect(fetch.mock.calls[1][1]?.body).toBe('{}');
  });

  it('maps each rejected identity to the exact expired subject', async () => {
    const fetch = vi
      .fn<BindingFetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_wallet_proof' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_account_session' }, 401));
    const client = createWalletAccountBindingClient({ fetch });

    await expect(
      client.resolve({
        wallet: walletCandidate(),
        account: accountBindingCandidate('account-token'),
      }),
    ).resolves.toEqual({ ok: false, reason: 'expired', subject: 'wallet' });
    await expect(
      client.resolve({
        wallet: walletCandidate(),
        account: accountBindingCandidate('account-token'),
      }),
    ).resolves.toEqual({ ok: false, reason: 'expired', subject: 'account' });
  });

  it.each([
    [400, 'identity_required'],
    [400, 'invalid_active_wallet'],
    [400, 'active_wallet_required'],
    [400, 'wallet_proof_required'],
    [409, 'wallet_not_initialized'],
    [503, 'temporarily_unavailable'],
  ] as const)('preserves the API contract error for HTTP %i', async (status, code) => {
    const client = createWalletAccountBindingClient({
      fetch: vi.fn<BindingFetch>(async () => jsonResponse({ error: code }, status)),
    });

    await expect(
      client.resolve({ wallet: walletCandidate() }),
    ).resolves.toEqual({ ok: false, reason: 'error', code });
  });

  it('accepts conflict when a valid proof names a different active Wallet', async () => {
    const client = createWalletAccountBindingClient({
      fetch: vi.fn<BindingFetch>(async () => jsonResponse({ relation: 'conflict' })),
    });

    await expect(client.resolve({ wallet: walletCandidate() })).resolves.toEqual({
      ok: true,
      relation: 'conflict',
    });
  });

  it('maps network failure without returning the thrown message', async () => {
    const fetch = vi.fn<BindingFetch>(async () => {
      throw new Error('network failed while carrying account-token-secret');
    });
    const client = createWalletAccountBindingClient({ fetch });

    const result = await client.resolve({
      wallet: walletCandidate('wallet-proof-secret'),
      account: accountBindingCandidate('account-token-secret'),
    });

    expect(result).toEqual({ ok: false, reason: 'offline' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each([
    [jsonResponse('bound'), 'malformed_binding_response'],
    [jsonResponse({ relation: 'wallet_only' }), 'malformed_binding_response'],
    [jsonResponse({ relation: 'bound', vault: 'unexpected' }), 'malformed_binding_response'],
    [new Response('not json', { status: 200 }), 'malformed_binding_response'],
    [jsonResponse({ error: 'service failed' }, 503), 'malformed_binding_response'],
    [jsonResponse({ error: 'invalid_wallet_proof' }, 503), 'malformed_binding_response'],
    [new Response('not json', { status: 401 }), 'malformed_binding_response'],
  ])('locks malformed and non-success API responses', async (response, code) => {
    const client = createWalletAccountBindingClient({
      fetch: vi.fn<BindingFetch>(async () => response),
    });

    await expect(
      client.resolve({
        wallet: walletCandidate(),
        account: accountBindingCandidate('account-token'),
      }),
    ).resolves.toEqual({ ok: false, reason: 'error', code });
  });

  it('rejects an error for an identity the client did not supply', async () => {
    const walletError = createWalletAccountBindingClient({
      fetch: vi.fn<BindingFetch>(async () =>
        jsonResponse({ error: 'invalid_wallet_proof' }, 401)),
    });
    const accountError = createWalletAccountBindingClient({
      fetch: vi.fn<BindingFetch>(async () =>
        jsonResponse({ error: 'invalid_account_session' }, 401)),
    });

    await expect(
      walletError.resolve({ account: accountBindingCandidate('account-token') }),
    ).resolves.toEqual({
      ok: false,
      reason: 'error',
      code: 'malformed_binding_response',
    });
    await expect(
      accountError.resolve({ wallet: walletCandidate() }),
    ).resolves.toEqual({
      ok: false,
      reason: 'error',
      code: 'malformed_binding_response',
    });
  });

  it('rejects forged candidates before making a request', async () => {
    const fetch = vi.fn<BindingFetch>();
    const client = createWalletAccountBindingClient({ fetch });
    const forgedWallet = Object.freeze({
      kind: 'dexter_wallet_identity_proof',
    }) as WalletBindingCandidate;
    const forgedAccount = Object.freeze({
      kind: 'dexter_account_session',
    }) as AccountBindingCandidate;

    await expect(
      client.resolve({ wallet: forgedWallet, account: accountBindingCandidate('account-token') }),
    ).resolves.toEqual({
      ok: false,
      reason: 'error',
      code: 'invalid_wallet_candidate',
    });
    await expect(
      client.resolve({ wallet: walletCandidate(), account: forgedAccount }),
    ).resolves.toEqual({
      ok: false,
      reason: 'error',
      code: 'invalid_account_candidate',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('plugs into the relationship controller and leaves 401 sessions locked', async () => {
    const fetch = vi
      .fn<BindingFetch>()
      .mockResolvedValueOnce(jsonResponse({ relation: 'bound' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_wallet_proof' }, 401));
    const client = createWalletAccountBindingClient({ fetch });
    const controller = new WalletAccountRelationController({ verify: client.verify });
    const wallet = walletCandidate();
    const account = accountBindingCandidate('account-token');

    await controller.restore({ wallet, account });
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'bound',
      privateAccountAccess: true,
    });

    await controller.retry();
    expect(controller.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'expired', subject: 'wallet' },
      privateAccountAccess: false,
    });
  });

  it('returns a fixed abort code without reflecting request data', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<BindingFetch>(async (_url, init) => {
      init?.signal?.throwIfAborted();
      throw new Error('unexpected');
    });
    const client = createWalletAccountBindingClient({ fetch });
    controller.abort();

    await expect(
      client.resolve({
        wallet: walletCandidate('wallet-proof-secret'),
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'error',
      code: 'binding_request_aborted',
    });
  });
});
