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

export interface DexterConnectConfig {
  /** dexter-api base. Default https://api.dexter.cash. */
  apiBase?: string;
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
