// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDexterIdentityCoordinator } from './identityCoordinator';
import {
  disconnectActiveWallet,
  setActiveWallet,
  switchWallet,
} from './walletStore';
import { walletProofSessionStore } from './walletProofSession';
import { bytesToBase64url } from './base64';

const proofA = {
  token: 'proof-a',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};

const proofB = {
  token: 'proof-b',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};

const proofC = {
  token: 'proof-c',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};

const HANDLE_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const HANDLE_B = 'AQEBAQEBAQEBAQEBAQEBAQ';
const HANDLE_C = 'AgICAgICAgICAgICAgICAg';
const VAULT_A = '11111111111111111111111111111111';
const VAULT_B = 'So11111111111111111111111111111111111111112';
const VAULT_C = 'SysvarRent111111111111111111111111111111111';
const ACCOUNT_A_SUBJECT = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B_SUBJECT = '22222222-2222-4222-8222-222222222222';

function jwt(subject: string, tokenId: string): string {
  const encode = (value: unknown) =>
    bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: subject, jti: tokenId }),
    encode(`signature-${tokenId}`),
  ].join('.');
}

const ACCOUNT_A1 = jwt(ACCOUNT_A_SUBJECT, 'a1');
const ACCOUNT_A2 = jwt(ACCOUNT_A_SUBJECT, 'a2');
const ACCOUNT_B1 = jwt(ACCOUNT_B_SUBJECT, 'b1');

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Dexter identity coordinator', () => {
  it('restores an exact Wallet/account pair through the server', async () => {
    setActiveWallet({ handle: HANDLE_A, credentialId: 'cred-a', vaultPda: VAULT_A });
    walletProofSessionStore.save(HANDLE_A, proofA);
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        response(200, { relation: 'bound' }),
    );
    const identity = createDexterIdentityCoordinator({ fetch: fetchMock });

    const snapshot = await identity.restore('account-a');

    expect(snapshot.relation).toBe('bound');
    expect(snapshot.privateAccountAccess).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer account-a',
        'X-Dexter-Wallet-Proof': 'proof-a',
      },
      body: JSON.stringify({
        activeWallet: {
          userHandle: HANDLE_A,
          vaultPda: VAULT_A,
        },
      }),
    });
    identity.dispose();
  });

  it('keeps Wallet-only and account-only states local', async () => {
    setActiveWallet({ handle: HANDLE_A, vaultPda: VAULT_A });
    walletProofSessionStore.save(HANDLE_A, proofA);
    const fetchMock = vi.fn();
    const identity = createDexterIdentityCoordinator({ fetch: fetchMock });

    expect((await identity.restore(null)).relation).toBe('wallet_only');
    expect((await identity.setAccountSession(null)).privateAccountAccess).toBe(false);
    identity.dispose();

    window.localStorage.clear();
    const accountOnly = createDexterIdentityCoordinator({ fetch: fetchMock });
    expect((await accountOnly.restore('account-a')).relation).toBe('account_only');
    expect(fetchMock).not.toHaveBeenCalled();
    accountOnly.dispose();
  });

  it('ends the old account binding on every Wallet change', async () => {
    setActiveWallet({ handle: HANDLE_A, credentialId: 'cred-a', vaultPda: VAULT_A });
    walletProofSessionStore.save(HANDLE_A, proofA);
    setActiveWallet({ handle: HANDLE_B, credentialId: 'cred-b', vaultPda: VAULT_B });
    walletProofSessionStore.save(HANDLE_B, proofB);
    setActiveWallet({ handle: HANDLE_C, credentialId: 'cred-c', vaultPda: VAULT_C });
    walletProofSessionStore.save(HANDLE_C, proofC);
    switchWallet(HANDLE_A);

    const fetchMock = vi.fn(async (_: unknown, init?: RequestInit) => {
      void init;
      return response(200, { relation: 'bound' });
    });
    const identity = createDexterIdentityCoordinator({ fetch: fetchMock });
    expect((await identity.restore(ACCOUNT_A1)).relation).toBe('bound');

    switchWallet(HANDLE_B);
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls).not.toContainEqual([
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${ACCOUNT_A1}`,
          'X-Dexter-Wallet-Proof': 'proof-b',
        }),
      }),
    ]);

    identity.setAccountLoading();
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'hydrating' },
      privateAccountAccess: false,
    });
    expect((await identity.setAccountSession('not-a-jwt')).relation).toBe('wallet_only');
    expect((await identity.setAccountSession(ACCOUNT_A2)).relation).toBe('wallet_only');
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(switchWallet(HANDLE_A)).toBe(true);
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(await identity.setAccountSession(ACCOUNT_A2)).toMatchObject({
      relation: 'wallet_only',
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(switchWallet(HANDLE_B)).toBe(true);
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(disconnectActiveWallet()).toBe(true);
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'none',
      walletPresent: false,
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(
      setActiveWallet({ handle: HANDLE_C, credentialId: 'cred-c', vaultPda: VAULT_C }),
    ).toBe(true);
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(switchWallet(HANDLE_B)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const rebound = await identity.setAccountSession(ACCOUNT_B1);
    expect(rebound).toMatchObject({
      relation: 'bound',
      privateAccountAccess: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Authorization: `Bearer ${ACCOUNT_B1}`,
        'X-Dexter-Wallet-Proof': 'proof-b',
      },
      body: JSON.stringify({
        activeWallet: { userHandle: HANDLE_B, vaultPda: VAULT_B },
      }),
    });
    identity.dispose();
  });

  it('does not revive a signed-out account from a stale same-subject refresh', async () => {
    setActiveWallet({ handle: HANDLE_A, credentialId: 'cred-a', vaultPda: VAULT_A });
    walletProofSessionStore.save(HANDLE_A, proofA);
    setActiveWallet({ handle: HANDLE_B, credentialId: 'cred-b', vaultPda: VAULT_B });
    walletProofSessionStore.save(HANDLE_B, proofB);
    switchWallet(HANDLE_A);

    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        response(200, { relation: 'bound' }),
    );
    const identity = createDexterIdentityCoordinator({ fetch: fetchMock });
    expect((await identity.restore(ACCOUNT_A1)).relation).toBe('bound');

    expect(switchWallet(HANDLE_B)).toBe(true);
    expect((await identity.setAccountSession(null)).relation).toBe('wallet_only');
    expect((await identity.setAccountSession(ACCOUNT_A2)).relation).toBe('wallet_only');
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(switchWallet(HANDLE_A)).toBe(true);
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    identity.dispose();
  });

  it('does not revive a previous account while the host reloads', async () => {
    setActiveWallet({ handle: HANDLE_A, credentialId: 'cred-a', vaultPda: VAULT_A });
    walletProofSessionStore.save(HANDLE_A, proofA);
    setActiveWallet({ handle: HANDLE_B, credentialId: 'cred-b', vaultPda: VAULT_B });
    walletProofSessionStore.save(HANDLE_B, proofB);
    switchWallet(HANDLE_A);

    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        response(200, { relation: 'bound' }),
    );
    const identity = createDexterIdentityCoordinator({ fetch: fetchMock });
    expect((await identity.restore(ACCOUNT_A1)).relation).toBe('bound');

    expect(switchWallet(HANDLE_B)).toBe(true);
    identity.setAccountLoading();
    expect(switchWallet(HANDLE_A)).toBe(true);
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'hydrating' },
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    walletProofSessionStore.save(HANDLE_A, {
      ...proofA,
      token: 'proof-a-refreshed',
    });
    expect(identity.getSnapshot()).toMatchObject({
      relation: 'wallet_only',
      runtime: { phase: 'hydrating' },
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const rebound = await identity.setAccountSession(ACCOUNT_A2);
    expect(rebound).toMatchObject({
      relation: 'wallet_only',
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    identity.dispose();
  });

  it('verifies and quarantines a persisted Wallet plus account pair during restore', async () => {
    setActiveWallet({ handle: HANDLE_B, credentialId: 'cred-b', vaultPda: VAULT_B });
    walletProofSessionStore.save(HANDLE_B, proofB);
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        response(200, { relation: 'conflict' }),
    );
    const identity = createDexterIdentityCoordinator({ fetch: fetchMock });

    const restored = await identity.restore(ACCOUNT_A1);

    expect(restored).toMatchObject({
      relation: 'conflict',
      quarantined: true,
      privateAccountAccess: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: `Bearer ${ACCOUNT_A1}`,
        'X-Dexter-Wallet-Proof': 'proof-b',
      },
    });
    identity.dispose();
  });

  it('quarantines a valid-looking roster row whose Vault PDA does not match its proof', async () => {
    setActiveWallet({ handle: HANDLE_A, credentialId: 'cred-a', vaultPda: VAULT_B });
    walletProofSessionStore.save(HANDLE_A, proofA);
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.body).toBe(
        JSON.stringify({
          activeWallet: { userHandle: HANDLE_A, vaultPda: VAULT_B },
        }),
      );
      return response(200, { relation: 'conflict' });
    });
    const identity = createDexterIdentityCoordinator({ fetch: fetchMock });

    const snapshot = await identity.restore('account-a');

    expect(snapshot).toMatchObject({
      relation: 'conflict',
      quarantined: true,
      privateAccountAccess: false,
    });
    identity.dispose();
  });

  it('account sign-out keeps the Wallet proof available for later use', async () => {
    setActiveWallet({ handle: HANDLE_A, vaultPda: VAULT_A });
    walletProofSessionStore.save(HANDLE_A, proofA);
    const identity = createDexterIdentityCoordinator({
      fetch: async () => response(200, { relation: 'bound' }),
    });
    await identity.restore('account-a');

    const signedOut = await identity.setAccountSession(null);

    expect(signedOut.relation).toBe('wallet_only');
    expect(signedOut.privateAccountAccess).toBe(false);
    expect(walletProofSessionStore.load(HANDLE_A)).not.toBeNull();
    identity.dispose();
  });

  it('browser disconnect ends the complete active identity and keeps the device proof', async () => {
    setActiveWallet({ handle: HANDLE_A, vaultPda: VAULT_A });
    walletProofSessionStore.save(HANDLE_A, proofA);
    const identity = createDexterIdentityCoordinator({
      fetch: async () => response(200, { relation: 'bound' }),
    });
    await identity.restore('account-a');

    expect(disconnectActiveWallet()).toBe(true);

    expect(identity.getSnapshot()).toMatchObject({
      relation: 'none',
      walletPresent: false,
      accountPresent: false,
      privateAccountAccess: false,
    });
    expect(walletProofSessionStore.load(HANDLE_A)).not.toBeNull();
    identity.dispose();
  });

  it('removes account access when the retained Wallet proof expires in an open page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      setActiveWallet({ handle: HANDLE_A, credentialId: 'cred-a', vaultPda: VAULT_A });
      walletProofSessionStore.save(HANDLE_A, {
        ...proofA,
        expiresAt: 1_001,
      });
      const identity = createDexterIdentityCoordinator({
        fetch: async () => response(200, { relation: 'bound' }),
      });
      expect((await identity.restore('account-a')).relation).toBe('bound');

      await vi.advanceTimersByTimeAsync(1_000);

      expect(identity.getSnapshot()).toMatchObject({
        relation: 'wallet_only',
        runtime: { phase: 'expired', subject: 'wallet' },
        privateAccountAccess: false,
      });
      identity.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
