// @dexterai/connect — public types.

/** Supabase session tokens returned by dexter-api's passkey-login (camelCase). */
export interface PasskeyLoginTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  expiresIn: number;
  tokenType: string;
}

/**
 * Vault identity, returned ALONGSIDE the session by passkey-login once
 * vault-review ships the dexter-api change (ASK 1). Optional until then —
 * the connector degrades to session-only. Consumers that open x402 tabs
 * (dexter-agents) need `vaultPda` + `publicKey` to build a passkey signer.
 */
export interface ConnectVault {
  vaultPda: string;
  /** Swig state address, base58 — the user-facing Dexter Wallet address. */
  swigAddress: string;
  /** v2 swig wallet PDA (deposit address); null until the swig is deployed. */
  receiveAddress: string | null;
  /** Swig wallet's USDC ATA, base58 (for the connected-chip balance read);
   *  null until the swig is deployed. Server-resolved (off-curve-safe). */
  usdcAta: string | null;
  /** base64 33-byte SEC1 compressed P-256 authority pubkey (for the signer). */
  publicKey: string;
  userHandle: string;
  credentialId: string;
  /** The wallet's cross-device display name (user-authored via rename), or
   *  null when never named. Identity is first-class: every sign-in carries
   *  the human name so no consumer ever falls back to a synthetic email.
   *  Optional for wire-compat with servers/popup pages predating 0.23. */
  walletLabel?: string | null;
}

/** Result of a completed "Sign in with Dexter" ceremony. */
export interface SignInResult {
  session: PasskeyLoginTokens;
  /** Present once vault-review ships the vault-in-login change. */
  vault?: ConnectVault;
}

/**
 * Coarse ceremony phase, emitted as a sign-in/create ceremony progresses so the
 * UI can show live "connecting steps" instead of one flat spinner:
 *   challenge → passkey (the OS prompt) → verifying → finalizing (create only).
 */
export type CeremonyPhase = 'challenge' | 'passkey' | 'verifying' | 'finalizing';

/**
 * Vault identity on the wallet-only recover leg, as reported by
 * /api/passkey-vault-anon/status. Narrower than ConnectVault on purpose —
 * the status endpoint carries no publicKey/usdcAta, so a recover cannot
 * construct a passkey signer; it re-points this browser at the wallet and
 * lets useIdentity/useDexterWallet light the UI.
 */
export interface RecoverVault {
  vaultPda: string;
  /** Swig state address, base58 — the user-facing Dexter Wallet address. */
  swigAddress: string;
  /** Deposit address; null until the swig is deployed. */
  receiveAddress: string | null;
  isActivated: boolean;
  walletLabel: string | null;
}

/**
 * Result of a wallet-only recover ceremony. A discriminated RESULT, not a
 * throw: user-cancel is a normal outcome in WebAuthn, and consumers branch on
 * `reason` (no_credential → offer create; cancelled → stay silent; error →
 * retry copy). `no_credential` covers both the immediate-mode instant
 * rejection (no passkey on this device) and a verify 404 (a passkey the
 * server has no row for).
 */
export type RecoverOutcome =
  | { ok: true; userHandle: string; credentialId: string; vault: RecoverVault }
  | { ok: false; reason: 'no_credential' | 'cancelled' | 'error'; error?: ConnectError };

export interface RecoverWalletConfig extends DexterConnectConfig {
  /** Chrome-149+ immediate UI mode: instant fast-fail when this device has no
   *  discoverable passkey (no empty account-picker sheet). Falls back to the
   *  normal modal wherever unsupported. */
  preferImmediate?: boolean;
  onPhase?: (phase: CeremonyPhase) => void;
}

export interface DexterConnectConfig {
  /** dexter-api base. Default https://api.dexter.cash. */
  apiBase?: string;
  /**
   * Where the WebAuthn ceremony runs:
   *  - 'auto' (default): inline on the canonical Dexter origin (dexter.cash),
   *    popup on ANY other origin — so a third-party site works without the
   *    WebAuthn rpId-origin problem (in-page only works on dexter.cash).
   *  - 'popup': always via the hosted popup (works on any website).
   *  - 'inline': always in-page — only valid on a Dexter origin; this is what
   *    the hosted ceremony page itself uses.
   */
  transport?: 'auto' | 'popup' | 'inline';
  /** Hosted ceremony page (popup transport). Default https://dexter.cash/connect. */
  connectHost?: string;
}

/** Typed error whose `code` is the server's snake_case error string. */
export class ConnectError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'ConnectError';
  }
}
