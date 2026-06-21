import { useEffect, type ReactElement } from 'react';
import { useSignInWithDexter, type UseSignInWithDexterConfig } from './useSignInWithDexter';
import type { SignInResult, ConnectError } from './types';

export interface SignInWithDexterProps extends UseSignInWithDexterConfig {
  /** Fired with the result the moment sign-in completes. */
  onSuccess?: (result: SignInResult) => void;
  /** Fired with the typed error if the ceremony fails. */
  onError?: (error: ConnectError) => void;
  /** Button label when signed out. Default "Sign in with Dexter". */
  label?: string;
  /** Visual variant: 'primary' = filled ember (default), 'secondary' = outline. */
  variant?: 'primary' | 'secondary';
  /** Extra className composed after the brand classes. Prefer overriding the
   *  `--dx-*` CSS variables for theming over restyling from scratch. */
  className?: string;
  /** Render the built-in connected chip (wallet + balance). Default true.
   *  Set false to render nothing once connected (consumer renders its own UI). */
  showConnectedChip?: boolean;
}

const STYLE_ID = 'dexter-connect-button-styles';

/**
 * The branded button's CSS, injected ONCE into <head>. Class-based (not inline)
 * so interaction states (hover / focus / active / disabled) and the loading
 * spinner can animate — and themeable: a consumer restyles by overriding the
 * `--dx-*` CSS variables on the button or any ancestor, never by forking the
 * component. This is the cure for hand-rolled copies: one button, many skins.
 */
const BUTTON_CSS = `
@keyframes dx-spin { to { transform: rotate(360deg); } }
@keyframes dx-pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }
.dx-btn{
  --dx-ember:#f26c18; --dx-ember-2:#ba3a00; --dx-fg:#fff4ea; --dx-radius:0px;
  position:relative; display:inline-flex; align-items:center; justify-content:center; gap:10px;
  padding:11px 22px; border:1px solid color-mix(in srgb,var(--dx-ember) 55%,transparent);
  border-radius:var(--dx-radius);
  background:linear-gradient(135deg,var(--dx-ember),var(--dx-ember-2));
  color:var(--dx-fg); font:inherit; font-weight:600; font-size:.78rem; letter-spacing:.12em;
  text-transform:uppercase; cursor:pointer; -webkit-tap-highlight-color:transparent;
  box-shadow:0 14px 26px color-mix(in srgb,var(--dx-ember) 24%,transparent);
  transition:transform .16s ease, box-shadow .16s ease, filter .16s ease, background .16s ease;
}
.dx-btn:hover{ transform:translateY(-1px); filter:brightness(1.07); box-shadow:0 20px 34px color-mix(in srgb,var(--dx-ember) 32%,transparent); }
.dx-btn:active{ transform:translateY(0); filter:brightness(.97); box-shadow:0 8px 16px color-mix(in srgb,var(--dx-ember) 22%,transparent); }
.dx-btn:focus-visible{ outline:none; box-shadow:0 0 0 3px color-mix(in srgb,var(--dx-ember) 38%,transparent); }
.dx-btn:disabled{ cursor:default; filter:saturate(.85) brightness(.98); }
.dx-btn--secondary{ background:transparent; color:var(--dx-ember); box-shadow:none; border-color:color-mix(in srgb,var(--dx-ember) 45%,transparent); }
.dx-btn--secondary:hover{ background:color-mix(in srgb,var(--dx-ember) 9%,transparent); filter:none; box-shadow:none; }
.dx-btn__mark{ flex-shrink:0; }
.dx-btn__spin{ width:15px; height:15px; flex-shrink:0; border-radius:50%;
  border:2px solid color-mix(in srgb,currentColor 30%,transparent); border-top-color:currentColor;
  animation:dx-spin .7s linear infinite; }
.dx-btn__doing{ animation:dx-pulse 1.4s ease-in-out infinite; }
.dx-chip{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; font:inherit;
  font-variant-numeric:tabular-nums; border-radius:var(--dx-radius,0);
  border:1px solid color-mix(in srgb,var(--dx-ember,#f26c18) 35%,transparent); }
.dx-chip__dot{ width:7px; height:7px; border-radius:50%; background:var(--dx-ember,#f26c18); }
.dx-chip__bal{ font-weight:600; opacity:.85; }
.dx-chip__x{ margin-left:2px; border:none; background:transparent; color:inherit; cursor:pointer; font-size:16px; line-height:1; opacity:.6; }
.dx-chip__x:hover{ opacity:1; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = BUTTON_CSS;
  document.head.appendChild(el);
}

// Inject at module load too (covers above-the-fold use before the effect runs).
ensureStyles();

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
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
      className="dx-btn__mark"
      width="18"
      height="18"
      viewBox="0 0 300 300"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M143.18,22.65c35.41,7.66,68.19,23.6,94.89,48.28,5.22,4.86,11.17,10.45,15.18,16.1,1.38,1.93,1.94,3.6.99,5.23-1.08,1.92-4.22,3.41-6.56,4.17-28.39,9.43-61.55,8.26-88.62-4.69-13.81-7.66-17.02-5.76-31.67-3.48-21.89,2.38-46.67.37-65.06-12.31-6.07-4.99-9.33-12.71-8.8-20.52-.16-9.4,4.25-18.12,11.47-24.06,21.29-17.85,52.64-14.45,78-8.77l.18.04h0Z" />
      <path d="M46.08,129.98c1.06-1.03,3.52-1.07,5.29-1.04,48.98-.05,98.1-.06,146.83-.1,17.53.14,35.01-.31,52.49.18,2.13.18,3.89.74,4.73,2.05,1.46,2.38.35,6.09-1.98,7.6-3.66,2.05-8.62,1.33-12.86,1.74-2.85.12-5.45.13-7.02,2.02-.91,1.07-1.28,2.56-1.56,3.95-.57,3.23-1.16,6.52-1.89,9.62-2.81,12.43-8.68,24.65-19.76,31.56-9.49,5.59-20.42,6.86-31.2,5.75-11.88-1.69-22.15-8.81-29.11-18.28-3.51-4.81-4.92-10.5-5.8-16.29-.47-2.56-.51-5.87-1.35-8-1.16-3.38-6.14-2.59-9.25-1.92-4.21.95-4.39,5.7-5.14,9.19-2.25,11.18-6.84,20.68-16.15,27.65-1.31,1.05-2.91,2.03-2.12,3.66,2.5,3.21,6.65,4.49,10.44,5.97,3.26,1.17,6.86,2.41,7.18,6.06.05,8.18-11.97,3.46-16.32,1.85-3.95-1.55-7.4-4.27-10.42-7.26-3.92-4.28-9.66-4.5-15.16-4.45-3.45-.07-6.99-.19-10.45-.82-21.29-4-31.08-21.3-30.9-42.01-.08-4.63.03-9.32.09-13.91.04-1.69.07-3.46,1.28-4.67l.1-.09h0Z" />
      <path d="M173.06,203.11c9.24-.06,21.6,4.49,22.85,14.84.3,2.12-.67,4.34-2.92,4.73-1.38.29-2.88-.05-4.09-.75-1.64-.9-2.97-2.86-4.19-3.05-1.33-.2-1.99.81-2.93,1.94-10.27,13.34-28.04,20.92-44.83,20.42-15.41-.33-31.89-5.95-43.53-17.34-3.15-3.39-1.55-9.88,3.61-9.19,1.83.32,3.29,1.45,4.76,2.65,10.49,10.12,24.85,14.04,39.12,13.03,10.55-1.23,20.38-5.47,28.74-11.92,1.11-1.06,4.45-3.63,3.5-5.12-.76-.85-4.31-.47-5.92-2.01-2.25-1.92-1.39-6.22,1.16-7.36,1.36-.65,2.96-.81,4.47-.86h.2,0Z" />
    </svg>
  );
}

/**
 * Turnkey "Sign in with Dexter" element. Signed out → the branded ember button
 * (hover / focus / active / loading states, themeable via --dx-* CSS vars);
 * signed in → a compact chip with the Dexter Wallet address + USD available.
 * Wraps useSignInWithDexter; consumers who need the raw vault/passkey data
 * should use that hook directly. Brand voice: no emojis, "unlock" banned.
 */
export function SignInWithDexter(props: SignInWithDexterProps): ReactElement | null {
  const {
    onSuccess,
    onError,
    label = 'Sign in with Dexter',
    variant = 'primary',
    className,
    showConnectedChip = true,
    ...config
  } = props;
  useEffect(ensureStyles, []);
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

  const pending = c.status === 'pending';
  return (
    <button
      type="button"
      className={cx('dx-btn', variant === 'secondary' && 'dx-btn--secondary', className)}
      onClick={handleClick}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <span className="dx-btn__spin" aria-hidden />
          <span className="dx-btn__doing">Connecting…</span>
        </>
      ) : (
        <>
          <DexterMark />
          {label}
        </>
      )}
    </button>
  );
}
