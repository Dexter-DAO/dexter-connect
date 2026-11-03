import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { base64ToBytes, base64urlToBytes, bytesToBase64, bytesToBase64url } from './base64';
import { readErrorCode } from './httpError';
import { openCeremonyPopup, shouldUsePopup } from './popup';
import { DEXTER_RP_ID, resolveDexterApiBase, resolveDexterConnectHost } from './trust';
import { ConnectError, type CeremonyPhase } from './types';

export const ACCOUNT_IDENTITY_API_PATH = '/api/connect/account-identity';

/** Application authentication. It does not authorize a Registry instruction. */
export interface AccountIdentitySession {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly expiresIn: number;
  readonly tokenType: 'Bearer';
}

export interface AccountIdentityCredential {
  readonly userHandle: string;
  readonly credentialId: string;
  /** Standard base64, 33-byte compressed P-256 public key. */
  readonly publicKey: string;
}

export interface AccountIdentityResult {
  readonly profile: 'account-identity-v1';
  readonly session: AccountIdentitySession;
  readonly credential: AccountIdentityCredential;
}

export interface AccountRefusalRequest {
  readonly request_id: string;
  readonly decline_token: string;
}

export interface AccountAccessResult extends AccountIdentityResult {
  /** First-party proof valid only for refusing the original connection request. */
  readonly refusalProof: AccountIdentitySession;
}

interface AccountIdentityConfig {
  /** Compatibility options accept only the canonical Dexter origins. */
  readonly apiBase?: string;
  readonly connectHost?: string;
  readonly transport?: 'auto' | 'popup' | 'inline';
  readonly onPhase?: (phase: CeremonyPhase) => void;
}

export interface SignInAccountIdentityConfig extends AccountIdentityConfig {
  readonly targetUserHandle?: string;
}

export interface EnrollAccountIdentityConfig extends AccountIdentityConfig {
  /** Display label for the credential in the device's passkey picker. */
  readonly name?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalBase64url(value: unknown, exactLength?: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1400) return false;
  try {
    const bytes = base64urlToBytes(value);
    return bytes.length > 0 && bytes.length <= 1024 &&
      (exactLength === undefined || bytes.length === exactLength) && bytesToBase64url(bytes) === value;
  } catch { return false; }
}

function validPublicKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 44) return false;
  try {
    const bytes = base64ToBytes(value);
    return bytes.length === 33 && (bytes[0] === 2 || bytes[0] === 3) && bytesToBase64(bytes) === value;
  } catch { return false; }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function normalizeSession(session: unknown): AccountIdentitySession {
  if (!record(session) || typeof session.accessToken !== 'string' || session.accessToken.length === 0 ||
      /\s/.test(session.accessToken) || session.tokenType !== 'Bearer' ||
      !positiveInteger(session.expiresAt) || !positiveInteger(session.expiresIn) ||
      session.expiresIn > 30 * 24 * 60 * 60) {
    throw new ConnectError('account_identity_result_malformed');
  }
  return Object.freeze({
    accessToken: session.accessToken, expiresAt: session.expiresAt, expiresIn: session.expiresIn, tokenType: 'Bearer',
  });
}

function normalizeResult(value: unknown): AccountIdentityResult {
  if (!record(value) || value.profile !== 'account-identity-v1' || !record(value.credential)) {
    throw new ConnectError('account_identity_result_malformed');
  }
  const { credential } = value;
  if (!canonicalBase64url(credential.userHandle, 16) ||
      !canonicalBase64url(credential.credentialId) || !validPublicKey(credential.publicKey)) {
    throw new ConnectError('account_identity_result_malformed');
  }
  // The public popup may return this object to another origin. Pick identity fields explicitly.
  return Object.freeze({
    profile: 'account-identity-v1', session: normalizeSession(value.session),
    credential: Object.freeze({
      userHandle: credential.userHandle, credentialId: credential.credentialId, publicKey: credential.publicKey,
    }),
  });
}

function normalizeAccessResult(value: unknown): AccountAccessResult {
  const identity = normalizeResult(value);
  const refusalProof = normalizeSession(record(value) ? value.refusalProof : undefined);
  if (refusalProof.accessToken === identity.session.accessToken) {
    throw new ConnectError('account_identity_result_malformed');
  }
  return Object.freeze({ ...identity, refusalProof });
}

function bindRefusalRequest(request: AccountRefusalRequest): AccountRefusalRequest {
  assertInlineOrigin();
  if (window.top !== window || window.location.pathname !== '/tabs/setup' ||
      !record(request) || typeof request.request_id !== 'string' || typeof request.decline_token !== 'string' ||
      !/^vpair_[a-f0-9]{1,80}$/.test(request.request_id) ||
      !/^[a-f0-9]{64}$/.test(request.decline_token) ||
      new URL(window.location.href).searchParams.get('request_id') !== request.request_id) {
    throw new ConnectError('account_request_mismatch');
  }
  return Object.freeze({ request_id: request.request_id, decline_token: request.decline_token });
}

async function post(apiBase: string, endpoint: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${ACCOUNT_IDENTITY_API_PATH}/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
  } catch {
    // Never retry a completed WebAuthn submission automatically. The server may
    // already have consumed it; another sign-in can recover the identity.
    throw new ConnectError(endpoint === 'login' || endpoint === 'enroll'
      ? 'account_identity_request_uncertain' : 'account_identity_unavailable');
  }
  if (!response.ok) {
    const code = await readErrorCode(response);
    if (endpoint === 'enroll' && !(
      (response.status === 400 && code === 'account_identity_verification_failed') ||
      (response.status === 409 && ['challenge_unavailable', 'credential_exists', 'credential_changed'].includes(code))
    )) {
      throw new ConnectError('account_identity_request_uncertain');
    }
    throw new ConnectError(code);
  }
  try { return await response.json(); }
  catch {
    throw new ConnectError(endpoint === 'enroll'
      ? 'account_identity_request_uncertain' : 'account_identity_result_malformed');
  }
}

function enrollmentResult<T extends AccountIdentityResult>(value: unknown, decode: (value: unknown) => T,
  expected?: { credentialId: string; userHandle: string }): T {
  try {
    const result = decode(value);
    if (expected && (result.credential.credentialId !== expected.credentialId ||
        result.credential.userHandle !== expected.userHandle)) {
      throw new ConnectError('account_identity_credential_mismatch');
    }
    return result;
  } catch {
    // A successful submission may already have persisted the credential even
    // when its reply cannot safely authenticate this caller. Recover by sign-in.
    throw new ConnectError('account_identity_request_uncertain');
  }
}

function assertInlineOrigin(): void {
  if (typeof window === 'undefined' || window.location.origin !== 'https://dexter.cash') {
    throw new ConnectError('hosted_ceremony_origin_required');
  }
  if (!browserSupportsWebAuthn()) throw new ConnectError('webauthn_unsupported');
}

function loginOptions(value: unknown): PublicKeyCredentialRequestOptionsJSON {
  if (!record(value) || !record(value.options)) throw new ConnectError('account_identity_challenge_malformed');
  const options = value.options;
  if (!canonicalBase64url(options.challenge) || base64urlToBytes(options.challenge).length < 16 ||
      options.rpId !== DEXTER_RP_ID || options.userVerification !== 'required') {
    throw new ConnectError('account_identity_challenge_malformed');
  }
  return options as unknown as PublicKeyCredentialRequestOptionsJSON;
}

function enrollmentOptions(value: unknown): PublicKeyCredentialCreationOptionsJSON {
  if (!record(value) || !record(value.options)) throw new ConnectError('account_identity_challenge_malformed');
  const options = value.options;
  if (!canonicalBase64url(options.challenge) || base64urlToBytes(options.challenge).length < 16 ||
      !record(options.rp) || options.rp.id !== DEXTER_RP_ID ||
      !record(options.user) || !canonicalBase64url(options.user.id, 16) ||
      !record(options.authenticatorSelection) || options.authenticatorSelection.userVerification !== 'required' ||
      options.authenticatorSelection.residentKey !== 'required' ||
      !Array.isArray(options.pubKeyCredParams) || options.pubKeyCredParams.length !== 1 ||
      !record(options.pubKeyCredParams[0]) || options.pubKeyCredParams[0].type !== 'public-key' ||
      options.pubKeyCredParams[0].alg !== -7) {
    throw new ConnectError('account_identity_challenge_malformed');
  }
  return options as unknown as PublicKeyCredentialCreationOptionsJSON;
}

function ceremonyError(cause: unknown): ConnectError {
  if (cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'AbortError')) {
    return new ConnectError('user_cancelled');
  }
  return new ConnectError('webauthn_failed');
}

let ceremonyInProgress = false;

async function serializeCeremony<T>(run: () => Promise<T>): Promise<T> {
  if (ceremonyInProgress) throw new ConnectError('account_identity_ceremony_in_progress');
  ceremonyInProgress = true;
  try { return await run(); }
  finally { ceremonyInProgress = false; }
}

/** Sign in with an existing credential. The caller owns session persistence. */
export async function signInAccountIdentity(config: SignInAccountIdentityConfig = {}): Promise<AccountIdentityResult> {
  return signIn(config, normalizeResult);
}

/** Authenticate the active first-party request with a fresh passkey assertion. */
export async function signInAccountAccess(config: Pick<SignInAccountIdentityConfig, 'targetUserHandle' | 'onPhase'> & {
  readonly accountRequest: AccountRefusalRequest;
}): Promise<AccountAccessResult> {
  return signIn({ targetUserHandle: config.targetUserHandle, onPhase: config.onPhase, transport: 'inline' },
    normalizeAccessResult, bindRefusalRequest(config.accountRequest));
}

async function signIn<T extends AccountIdentityResult>(config: SignInAccountIdentityConfig,
  decode: (value: unknown) => T, accountRequest?: AccountRefusalRequest): Promise<T> {
  const context = accountRequest ? { accountRequest } : {};
  const { targetUserHandle, transport, onPhase } = config;
  const apiBase = resolveDexterApiBase(config.apiBase);
  const connectHost = resolveDexterConnectHost(config.connectHost);
  if (targetUserHandle !== undefined && !canonicalBase64url(targetUserHandle, 16)) {
    throw new ConnectError('invalid_target_account');
  }
  return serializeCeremony(async () => {
    let result: T;
    if (shouldUsePopup(transport)) {
      result = decode(await openCeremonyPopup('account-signin', {
        connectHost, ...(targetUserHandle === undefined ? {} : { targetUserHandle }),
      }));
    } else {
      assertInlineOrigin();
      onPhase?.('challenge');
      const optionsJSON = loginOptions(await post(apiBase, 'login-challenge', context));
      onPhase?.('passkey');
      let credential;
      try { credential = await startAuthentication({ optionsJSON }); }
      catch (cause) { throw ceremonyError(cause); }
      onPhase?.('verifying');
      result = decode(await post(apiBase, 'login', { credential, ...context }));
      if (result.credential.credentialId !== credential.id ||
          (credential.response.userHandle && result.credential.userHandle !== credential.response.userHandle)) {
        throw new ConnectError('account_identity_credential_mismatch');
      }
    }
    if (targetUserHandle !== undefined && result.credential.userHandle !== targetUserHandle) {
      throw new ConnectError('target_account_mismatch');
    }
    return result;
  });
}

/** Enroll a passkey and authenticate its identity without creating a wallet. */
export async function enrollAccountIdentity(config: EnrollAccountIdentityConfig = {}): Promise<AccountIdentityResult> {
  return enroll(config, normalizeResult);
}

/** Enroll on the original first-party request and obtain its distinct refusal proof. */
export async function enrollAccountAccess(config: Pick<EnrollAccountIdentityConfig, 'name' | 'onPhase'> & {
  readonly accountRequest: AccountRefusalRequest;
}): Promise<AccountAccessResult> {
  return enroll({ name: config.name, onPhase: config.onPhase, transport: 'inline' },
    normalizeAccessResult, bindRefusalRequest(config.accountRequest));
}

async function enroll<T extends AccountIdentityResult>(config: EnrollAccountIdentityConfig,
  decode: (value: unknown) => T, accountRequest?: AccountRefusalRequest): Promise<T> {
  const context = accountRequest ? { accountRequest } : {};
  const { transport, onPhase } = config;
  const apiBase = resolveDexterApiBase(config.apiBase);
  const connectHost = resolveDexterConnectHost(config.connectHost);
  if (config.name !== undefined && (typeof config.name !== 'string' || config.name.trim().length > 80)) {
    throw new ConnectError('invalid_account_identity_name');
  }
  const name = config.name?.trim() || 'Dexter';
  return serializeCeremony(async () => {
    if (shouldUsePopup(transport)) {
      let value: unknown;
      try { value = await openCeremonyPopup('account-enroll', { connectHost, name }); }
      catch (cause) {
        if (cause instanceof ConnectError && [
          'popup_blocked', 'not_browser', 'user_cancelled', 'account_identity_verification_failed',
          'challenge_unavailable', 'credential_exists', 'credential_changed', 'account_identity_unavailable',
          'account_identity_challenge_malformed', 'webauthn_unsupported', 'webauthn_failed',
        ].includes(cause.code)) throw cause;
        // Timeout, closure or a transport failure cannot establish whether the
        // hosted enrollment committed. A new creation must not be the recovery.
        throw new ConnectError('account_identity_request_uncertain');
      }
      return enrollmentResult(value, decode);
    }
    assertInlineOrigin();
    onPhase?.('challenge');
    const options = enrollmentOptions(await post(apiBase, 'enroll-challenge', context));
    const expectedUserHandle = options.user.id;
    const optionsJSON = {
      ...options, rp: { ...options.rp, name: 'Dexter' }, user: { ...options.user, name, displayName: name },
    };
    onPhase?.('passkey');
    let credential;
    try { credential = await startRegistration({ optionsJSON }); }
    catch (cause) { throw ceremonyError(cause); }
    onPhase?.('verifying');
    return enrollmentResult(await post(apiBase, 'enroll', { credential, ...context }), decode, {
      credentialId: credential.id, userHandle: expectedUserHandle,
    });
  });
}
