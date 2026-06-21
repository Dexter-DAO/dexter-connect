import type {
  DexterConnectConfig,
  PasskeyLoginTokens,
  ConnectVault,
  SignInResult,
  CeremonyPhase,
} from './types';
import { ConnectError } from './types';
import { base64urlToBytes, bytesToBase64url } from './base64';

const DEFAULT_API_BASE = 'https://api.dexter.cash';
const ANON_SIGN_BASE = '/api/passkey-anon/sign';

interface ChallengeOptions {
  challenge: string; // base64url
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
}

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
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
  onPhase?.('challenge');
  const options = await fetchLoginChallenge(apiBase);
  onPhase?.('passkey');
  const credential = await getAssertion(options);
  onPhase?.('verifying');
  return submitLogin(apiBase, credential);
}

async function fetchLoginChallenge(apiBase: string): Promise<ChallengeOptions> {
  const res = await fetch(`${apiBase}${ANON_SIGN_BASE}/login-challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    throw new ConnectError('login_challenge_failed', `login-challenge ${res.status}`);
  }
  const data = (await res.json()) as { options?: ChallengeOptions };
  if (!data?.options?.challenge) {
    throw new ConnectError('login_challenge_malformed', 'no challenge in response');
  }
  return data.options;
}

async function getAssertion(options: ChallengeOptions): Promise<PublicKeyCredential> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new ConnectError('webauthn_unsupported', 'WebAuthn unavailable in this environment');
  }
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: base64urlToBytes(options.challenge).buffer.slice(0) as ArrayBuffer,
        rpId: options.rpId,
        timeout: options.timeout ?? 60_000,
        userVerification: options.userVerification ?? 'required',
        // No allowCredentials — discoverable resident-key login.
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw new ConnectError('webauthn_failed', err instanceof Error ? err.message : String(err));
  }
  if (!credential || credential.type !== 'public-key') {
    throw new ConnectError('no_credential', 'WebAuthn returned no credential');
  }
  return credential;
}

async function submitLogin(
  apiBase: string,
  credential: PublicKeyCredential,
): Promise<SignInResult> {
  const assertion = credential.response as AuthenticatorAssertionResponse;
  const credentialJson = {
    id: credential.id,
    rawId: bytesToBase64url(new Uint8Array(credential.rawId)),
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64url(new Uint8Array(assertion.clientDataJSON)),
      authenticatorData: bytesToBase64url(new Uint8Array(assertion.authenticatorData)),
      signature: bytesToBase64url(new Uint8Array(assertion.signature)),
      userHandle: assertion.userHandle
        ? bytesToBase64url(new Uint8Array(assertion.userHandle))
        : null,
    },
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
  };

  const res = await fetch(`${apiBase}${ANON_SIGN_BASE}/passkey-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: credentialJson }),
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
