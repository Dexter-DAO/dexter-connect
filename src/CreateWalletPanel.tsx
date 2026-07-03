import { useEffect, useState, type ReactElement } from 'react';

import { DexterButton, ensureDexterButtonStyles, cx } from './DexterButton';
import { AllowanceChips } from './AllowanceChips';
import { ensureConsentStyles } from './consentStyles';
import { ceremonyPhaseLabel } from './phase';
import { authoredPolicy } from './policy';
import { createWallet, type CreateWalletResult } from './enroll';
import { ConnectError, type CeremonyPhase } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// CreateWalletPanel — the turnkey consent-at-birth create surface. Every door
// that mints a Dexter wallet collects the user-authored agent allowance BEFORE
// the wallet is born (Branch's consent-at-birth ruling): an optional name, the
// AllowanceChips ($5/$20/$50/Custom, NONE preselected), the fine print, and the
// branded Create CTA — gated shut until a valid amount is authored. Zero is not
// consent; nothing invents a default. On tap it runs the full createWallet
// ceremony (one passkey approval) with the authored SpendPolicy threaded into the
// /initialize body. One panel, every consumer (Rule #7); themeable via --dx-*.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateWalletPanelProps {
  /** Fired with the minted wallet the moment creation succeeds. */
  onCreated?: (result: CreateWalletResult) => void;
  /** Fired with the typed error if the ceremony fails. */
  onError?: (error: ConnectError) => void;
  /** dexter-api base. Default https://api.dexter.cash (createWallet's default). */
  apiBase?: string;
  /** Where the WebAuthn ceremony runs. Default 'auto' (createWallet's default). */
  transport?: 'auto' | 'popup' | 'inline';
  /** Render the optional "Name your wallet" field. Default true. */
  showName?: boolean;
  /** Extra className composed after the brand classes. */
  className?: string;
}

const FINE_PRINT =
  'Your number, your tap. Agents can never spend past it, and you can revoke any time.';

/** The turnkey consent-at-birth create panel. */
export function CreateWalletPanel(props: CreateWalletPanelProps): ReactElement {
  const { onCreated, onError, apiBase, transport, showName = true, className } = props;
  useEffect(ensureConsentStyles, []);
  useEffect(ensureDexterButtonStyles, []);

  const [name, setName] = useState('');
  const [value, setValue] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<CeremonyPhase | null>(null);
  const [error, setError] = useState<ConnectError | null>(null);

  const policy = authoredPolicy(value ?? '');

  const handleCreate = async (): Promise<void> => {
    // Busy guard: ignore taps while a ceremony is already in flight.
    if (running) return;
    // Gating guard: zero is not consent, no default — never run without a policy.
    if (!policy) return;

    setError(null);
    setRunning(true);
    setPhase(null);
    try {
      const result = await createWallet({
        name: name.trim() || 'Dexter Wallet',
        spendPolicy: policy,
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
      {showName && (
        <div className="dx-cwp__field">
          <label className="dx-cwp__label" htmlFor="dx-cwp-name">
            Name your wallet
          </label>
          <input
            id="dx-cwp-name"
            className="dx-cwp__name"
            maxLength={40}
            placeholder="Dexter Wallet"
            value={name}
            disabled={running}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}

      <div className="dx-cwp__field">
        <span className="dx-cwp__label">What agents may spend, per 30 days</span>
        <AllowanceChips value={value} onChange={setValue} />
      </div>

      <p className="dx-cwp__fine">{FINE_PRINT}</p>

      {error && (
        <div className="dx-cwp__err" role="alert">
          {error.message || error.code}
        </div>
      )}

      <DexterButton
        block
        className="dx-cwp__cta"
        loading={running}
        loadingLabel={phase ? ceremonyPhaseLabel(phase) : 'Creating…'}
        disabled={!policy}
        onClick={handleCreate}
      >
        {error ? 'Retry' : 'Create your Dexter Wallet'}
      </DexterButton>
    </div>
  );
}
