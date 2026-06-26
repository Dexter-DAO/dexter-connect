// @dexterai/connect — the agent-spend control surface (Layer 2: the honest read).
//
// ONE primitive — "an agent can spend from my vault, scoped + revocable" —
// expressed as TWO grant MODES over ONE balance:
//   • AUTOMATIC  — the role-2 anon agent-spend rail (ON by default, the heal).
//                  Off-switch = revokeAgentSpendMessage; armed-state lives in the
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
// CEREMONY NOTE: the agent-spend endpoints verify the passkey with
// @simplewebauthn/server, where `expectedChallenge = base64url(the RAW message
// bytes)`. So we sign the message DIRECTLY as the WebAuthn challenge (a plain
// navigator.credentials.get via startAuthentication) — NOT through the on-chain
// `signOperation` ceremony, which signs sha256(message) over a server-minted
// challenge (that convention is for the on-chain vault ops + /grants endpoints).
// The message bytes still come from the SDK builder (NEVER hand-rolled — Rule #7).
//
// The assertion is TARGETED (allowCredentials = the wallet's credential id) so
// the OS goes straight to the biometric — same prompt UX as every other passkey
// button in the app, NOT a discoverable account-picker sheet.
//
// FRAMEWORK-FREE: connect reads NO process.env. The API origin is a PARAMETER the
// caller passes (mirrors fetchUsdcBalance taking its rpcUrl). VAULT TYPES: the
// @dexterai/vault message builders are typed in PublicKey from @solana/web3.js —
// web3.js is therefore an inherent PEER of this verb surface (declared as a peer
// dep, never bundled; the consumer already has it).

import { PublicKey } from '@solana/web3.js';
import { startAuthentication } from '@simplewebauthn/browser';
import { revokeAgentSpendMessage, enableAgentSpendMessage } from '@dexterai/vault/messages';
import { DEXTER_VAULT_PROGRAM_ID } from '@dexterai/vault/constants';

import { bytesToBase64url, base64urlToBase64 } from './base64';
import type { IdentityKind } from './identity';

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

/** Normalize a caller-supplied API origin: trim and strip a trailing slash. */
function normalizeOrigin(apiOrigin: string): string {
  return apiOrigin.trim().replace(/\/$/, '');
}

// ── the ceremony ─────────────────────────────────────────────────────────────

/** The RP the passkeys are registered under — the current origin's domain (e.g.
 *  dexter.cash). Derived, not hardcoded, so it follows the deployment. */
function rpId(): string {
  return typeof window !== 'undefined' ? window.location.hostname : 'dexter.cash';
}

/** The three fields the anon router verifies (sent as standard base64). */
interface AnonSignedPayload {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/**
 * Sign a raw operation message DIRECTLY as the WebAuthn challenge — the
 * convention the agent-spend endpoints verify against. Targeted at the given
 * credential (base64url) so the OS prompts the biometric directly. Returns the
 * three fields as standard base64.
 */
async function assertOverMessage(
  messageBytes: Uint8Array,
  credentialId?: string | null,
): Promise<AnonSignedPayload> {
  const resp = await startAuthentication({
    optionsJSON: {
      challenge: bytesToBase64url(messageBytes),
      rpId: rpId(),
      userVerification: 'required',
      ...(credentialId
        ? { allowCredentials: [{ id: credentialId, type: 'public-key' as const }] }
        : {}),
    },
  });
  return {
    clientDataJSON: base64urlToBase64(resp.response.clientDataJSON),
    authenticatorData: base64urlToBase64(resp.response.authenticatorData),
    signature: base64urlToBase64(resp.response.signature),
  };
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
 * @param apiOrigin     The dexter-api origin (e.g. https://api.dexter.cash). The
 *                      caller owns env; connect reads none.
 * @param credentialId  The wallet's passkey credential id (base64url), to make
 *                      the assertion a direct biometric, not an account picker.
 */
export async function revokeAgentSpend(
  id: AgentSpendIdentity,
  vaultPda: string,
  apiOrigin: string,
  credentialId?: string | null,
): Promise<RevokeAgentSpendResult> {
  assertDexterWallet(id);
  const origin = normalizeOrigin(apiOrigin);
  const message = revokeAgentSpendMessage({
    programId: DEXTER_VAULT_PROGRAM_ID,
    vaultPda: new PublicKey(vaultPda),
  });
  const signed = await assertOverMessage(message, credentialId);
  const res = await fetch(`${origin}/api/passkey-vault-anon/revoke-agent-spend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userHandle: id.userHandle, signedPasskeyPayload: signed }),
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
 * @param apiOrigin     The dexter-api origin (e.g. https://api.dexter.cash).
 * @param credentialId  The wallet's passkey credential id (base64url).
 */
export async function enableAgentSpend(
  id: AgentSpendIdentity,
  vaultPda: string,
  apiOrigin: string,
  credentialId?: string | null,
): Promise<EnableAgentSpendResult> {
  assertDexterWallet(id);
  const origin = normalizeOrigin(apiOrigin);

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
  const { nonce, expiry } = (await challengeRes.json()) as { nonce: string; expiry: number };

  // Step 2 — verify: sign the 112-byte ON-switch message over the EXACT
  // nonce+expiry, submit. The server burns the nonce atomically with the flip.
  const message = enableAgentSpendMessage({
    programId: DEXTER_VAULT_PROGRAM_ID,
    vaultPda: new PublicKey(vaultPda),
    nonce: BigInt(nonce),
    expiry: BigInt(expiry),
  });
  const signed = await assertOverMessage(message, credentialId);
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
