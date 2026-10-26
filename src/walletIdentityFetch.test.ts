import { describe, expect, it, vi } from 'vitest';
import { fetchWithWalletIdentity, walletBindingCandidate, type WalletBindingCandidate } from './bindingResolver';

const activeWallet = { userHandle: 'AAAAAAAAAAAAAAAAAAAAAA', vaultPda: '11111111111111111111111111111111' };
const wallet = walletBindingCandidate('signed-proof', activeWallet);
const url = 'https://api.dexter.cash/api/passkey-vault/governed-assets/transactions/history';

describe('fetchWithWalletIdentity', () => {
  it('passes through the response while binding the exact handle and proof without redirect leakage', async () => {
    const response = new Response('{"items":[]}');
    const fetch = vi.fn(async () => response);
    expect(await fetchWithWalletIdentity({ wallet, activeWallet, url, fetch,
      init: { method: 'GET', headers: { 'X-Dexter-Owner-Session': 'session-1' }, redirect: 'follow', credentials: 'include' },
    })).toBe(response);
    const [target, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe(url);
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(new Headers(init.headers).get('X-Dexter-Wallet-Proof')).toBe('signed-proof');
    expect(new Headers(init.headers).get('X-Dexter-Owner-Handle')).toBe(activeWallet.userHandle);
    expect(new Headers(init.headers).get('X-Dexter-Owner-Session')).toBe('session-1');
    expect(JSON.stringify(wallet)).not.toContain('signed-proof');
  });
  it.each([
    'https://evil.example/api/history', '//evil.example/api/history',
    'http://api.dexter.cash/api/history', 'https://api.dexter.cash:444/api/history',
    'https://api.dexter.cash.evil.example/api/history', 'https://user:pass@api.dexter.cash/api/history',
    'https://api.dexter.cash/api/history#fragment', 'https://api.dexter.cash/other',
  ])('refuses credential forwarding to %s', async (target) => {
    const fetch = vi.fn();
    await expect(fetchWithWalletIdentity({ wallet, activeWallet, url: target, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...activeWallet, userHandle: 'AQEBAQEBAQEBAQEBAQEBAQ' },
    { ...activeWallet, vaultPda: 'So11111111111111111111111111111111111111112' },
  ])('refuses a switched active wallet', async (other) => {
    const fetch = vi.fn();
    await expect(fetchWithWalletIdentity({ wallet, activeWallet: other, url, fetch })).rejects.toThrow('wallet_identity_mismatch');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { Authorization: 'Bearer account-token' },
    { 'X-Dexter-Wallet-Proof': 'caller-proof' },
    { 'X-Dexter-Owner-Handle': 'AQEBAQEBAQEBAQEBAQEBAQ' },
  ])('refuses mixed identity headers', async (headers) => {
    const fetch = vi.fn();
    await expect(fetchWithWalletIdentity({ wallet, activeWallet, url, fetch, init: { headers } })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses forged candidates and foreign or duplicate query handles', async () => {
    const fetch = vi.fn();
    await expect(fetchWithWalletIdentity({ wallet: { kind: 'dexter_wallet_identity_proof' } as WalletBindingCandidate, activeWallet, url, fetch })).rejects.toThrow();
    for (const suffix of ['?user_handle=AQEBAQEBAQEBAQEBAQEBAQ', `?user_handle=${activeWallet.userHandle}&user_handle=${activeWallet.userHandle}`]) {
      await expect(fetchWithWalletIdentity({ wallet, activeWallet, url: url + suffix, fetch })).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
