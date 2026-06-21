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

/** The Dexter passkey mark — the brand glyph carried on the branded button so
 *  every surface renders ONE button (no more hand-rolled copies per app). */
function DexterMark(): ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 300 300"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M143.18,22.65c35.41,7.66,68.19,23.6,94.89,48.28,5.22,4.86,11.17,10.45,15.18,16.1,1.38,1.93,1.94,3.6.99,5.23-1.08,1.92-4.22,3.41-6.56,4.17-28.39,9.43-61.55,8.26-88.62-4.69-13.81-7.66-17.02-5.76-31.67-3.48-21.89,2.38-46.67.37-65.06-12.31-6.07-4.99-9.33-12.71-8.8-20.52-.16-9.4,4.25-18.12,11.47-24.06,21.29-17.85,52.64-14.45,78-8.77l.18.04h0Z" />
      <path d="M46.08,129.98c1.06-1.03,3.52-1.07,5.29-1.04,48.98-.05,98.1-.06,146.83-.1,17.53.14,35.01-.31,52.49.18,2.13.18,3.89.74,4.73,2.05,1.46,2.38.35,6.09-1.98,7.6-3.66,2.05-8.62,1.33-12.86,1.74-2.85.12-5.45.13-7.02,2.02-.91,1.07-1.28,2.56-1.56,3.95-.57,3.23-1.16,6.52-1.89,9.62-2.81,12.43-8.68,24.65-19.76,31.56-9.49,5.59-20.42,6.86-31.2,5.75-11.88-1.69-22.15-8.81-29.11-18.28-3.51-4.81-4.92-10.5-5.8-16.29-.47-2.56-.51-5.87-1.35-8-1.16-3.38-6.14-2.59-9.25-1.92-4.21.95-4.39,5.7-5.14,9.19-2.25,11.18-6.84,20.68-16.15,27.65-1.31,1.05-2.91,2.03-2.12,3.66,2.5,3.21,6.65,4.49,10.44,5.97,3.26,1.17,6.86,2.41,7.18,6.06.05,8.18-11.97,3.46-16.32,1.85-3.95-1.55-7.4-4.27-10.42-7.26-3.92-4.28-9.66-4.5-15.16-4.45-3.45-.07-6.99-.19-10.45-.82-21.29-4-31.08-21.3-30.9-42.01-.08-4.63.03-9.32.09-13.91.04-1.69.07-3.46,1.28-4.67l.1-.09h0Z" />
      <path d="M173.06,203.11c9.24-.06,21.6,4.49,22.85,14.84.3,2.12-.67,4.34-2.92,4.73-1.38.29-2.88-.05-4.09-.75-1.64-.9-2.97-2.86-4.19-3.05-1.33-.2-1.99.81-2.93,1.94-10.27,13.34-28.04,20.92-44.83,20.42-15.41-.33-31.89-5.95-43.53-17.34-3.15-3.39-1.55-9.88,3.61-9.19,1.83.32,3.29,1.45,4.76,2.65,10.49,10.12,24.85,14.04,39.12,13.03,10.55-1.23,20.38-5.47,28.74-11.92,1.11-1.06,4.45-3.63,3.5-5.12-.76-.85-4.31-.47-5.92-2.01-2.25-1.92-1.39-6.22,1.16-7.36,1.36-.65,2.96-.81,4.47-.86h.2,0Z" />
    </svg>
  );
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
      {c.status === 'pending' ? (
        'Signing in…'
      ) : (
        <>
          <DexterMark />
          {label}
        </>
      )}
    </button>
  );
}

// ── default styles (a base; consumers restyle via className) ──────────────────
const EMBER = '#ef6820';

const BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '10px 22px',
  border: '1px solid rgba(242, 108, 24, 0.55)',
  borderRadius: 0, // sharp corners — Dexter brand drops radius on structural elements
  background: 'linear-gradient(135deg, rgba(242, 108, 24, 0.95), rgba(186, 58, 0, 0.88))',
  color: '#fff4ea',
  font: 'inherit',
  fontWeight: 600,
  fontSize: '0.78rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  boxShadow: '0 16px 28px rgba(242, 108, 24, 0.25)',
  cursor: 'pointer',
};

const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 0, // sharp — match the brand
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
