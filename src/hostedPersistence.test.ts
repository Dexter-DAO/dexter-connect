// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

import { startAuthentication } from '@simplewebauthn/browser';
import { runHostedCeremony } from './hosted';
import { getActiveWallet, listWallets, setActiveWallet } from './walletStore';
import { walletProofSessionStore } from './walletProofSession';

const HANDLE_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const HANDLE_B = 'AQEBAQEBAQEBAQEBAQEBAQ';
const VAULT_A = '11111111111111111111111111111111';
const VAULT_B = 'So11111111111111111111111111111111111111112';

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

interface HappyWindow extends Window {
  happyDOM?: { setURL(url: string): void };
}

beforeEach(() => {
  (window as unknown as HappyWindow).happyDOM?.setURL?.('https://dexter.cash/connect');
  window.localStorage.clear();
  setActiveWallet({
    handle: HANDLE_A,
    credentialId: 'credential-a',
    vaultPda: VAULT_A,
  });
  walletProofSessionStore.save(HANDLE_A, proofA);
  vi.mocked(startAuthentication).mockResolvedValue({
    id: 'credential-b',
    rawId: 'credential-b',
    response: {},
    clientExtensionResults: {},
    type: 'public-key',
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('hosted provisional persistence', () => {
  it('returns Wallet B without changing Dexter host storage from Wallet A', async () => {
    const walletB = {
      vaultPda: VAULT_B,
      swigAddress: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
      receiveAddress: null,
      usdcAta: null,
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      userHandle: HANDLE_B,
      credentialId: 'credential-b',
      walletLabel: 'Off-origin Wallet',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ options: { challenge: 'challenge' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            accessToken: 'account-b',
            refreshToken: 'refresh-b',
            expiresAt: 2_000_000_000,
            expiresIn: 3_600,
            tokenType: 'bearer',
            vault: walletB,
            walletIdentityProof: proofB,
          }),
        }),
    );
    const storageBefore = snapshotStorage();

    const result = await runHostedCeremony({
      operation: 'signin',
      walletStore: 'provisional',
    });

    expect(result.vault).toEqual(walletB);
    expect(result.walletIdentityProof).toEqual(proofB);
    expect(getActiveWallet()).toMatchObject({
      handle: HANDLE_A,
      vaultPda: VAULT_A,
    });
    expect(listWallets().map((wallet) => wallet.handle)).toEqual([HANDLE_A]);
    expect(walletProofSessionStore.load(HANDLE_A)).toMatchObject({
      kind: 'dexter_wallet_proof_session',
      handle: HANDLE_A,
      expiresAt: proofA.expiresAt,
    });
    expect(walletProofSessionStore.load(HANDLE_B)).toBeNull();
    expect(snapshotStorage()).toEqual(storageBefore);
  });
});

function snapshotStorage(): Record<string, string | null> {
  return Object.fromEntries(
    Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    )
      .filter((key): key is string => key !== null)
      .sort()
      .map((key) => [key, window.localStorage.getItem(key)]),
  );
}
