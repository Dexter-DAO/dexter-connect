// @dexterai/connect — the agent-spend control surface (Layer 2: the honest read).
//
// ONE primitive — "an agent can spend from my vault, scoped + revocable" —
// expressed as TWO grant MODES over ONE balance:
//   • AUTOMATIC  — the role-2 anon agent-spend rail (ON by default, the heal).
//                  Off-switch = one-time revokeAgentSpendV2Message; armed-state lives in the
//                  Ed25519 session's authority.signer on-chain.
//   • TABS       — explicit, user-opened V6 per-counterparty sessions, each its
//                  own cap; killed by sessionRevokeMessage.
//
// The two modes draw the SAME vault USDC — there is NO second pool. They do NOT
// share cap accounting (by design: two cap regimes), so an honest read must keep
// them SEPARATE and labeled, never merge them into one number that hides which
// rail. If this read lies, every screen lies.
//
// THE TRAP this module exists to avoid: `onchain.liveSessionCount` counts V6 Tab
// PDAs, a DIFFERENT model than the Ed25519 arm. It reads 0 on a fully-armed
// automatic rail. The armed indicator MUST read `agentSpendArmed` (the backend's
// authority.signer decode), never liveSessionCount.
//
// Pure + framework-free: takes the raw /status and /sessions shapes as INPUT and
// returns the two-mode object. The consumer owns the fetch; this owns the truth.
//
// ── The VERBS (revoke / enable) ──────────────────────────────────────────────
// The assembler above is the READ. Below are the WRITES — the off/on switch for
// the AUTOMATIC role-2 rail. Migrated out of dexter-fe (app/lib/vault/agentSpend.ts)
// so every consumer shares ONE implementation instead of hand-rolling its own
// fork (Rule #7 — kill bypass drift).
//
// CEREMONY NOTE: agent-spend now uses the same canonical server envelope as
// every vault authorization. The pinned API binds sha256(raw operation), the
// exact vault, program, current guard nonce, release epoch, and fresh ceremony
// entropy. The backend action re-verifies those bytes; raw-operation WebAuthn
// challenges and caller-derived RP IDs are deliberately unsupported.
//
// The assertion is TARGETED (allowCredentials = the wallet's credential id) so
// the OS goes straight to the biometric — same prompt UX as every other passkey
// button in the app, NOT a discoverable account-picker sheet.
//
// FRAMEWORK-FREE: connect reads NO process.env. The historical API-origin
// parameter remains source-compatible, but it may only name Dexter's pinned
// signing server. This constrains the WebAuthn trust anchor, not the arbitrary
// third-party website embedding Connect. VAULT TYPES: the @dexterai/vault
// message builders are typed in PublicKey from @solana/web3.js — web3.js is
// therefore an inherent PEER of this verb surface (declared as a peer dep,
// never bundled; the consumer already has it).

import { PublicKey } from '@solana/web3.js';
import { WebAuthnAssertion } from '@dexterai/vault/signers/browser';
import { validatePasskeyAuthorizationChallenge } from '@dexterai/vault';
import { enableAgentSpendMessage, revokeAgentSpendV2Message } from '@dexterai/vault/messages';
import { DEXTER_VAULT_PROGRAM_ID } from '@dexterai/vault/constants';

import {
  base64urlToBytes,
  bytesToBase64,
  bytesToBase64url,
} from './base64';
import type { IdentityKind } from './identity';
import {
  bytesEqual,
  resolveDexterApiBase,
  resolveDexterRpId,
} from './trust';

/** The automatic role-2 agent-spend rail. */
export interface AutomaticAgentSpend {
  /** true = agent-spend is ON (not revoked). Derived from revokedAt === null. */
  active: boolean;
  /** ISO timestamp the rail was revoked, or null when active. */
  revokedAt: string | null;
  /**
   * On-chain role-2 arm state, decoded from authority.signer by the backend:
   *   true  = armed (the rail is live and can spend)
   *   false = dormant (granted but not yet armed — arms on first pay)
   *   null  = indeterminate (vault not activated, or a transient chain read failed)
   * NEVER derived from liveSessionCount (that counts the wrong session model).
   */
  armed: boolean | null;
  // Spend counters — surfaced ONLY when the backend provides them. Never faked:
  // an absent counter stays undefined so the UI renders "—", not a false $0.
  spentTodayAtomic?: string;
  dailyCapAtomic?: string;
  perCallCapAtomic?: string;
  lifetimeSpentAtomic?: string;
}

/** One explicit user-opened Tab (a V6 per-counterparty session). */
export interface AgentSpendTab {
  /** The session pubkey — the handle a Tab revoke targets. */
  id: string;
  /** The counterparty (agent/app) address this Tab authorizes. */
  counterparty: string;
  /** Display label: the Dexter-verified app name, else a shortened address. */
  label: string;
  /** Whether the Tab is currently live (not expired/spent-out/revoked). */
  live: boolean;
  /** Spent so far against this Tab's cap, atomic USDC (6dp) string. */
  spentAtomic: string;
  /** This Tab's spending cap, atomic USDC (6dp) string. */
  capAtomic: string;
  /** Unix seconds when the Tab expires. */
  expiresAt: number;
}

/** The honest two-mode status: one balance, two separately-accounted rails. */
export interface AgentSpendStatus {
  /** Vault USDC balance, atomic (6dp) string — the ONE pool both rails draw. */
  balanceAtomic: string | null;
  /** The automatic role-2 rail. */
  automatic: AutomaticAgentSpend;
  /** The explicit Tabs. */
  tabs: AgentSpendTab[];
}

// ── Raw inputs ───────────────────────────────────────────────────────────────
// Minimal STRUCTURAL shapes of the live /status + /sessions responses — kept
// loose on purpose so the assembler doesn't couple to any one consumer's full
// client type. Extra fields on the real responses are ignored.

/** The fields of GET /status the two-mode read consumes. */
export interface RawAgentSpendStatus {
  /** ISO timestamp when revoked, null when active. Top-level on /status. */
  agentSpendRevokedAt?: string | null;
  /** On-chain armed read (authority.signer). true/false/null. Top-level on /status. */
  agentSpendArmed?: boolean | null;
  /** On-chain block; usdcAtomic is the vault balance. */
  onchain?: {
    usdcAtomic?: string | null;
    /** Present but DELIBERATELY UNUSED here — counts the wrong session model. */
    liveSessionCount?: number;
  } | null;
  // Optional spend counters — passed through only if the backend includes them.
  agentSpendDaily?: {
    spentTodayAtomic?: string;
    dailyCapAtomic?: string;
    perCallCapAtomic?: string;
    lifetimeSpentAtomic?: string;
  } | null;
}

/** The fields of one GET /sessions row the Tabs rail consumes. */
export interface RawAgentSpendSession {
  sessionPubkey: string;
  counterparty: string;
  appName?: string | null;
  live: boolean;
  spent: string;
  maxAmount: string;
  expiresAt: number;
}

function shortCounterparty(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

/**
 * Assemble the honest two-mode agent-spend status from the raw /status response
 * and the raw /sessions rows. Pure: no fetch, no clock, no I/O.
 */
export function assembleAgentSpendStatus(
  status: RawAgentSpendStatus,
  sessions: RawAgentSpendSession[] = [],
): AgentSpendStatus {
  const revokedAt = status.agentSpendRevokedAt ?? null;
  const daily = status.agentSpendDaily ?? null;

  const automatic: AutomaticAgentSpend = {
    active: revokedAt === null,
    revokedAt,
    // THE honest read: the dedicated armed field, never liveSessionCount.
    armed: status.agentSpendArmed ?? null,
  };
  // Attach spend counters only if present — never invent a 0.
  if (daily) {
    if (daily.spentTodayAtomic !== undefined) automatic.spentTodayAtomic = daily.spentTodayAtomic;
    if (daily.dailyCapAtomic !== undefined) automatic.dailyCapAtomic = daily.dailyCapAtomic;
    if (daily.perCallCapAtomic !== undefined) automatic.perCallCapAtomic = daily.perCallCapAtomic;
    if (daily.lifetimeSpentAtomic !== undefined) automatic.lifetimeSpentAtomic = daily.lifetimeSpentAtomic;
  }

  return {
    balanceAtomic: status.onchain?.usdcAtomic ?? null,
    automatic,
    tabs: sessions.map((s) => ({
      id: s.sessionPubkey,
      counterparty: s.counterparty,
      label: s.appName?.trim() || shortCounterparty(s.counterparty),
      live: s.live,
      spentAtomic: s.spent,
      capAtomic: s.maxAmount,
      expiresAt: s.expiresAt,
    })),
  };
}

// ── identity the verbs need ──────────────────────────────────────────────────

/**
 * The minimal identity the off/on switch needs: WHO is active + the wallet
 * handle the anon router keys on. Structurally satisfied by connect's
 * ResolvedIdentity (pass it straight through), or hand-build `{ kind, userHandle }`.
 */
export interface AgentSpendIdentity {
  /** Passkey-vault-first identity axis. Agent-spend is Dexter-Wallet-only. */
  kind: IdentityKind;
  /** The passkey-vault user handle the anon router addresses, or null. */
  userHandle: string | null;
}

// ── typed error + human copy ─────────────────────────────────────────────────

/** Typed error whose `code` is the server's snake_case error string. */
export class AgentSpendError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'AgentSpendError';
  }
}

/** Map an AgentSpendError.code to plain, user-facing copy. */
export function describeAgentSpendError(code: string): string {
  switch (code) {
    case 'verification_failed':
      return "That passkey didn't verify — try again.";
    case 'missing_fields':
      return 'The request was incomplete — try again.';
    case 'vault_not_found':
      return 'No wallet found for this passkey.';
    case 'nonce_not_found':
    case 'nonce_already_used':
      return 'That confirmation expired — tap again to retry.';
    case 'revoke_failed':
    case 'enable_failed':
      return "The server couldn't complete it — try again shortly.";
    case 'not_guest':
      return 'This control is only available on a Dexter Wallet.';
    case 'hosted_signer_required':
      return 'Open Dexter’s secure approval window to confirm this change.';
    case 'challenge_malformed':
    case 'challenge_mismatch':
    case 'credential_mismatch':
      return 'Dexter could not verify exactly what you were asked to approve.';
    default:
      return code;
  }
}

async function agentSpendError(res: Response): Promise<AgentSpendError> {
  let code = `http_${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) code = String(body.error);
  } catch {
    /* non-JSON body — keep http_<status> */
  }
  return new AgentSpendError(code, `agent-spend ${res.status}: ${code}`);
}

/** Dexter-Wallet (passkey-vault) guard — the off/on switch is anon-vault only. */
function assertDexterWallet(id: AgentSpendIdentity): void {
  if (id.kind !== 'passkey-vault') {
    throw new AgentSpendError('not_guest', 'agent-spend off/on switch is Dexter Wallet only');
  }
}

function assertHostedSignerIfNeeded(signer?: AgentSpendOperationSigner): void {
  if (
    !signer &&
    (typeof window === 'undefined' || window.location.origin !== 'https://dexter.cash')
  ) {
    throw new AgentSpendError(
      'hosted_signer_required',
      'agent-spend consent on a third-party website requires Dexter\'s hosted signer',
    );
  }
}

// ── the ceremony ─────────────────────────────────────────────────────────────

/** The three fields the anon router verifies (sent as standard base64). */
interface AnonSignedPayload {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** A caller may supply Connect's hosted signer on an arbitrary website. */
export interface AgentSpendOperationSigner {
  signOperation(operationMessage: Uint8Array): Promise<{
    signature: Uint8Array;
    clientDataJSON: Uint8Array;
    authenticatorData: Uint8Array;
  }>;
}

function signedPayload(result: {
  signature: Uint8Array;
  clientDataJSON: Uint8Array;
  authenticatorData: Uint8Array;
}): AnonSignedPayload {
  if (
    result.signature.length !== 64 ||
    result.clientDataJSON.length === 0 ||
    result.authenticatorData.length < 37
  ) {
    throw new AgentSpendError('verification_failed', 'signer returned malformed assertion bytes');
  }
  return {
    clientDataJSON: bytesToBase64(result.clientDataJSON),
    authenticatorData: bytesToBase64(result.authenticatorData),
    signature: bytesToBase64(result.signature),
  };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new AgentSpendError('webauthn_unavailable', 'Web Crypto is unavailable');
  }
  return new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
  );
}

/**
 * Canonical inline ceremony for Dexter's own origin. An unrelated website must
 * supply the hosted signer returned by createPasskeySigner; it must never run a
 * Dexter credential ceremony under its own browser origin.
 */
async function assertCanonicalOperationInline(
  messageBytes: Uint8Array,
  userHandle: string,
  expectedVault: PublicKey,
  apiBase: string,
  credentialId?: string | null,
): Promise<AnonSignedPayload> {
  if (typeof window === 'undefined' || window.location.origin !== 'https://dexter.cash') {
    throw new AgentSpendError(
      'hosted_signer_required',
      'agent-spend consent on a third-party website requires Dexter\'s hosted signer',
    );
  }

  const operationHash = await sha256(messageBytes);
  const challengeRes = await fetch(`${apiBase}/api/passkey-anon/sign/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userHandle,
      operationMessage: bytesToBase64url(messageBytes),
      operationHash: bytesToBase64url(operationHash),
      operation: 'vault_operation',
    }),
  });
  if (!challengeRes.ok) throw await agentSpendError(challengeRes);
  const data = (await challengeRes.json()) as {
    options?: {
      challenge?: string;
      rpId?: string;
      allowCredentials?: Array<{
        id: string;
        transports?: AuthenticatorTransport[];
      }>;
    };
  };
  const options = data.options;
  const serverCredential = options?.allowCredentials?.[0];
  if (!options?.challenge || !serverCredential?.id) {
    throw new AgentSpendError('challenge_malformed', 'Dexter returned an incomplete challenge');
  }
  const rpId = resolveDexterRpId(options.rpId);
  if (credentialId && credentialId !== serverCredential.id) {
    throw new AgentSpendError('credential_mismatch', 'Dexter returned a different credential');
  }
  const challenge = base64urlToBytes(options.challenge);
  try {
    validatePasskeyAuthorizationChallenge({
      challenge,
      operationHash,
      expectedVault,
    });
  } catch {
    throw new AgentSpendError('challenge_mismatch', 'Dexter returned an unbound challenge');
  }

  const assertion = await new WebAuthnAssertion({
    credentialId: base64urlToBytes(serverCredential.id),
    rpId,
    allowCredentials: [{
      id: base64urlToBytes(serverCredential.id),
      transports: serverCredential.transports,
    }],
  }).assertOver(challenge);

  const credential = {
    id: serverCredential.id,
    rawId: serverCredential.id,
    type: 'public-key' as const,
    response: {
      clientDataJSON: bytesToBase64url(assertion.clientDataJSON),
      authenticatorData: bytesToBase64url(assertion.authenticatorData),
      signature: bytesToBase64url(assertion.signatureDer),
      userHandle: null,
    },
    clientExtensionResults: {},
    authenticatorAttachment: null,
  };
  const verifyRes = await fetch(`${apiBase}/api/passkey-anon/sign/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential, userHandle }),
  });
  if (!verifyRes.ok) throw await agentSpendError(verifyRes);
  const verified = (await verifyRes.json()) as { verified?: boolean };
  if (verified.verified !== true) {
    throw new AgentSpendError('verification_failed', 'Dexter did not verify the assertion');
  }
  return signedPayload(assertion);
}

async function authorizeAgentSpendOperation(
  messageBytes: Uint8Array,
  id: AgentSpendIdentity,
  expectedVault: PublicKey,
  apiBase: string,
  credentialId?: string | null,
  signer?: AgentSpendOperationSigner,
): Promise<AnonSignedPayload> {
  if (!id.userHandle) throw new AgentSpendError('missing_fields', 'wallet handle is required');
  if (signer) return signedPayload(await signer.signOperation(new Uint8Array(messageBytes)));
  return assertCanonicalOperationInline(
    new Uint8Array(messageBytes),
    id.userHandle,
    expectedVault,
    apiBase,
    credentialId,
  );
}

// ── the verbs ────────────────────────────────────────────────────────────────

export interface RevokeAgentSpendResult {
  revoked: boolean;
}

/**
 * Revoke the AUTOMATIC role-2 agent-spend rail — the off-switch. Takes effect on
 * the very next agent payment (the spend path reads agent_spend_revoked_at fresh
 * per spend). Dexter-Wallet (anon-vault) only; `credentialId` (base64url) targets
 * the biometric prompt.
 *
 * @param id            WHO is active — must be the passkey-vault (Dexter Wallet).
 * @param vaultPda      The vault PDA, base58 string. Becomes the signed message.
 * @param apiOrigin     Compatibility-only: must be https://api.dexter.cash.
 * @param credentialId  The wallet's passkey credential id (base64url), to make
 *                      the assertion a direct biometric, not an account picker.
 */
export async function revokeAgentSpend(
  id: AgentSpendIdentity,
  vaultPda: string,
  apiOrigin: string,
  credentialId?: string | null,
  signer?: AgentSpendOperationSigner,
): Promise<RevokeAgentSpendResult> {
  assertDexterWallet(id);
  // Reject an untrusted challenge/verification server before building the
  // operation or invoking WebAuthn. The embedding website remains unrestricted.
  const origin = resolveDexterApiBase(apiOrigin);
  assertHostedSignerIfNeeded(signer);
  if (!id.userHandle) throw new AgentSpendError('missing_fields', 'wallet handle is required');

  // Revocation also uses a one-time intent. A deterministic V1 assertion could
  // otherwise be replayed after a later re-enable and unexpectedly turn the
  // rail off again.
  const challengeRes = await fetch(
    `${origin}/api/passkey-vault-anon/revoke-agent-spend/challenge`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userHandle: id.userHandle }),
    },
  );
  if (!challengeRes.ok) throw await agentSpendError(challengeRes);
  const challenge = (await challengeRes.json()) as {
    nonce?: string;
    expiry?: number;
    operationMessage?: string;
  };
  if (
    typeof challenge.nonce !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(challenge.nonce) ||
    typeof challenge.expiry !== 'number' ||
    !Number.isSafeInteger(challenge.expiry) ||
    typeof challenge.operationMessage !== 'string'
  ) {
    throw new AgentSpendError('challenge_malformed', 'Dexter returned an incomplete revoke intent');
  }

  const expectedVault = new PublicKey(vaultPda);
  const message = revokeAgentSpendV2Message({
    programId: DEXTER_VAULT_PROGRAM_ID,
    vaultPda: expectedVault,
    nonce: BigInt(challenge.nonce),
    expiry: BigInt(challenge.expiry),
  });
  let serverMessage: Uint8Array;
  try {
    serverMessage = base64urlToBytes(challenge.operationMessage);
  } catch {
    throw new AgentSpendError('challenge_malformed', 'Dexter returned invalid revoke bytes');
  }
  if (!bytesEqual(serverMessage, message)) {
    throw new AgentSpendError('challenge_mismatch', 'Dexter returned a different revoke operation');
  }
  const signed = await authorizeAgentSpendOperation(
    serverMessage,
    id,
    expectedVault,
    origin,
    credentialId,
    signer,
  );
  const res = await fetch(`${origin}/api/passkey-vault-anon/revoke-agent-spend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userHandle: id.userHandle,
      nonce: challenge.nonce,
      signedPasskeyPayload: signed,
    }),
  });
  if (!res.ok) throw await agentSpendError(res);
  return (await res.json()) as RevokeAgentSpendResult;
}

export interface EnableAgentSpendResult {
  enabled: boolean;
}

/**
 * Re-enable the AUTOMATIC role-2 agent-spend rail — the ON switch. Turning spend
 * back ON is the dangerous direction, so it is a two-step, replay-protected nonce
 * flow: fetch a server-minted nonce+expiry (inert until redeemed), sign
 * enableAgentSpendMessage over those EXACT values as the WebAuthn challenge,
 * submit. Dexter-Wallet (anon-vault) only.
 *
 * @param id            WHO is active — must be the passkey-vault (Dexter Wallet).
 * @param vaultPda      The vault PDA, base58 string.
 * @param apiOrigin     Compatibility-only: must be https://api.dexter.cash.
 * @param credentialId  The wallet's passkey credential id (base64url).
 */
export async function enableAgentSpend(
  id: AgentSpendIdentity,
  vaultPda: string,
  apiOrigin: string,
  credentialId?: string | null,
  signer?: AgentSpendOperationSigner,
): Promise<EnableAgentSpendResult> {
  assertDexterWallet(id);
  // Fail before the nonce request and before WebAuthn if a caller tries to
  // retarget this operation to a different signing server.
  const origin = resolveDexterApiBase(apiOrigin);
  assertHostedSignerIfNeeded(signer);

  // Step 1 — challenge: nonce + expiry (inert until redeemed in step 2).
  const challengeRes = await fetch(
    `${origin}/api/passkey-vault-anon/enable-agent-spend/challenge`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userHandle: id.userHandle }),
    },
  );
  if (!challengeRes.ok) throw await agentSpendError(challengeRes);
  const challenge = (await challengeRes.json()) as {
    nonce?: string;
    expiry?: number;
    operationMessage?: string;
  };
  if (
    typeof challenge.nonce !== 'string' ||
    typeof challenge.expiry !== 'number' ||
    typeof challenge.operationMessage !== 'string'
  ) {
    throw new AgentSpendError('challenge_malformed', 'Dexter returned an incomplete enable intent');
  }
  const { nonce, expiry } = challenge;

  // Step 2 — verify: sign the 112-byte ON-switch message over the EXACT
  // nonce+expiry, submit. The server burns the nonce atomically with the flip.
  const expectedVault = new PublicKey(vaultPda);
  const message = enableAgentSpendMessage({
    programId: DEXTER_VAULT_PROGRAM_ID,
    vaultPda: expectedVault,
    nonce: BigInt(nonce),
    expiry: BigInt(expiry),
  });
  let serverMessage: Uint8Array;
  try {
    serverMessage = base64urlToBytes(challenge.operationMessage);
  } catch {
    throw new AgentSpendError('challenge_malformed', 'Dexter returned invalid enable bytes');
  }
  if (!bytesEqual(serverMessage, message)) {
    throw new AgentSpendError('challenge_mismatch', 'Dexter returned a different enable operation');
  }
  const signed = await authorizeAgentSpendOperation(
    serverMessage,
    id,
    expectedVault,
    origin,
    credentialId,
    signer,
  );
  const verifyRes = await fetch(
    `${origin}/api/passkey-vault-anon/enable-agent-spend/verify`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userHandle: id.userHandle, nonce, signedPasskeyPayload: signed }),
    },
  );
  if (!verifyRes.ok) throw await agentSpendError(verifyRes);
  return (await verifyRes.json()) as EnableAgentSpendResult;
}
