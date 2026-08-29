import { useEffect, useId, useState, type ReactElement } from 'react';

import { DexterButton, ensureDexterButtonStyles, cx } from './DexterButton';
import { AllowanceChips } from './AllowanceChips';
import { ensureConsentStyles } from './consentStyles';
import { ceremonyPhaseLabel } from './phase';
import { authoredPolicy } from './policy';
import { createWallet, type CreateWalletResult } from './enroll';
import { shouldUsePopup } from './popup';
import {
  ConnectError,
  type AgentDelegationMode,
  type CeremonyPhase,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// CreateWalletPanel: the turnkey wallet-create surface. The default creates
// the owner's wallet. Explicit configure-now doors collect an allowance. Off-origin
// ceremonies continue into the hosted Dexter window, which is the sole place
// that collects the applicable values; the outer page never displays a choice
// that the popup would discard or duplicate.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateWalletPanelProps {
  /** Fired with the minted wallet the moment creation succeeds. */
  onCreated?: (result: CreateWalletResult) => void;
  /** Fired with the typed error if the ceremony fails. */
  onError?: (error: ConnectError) => void;
  /** Compatibility-only: omitted or exactly https://api.dexter.cash. */
  apiBase?: string;
  /** Where the WebAuthn ceremony runs. Default 'auto' (createWallet's default). */
  transport?: 'auto' | 'popup' | 'inline';
  /** Render the optional "Name your wallet" field. Default true. */
  showName?: boolean;
  /**
   * `deferred` is the default and omits the agent-allowance UI.
   * `configure-now` is the explicit compatibility flow for an allowance.
   */
  agentDelegation?: AgentDelegationMode;
  /** Extra className composed after the brand classes. */
  className?: string;
}

const FINE_PRINT =
  'This is the wallet-wide agent allowance. You can revoke it anytime. Starter credit, if available, is separate and never raises this limit.';

/** The turnkey consent-at-birth create panel. */
export function CreateWalletPanel(props: CreateWalletPanelProps): ReactElement {
  const {
    onCreated,
    onError,
    apiBase,
    transport,
    showName = true,
    agentDelegation = 'deferred',
    className,
  } = props;
  useEffect(ensureConsentStyles, []);
  useEffect(ensureDexterButtonStyles, []);
  const nameInputId = useId();

  const [name, setName] = useState('');
  const [value, setValue] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const [error, setError] = useState<ConnectError | null>(null);
  const [resolvedTransport, setResolvedTransport] = useState<
    'unknown' | 'inline' | 'popup'
  >(
    transport === 'inline' ? 'inline' : transport === 'popup' ? 'popup' : 'unknown',
  );

  useEffect(() => {
    setResolvedTransport(shouldUsePopup(transport) ? 'popup' : 'inline');
  }, [transport]);

  const hosted = resolvedTransport === 'popup';
  const ownerOnly = agentDelegation === 'deferred';
  const policy =
    resolvedTransport === 'inline' && !ownerOnly
      ? authoredPolicy(value ?? '')
      : null;
  const canContinue = hosted || ownerOnly || Boolean(policy);
  const statusText = running
    ? phase
      ? ceremonyPhaseLabel(phase)
      : 'Starting your passkey…'
    : resolvedTransport === 'unknown'
      ? 'Preparing wallet setup…'
      : hosted
        ? 'Wallet setup continues in Dexter Wallet.'
        : ownerOnly
          ? ''
          : policy
            ? 'Ready to create.'
            : 'Choose an agent allowance.';

  const handleCreate = async (): Promise<void> => {
    // Busy guard: ignore taps while a ceremony is already in flight.
    if (running) return;
    // Inline configure-now creation is gated on the authored policy. Deferred
    // creation is explicitly owner-only. Hosted creation owns the choice in the
    // Dexter window, so the outer page supplies no shadow value.
    if (resolvedTransport === 'unknown' || (!hosted && !ownerOnly && !policy)) return;

    setError(null);
    setRunning(true);
    setPhase(null);
    try {
      const result = await createWallet({
        name: hosted ? undefined : name.trim() || 'Dexter Wallet',
        spendPolicy: hosted ? undefined : policy ?? undefined,
        agentDelegation,
        apiBase,
        transport,
        onPhase: setPhase,
      });
      onCreated?.(result);
    } catch (e) {
      const err =
        e instanceof ConnectError
          ? e
          : new ConnectError('create_failed', e instanceof Error ? e.message : String(e));
      setError(err);
      onError?.(err);
    } finally {
      setRunning(false);
      setPhase(null);
    }
  };

  return (
    <div className={cx('dx-cwp', className)}>
      {!hosted && resolvedTransport === 'inline' && showName && (
        <div className="dx-cwp__field">
          <label className="dx-cwp__label" htmlFor={nameInputId}>
            Name your wallet
          </label>
          <input
            id={nameInputId}
            className="dx-cwp__name"
            maxLength={40}
            placeholder="Dexter Wallet"
            value={name}
            disabled={running}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}

      {hosted ? (
        <p className="dx-cwp__hosted">
          {ownerOnly
            ? 'Finish setup in Dexter Wallet.'
            : 'Choose a name and agent allowance in Dexter Wallet.'}
        </p>
      ) : resolvedTransport === 'inline' ? (
        !ownerOnly ? (
          <>
            <div className="dx-cwp__field">
              <span className="dx-cwp__label">What agents may spend automatically, per 30 days</span>
              <AllowanceChips value={value} onChange={setValue} disabled={running} />
            </div>
            <p className="dx-cwp__fine">{FINE_PRINT}</p>
          </>
        ) : null
      ) : null}

      {error && (
        <div className="dx-cwp__err" role="alert" aria-live="assertive">
          {error.message || error.code}
        </div>
      )}

      {statusText && (
        <p className="dx-cwp__status" role="status" aria-live="polite">
          {statusText}
        </p>
      )}

      <DexterButton
        block
        className="dx-cwp__cta"
        loading={running}
        loadingLabel={phase ? ceremonyPhaseLabel(phase) : 'Creating…'}
        disabled={!canContinue || resolvedTransport === 'unknown'}
        onClick={handleCreate}
      >
        {error
          ? 'Retry'
          : hosted
            ? 'Continue to Dexter Wallet'
            : 'Create your Dexter Wallet'}
      </DexterButton>
    </div>
  );
}
