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
import { base64urlToBytes, bytesToBase64url } from './base64';
import { setActiveHandle } from './walletStore';
import { shouldUsePopup, openCeremonyPopup } from './popup';

const DEFAULT_API_BASE = 'https://api.dexter.cash';
const DEFAULT_RP_ID = 'dexter.cash';
const DEFAULT_WALLET_NAME = 'Dexter Wallet';

export interface CreateWalletConfig extends DexterConnectConfig {
  /** Label for the passkey in the OS keychain AND the wallet roster. Set at
   *  creation — the only moment naming is guaranteed to stick. Default "Dexter Wallet". */
  name?: string;
  /** RP id for the new credential. Default "dexter.cash". */
  rpId?: string;
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

/** Server-issued WebAuthn creation options (the `options` field of the challenge). */
interface CreationOptionsJSON {
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout?: number;
  excludeCredentials?: Array<{ id: string; type: 'public-key'; transports?: string[] }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
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
    return openCeremonyPopup<CreateWalletResult>('create', {
      connectHost: config.connectHost,
      name: config.name,
      apiBase: config.apiBase,
    });
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
  const credential = await createCredential(options, name, rpId);
  config.onPhase?.('verifying');
  const enrolled = await submitEnrollComplete(apiBase, credential);
  config.onPhase?.('finalizing');
  const init = await initializeVault(apiBase, enrolled.userHandle, enrolled.credentialId);

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

async function fetchEnrollChallenge(apiBase: string): Promise<CreationOptionsJSON> {
  const res = await fetch(`${apiBase}/api/passkey-anon/enroll/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new ConnectError('enroll_challenge_failed', `enroll/challenge ${res.status}`);
  const data = (await res.json()) as { options?: CreationOptionsJSON };
  if (!data?.options?.challenge) {
    throw new ConnectError('enroll_challenge_malformed', 'no creation options in response');
  }
  return data.options;
}

async function createCredential(
  options: CreationOptionsJSON,
  name: string,
  rpId: string,
): Promise<PublicKeyCredential> {
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: buildCreationOptions(options, name, rpId),
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new ConnectError('webauthn_failed', err instanceof Error ? err.message : String(err));
  }
  if (!credential || credential.type !== 'public-key') {
    throw new ConnectError('no_credential', 'authenticator returned no credential');
  }
  return credential;
}

async function submitEnrollComplete(
  apiBase: string,
  credential: PublicKeyCredential,
): Promise<{ credentialId: string; publicKey: string; userHandle: string }> {
  const attestation = credential.response as AuthenticatorAttestationResponse;
  const credentialJson = {
    id: credential.id,
    rawId: bytesToBase64url(new Uint8Array(credential.rawId)),
    type: credential.type,
    response: {
      attestationObject: bytesToBase64url(new Uint8Array(attestation.attestationObject)),
      clientDataJSON: bytesToBase64url(new Uint8Array(attestation.clientDataJSON)),
      transports:
        typeof attestation.getTransports === 'function' ? attestation.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    authenticatorAttachment:
      (credential as { authenticatorAttachment?: string }).authenticatorAttachment ?? null,
  };
  const res = await fetch(`${apiBase}/api/passkey-anon/enroll/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: credentialJson }),
  });
  if (!res.ok) throw new ConnectError(await readErrorCode(res), `enroll/complete ${res.status}`);
  return (await res.json()) as { credentialId: string; publicKey: string; userHandle: string };
}

async function initializeVault(
  apiBase: string,
  userHandle: string,
  credentialId: string,
): Promise<{ vaultPda: string; receiveAddress: string | null; swigStateAddress: string }> {
  const res = await fetch(`${apiBase}/api/passkey-vault-anon/initialize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userHandle, credentialId, coolingOffSeconds: 0 }),
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

/** base64url string → a fresh ArrayBuffer (BufferSource for the WebAuthn call). */
function toBuf(b64url: string): ArrayBuffer {
  return base64urlToBytes(b64url).buffer.slice(0) as ArrayBuffer;
}

function buildCreationOptions(
  o: CreationOptionsJSON,
  name: string,
  rpId: string,
): PublicKeyCredentialCreationOptions {
  return {
    // rp.name = the site shown in the keychain; user.name/displayName = the
    // wallet label the user sees. We override the server's user.name (a raw,
    // unreadable handle) with the chosen wallet name.
    rp: { id: o.rp.id ?? rpId, name: 'Dexter' },
    user: {
      id: toBuf(o.user.id),
      name,
      displayName: name,
    },
    challenge: toBuf(o.challenge),
    pubKeyCredParams: o.pubKeyCredParams,
    timeout: o.timeout,
    excludeCredentials: o.excludeCredentials?.map((c) => ({
      id: toBuf(c.id),
      type: c.type,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: o.authenticatorSelection,
    attestation: o.attestation,
  };
}

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
