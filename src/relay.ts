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
import { getActiveHandle, setActiveHandle } from './walletStore';
import { readErrorCode } from './httpError';
import {
  classifyWebAuthnRejection,
  immediateAuthentication,
  immediateGetSupported,
  primeImmediateSupport,
} from './immediate';

const DEFAULT_API_BASE = 'https://api.dexter.cash';
const ANON_SIGN_BASE = '/api/passkey-anon/sign';

// Settle the immediate-mode capability probe at module load so continue's
// tap-time read never inserts an await before navigator.credentials.get()
// (same discipline as recover.ts).
primeImmediateSupport();

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
    const result = await openCeremonyPopup<SignInResult>('signin', {
      connectHost: config.connectHost,
      apiBase: config.apiBase,
    });
    // Persist the active handle so the SDK wallet store reflects the sign-in
    // (guarded: a session without a vault leaves nothing to record).
    if (result.vault) {
      setActiveHandle(result.vault.userHandle, result.vault.walletLabel ?? undefined, result.vault.credentialId);
    }
    return result;
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
  const result = await submitLogin(apiBase, response);
  // Persist the active handle on a successful inline sign-in (guarded: no vault,
  // nothing to record — same discipline as the popup path above).
  if (result.vault) {
    setActiveHandle(result.vault.userHandle, result.vault.walletLabel ?? undefined, result.vault.credentialId);
  }
  return result;
}

// ── Hybrid "continue" — register-or-sign-in in one call ──────────────────────
// One "Sign in with Dexter" button serves both a returning user and a brand-new
// one (like "Sign in with Google" creates if you're new). The decision is
// KEYCHAIN-FIRST, never localStorage-first: a synced passkey on a fresh device
// has no local handle, and guessing "create" there silently mints a second
// wallet and orphans the funded one (the exact bug fe's NoWalletSignIn killed).
//
// Decision rule (inline path — the hosted popup runs this on dexter.cash):
//   1. Immediate mode supported (Chrome 149+/Android): probe the KEYCHAIN with
//      an immediate discoverable login. Passkey exists → full sign-in, done.
//      Instant fast-fail → this device truly has no passkey → create path.
//   2. No immediate support (iOS today) + a local handle → modal sign-in (a
//      passkey existed here; safe).
//   3. No immediate support + no local handle → we CANNOT probe silently.
//      Return needs_choice: the caller renders an explicit sign-in / create
//      fork. The verb never guess-creates.
//
// Consent-at-birth: the create leg runs ONLY when the caller already authored
// a spendPolicy (fail-closed, same rule as the hosted page). Without one the
// verb returns needs_create and the caller collects name + allowance first.
export type ContinueResult =
  | ({ kind: 'signin' } & SignInResult)
  | ({ kind: 'create' } & CreateWalletResult)
  /** This device has no passkey (proven by an immediate fast-fail) but the
   *  caller supplied no authored spendPolicy — collect name + allowance,
   *  then call createWallet. */
  | { kind: 'needs_create' }
  /** Cannot silently probe (no immediate support, no local handle): render an
   *  explicit "Sign in" / "I'm new" choice. Never guess. */
  | { kind: 'needs_choice' }
  /** The user dismissed the passkey sheet. Not an error — stay quiet. */
  | { kind: 'cancelled' };

export async function continueWithDexter(
  config: CreateWalletConfig = {},
  onPhase?: (phase: CeremonyPhase) => void,
): Promise<ContinueResult> {
  // Off-origin: the popup on dexter.cash decides (it alone can see the
  // dexter.cash keychain/handle); only terminal outcomes ride back.
  if (shouldUsePopup(config.transport)) {
    const result = await openCeremonyPopup<ContinueResult>('continue', {
      connectHost: config.connectHost,
      name: config.name,
      apiBase: config.apiBase,
    });
    // Persist the active handle for whichever branch the popup resolved. A create
    // carries the identity at the top level; a signin only has one when the
    // server returned a vault (guarded). Non-terminal kinds carry no identity.
    if (result.kind === 'create') {
      // The result's label wins — the name may have been typed on the hosted page.
      setActiveHandle(result.handle, result.label ?? config.name, result.credentialId);
    } else if (result.kind === 'signin' && result.vault) {
      setActiveHandle(result.vault.userHandle, result.vault.walletLabel ?? undefined, result.vault.credentialId);
    }
    return result;
  }

  // Inline — keychain-first probe.
  if (await immediateGetSupported()) {
    const probe = await immediatePasskeyLogin(config, onPhase);
    if (probe.outcome === 'signin') return { kind: 'signin', ...probe.result };
    if (probe.outcome === 'cancelled') return { kind: 'cancelled' };
    // outcome === 'no_credential' — proven empty device; create needs consent.
    if (!config.spendPolicy) return { kind: 'needs_create' };
    const created = await createWallet({ ...config, onPhase });
    return { kind: 'create', ...created };
  }

  // No immediate support: a local handle proves a passkey lived here — the
  // modal discoverable login is safe. Without one, ask; never guess.
  if (getActiveHandle()) {
    const result = await passkeyLogin(config, onPhase);
    return { kind: 'signin', ...result };
  }
  return { kind: 'needs_choice' };
}

/** Immediate-mode discoverable login: the keychain probe that doubles as the
 *  full sign-in when a passkey exists. Fast-fails without UI when the device
 *  holds none. Same legs as passkeyLogin, immediate mediation. */
async function immediatePasskeyLogin(
  config: DexterConnectConfig,
  onPhase?: (phase: CeremonyPhase) => void,
): Promise<
  | { outcome: 'signin'; result: SignInResult }
  | { outcome: 'no_credential' }
  | { outcome: 'cancelled' }
> {
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  onPhase?.('challenge');
  const options = await fetchLoginChallenge(apiBase);
  onPhase?.('passkey');
  let response: AuthenticationResponseJSON;
  try {
    response = await immediateAuthentication(options);
  } catch (err) {
    if (classifyWebAuthnRejection(err)) {
      // Immediate mode rejects instantly when the device holds no discoverable
      // passkey; a rejection after the sheet showed is the user dismissing.
      // The API can't distinguish the two — both are a no-sign outcome, and
      // no_credential is the safe reading (the caller offers create, which
      // the user can decline; a swallowed cancel would dead-end a new user).
      return { outcome: 'no_credential' };
    }
    throw new ConnectError('webauthn_failed', err instanceof Error ? err.message : String(err));
  }
  onPhase?.('verifying');
  const result = await submitLogin(apiBase, response);
  if (result.vault) {
    setActiveHandle(
      result.vault.userHandle,
      result.vault.walletLabel ?? undefined,
      result.vault.credentialId,
    );
  }
  return { outcome: 'signin', result };
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

