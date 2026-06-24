import { useEffect, type ReactElement } from 'react';

import { cx } from './DexterButton';
import { ensureWalletKitStyles } from './walletKitStyles';

// ─────────────────────────────────────────────────────────────────────────────
// DexterWalletChip — the branded header trigger. Presentational: the consumer
// computes WHAT to show (account name / wallet label / signed-out prompt) from
// its own identity + auth, and this renders the branded chip (avatar + label,
// connected vs signed-out tone). One chip, every surface (Rule #7). Themeable
// via --dx-* CSS vars; sharp corners by default.
// ─────────────────────────────────────────────────────────────────────────────

export interface DexterWalletChipProps {
  /** Connected (a wallet/account is present) → avatar + label; else signed-out label only. */
  connected: boolean;
  /** What to show: account name, wallet label, or the signed-out prompt (e.g. "Log in"). */
  label: string;
  /** Avatar image (e.g. a linked X avatar); falls back to the initial. */
  avatarUrl?: string | null;
  /** Single-character avatar fallback (defaults to the first letter of `label`). */
  avatarInitial?: string;
  onClick?: () => void;
  /** Extra className composed after the brand classes. */
  className?: string;
  /** Reflected to aria-expanded (when the chip toggles a menu). */
  ariaExpanded?: boolean;
}

/** The branded wallet/account chip. Wire it to open your menu via `onClick`. */
export function DexterWalletChip(props: DexterWalletChipProps): ReactElement {
  const { connected, label, avatarUrl, avatarInitial, onClick, className, ariaExpanded } = props;
  useEffect(ensureWalletKitStyles, []);

  const initial = (avatarInitial ?? label.trim().charAt(0) ?? 'D').toUpperCase();

  return (
    <button
      type="button"
      className={cx('dx-wchip', !connected && 'dx-wchip--signedout', className)}
      onClick={onClick}
      aria-expanded={ariaExpanded}
    >
      {connected ? (
        <span className="dx-wchip__avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : initial}
        </span>
      ) : null}
      <span className="dx-wchip__label">{label}</span>
    </button>
  );
}
