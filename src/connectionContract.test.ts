import { describe, expect, it } from 'vitest';

import { createDexterControlModel } from './connectionContract';
import type {
  RelationRuntime,
  WalletAccountRelation,
  WalletAccountRelationSnapshot,
} from './relationController';

function snapshot(
  relation: WalletAccountRelation,
  runtime: RelationRuntime = { phase: 'ready' },
): WalletAccountRelationSnapshot {
  const walletPresent = relation === 'wallet_only' || relation === 'bound' || relation === 'conflict';
  const accountPresent = relation === 'account_only' || relation === 'bound' || relation === 'conflict';
  const bound = relation === 'bound' && runtime.phase === 'ready';
  return {
    relation,
    runtime,
    walletPresent,
    accountPresent,
    privateAccountAccess: bound,
    quarantined: relation === 'conflict',
    verifiedAt: bound || relation === 'conflict' ? 1 : null,
    revision: 1,
  };
}

describe('Dexter control display and permissions', () => {
  it('unlocks account content only for a ready bound relation', () => {
    for (const relation of ['none', 'wallet_only', 'account_only', 'conflict'] as const) {
      expect(
        createDexterControlModel('agent', snapshot(relation)).permissions,
      ).toMatchObject({
        accountContentVisible: false,
        agentAuthorityVisible: false,
      });
    }

    expect(createDexterControlModel('agent', snapshot('bound'))).toMatchObject({
      stage: 'ready',
      primaryAction: 'use_another_wallet',
      permissions: {
        accountContentVisible: true,
        agentAuthorityVisible: true,
      },
    });
  });

  it('keeps checking and offline states closed', () => {
    const checking = createDexterControlModel(
      'wallet',
      snapshot('wallet_only', { phase: 'checking', reason: 'wallet_change' }),
    );
    const offline = createDexterControlModel(
      'wallet',
      snapshot('wallet_only', { phase: 'offline' }),
    );

    expect(checking.stage).toBe('checking');
    expect(checking.permissions.ownerWalletUseEnabled).toBe(false);
    expect(offline.stage).toBe('offline');
    expect(offline.permissions.walletDataVisible).toBe(false);
  });

  it('supports direct owner-present Wallet use without agent authority', () => {
    const model = createDexterControlModel('wallet', snapshot('wallet_only'));

    expect(model).toMatchObject({
      stage: 'ready',
      permissions: {
        capabilities: ['identity', 'wallet.read', 'wallet.use'],
        walletDataVisible: true,
        ownerWalletUseEnabled: true,
        accountContentVisible: false,
        agentAuthorityVisible: false,
      },
    });
  });

  it('does not treat agent authority as direct owner Wallet use', () => {
    const model = createDexterControlModel('agent', snapshot('bound'));

    expect(model.permissions.capabilities).toEqual([
      'identity',
      'wallet.read',
      'agent.authority',
    ]);
    expect(model.permissions.ownerWalletUseEnabled).toBe(false);
    expect(model.permissions.agentAuthorityVisible).toBe(true);
  });

  it('keeps Wallet data out of an identity-only integration', () => {
    const model = createDexterControlModel('identity', snapshot('bound'));

    expect(model.permissions.capabilities).toEqual(['identity']);
    expect(model.permissions.walletIdentityVisible).toBe(true);
    expect(model.permissions.walletDataVisible).toBe(false);
    expect(model.permissions.accountContentVisible).toBe(true);
  });

  it('routes account-only and conflict states to repair', () => {
    expect(createDexterControlModel('identity', snapshot('account_only')).stage).toBe('repair');
    expect(createDexterControlModel('wallet', snapshot('conflict'))).toMatchObject({
      stage: 'repair',
      primaryAction: 'repair',
      permissions: {
        walletIdentityVisible: false,
        accountContentVisible: false,
      },
    });
  });
});
