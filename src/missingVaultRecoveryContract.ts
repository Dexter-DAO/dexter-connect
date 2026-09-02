import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { base64urlToBytes, bytesToBase64url } from './base64';
import {
  ConnectError,
  type HostedMissingVaultRecoveryRequestPayload,
  type MissingVaultRecoveryAccount,
  type MissingVaultRecoveryResult,
} from './types';
import { bytesEqual, DEXTER_RP_ID } from './trust';

const DEXTER_ORIGIN = 'https://dexter.cash';
const MIN_CHALLENGE_BYTES = 16;
const MAX_CHALLENGE_BYTES = 128;

/**
 * Reduce an API response to the one WebAuthn request this recovery operation
 * permits. No credential allow-list or extension can be smuggled through the
 * hosted page as a generic signing request.
 */
export function normalizeMissingVaultRecoveryOptions(
  value: unknown,
): PublicKeyCredentialRequestOptionsJSON {
  if (!value || typeof value !== 'object') {
    throw new ConnectError('missing_vault_recovery_challenge_malformed');
  }
  const options = value as Record<string, unknown>;
  const challenge = canonicalBase64url(
    options.challenge,
    MIN_CHALLENGE_BYTES,
    MAX_CHALLENGE_BYTES,
    'missing_vault_recovery_challenge_malformed',
  );
  const challengeBytes = base64urlToBytes(challenge);
  if (
    challengeBytes.byteLength < MIN_CHALLENGE_BYTES ||
    challengeBytes.byteLength > MAX_CHALLENGE_BYTES ||
    options.rpId !== DEXTER_RP_ID ||
    options.userVerification !== 'required' ||
    options.allowCredentials !== undefined ||
    (options.extensions !== undefined &&
      (!isPlainObject(options.extensions) || Object.keys(options.extensions).length !== 0))
  ) {
    throw new ConnectError('missing_vault_recovery_challenge_malformed');
  }
  if (
    options.timeout !== undefined &&
    (typeof options.timeout !== 'number' ||
      !Number.isFinite(options.timeout) ||
      options.timeout <= 0 ||
      options.timeout > 300_000)
  ) {
    throw new ConnectError('missing_vault_recovery_challenge_malformed');
  }

  return {
    challenge,
    rpId: DEXTER_RP_ID,
    userVerification: 'required',
    ...(typeof options.timeout === 'number' ? { timeout: options.timeout } : {}),
  };
}

export function parseMissingVaultRecoveryChallenge(
  value: unknown,
): HostedMissingVaultRecoveryRequestPayload {
  if (!value || typeof value !== 'object') {
    throw new ConnectError('missing_vault_recovery_challenge_malformed');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.operation !== 'vault_missing_recovery') {
    throw new ConnectError('missing_vault_recovery_operation_mismatch');
  }
  return {
    options: normalizeMissingVaultRecoveryOptions(envelope.options),
    account: parseMissingVaultRecoveryAccount(envelope.account),
  };
}

/**
 * Validate and sanitize the assertion before the authenticated opener submits
 * it. The API remains authoritative; this closes popup/result substitution in
 * the browser boundary and prevents extra extension payloads crossing back.
 */
export async function validateMissingVaultRecoveryAssertion(
  value: unknown,
  expectedChallenge: string,
): Promise<AuthenticationResponseJSON> {
  if (!value || typeof value !== 'object') {
    throw new ConnectError('missing_vault_recovery_assertion_malformed');
  }
  const credential = value as Record<string, unknown>;
  const response = credential.response;
  if (!response || typeof response !== 'object') {
    throw new ConnectError('missing_vault_recovery_assertion_malformed');
  }
  const assertion = response as Record<string, unknown>;
  const id = canonicalBase64url(
    credential.id,
    1,
    1024,
    'missing_vault_recovery_assertion_malformed',
  );
  const rawId = canonicalBase64url(
    credential.rawId,
    1,
    1024,
    'missing_vault_recovery_assertion_malformed',
  );
  if (
    !bytesEqual(base64urlToBytes(id), base64urlToBytes(rawId)) ||
    credential.type !== 'public-key' ||
    !isPlainObject(credential.clientExtensionResults) ||
    Object.keys(credential.clientExtensionResults).length !== 0
  ) {
    throw new ConnectError('missing_vault_recovery_assertion_malformed');
  }

  const clientDataJSON = canonicalBase64url(
    assertion.clientDataJSON,
    1,
    8_192,
    'missing_vault_recovery_assertion_malformed',
  );
  const authenticatorData = canonicalBase64url(
    assertion.authenticatorData,
    37,
    4_096,
    'missing_vault_recovery_assertion_malformed',
  );
  const signature = canonicalBase64url(
    assertion.signature,
    1,
    1_024,
    'missing_vault_recovery_assertion_malformed',
  );
  const userHandle = assertion.userHandle === undefined || assertion.userHandle === null
    ? undefined
    : canonicalBase64url(
        assertion.userHandle,
        1,
        1_024,
        'missing_vault_recovery_assertion_malformed',
      );

  let clientData: Record<string, unknown>;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      base64urlToBytes(clientDataJSON),
    );
    clientData = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    throw new ConnectError('missing_vault_recovery_assertion_malformed');
  }
  if (
    clientData.type !== 'webauthn.get' ||
    clientData.challenge !== expectedChallenge ||
    clientData.origin !== DEXTER_ORIGIN ||
    clientData.crossOrigin !== false
  ) {
    throw new ConnectError('missing_vault_recovery_assertion_unbound');
  }

  const authData = base64urlToBytes(authenticatorData);
  const expectedRpHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(DEXTER_RP_ID)),
  );
  const flags = authData[32] ?? 0;
  if (
    !bytesEqual(authData.subarray(0, 32), expectedRpHash) ||
    (flags & 0x01) === 0 ||
    (flags & 0x04) === 0
  ) {
    throw new ConnectError('missing_vault_recovery_assertion_unbound');
  }

  const authenticatorAttachment = credential.authenticatorAttachment;
  if (
    authenticatorAttachment !== undefined &&
    authenticatorAttachment !== 'platform' &&
    authenticatorAttachment !== 'cross-platform'
  ) {
    throw new ConnectError('missing_vault_recovery_assertion_malformed');
  }

  return {
    id,
    rawId,
    type: 'public-key',
    response: {
      clientDataJSON,
      authenticatorData,
      signature,
      ...(userHandle ? { userHandle } : {}),
    },
    clientExtensionResults: {},
    ...(authenticatorAttachment ? { authenticatorAttachment } : {}),
  };
}

export function parseMissingVaultRecoveryResult(
  value: unknown,
  credential: AuthenticationResponseJSON,
  expectedAccount: MissingVaultRecoveryAccount,
): MissingVaultRecoveryResult {
  if (!value || typeof value !== 'object') {
    throw new ConnectError('missing_vault_recovery_result_malformed');
  }
  const result = value as Record<string, unknown>;
  const vault = result.vault;
  if (
    result.recovered !== true ||
    typeof result.alreadyRecovered !== 'boolean' ||
    result.relation !== 'bound' ||
    !vault ||
    typeof vault !== 'object'
  ) {
    throw new ConnectError('missing_vault_recovery_result_malformed');
  }
  const row = vault as Record<string, unknown>;
  const account = parseMissingVaultRecoveryAccount(result.account);
  const credentialId = canonicalBase64url(
    row.credentialId,
    1,
    1024,
    'missing_vault_recovery_result_malformed',
  );
  const userHandle = canonicalBase64url(
    row.userHandle,
    1,
    1024,
    'missing_vault_recovery_result_malformed',
  );
  if (
    account.provider !== expectedAccount.provider ||
    account.handle !== expectedAccount.handle ||
    credentialId !== credential.id ||
    (credential.response.userHandle !== undefined &&
      userHandle !== credential.response.userHandle) ||
    !nonEmptyString(row.vaultPda) ||
    !nonEmptyString(row.swigAddress) ||
    !nonEmptyString(row.receiveAddress) ||
    row.state !== 'initialized'
  ) {
    throw new ConnectError('missing_vault_recovery_result_malformed');
  }

  return {
    recovered: true,
    alreadyRecovered: result.alreadyRecovered,
    relation: 'bound',
    account,
    vault: {
      vaultPda: row.vaultPda,
      swigAddress: row.swigAddress,
      receiveAddress: row.receiveAddress,
      userHandle,
      credentialId,
      state: 'initialized',
    },
  };
}

export function parseMissingVaultRecoveryAccount(
  value: unknown,
): MissingVaultRecoveryAccount {
  if (!value || typeof value !== 'object') {
    throw new ConnectError('missing_vault_recovery_account_malformed');
  }
  const account = value as Record<string, unknown>;
  if (
    account.provider !== 'x' ||
    typeof account.handle !== 'string' ||
    !/^@[A-Za-z0-9_]{1,64}$/.test(account.handle)
  ) {
    throw new ConnectError('missing_vault_recovery_account_malformed');
  }
  return { provider: 'x', handle: account.handle };
}

function canonicalBase64url(
  value: unknown,
  minBytes: number,
  maxBytes: number,
  errorCode: string,
): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ConnectError(errorCode);
  }
  try {
    const bytes = base64urlToBytes(value);
    if (
      bytes.byteLength < minBytes ||
      bytes.byteLength > maxBytes ||
      bytesToBase64url(bytes) !== value
    ) {
      throw new Error('non-canonical');
    }
  } catch {
    throw new ConnectError(errorCode);
  }
  return value;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
