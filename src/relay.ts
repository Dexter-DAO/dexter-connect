import type {
  DexterConnectConfig,
  PasskeyLoginTokens,
  ConnectVault,
  SignInResult,
  CeremonyPhase,
} from './types';
import { ConnectError } from './types';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { shouldUsePopup, openCeremonyPopup } from './popup';
import { createWallet, type CreateWalletConfig, type CreateWalletResult } from './enroll';
import { getActiveHandle } from './walletStore';

const DEFAULT_API_BASE = 'https://api.dexter.cash';
const ANON_SIGN_BASE = '/api/passkey-anon/sign';

/**
 * "Sign in with Dexter" — the discoverable-credential login ceremony.
 *
 *   1. POST /login-challenge  → a server-issued challenge (no allow-list:
 *      the resident passkey itself identifies the user)
 *   2. navigator.credentials.get over that challenge (no allowCredentials)
 *   3. POST /passkey-login    → the server resolves the credential + vault,
 *      verifies the assertion, and returns a Supabase session (+ the vault
 *      payload once vault-review ships the dexter-api change — ASK 1)
 *
 * Relays to dexter-api's ANON router — a first-time third-party user has no
 * Supabase session, so the Supabase-gated router would 401.
 */
export async function passkeyLogin(
  config: DexterConnectConfig = {},
  onPhase?: (phase: CeremonyPhase) => void,
): Promise<SignInResult> {
  // Hosted-popup transport: on any non-Dexter origin, run the ceremony in a
  // popup on dexter.cash and get the same result back (works on any website).
  if (shouldUsePopup(config.transport)) {
    return openCeremonyPopup<SignInResult>('signin', {
      connectHost: config.connectHost,
      apiBase: config.apiBase,
    });
  }
  if (!browserSupportsWebAuthn()) {
    throw new ConnectError('webauthn_unsupported', 'WebAuthn unavailable in this environment');
  }
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  onPhase?.('challenge');
  const options = await fetchLoginChallenge(apiBase);
  onPhase?.('passkey');
  // SimpleWebAuthn runs the get() ceremony + all the base64url/ArrayBuffer
  // marshalling and returns server-ready JSON. (Replaces hand-rolled getAssertion.)
  let response: AuthenticationResponseJSON;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    throw new ConnectError('webauthn_failed', err instanceof Error ? err.message : String(err));
  }
  onPhase?.('verifying');
  return submitLogin(apiBase, response);
}

// ── Hybrid "continue" — register-or-sign-in in one call ──────────────────────
// dexter-agents approved op=continue ALONGSIDE signin|create (back-compat). The
// CALLER no longer pre-decides — this does, so one "Sign in with Dexter" button
// works for both a brand-new user and a returning one (like "Sign in with
// Google" creates if you're new). Critically, a new user must NOT dead-end at
// the discoverable-credential cross-device QR: when this device has no known
// wallet handle, we REGISTER rather than attempt a resident-key sign-in.
export type ContinueResult =
  | ({ kind: 'signin' } & SignInResult)
  | ({ kind: 'create' } & CreateWalletResult);

export async function continueWithDexter(
  config: CreateWalletConfig = {},
  onPhase?: (phase: CeremonyPhase) => void,
): Promise<ContinueResult> {
  // Off-origin: the popup on dexter.cash decides (it alone can see the dexter.cash
  // handle and attempt a discoverable sign-in); same call, result handed back.
  if (shouldUsePopup(config.transport)) {
    return openCeremonyPopup<ContinueResult>('continue', {
      connectHost: config.connectHost,
      name: config.name,
      apiBase: config.apiBase,
    });
  }
  // Inline (on the Dexter origin): a known wallet handle on THIS device → sign it
  // in; otherwise register a fresh one (never the QR dead-end for a new user).
  if (getActiveHandle()) {
    const result = await passkeyLogin(config, onPhase);
    return { kind: 'signin', ...result };
  }
  const result = await createWallet({ ...config, onPhase });
  return { kind: 'create', ...result };
}

async function fetchLoginChallenge(
  apiBase: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const res = await fetch(`${apiBase}${ANON_SIGN_BASE}/login-challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    throw new ConnectError('login_challenge_failed', `login-challenge ${res.status}`);
  }
  const data = (await res.json()) as { options?: PublicKeyCredentialRequestOptionsJSON };
  if (!data?.options?.challenge) {
    throw new ConnectError('login_challenge_malformed', 'no challenge in response');
  }
  return data.options;
}

async function submitLogin(
  apiBase: string,
  response: AuthenticationResponseJSON,
): Promise<SignInResult> {
  // SimpleWebAuthn's AuthenticationResponseJSON is already the server's expected
  // credential shape (id/rawId/response/clientExtensionResults/type) — send as-is.
  const res = await fetch(`${apiBase}${ANON_SIGN_BASE}/passkey-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: response }),
  });

  if (!res.ok) {
    throw new ConnectError(await readErrorCode(res), `passkey-login ${res.status}`);
  }

  const data = (await res.json()) as PasskeyLoginTokens & { vault?: ConnectVault };
  const session: PasskeyLoginTokens = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    expiresIn: data.expiresIn,
    tokenType: data.tokenType,
  };
  return data.vault ? { session, vault: data.vault } : { session };
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
