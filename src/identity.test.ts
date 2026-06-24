import { describe, it, expect } from 'vitest';

import { resolveIdentity } from './identity';

/**
 * resolveIdentity is the PURE "who is active" combiner — the spine of the single
 * identity source of truth. It answers WHO from browser state only (account
 * session token + passkey-vault handle), carries NO server/chain facts, and is
 * passkey-vault-FIRST.
 */
describe('resolveIdentity — the WHO combiner (browser state only, no facts)', () => {
  it('no account, no passkey vault → none', () => {
    expect(resolveIdentity({ accountToken: null, userHandle: null })).toEqual({
      kind: 'none',
      userHandle: null,
      accountToken: null,
      hasPasskeyVault: false,
      hasAccount: false,
      hasWallet: false,
    });
  });

  it('passkey vault only → passkey-vault (first-class)', () => {
    expect(resolveIdentity({ accountToken: null, userHandle: 'handle-abc' })).toEqual({
      kind: 'passkey-vault',
      userHandle: 'handle-abc',
      accountToken: null,
      hasPasskeyVault: true,
      hasAccount: false,
      hasWallet: true,
    });
  });

  it('account only → account', () => {
    expect(resolveIdentity({ accountToken: 'jwt-xyz', userHandle: null })).toEqual({
      kind: 'account',
      userHandle: null,
      accountToken: 'jwt-xyz',
      hasPasskeyVault: false,
      hasAccount: true,
      hasWallet: true,
    });
  });

  it('both present → passkey-vault WINS the kind (passkey-vault-FIRST); both flags true', () => {
    expect(resolveIdentity({ accountToken: 'jwt-xyz', userHandle: 'handle-abc' })).toEqual({
      kind: 'passkey-vault',
      userHandle: 'handle-abc',
      accountToken: 'jwt-xyz',
      hasPasskeyVault: true,
      hasAccount: true,
      hasWallet: true,
    });
  });

  it('empty strings are treated as absent (defensive)', () => {
    expect(resolveIdentity({ accountToken: '', userHandle: '' })).toEqual({
      kind: 'none',
      userHandle: null,
      accountToken: null,
      hasPasskeyVault: false,
      hasAccount: false,
      hasWallet: false,
    });
  });
});
