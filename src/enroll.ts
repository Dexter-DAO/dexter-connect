// @dexterai/connect — createWallet
//
// The wallet-CREATION lifecycle verb the SDK was missing. Until now connect
// could sign in an existing wallet (passkeyLogin), manage one (useDexterWallet),
// and sign with one (createPasskeySigner) — but it could not MINT one. Wallet
// creation lived inside dexter-fe, so every other consumer (agents, phone, a
// third party) had nothing to call. This closes that gap.
//
// createWallet runs the full enrollment ceremony in one call:
//   1. POST /api/passkey-anon/enroll/challenge   → creation options
//   2. navigator.credentials.create(name)        → a passkey, NAMED AT BIRTH
//   3. POST /api/passkey-anon/enroll/complete    → { credentialId, publicKey, userHandle }
//   4. POST /api/passkey-vault-anon/initialize   → the vault (counterfactual; no
//                                                   swig deployed yet)
//   5. setActiveHandle(handle, name, credentialId) — record in the canonical store
//
// The name is set at creation, which is the only moment a passkey label is
// GUARANTEED to stick in the OS keychain (no dependence on the post-hoc Signal
// API, which some platforms no-op). Blank name → the brand default.

import type { ConnectVault, DexterConnectConfig, CeremonyPhase } from './types';
import { ConnectError } from './types';
import { startRegistration } from '@simplewebauthn/browser';
import type {
  RegistrationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { setActiveHandle } from './walletStore';
import { shouldUsePopup, openCeremonyPopup } from './popup';
import { SESSION_TTL_30D } from './policy';
import type { SpendPolicy } from './policy';

const DEFAULT_API_BASE = 'https://api.dexter.cash';
const DEFAULT_RP_ID = 'dexter.cash';
const DEFAULT_WALLET_NAME = 'Dexter Wallet';

export interface CreateWalletConfig extends DexterConnectConfig {
  /** Label for the passkey in the OS keychain AND the wallet roster. Set at
   *  creation — the only moment naming is guaranteed to stick. Default "Dexter Wallet". */
  name?: string;
  /** RP id for the new credential. Default "dexter.cash". */
  rpId?: string;
  /** Consent-at-birth allowance the user authored at creation (chips $5/$20/$50
   *  or Custom; zero is not consent; build it with authoredPolicy()). When
   *  present it rides the /initialize body so the number becomes the server-side
   *  write-once consent record. The TTL is ruled fixed 30d — whatever the object
   *  carries, the wire always sends SESSION_TTL_30D. Absent → no policy authored
   *  (the vault initializes without one; nothing invents a default). */
  spendPolicy?: SpendPolicy;
  /** Called as the ceremony progresses, for live "connecting steps" UI:
   *  challenge → passkey → verifying → finalizing. */
  onPhase?: (phase: CeremonyPhase) => void;
}

export interface CreateWalletResult {
  /** Server-minted 16-byte user handle, base64url — the vault identity. */
  handle: string;
  /** base64url credential id of the new passkey. */
  credentialId: string;
  /** The freshly initialized vault (swig not yet deployed; deploys lazily). */
  vault: ConnectVault;
}

/**
 * Mint a brand-new Dexter wallet (passkey + vault) and make it the active wallet.
 *
 * One passkey approval. Throws ConnectError on any failed leg (the `code` is the
 * server's error string, or webauthn_failed / no_credential for the ceremony).
 */
export async function createWallet(
  config: CreateWalletConfig = {},
): Promise<CreateWalletResult> {
  // Hosted-popup transport: on any non-Dexter origin, run the create ceremony in
  // a popup on dexter.cash and get the wallet back (works on any website).
  if (shouldUsePopup(config.transport)) {
    const result = await openCeremonyPopup<CreateWalletResult>('create', {
      connectHost: config.connectHost,
      name: config.name,
      apiBase: config.apiBase,
    });
    // The ceremony ran on dexter.cash (its localStorage), so a third-party-origin
    // create would otherwise leave THIS caller's store empty. Persist from the
    // returned result on the caller's origin — label from the requested name.
    setActiveHandle(result.handle, config.name, result.credentialId);
    return result;
  }
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new ConnectError('webauthn_unsupported', 'WebAuthn unavailable in this environment');
  }
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const rpId = config.rpId ?? DEFAULT_RP_ID;
  const name = (config.name && config.name.trim()) || DEFAULT_WALLET_NAME;

  config.onPhase?.('challenge');
  const options = await fetchEnrollChallenge(apiBase);
  config.onPhase?.('passkey');
  // Override the keychain labels: rp.name = the brand shown in the OS sheet;
  // user.name/displayName = the chosen wallet name (the server sends a raw,
  // unreadable handle). These aren't part of the signed attestation, so setting
  // them client-side is safe — same as the old buildCreationOptions did.
  const optionsJSON: PublicKeyCredentialCreationOptionsJSON = {
    ...options,
    rp: { ...options.rp, id: options.rp.id ?? rpId, name: 'Dexter' },
    user: { ...options.user, name, displayName: name },
  };
  let regResponse: RegistrationResponseJSON;
  try {
    // SimpleWebAuthn runs create() + all the base64url/ArrayBuffer marshalling
    // and returns server-ready JSON. (Replaces hand-rolled createCredential.)
    regResponse = await startRegistration({ optionsJSON });
  } catch (err) {
    throw new ConnectError('webauthn_failed', err instanceof Error ? err.message : String(err));
  }
  config.onPhase?.('verifying');
  const enrolled = await submitEnrollComplete(apiBase, regResponse);
  config.onPhase?.('finalizing');
  const init = await initializeVault(
    apiBase,
    enrolled.userHandle,
    enrolled.credentialId,
    config.spendPolicy,
  );

  // Record in the canonical store — the label matches the passkey's keychain
  // entry, and storing the credentialId lets a later eject() auto-prune it.
  setActiveHandle(enrolled.userHandle, name, enrolled.credentialId);

  return {
    handle: enrolled.userHandle,
    credentialId: enrolled.credentialId,
    vault: {
      vaultPda: init.vaultPda,
      swigAddress: init.swigStateAddress,
      // FAIL SAFE: never invent a receive address — null until the server returns
      // one (depositing to the config PDA would strand funds).
      receiveAddress: init.receiveAddress ?? null,
      usdcAta: null, // swig not deployed yet (counterfactual pattern)
      publicKey: enrolled.publicKey,
      userHandle: enrolled.userHandle,
      credentialId: enrolled.credentialId,
    },
  };
}

// ---------------------------------------------------------------------------
// Ceremony legs
// ---------------------------------------------------------------------------

async function fetchEnrollChallenge(
  apiBase: string,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const res = await fetch(`${apiBase}/api/passkey-anon/enroll/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new ConnectError('enroll_challenge_failed', `enroll/challenge ${res.status}`);
  const data = (await res.json()) as { options?: PublicKeyCredentialCreationOptionsJSON };
  if (!data?.options?.challenge) {
    throw new ConnectError('enroll_challenge_malformed', 'no creation options in response');
  }
  return data.options;
}

async function submitEnrollComplete(
  apiBase: string,
  response: RegistrationResponseJSON,
): Promise<{ credentialId: string; publicKey: string; userHandle: string }> {
  // RegistrationResponseJSON already matches the server's expected credential
  // shape (id/rawId/response.{attestationObject,clientDataJSON,transports}/...).
  const res = await fetch(`${apiBase}/api/passkey-anon/enroll/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: response }),
  });
  if (!res.ok) throw new ConnectError(await readErrorCode(res), `enroll/complete ${res.status}`);
  return (await res.json()) as { credentialId: string; publicKey: string; userHandle: string };
}

async function initializeVault(
  apiBase: string,
  userHandle: string,
  credentialId: string,
  spendPolicy?: SpendPolicy,
): Promise<{ vaultPda: string; receiveAddress: string | null; swigStateAddress: string }> {
  const body: Record<string, unknown> = { userHandle, credentialId, coolingOffSeconds: 0 };
  // Consent-at-birth: when the user authored an allowance, it rides here (same
  // wire slot as coolingOffSeconds). The TTL is ruled fixed 30d and never
  // user-editable — overwrite whatever the caller's object carries with
  // SESSION_TTL_30D so a tampered sessionTtlSeconds can never reach the server.
  if (spendPolicy) {
    body.spendLimitAtomic = spendPolicy.spendLimitAtomic;
    body.sessionTtlSeconds = SESSION_TTL_30D;
  }
  const res = await fetch(`${apiBase}/api/passkey-vault-anon/initialize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ConnectError(await readErrorCode(res), `initialize ${res.status}`);
  return (await res.json()) as {
    vaultPda: string;
    receiveAddress: string | null;
    swigStateAddress: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the server's snake_case `error` field; fall back to an http_<status> code. */
async function readErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // non-JSON body — fall through
  }
  return `http_${res.status}`;
}
