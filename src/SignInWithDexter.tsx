import { useEffect, type ReactElement } from 'react';
import { useSignInWithDexter, type UseSignInWithDexterConfig } from './useSignInWithDexter';
import type { SignInResult, ConnectError, CeremonyPhase } from './types';
import { DexterButton, ensureDexterButtonStyles, cx } from './DexterButton';

/** Per-phase loading labels — the live "connecting steps" in the button. */
const PHASE_LABEL: Record<CeremonyPhase, string> = {
  challenge: 'Preparing…',
  passkey: 'Waiting for your passkey…',
  verifying: 'Verifying…',
  finalizing: 'Finishing…',
};

export interface SignInWithDexterProps extends UseSignInWithDexterConfig {
  /** Fired with the result the moment sign-in completes. */
  onSuccess?: (result: SignInResult) => void;
  /** Fired with the typed error if the ceremony fails. */
  onError?: (error: ConnectError) => void;
  /** Button label when signed out. Default "Sign in with Dexter". */
  label?: string;
  /** 'primary' = filled ember (default), 'secondary' = outline. */
  variant?: 'primary' | 'secondary';
  /** Full-width button. */
  block?: boolean;
  /** Extra className composed after the brand classes. Prefer overriding the
   *  `--dx-*` CSS variables for theming. */
  className?: string;
  /** Render the built-in connected chip (wallet + balance). Default true. */
  showConnectedChip?: boolean;
}

function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Turnkey "Sign in with Dexter" element. Signed out → the branded DexterButton
 * (hover / focus / active / loading states, themeable via --dx-* CSS vars);
 * signed in → a compact chip with the Dexter Wallet address + USD available.
 * Wraps useSignInWithDexter; for the wallet CREATE flow use <DexterButton>
 * wired to your create action. Brand voice: no emojis, "unlock" banned.
 */
export function SignInWithDexter(props: SignInWithDexterProps): ReactElement | null {
  const {
    onSuccess,
    onError,
    label = 'Sign in with Dexter',
    variant = 'primary',
    block = false,
    className,
    showConnectedChip = true,
    ...config
  } = props;
  useEffect(ensureDexterButtonStyles, []);
  const c = useSignInWithDexter(config);

  const handleClick = async () => {
    try {
      onSuccess?.(await c.signIn());
    } catch (err) {
      onError?.(err as ConnectError);
    }
  };

  if (c.isVaultConnected) {
    if (!showConnectedChip) return null;
    return (
      <span className={cx('dx-chip', className)}>
        <span className="dx-chip__dot" aria-hidden />
        <span>{c.vaultAddress ? shortAddress(c.vaultAddress) : 'Connected'}</span>
        {c.usdcBalance !== null && (
          <span className="dx-chip__bal">{formatUsd(c.usdcBalance)} available</span>
        )}
        <button type="button" className="dx-chip__x" onClick={c.disconnect} aria-label="Disconnect">
          {'×'}
        </button>
      </span>
    );
  }

  return (
    <DexterButton
      loading={c.status === 'pending'}
      loadingLabel={c.phase ? PHASE_LABEL[c.phase] : 'Connecting…'}
      variant={variant}
      block={block}
      className={className}
      onClick={handleClick}
    >
      {label}
    </DexterButton>
  );
}
