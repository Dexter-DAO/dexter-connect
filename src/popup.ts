import {
  ConnectError,
  type CeremonyOperation,
  type HostedMissingVaultRecoveryRequestPayload,
  type HostedSignRequestPayload,
  type WalletStoreMode,
  type AgentDelegationMode,
  resolveAgentDelegationMode,
  resolveWalletStoreMode,
} from './types';
import { normalizeMissingVaultRecoveryOptions } from './missingVaultRecoveryContract';
import { resolveDexterConnectHost } from './trust';

// ─────────────────────────────────────────────────────────────────────────────
// Hosted-popup transport — "Sign in with Dexter on ANY website."
//
// WebAuthn credentials are bound to the rpId origin (dexter.cash), so an in-page
// ceremony only works on Dexter's own origins. To make it work from a stranger
// site, the ceremony runs in a popup on the Dexter origin (dexter.cash/connect)
// and posts the result back to window.opener with a strict target-origin check.
// The public API (signIn / createWallet) is unchanged — this is transport behind
// the same calls.
// ─────────────────────────────────────────────────────────────────────────────

const POPUP_TIMEOUT_MS = 120_000;
const CANONICAL_ORIGIN = 'https://dexter.cash';

/**
 * Decide whether a ceremony routes through the hosted popup.
 * 'auto' = inline ONLY on the canonical Dexter origin; popup everywhere else
 * (incl. subdomains like beta.dexter.cash, where in-page WebAuthn 400s because
 * the subdomain isn't in dexter-api's RP_CONFIG.origins). Correct-by-construction
 * so no consumer has to know that gotcha.
 */
export function shouldUsePopup(transport?: 'auto' | 'popup' | 'inline'): boolean {
  if (transport === 'popup') return true;
  if (transport === 'inline') return false;
  if (typeof window === 'undefined') return false; // SSR: no popup
  return window.location.origin !== CANONICAL_ORIGIN;
}

interface PopupHelloMessage {
  v: 1;
  type: 'dexter-connect:hello';
  requestId: string;
  op: CeremonyOperation;
}

interface PopupHelloAckMessage {
  v: 1;
  type: 'dexter-connect:hello-ack';
  requestId: string;
  op: CeremonyOperation;
}

/** Sent exactly once, after hello/ack, and never represented in the URL. */
interface PopupSignRequestMessage {
  v: 1;
  type: 'dexter-connect:sign-request';
  requestId: string;
  op: 'sign';
  payload: HostedSignRequestPayload;
}

/** Sent exactly once after the exact recovery popup completes hello/ack. */
interface PopupMissingVaultRecoveryRequestMessage {
  v: 1;
  type: 'dexter-connect:missing-vault-recovery-request';
  requestId: string;
  op: 'recover-missing-vault';
  payload: HostedMissingVaultRecoveryRequestPayload;
}

interface PopupResultMessage {
  v: 1;
  type: 'dexter-connect:result';
  requestId: string;
  op: CeremonyOperation;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message?: string };
}

/**
 * Run a ceremony (sign-in or create) via the hosted popup, returning the SAME
 * shape the inline path returns (SignInResult | CreateWalletResult). Strict
 * checks: a browser-stamped hello/ack binds the arbitrary opener origin to the
 * exact popup window; results require the hosted origin, popup source, request
 * nonce, and operation. Rejects on block / close / timeout / error.
 */
export function openCeremonyPopup<T>(
  op: CeremonyOperation,
  config: {
    connectHost?: string;
    name?: string;
    preferImmediate?: boolean;
    walletStore?: WalletStoreMode;
    agentDelegation?: AgentDelegationMode;
    signRequest?: HostedSignRequestPayload;
    /**
     * Internal recovery seam. The loader is invoked only after window.open so
     * iOS Safari keeps the popup tied to the user's tap. It returns only
     * server-issued public-key options; the account token never crosses.
     */
    missingVaultRecoveryRequest?: () => Promise<HostedMissingVaultRecoveryRequestPayload>;
  } = {},
): Promise<T> {
  if (typeof window === 'undefined') {
    return Promise.reject(new ConnectError('not_browser', 'popup ceremony requires a browser'));
  }
  // The opener may be any website. The credential-handling popup may not.
  const host = resolveDexterConnectHost(config.connectHost);
  const hostOrigin = new URL(host).origin;
  const openerOrigin = window.location.origin;
  const requestId = makeNonce();
  const signRequest = snapshotSignRequest(op, config.signRequest);
  const recoveryOptionsLoader = snapshotRecoveryLoader(
    op,
    config.missingVaultRecoveryRequest,
  );
  const walletStore = resolveWalletStoreMode(config.walletStore);
  const createsWallet = op === 'create' || op === 'continue';
  if (!createsWallet && config.agentDelegation !== undefined) {
    throw new ConnectError(
      'unexpected_agent_delegation',
      'agentDelegation applies only to create or continue ceremonies',
    );
  }
  const agentDelegation = createsWallet
    ? resolveAgentDelegationMode(config.agentDelegation)
    : undefined;

  const params = new URLSearchParams({ v: '1', op, requestId, origin: openerOrigin });
  if (config.name) params.set('name', config.name);
  if (config.preferImmediate) params.set('preferImmediate', '1');
  if (walletStore === 'provisional') params.set('walletStore', 'provisional');
  if (agentDelegation) params.set('agentDelegation', agentDelegation);
  const url = `${host}?${params.toString()}`;

  return new Promise<T>((resolve, reject) => {
    const popup = window.open(url, 'dexter-connect', popupFeatures());
    if (!popup) {
      reject(
        new ConnectError('popup_blocked', 'the Dexter sign-in popup was blocked — allow popups for this site'),
      );
      return;
    }

    let settled = false;
    let handshakeComplete = false;
    let recoveryRequestSent = false;
    let recoveryRequest: HostedMissingVaultRecoveryRequestPayload | undefined;

    const sendRecoveryRequest = () => {
      if (
        settled ||
        !handshakeComplete ||
        recoveryRequestSent ||
        !recoveryRequest
      ) {
        return;
      }
      const request: PopupMissingVaultRecoveryRequestMessage = {
        v: 1,
        type: 'dexter-connect:missing-vault-recovery-request',
        requestId,
        op: 'recover-missing-vault',
        payload: recoveryRequest,
      };
      try {
        popup.postMessage(request, hostOrigin);
        recoveryRequestSent = true;
      } catch (err) {
        finish(() =>
          reject(
            new ConnectError(
              'popup_handshake_failed',
              err instanceof Error ? err.message : String(err),
            ),
          ),
        );
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== hostOrigin) return; // only trust the hosted origin
      if (event.source !== popup) return; // only trust the exact window we opened
      const data = event.data as PopupHelloMessage | PopupResultMessage | undefined;
      if (!data || data.v !== 1 || data.requestId !== requestId || data.op !== op) return;

      if (data.type === 'dexter-connect:hello') {
        // A repeated hello cannot trigger a second sensitive request.
        if (handshakeComplete) return;
        const ack: PopupHelloAckMessage = {
          v: 1,
          type: 'dexter-connect:hello-ack',
          requestId,
          op,
        };
        try {
          // targetOrigin is the browser-stamped hosted origin, never query data.
          popup.postMessage(ack, event.origin);
          if (signRequest) {
            const request: PopupSignRequestMessage = {
              v: 1,
              type: 'dexter-connect:sign-request',
              requestId,
              op: 'sign',
              payload: signRequest,
            };
            // The raw operation and vault identity cross only this exact
            // browser-stamped source/origin boundary, after hello/ack.
            popup.postMessage(request, event.origin);
          }
          handshakeComplete = true;
          sendRecoveryRequest();
        } catch (err) {
          finish(() =>
            reject(
              new ConnectError(
                'popup_handshake_failed',
                err instanceof Error ? err.message : String(err),
              ),
            ),
          );
        }
        return;
      }

      // A result is meaningful only after the exact popup completed the
      // browser-stamped origin handshake for this exact operation.
      if (data.type !== 'dexter-connect:result' || !handshakeComplete) return;
      if (op === 'recover-missing-vault' && !recoveryRequestSent) return;
      if (data.ok) finish(() => resolve(data.result as T));
      else
        finish(() =>
          reject(new ConnectError(data.error?.code ?? 'popup_failed', data.error?.message)),
        );
    };

    const closedTimer = window.setInterval(() => {
      if (popup.closed) finish(() => reject(new ConnectError('popup_closed', 'the sign-in window was closed')));
    }, 500);
    const timeout = window.setTimeout(
      () => finish(() => reject(new ConnectError('popup_timeout', 'the sign-in window timed out'))),
      POPUP_TIMEOUT_MS,
    );

    function finish(act: () => void) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
      window.clearTimeout(timeout);
      try {
        popup?.close();
      } catch {
        /* cross-origin close can throw after navigation — ignore */
      }
      act();
    }

    window.addEventListener('message', onMessage);

    // Invoke this only after the popup exists. Fetching before window.open
    // breaks the user-activation chain on iOS Safari and lets popup blockers
    // turn a valid recovery attempt into a dead end.
    if (recoveryOptionsLoader) {
      let pendingOptions: Promise<HostedMissingVaultRecoveryRequestPayload>;
      try {
        pendingOptions = recoveryOptionsLoader();
      } catch (err) {
        finish(() => reject(asRecoveryOptionsError(err)));
        return;
      }
      void pendingOptions.then(
        (request) => {
          if (settled) return;
          try {
            recoveryRequest = {
              options: normalizeMissingVaultRecoveryOptions(request?.options),
              account: snapshotRecoveryAccount(request?.account),
            };
            sendRecoveryRequest();
          } catch (err) {
            finish(() => reject(asRecoveryOptionsError(err)));
          }
        },
        (err) => finish(() => reject(asRecoveryOptionsError(err))),
      );
    }
  });
}

function snapshotRecoveryLoader(
  op: CeremonyOperation,
  loader?: () => Promise<HostedMissingVaultRecoveryRequestPayload>,
): (() => Promise<HostedMissingVaultRecoveryRequestPayload>) | undefined {
  if (op !== 'recover-missing-vault') {
    if (loader !== undefined) {
      throw new ConnectError(
        'unexpected_missing_vault_recovery_request',
        'missing Vault recovery options require the recovery operation',
      );
    }
    return undefined;
  }
  if (typeof loader !== 'function') {
    throw new ConnectError(
      'missing_vault_recovery_request',
      'missing Vault recovery requires server-issued public-key options',
    );
  }
  return loader;
}

function snapshotRecoveryAccount(
  value: HostedMissingVaultRecoveryRequestPayload['account'] | undefined,
): HostedMissingVaultRecoveryRequestPayload['account'] {
  if (
    value?.provider !== 'x' ||
    typeof value.handle !== 'string' ||
    !/^@[A-Za-z0-9_]{1,64}$/.test(value.handle)
  ) {
    throw new ConnectError('missing_vault_recovery_account_malformed');
  }
  return { provider: 'x', handle: value.handle };
}

function asRecoveryOptionsError(err: unknown): ConnectError {
  if (err instanceof ConnectError) return err;
  return new ConnectError(
    'missing_vault_recovery_challenge_failed',
    err instanceof Error ? err.message : String(err),
  );
}

function snapshotSignRequest(
  op: CeremonyOperation,
  request?: HostedSignRequestPayload,
): HostedSignRequestPayload | undefined {
  if (op !== 'sign') {
    if (request !== undefined) {
      throw new ConnectError('unexpected_sign_request', 'sign payload requires op=sign');
    }
    return undefined;
  }
  if (
    !request ||
    !(request.operationMessage instanceof Uint8Array) ||
    request.operationMessage.length === 0 ||
    request.operationMessage.length > 4_096
  ) {
    throw new ConnectError('missing_sign_request', 'hosted signing requires raw operation bytes');
  }
  if (isAccountProofOperation(request.operationMessage)) {
    throw new ConnectError(
      'unsupported_operation',
      'account-claim proofs cannot be requested by a third-party website',
    );
  }
  const vault = request.vault;
  if (
    !vault ||
    !vault.vaultPda ||
    !vault.publicKey ||
    !vault.userHandle ||
    !vault.credentialId
  ) {
    throw new ConnectError('invalid_sign_identity', 'hosted signing requires a complete vault identity');
  }
  return {
    // Snapshot before opening the window so caller mutation cannot change what
    // the user sees/signs after the ceremony begins.
    operationMessage: new Uint8Array(request.operationMessage),
    vault: {
      vaultPda: vault.vaultPda,
      publicKey: vault.publicKey,
      userHandle: vault.userHandle,
      credentialId: vault.credentialId,
      ...(vault.walletLabel !== undefined ? { walletLabel: vault.walletLabel } : {}),
    },
  };
}

/** `prove_passkey` account-login intent: reserved to Dexter account claim. */
function isAccountProofOperation(operation: Uint8Array): boolean {
  const prefix = new TextEncoder().encode('siwx_login');
  if (operation.length !== prefix.length + 32) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (operation[i] !== prefix[i]) return false;
  }
  return true;
}

function popupFeatures(): string {
  const w = 420;
  const h = 660;
  const sy = typeof window !== 'undefined' ? window.screenY || 0 : 0;
  const sx = typeof window !== 'undefined' ? window.screenX || 0 : 0;
  const sh = typeof window !== 'undefined' ? window.screen?.height ?? h : h;
  const sw = typeof window !== 'undefined' ? window.screen?.width ?? w : w;
  const top = Math.max(0, Math.round((sh - h) / 2 + sy));
  const left = Math.max(0, Math.round((sw - w) / 2 + sx));
  return `popup,width=${w},height=${h},left=${left},top=${top}`;
}

/** Correlation nonce (NOT a secret) — crypto.randomUUID, else getRandomValues. */
function makeNonce(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const a = new Uint8Array(16);
    c.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `rid-${new URL(location.href).searchParams.get('v') ?? ''}-${(typeof performance !== 'undefined' ? performance.now() : 0)}`;
}
