import {
  accountBindingCandidate,
  createWalletAccountBindingClient,
  walletBindingCandidate,
  type BindingFetch,
} from './bindingResolver';
import { activateConnectVault } from './walletActivation';
import {
  disconnectActiveWallet,
  getActiveWallet,
  setActiveWallet,
  type StoredWallet,
} from './walletStore';
import { passkeyLogin } from './relay';
import {
  ConnectError,
  type CeremonyPhase,
  type PasskeyLoginConfig,
  type PasskeyLoginTokens,
  type SignInResult,
} from './types';

export type AccountSessionInstaller = (
  session: PasskeyLoginTokens,
) => void | Promise<void>;

export type AccountSessionClearer = () => void | Promise<void>;

export interface ConnectDexterIdentityConfig
  extends Omit<PasskeyLoginConfig, 'walletStore'> {
  /**
   * Install the account session returned by the same passkey ceremony. Reject
   * without publishing a replacement session if installation fails.
   */
  readonly installAccountSession: AccountSessionInstaller;
  /** Injectable binding fetch for tests and non-browser hosts. */
  readonly bindingFetch?: BindingFetch;
}

export interface DisconnectDexterIdentityConfig {
  /** Clear the host account session after Connect drops the active Wallet. */
  readonly clearAccountSession: AccountSessionClearer;
}

function restoreWallet(previousWallet: StoredWallet | null): boolean {
  if (previousWallet) {
    return setActiveWallet(previousWallet);
  }
  return getActiveWallet() === null || disconnectActiveWallet();
}

/**
 * Complete a full Dexter identity transition from one passkey result.
 *
 * The candidate Wallet and account are verified as an exact pair before local
 * state changes. Connect then publishes the Wallet and asks the host to install
 * the matching account session. A rejected install restores the prior Wallet.
 */
export async function connectDexterIdentity(
  config: ConnectDexterIdentityConfig,
  onPhase?: (phase: CeremonyPhase) => void,
): Promise<SignInResult> {
  const {
    installAccountSession,
    bindingFetch,
    ...passkeyConfig
  } = config;
  const previousWallet = getActiveWallet();
  const result = await passkeyLogin(
    { ...passkeyConfig, walletStore: 'provisional' },
    onPhase,
  );

  const bindingClient = createWalletAccountBindingClient({
    ...(passkeyConfig.apiBase ? { apiBase: passkeyConfig.apiBase } : {}),
    ...(bindingFetch ? { fetch: bindingFetch } : {}),
  });
  const resolution = await bindingClient.resolve({
    wallet: walletBindingCandidate(result.walletIdentityProof.token, {
      userHandle: result.vault.userHandle,
      vaultPda: result.vault.vaultPda,
    }),
    account: accountBindingCandidate(result.session.accessToken),
  });
  if (!resolution.ok) {
    throw new ConnectError(
      resolution.reason === 'expired'
        ? `identity_${resolution.subject}_expired`
        : resolution.reason === 'offline'
          ? 'identity_binding_offline'
          : resolution.code,
    );
  }
  if (resolution.relation !== 'bound') {
    throw new ConnectError('identity_binding_conflict');
  }

  if (!activateConnectVault(result.vault, result.walletIdentityProof)) {
    throw new ConnectError('wallet_activation_failed');
  }
  try {
    await installAccountSession(result.session);
  } catch (cause) {
    if (!restoreWallet(previousWallet)) {
      throw new ConnectError(
        'identity_rollback_failed',
        'The previous Wallet could not be restored after account installation failed.',
      );
    }
    if (cause instanceof ConnectError) throw cause;
    throw new ConnectError(
      'account_session_install_failed',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  return result;
}

/** Clear the complete browser identity while retaining its device passkey. */
export async function disconnectDexterIdentity(
  config: DisconnectDexterIdentityConfig,
): Promise<boolean> {
  const previousWallet = getActiveWallet();
  if (previousWallet && !disconnectActiveWallet()) {
    throw new ConnectError('identity_wallet_disconnect_failed');
  }
  try {
    await config.clearAccountSession();
  } catch (cause) {
    if (!restoreWallet(previousWallet)) {
      throw new ConnectError(
        'identity_rollback_failed',
        'The previous Wallet could not be restored after account sign-out failed.',
      );
    }
    throw new ConnectError(
      'account_session_clear_failed',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  return true;
}
