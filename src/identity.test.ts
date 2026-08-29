import { describe, expect, it } from 'vitest';

import { resolveIdentity } from './identity';
import type {
  WalletAccountRelation,
  WalletAccountRelationSnapshot,
} from './relationController';

function snapshot(
  relation: WalletAccountRelation,
  walletPresent: boolean,
  accountPresent: boolean,
  privateAccountAccess = false,
  quarantined = relation === 'conflict',
): WalletAccountRelationSnapshot {
  return {
    relation,
    runtime: { phase: 'ready' },
    walletPresent,
    accountPresent,
    privateAccountAccess,
    quarantined,
    verifiedAt: privateAccountAccess || quarantined ? 123 : null,
    revision: 1,
  };
}

describe('resolveIdentity', () => {
  it('returns an empty presentation when neither candidate exists', () => {
    expect(
      resolveIdentity({
        relation: snapshot('none', false, false),
        accountToken: null,
        userHandle: null,
      }),
    ).toEqual({
      kind: 'none',
      userHandle: null,
      walletLabel: null,
      accountToken: null,
      hasPasskeyVault: false,
      hasAccount: false,
      hasWallet: false,
      hasAccountAccess: false,
      quarantined: false,
    });
  });

  it('presents a Wallet without inventing account access', () => {
    expect(
      resolveIdentity({
        relation: snapshot('wallet_only', true, false),
        accountToken: null,
        userHandle: 'handle-a',
        walletLabel: 'BranchWallet',
      }),
    ).toMatchObject({
      kind: 'wallet_only',
      userHandle: 'handle-a',
      walletLabel: 'BranchWallet',
      accountToken: null,
      hasWallet: true,
      hasAccountAccess: false,
    });
  });

  it('does not turn an account session into a Wallet', () => {
    expect(
      resolveIdentity({
        relation: snapshot('account_only', false, true),
        accountToken: 'account-bearer',
        userHandle: null,
      }),
    ).toMatchObject({
      kind: 'account_only',
      accountToken: null,
      hasPasskeyVault: false,
      hasAccount: true,
      hasWallet: false,
      hasAccountAccess: false,
    });
  });

  it('withholds the account bearer while a pair is being checked', () => {
    const relation: WalletAccountRelationSnapshot = {
      ...snapshot('wallet_only', true, true),
      runtime: { phase: 'checking', reason: 'restore' },
    };

    expect(
      resolveIdentity({
        relation,
        accountToken: 'candidate-account-bearer',
        userHandle: 'handle-a',
      }).accountToken,
    ).toBeNull();
  });

  it('exposes the account bearer only after the exact pair is bound', () => {
    expect(
      resolveIdentity({
        relation: snapshot('bound', true, true, true),
        accountToken: 'bound-account-bearer',
        userHandle: 'handle-a',
        walletLabel: 'BranchWallet',
      }),
    ).toMatchObject({
      kind: 'bound',
      accountToken: 'bound-account-bearer',
      userHandle: 'handle-a',
      hasWallet: true,
      hasAccountAccess: true,
      quarantined: false,
    });
  });

  it('withholds the account bearer for a verified mismatch', () => {
    expect(
      resolveIdentity({
        relation: snapshot('conflict', true, true),
        accountToken: 'account-b',
        userHandle: 'handle-a',
      }),
    ).toMatchObject({
      kind: 'conflict',
      accountToken: null,
      hasAccountAccess: false,
      quarantined: true,
    });
  });

  it('drops empty candidate strings and a label without an active Wallet', () => {
    expect(
      resolveIdentity({
        relation: snapshot('account_only', false, true),
        accountToken: '',
        userHandle: '',
        walletLabel: 'Stale',
      }),
    ).toMatchObject({
      userHandle: null,
      walletLabel: null,
      accountToken: null,
      hasWallet: false,
    });
  });
});
