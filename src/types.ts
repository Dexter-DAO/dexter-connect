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
  /** Swig wallet-address PDA, base58 — the user-facing Dexter Wallet address. */
  swigAddress: string;
  /** base64 33-byte SEC1 compressed P-256 authority pubkey (for the signer). */
  publicKey: string;
  userHandle: string;
  credentialId: string;
  /** Deposit address (swig wallet-address PDA). */
  receiveAddress: string;
}

/** Result of a completed "Sign in with Dexter" ceremony. */
export interface SignInResult {
  session: PasskeyLoginTokens;
  /** Present once vault-review ships the vault-in-login change. */
  vault?: ConnectVault;
}

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
