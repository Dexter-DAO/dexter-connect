import type { CeremonyPhase } from './types';

const PHASE_LABEL: Record<CeremonyPhase, string> = {
  challenge: 'Preparing…',
  passkey: 'Waiting for your passkey…',
  verifying: 'Verifying…',
  finalizing: 'Finishing…',
};

/**
 * Human-readable label for a ceremony phase — the live "connecting step" copy.
 * One source of truth for sign-in and Wallet-creation progress labels.
 */
export function ceremonyPhaseLabel(phase: CeremonyPhase): string {
  return PHASE_LABEL[phase];
}
