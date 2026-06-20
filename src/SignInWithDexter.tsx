import type { CSSProperties, ReactElement } from 'react';
import { useSignInWithDexter, type UseSignInWithDexterConfig } from './useSignInWithDexter';
import type { SignInResult, ConnectError } from './types';

export interface SignInWithDexterProps extends UseSignInWithDexterConfig {
  /** Fired with the result the moment sign-in completes. */
  onSuccess?: (result: SignInResult) => void;
  /** Fired with the typed error if the ceremony fails. */
  onError?: (error: ConnectError) => void;
  /** Button label when signed out. Default "Sign in with Dexter". */
  label?: string;
  /** className on the root (button when signed out, chip when connected) — for
   *  full restyling. Brand it from the consumer; the inline defaults are a base. */
  className?: string;
  /** Render the built-in connected chip (wallet + balance). Default true.
   *  Set false to render nothing once connected (consumer renders its own UI). */
  showConnectedChip?: boolean;
}

function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Turnkey "Sign in with Dexter" element. Signed out → an ember button; signed
 * in → a compact chip with the Dexter Wallet address + USD available. Wraps
 * useSignInWithDexter; consumers who need the raw vault/passkey data should use
 * that hook directly. Inline styles are a sensible default — restyle via
 * className (Dexter Ember, no emojis, "unlock" banned per brand voice).
 */
export function SignInWithDexter(props: SignInWithDexterProps): ReactElement | null {
  const {
    onSuccess,
    onError,
    label = 'Sign in with Dexter',
    className,
    showConnectedChip = true,
    ...config
  } = props;
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
      <span className={className} style={CHIP}>
        <span style={DOT} aria-hidden />
        <span>{c.vaultAddress ? shortAddress(c.vaultAddress) : 'Connected'}</span>
        {c.usdcBalance !== null && (
          <span style={BALANCE}>{formatUsd(c.usdcBalance)} available</span>
        )}
        <button type="button" onClick={c.disconnect} style={DISCONNECT} aria-label="Disconnect">
          {'×'}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={c.status === 'pending'}
      style={BUTTON}
    >
      {c.status === 'pending' ? 'Signing in…' : label}
    </button>
  );
}

// ── default styles (a base; consumers restyle via className) ──────────────────
const EMBER = '#ef6820';

const BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  border: 'none',
  borderRadius: 6,
  background: EMBER,
  color: '#fff',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
};

const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid rgba(239,104,32,0.35)',
  font: 'inherit',
  fontVariantNumeric: 'tabular-nums',
};

const DOT: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: EMBER,
};

const BALANCE: CSSProperties = {
  fontWeight: 600,
  opacity: 0.85,
};

const DISCONNECT: CSSProperties = {
  marginLeft: 2,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  opacity: 0.6,
};
