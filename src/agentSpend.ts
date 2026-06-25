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
