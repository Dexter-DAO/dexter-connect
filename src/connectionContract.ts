import type { WalletAccountRelationSnapshot } from './relationController';

export type DexterConnectionIntent = 'identity' | 'wallet' | 'agent';

export type DexterConnectionCapability =
  | 'identity'
  | 'wallet.read'
  | 'wallet.use'
  | 'agent.authority';

export type DexterControlStage =
  | 'connect'
  | 'checking'
  | 'ready'
  | 'repair'
  | 'offline'
  | 'error';

export type DexterControlPrimaryAction =
  | 'connect'
  | 'use_another_wallet'
  | 'retry'
  | 'repair';

export interface DexterConnectionPermissions {
  readonly capabilities: readonly DexterConnectionCapability[];
  readonly walletIdentityVisible: boolean;
  readonly walletDataVisible: boolean;
  readonly ownerWalletUseEnabled: boolean;
  readonly accountContentVisible: boolean;
  readonly agentAuthorityVisible: boolean;
}

export interface DexterControlModel {
  readonly intent: DexterConnectionIntent;
  readonly stage: DexterControlStage;
  readonly primaryAction: DexterControlPrimaryAction;
  readonly permissions: DexterConnectionPermissions;
}

const CAPABILITIES = Object.freeze({
  identity: Object.freeze(['identity'] as const),
  wallet: Object.freeze(['identity', 'wallet.read', 'wallet.use'] as const),
  agent: Object.freeze(['identity', 'wallet.read', 'agent.authority'] as const),
}) satisfies Readonly<
  Record<DexterConnectionIntent, readonly DexterConnectionCapability[]>
>;

function stageFor(
  relation: WalletAccountRelationSnapshot,
  intent: DexterConnectionIntent,
): DexterControlStage {
  if (relation.runtime.phase === 'hydrating' || relation.runtime.phase === 'checking') {
    return 'checking';
  }
  if (relation.runtime.phase === 'offline') return 'offline';
  if (relation.runtime.phase === 'error') return 'error';
  if (relation.runtime.phase === 'expired' || relation.relation === 'conflict') {
    return 'repair';
  }
  if (relation.relation === 'none') return 'connect';
  if (relation.relation === 'bound') return 'ready';
  if (relation.relation === 'wallet_only' && intent === 'wallet') return 'ready';
  return 'repair';
}

function primaryActionFor(
  stage: DexterControlStage,
): DexterControlPrimaryAction {
  if (stage === 'connect') return 'connect';
  if (stage === 'ready') return 'use_another_wallet';
  if (stage === 'repair') return 'repair';
  return 'retry';
}

/**
 * Produce the display and permission contract for the canonical Dexter control.
 * Account-owned content is available only after the API verifies `bound`.
 */
export function createDexterControlModel(
  intent: DexterConnectionIntent,
  relation: WalletAccountRelationSnapshot,
): DexterControlModel {
  const stage = stageFor(relation, intent);
  const ready = relation.runtime.phase === 'ready';
  const bound =
    ready &&
    relation.relation === 'bound' &&
    relation.privateAccountAccess;
  const ownerWalletReady =
    intent === 'wallet' &&
    ready &&
    relation.walletPresent &&
    (relation.relation === 'wallet_only' || bound);

  return Object.freeze({
    intent,
    stage,
    primaryAction: primaryActionFor(stage),
    permissions: Object.freeze({
      capabilities: CAPABILITIES[intent],
      walletIdentityVisible:
        ready && relation.walletPresent && relation.relation !== 'conflict',
      walletDataVisible:
        ownerWalletReady || (bound && intent === 'agent'),
      ownerWalletUseEnabled: ownerWalletReady,
      accountContentVisible: bound,
      agentAuthorityVisible: bound && intent === 'agent',
    }),
  });
}
