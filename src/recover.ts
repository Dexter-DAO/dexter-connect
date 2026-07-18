// Wallet-only sign-in — the P0c "recover" verb.
//
// Re-points this browser at an existing Dexter Wallet via a discoverable
// passkey assertion. Mints NO account session (Branch ruling 2026-07-05: the
// wallet IS the sign-in) — contrast passkeyLogin, which returns Supabase
// tokens. Ceremony: recover-challenge → assertion → recover-verify → vault
// status → setActiveHandle. Persistence happens ONLY after the vault is
// confirmed (fixes the donor quirk where a vaultless handle got persisted).
//
// FIRE ON TAP ONLY: never call this on mount. iOS ≤17.3 grants one
// gesture-less WebAuthn get() "freebie" whose consumption can hang the next
// modal get(); 17.4+ replaces it with opaque rate limiting. The UI copy for
// this verb is "Sign in with Dexter" — "recover" is a code name that must
// never reach a user (SPEC P1.4).

import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import type { RecoverOutcome, RecoverVault, RecoverWalletConfig } from './types';
import { ConnectError } from './types';
import { shouldUsePopup, openCeremonyPopup } from './popup';
import { setActiveHandle } from './walletStore';
import { readErrorCode } from './httpError';
import {
  classifyWebAuthnRejection,
  immediateAuthentication,
  immediateGetSupported,
  primeImmediateSupport,
} from './immediate';

const DEFAULT_API_BASE = 'https://api.dexter.cash';
const ANON_SIGN_BASE = '/api/passkey-anon/sign';

// Resolve the immediate-mode capability probe at module load so the tap-time
// read is already settled — no fresh await between the user gesture and
// navigator.credentials.get() (see immediate.ts).
primeImmediateSupport();

export async function recoverWallet(config: RecoverWalletConfig = {}): Promise<RecoverOutcome> {
  // Hosted-popup transport: on any non-Dexter origin the ceremony runs in a
  // popup on dexter.cash and the OUTCOME comes back over postMessage. A
  // completed ceremony travels ok:true even when the user declined — popup
  // infra failures are the only transport-level errors.
  if (shouldUsePopup(config.transport)) {
    let outcome: RecoverOutcome;
    try {
      outcome = await openCeremonyPopup<RecoverOutcome>('recover', {
        connectHost: config.connectHost,
        apiBase: config.apiBase,
        preferImmediate: config.preferImmediate,
      });
    } catch (err) {
      const ce =
        err instanceof ConnectError
          ? err
          : new ConnectError('popup_failed', err instanceof Error ? err.message : String(err));
      // Closing the sign-in window IS a cancel, not a failure.
      if (ce.code === 'popup_closed') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'error', error: ce };
    }
    // The receiver's inline run wrote dexter.cash localStorage only — persist
    // on the CALLER's origin too (same discipline as enroll's popup path).
    if (outcome.ok) {
      setActiveHandle(outcome.userHandle, outcome.vault.walletLabel ?? undefined, outcome.credentialId);
    }
    return outcome;
  }

  if (typeof navigator === 'undefined' || !browserSupportsWebAuthn()) {
    return {
      ok: false,
      reason: 'error',
      error: new ConnectError('webauthn_unsupported', 'WebAuthn unavailable in this environment'),
    };
  }

  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const onPhase = config.onPhase;

  onPhase?.('challenge');
  let options: PublicKeyCredentialRequestOptionsJSON;
  try {
    const res = await fetch(`${apiBase}${ANON_SIGN_BASE}/recover-challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return { ok: false, reason: 'error', error: new ConnectError(await readErrorCode(res)) };
    options = ((await res.json()) as { options: PublicKeyCredentialRequestOptionsJSON }).options;
  } catch (err) {
    return netError('recover_challenge_failed', err);
  }

  onPhase?.('passkey');
  const useImmediate = Boolean(config.preferImmediate) && (await immediateGetSupported());
  let credential: AuthenticationResponseJSON;
  try {
    credential = useImmediate
      ? await immediateAuthentication(options)
      : await startAuthentication({ optionsJSON: options });
  } catch (err) {
    if (classifyWebAuthnRejection(err)) {
      // Immediate mode rejects instantly when this device has no discoverable
      // passkey; a modal rejection is the user dismissing the sheet.
      return { ok: false, reason: useImmediate ? 'no_credential' : 'cancelled' };
    }
    return {
      ok: false,
      reason: 'error',
      error: new ConnectError('webauthn_failed', err instanceof Error ? err.message : String(err)),
    };
  }

  onPhase?.('verifying');
  let userHandle: string;
  let credentialId: string;
  try {
    const res = await fetch(`${apiBase}${ANON_SIGN_BASE}/recover-verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    // 404 = the passkey exists locally but maps to no server row — offer create.
    if (res.status === 404) return { ok: false, reason: 'no_credential' };
    if (!res.ok) return { ok: false, reason: 'error', error: new ConnectError(await readErrorCode(res)) };
    const data = (await res.json()) as { credentialId: string; userHandle: string };
    userHandle = data.userHandle;
    credentialId = data.credentialId;
  } catch (err) {
    return netError('recover_verify_failed', err);
  }

  // Vault hydration (still 'verifying' — no new user-visible phase). The verify
  // endpoint returns no vault payload, so the verb absorbs the status fetch the
  // fe hook used to do — one call for consumers, and the persistence gate below.
  let vault: RecoverVault;
  try {
    const res = await fetch(
      `${apiBase}/api/passkey-vault-anon/status?user_handle=${encodeURIComponent(userHandle)}`,
    );
    if (!res.ok) return { ok: false, reason: 'error', error: new ConnectError(await readErrorCode(res)) };
    const data = (await res.json()) as {
      hasVault?: boolean;
      vault?: {
        vaultPda: string;
        swigAddress: string;
        receiveAddress?: string | null;
        isActivated?: boolean;
        walletLabel?: string | null;
      } | null;
    };
    if (!data.hasVault || !data.vault) {
      return {
        ok: false,
        reason: 'error',
        error: new ConnectError('vault_not_found', 'this sign-in key has no wallet attached'),
      };
    }
    vault = {
      vaultPda: data.vault.vaultPda,
      swigAddress: data.vault.swigAddress,
      receiveAddress: data.vault.receiveAddress ?? null,
      isActivated: Boolean(data.vault.isActivated),
      walletLabel: data.vault.walletLabel ?? null,
    };
  } catch (err) {
    return netError('vault_status_failed', err);
  }

  // Persist ONLY now that the vault is confirmed — and carry label +
  // credentialId into the roster (the fe donor dropped both; eject's
  // Signal-API prune wants the credentialId).
  setActiveHandle(userHandle, vault.walletLabel ?? undefined, credentialId);
  return { ok: true, userHandle, credentialId, vault };
}

function netError(code: string, err: unknown): RecoverOutcome {
  return {
    ok: false,
    reason: 'error',
    error: new ConnectError(code, err instanceof Error ? err.message : String(err)),
  };
}
