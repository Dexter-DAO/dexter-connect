// @dexterai/connect/hosted — the credential ceremony entry used by
// https://dexter.cash/connect and other first-party Dexter-hosted routes.
//
// The root package intentionally keeps passkeyLogin, continueWithDexter, and
// browser roster controls private. This entry gives the hosted page one narrow
// dispatcher instead. It pins the API and transport, checks the browser origin,
// and preserves provisional Wallet results for an off-origin opener.

import { createWallet, type CreateWalletResult } from './enroll';
import { recoverWallet } from './recover';
import { continueWithDexter, passkeyLogin, type ContinueResult } from './relay';
import type { SpendPolicy } from './policy';
import type {
  CeremonyPhase,
  RecoverOutcome,
  SignInResult,
  WalletStoreMode,
} from './types';
import {
  ConnectError,
  resolveAgentDelegationMode,
  resolveWalletStoreMode,
} from './types';
import { DEXTER_API_BASE } from './trust';

/** The only production browser origin allowed to run an inline Dexter ceremony. */
export const DEXTER_HOSTED_CEREMONY_ORIGIN = 'https://dexter.cash';

export type HostedCeremonyOperation = 'signin' | 'continue' | 'create' | 'recover';
export type HostedContinueResult = ContinueResult;

interface HostedCeremonyBase {
  /** Commit to Dexter's host-side Wallet store, or return the Wallet provisionally. */
  walletStore?: WalletStoreMode;
  onPhase?: (phase: CeremonyPhase) => void;
}

export interface HostedSignInCeremony extends HostedCeremonyBase {
  operation: 'signin';
}

type HostedDelegationChoice =
  | {
      agentDelegation: 'configure-now';
      spendPolicy: SpendPolicy;
    }
  | {
      agentDelegation: 'deferred';
      spendPolicy?: never;
    }
  | {
      agentDelegation?: undefined;
      spendPolicy?: SpendPolicy;
    };

export type HostedContinueCeremony = HostedCeremonyBase & HostedDelegationChoice & {
  operation: 'continue';
  name?: string;
};

export type HostedCreateCeremony = HostedCeremonyBase & HostedDelegationChoice & {
  operation: 'create';
  name?: string;
};

export interface HostedRecoverCeremony extends HostedCeremonyBase {
  operation: 'recover';
  preferImmediate?: boolean;
}

export type HostedCeremonyRequest =
  | HostedSignInCeremony
  | HostedContinueCeremony
  | HostedCreateCeremony
  | HostedRecoverCeremony;

export type HostedCeremonyResult<O extends HostedCeremonyOperation> =
  O extends 'signin'
    ? SignInResult
    : O extends 'continue'
      ? HostedContinueResult
      : O extends 'create'
        ? CreateWalletResult
        : RecoverOutcome;

/**
 * Run one first-party hosted Wallet ceremony.
 *
 * The caller chooses only the operation and host-side persistence behavior.
 * API origin and transport are fixed here so a hosted route cannot drift into
 * a second implementation or accept an opener-controlled credential server.
 */
export function runHostedCeremony(request: HostedSignInCeremony): Promise<SignInResult>;
export function runHostedCeremony(
  request: HostedContinueCeremony,
): Promise<HostedContinueResult>;
export function runHostedCeremony(request: HostedCreateCeremony): Promise<CreateWalletResult>;
export function runHostedCeremony(request: HostedRecoverCeremony): Promise<RecoverOutcome>;
export async function runHostedCeremony(
  request: HostedCeremonyRequest,
): Promise<SignInResult | HostedContinueResult | CreateWalletResult | RecoverOutcome> {
  assertHostedCeremonyOrigin();
  const walletStore = resolveWalletStoreMode(request.walletStore);
  assertHostedDelegationChoice(request);
  const persistence = walletStore === 'provisional' ? { walletStore } : {};

  switch (request.operation) {
    case 'signin':
      return (await passkeyLogin(
        {
          apiBase: DEXTER_API_BASE,
          transport: 'inline',
          ...persistence,
        },
        request.onPhase,
      ));
    case 'continue':
      return (await continueWithDexter(
        {
          apiBase: DEXTER_API_BASE,
          transport: 'inline',
          ...persistence,
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.spendPolicy !== undefined ? { spendPolicy: request.spendPolicy } : {}),
          ...(request.agentDelegation !== undefined
            ? { agentDelegation: request.agentDelegation }
            : {}),
        },
        request.onPhase,
      ));
    case 'create':
      return (await createWallet({
        apiBase: DEXTER_API_BASE,
        transport: 'inline',
        ...persistence,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.spendPolicy !== undefined ? { spendPolicy: request.spendPolicy } : {}),
        ...(request.agentDelegation !== undefined
          ? { agentDelegation: request.agentDelegation }
          : {}),
        ...(request.onPhase !== undefined ? { onPhase: request.onPhase } : {}),
      }));
    case 'recover':
      return (await recoverWallet({
        apiBase: DEXTER_API_BASE,
        transport: 'inline',
        ...persistence,
        ...(request.preferImmediate !== undefined
          ? { preferImmediate: request.preferImmediate }
          : {}),
        ...(request.onPhase !== undefined ? { onPhase: request.onPhase } : {}),
      }));
    default:
      throw new ConnectError('unsupported_hosted_ceremony');
  }
}

function assertHostedDelegationChoice(request: HostedCeremonyRequest): void {
  if (request.operation !== 'continue' && request.operation !== 'create') return;
  const agentDelegation = resolveAgentDelegationMode(
    request.agentDelegation ?? (request.spendPolicy ? 'configure-now' : undefined),
  );
  if (agentDelegation === 'configure-now' && !request.spendPolicy) {
    throw new ConnectError(
      'missing_spend_policy',
      'agentDelegation configure-now requires a spendPolicy',
    );
  }
  if (agentDelegation === 'deferred' && request.spendPolicy) {
    throw new ConnectError(
      'conflicting_agent_delegation',
      'agentDelegation deferred cannot include a spendPolicy',
    );
  }
}

function assertHostedCeremonyOrigin(): void {
  if (
    typeof window === 'undefined' ||
    window.location.origin !== DEXTER_HOSTED_CEREMONY_ORIGIN
  ) {
    throw new ConnectError(
      'hosted_ceremony_origin_required',
      `Hosted Wallet ceremonies run only on ${DEXTER_HOSTED_CEREMONY_ORIGIN}`,
    );
  }
}
