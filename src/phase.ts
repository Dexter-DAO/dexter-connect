import type { CeremonyPhase } from './types';

const PHASE_LABEL: Record<CeremonyPhase, string> = {
  challenge: 'Preparing…',
  passkey: 'Waiting for your passkey…',
  verifying: 'Verifying…',
  finalizing: 'Finishing…',
};

/**
 * Human-readable label for a ceremony phase — the live "connecting step" copy.
 * ONE source of truth so sign-in (SignInWithDexter) and create (consumer setup
 * flows) show identical wording. Consumers surfacing createWallet's `onPhase`
 * should use this instead of hand-rolling their own strings (Rule #7).
 */
export function ceremonyPhaseLabel(phase: CeremonyPhase): string {
  return PHASE_LABEL[phase];
}
