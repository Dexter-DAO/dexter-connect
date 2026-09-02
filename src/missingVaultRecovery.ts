import {
  startAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { readErrorCode } from './httpError';
import {
  normalizeMissingVaultRecoveryOptions,
  parseMissingVaultRecoveryChallenge,
  parseMissingVaultRecoveryResult,
  validateMissingVaultRecoveryAssertion,
} from './missingVaultRecoveryContract';
import { openCeremonyPopup } from './popup';
import {
  ConnectError,
  type MissingVaultRecoveryConfig,
  type MissingVaultRecoveryResult,
  type HostedMissingVaultRecoveryRequestPayload,
} from './types';
import { resolveDexterApiBase, resolveDexterConnectHost } from './trust';

const RECOVERY_PATH = '/api/passkey-vault/recover-missing';
const INDEXTER_RECOVERY_ORIGIN = 'https://indexter.cash';

/**
 * Repair one confirmed split state: a Dexter passkey exists, but its Vault row
 * is missing from the already-authenticated account. This never signs in,
 * creates an account, or changes the browser's active Wallet.
 *
 * Call directly from a user click. The trusted popup opens synchronously; the
 * account-authenticated challenge fetch begins only after it exists.
 */
export async function recoverMissingVaultForAccount(
  config: MissingVaultRecoveryConfig,
): Promise<MissingVaultRecoveryResult> {
  requireIndexterRecoveryOpener();
  const apiBase = resolveDexterApiBase(config.apiBase);
  const connectHost = resolveDexterConnectHost(config.connectHost);
  const accountAccessToken = requireAccountAccessToken(config.accountAccessToken);
  let expectedRequest: HostedMissingVaultRecoveryRequestPayload | undefined;

  const popupResult = await openCeremonyPopup<AuthenticationResponseJSON>(
    'recover-missing-vault',
    {
      connectHost,
      missingVaultRecoveryRequest: async () => {
        expectedRequest = await fetchRecoveryChallenge(apiBase, accountAccessToken);
        return expectedRequest;
      },
    },
  );
  if (!expectedRequest) {
    throw new ConnectError('missing_vault_recovery_challenge_missing');
  }
  const credential = await validateMissingVaultRecoveryAssertion(
    popupResult,
    expectedRequest.options.challenge,
  );
  return completeRecovery(
    apiBase,
    accountAccessToken,
    credential,
    expectedRequest.account,
  );
}

function requireIndexterRecoveryOpener(): void {
  if (typeof window === 'undefined') {
    throw new ConnectError(
      'not_browser',
      'missing Vault recovery requires the Indexter browser session',
    );
  }
  if (window.location.origin !== INDEXTER_RECOVERY_ORIGIN) {
    throw new ConnectError(
      'untrusted_missing_vault_recovery_opener',
      'missing Vault recovery is restricted to Indexter',
    );
  }
}

/** First-party hosted proof. It is intentionally not a generic ceremony dispatcher. */
export async function runHostedMissingVaultRecoveryProof(
  options: unknown,
): Promise<AuthenticationResponseJSON> {
  const normalized = normalizeMissingVaultRecoveryOptions(options);
  let credential: AuthenticationResponseJSON;
  try {
    credential = await startAuthentication({ optionsJSON: normalized });
  } catch (err) {
    throw new ConnectError(
      'webauthn_failed',
      err instanceof Error ? err.message : String(err),
    );
  }
  return validateMissingVaultRecoveryAssertion(credential, normalized.challenge);
}

async function fetchRecoveryChallenge(
  apiBase: string,
  accountAccessToken: string,
): Promise<HostedMissingVaultRecoveryRequestPayload> {
  const res = await fetch(`${apiBase}${RECOVERY_PATH}/challenge`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accountAccessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    throw new ConnectError(
      await readErrorCode(res),
      `missing Vault recovery challenge ${res.status}`,
    );
  }
  return parseMissingVaultRecoveryChallenge(await res.json());
}

async function completeRecovery(
  apiBase: string,
  accountAccessToken: string,
  credential: AuthenticationResponseJSON,
  expectedAccount: HostedMissingVaultRecoveryRequestPayload['account'],
): Promise<MissingVaultRecoveryResult> {
  const res = await fetch(`${apiBase}${RECOVERY_PATH}/complete`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accountAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    throw new ConnectError(
      await readErrorCode(res),
      `missing Vault recovery completion ${res.status}`,
    );
  }
  return parseMissingVaultRecoveryResult(
    await res.json(),
    credential,
    expectedAccount,
  );
}

function requireAccountAccessToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 16_384 ||
    /\s/.test(value)
  ) {
    throw new ConnectError('missing_account_session');
  }
  return value;
}
