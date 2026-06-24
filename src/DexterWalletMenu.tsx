import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { cx } from './DexterButton';
import { ensureWalletKitStyles } from './walletKitStyles';

// ─────────────────────────────────────────────────────────────────────────────
// DexterWalletMenu — the branded wallet dropdown for a passkey-vault wallet.
// Identity header + actions (Manage / Save / Start fresh). Presentational: the
// consumer feeds the label and wires the action callbacks; the menu owns the
// "Save your wallet" flip and reveals whatever sign-in UI the consumer slots in
// (e.g. <SignInWithDexter/>). One branded wallet menu, every surface (Rule #7);
// themeable via --dx-* CSS vars.
// ─────────────────────────────────────────────────────────────────────────────

export interface DexterWalletMenuProps {
  /** The wallet's display name (nickname, else "Dexter Wallet"). */
  walletLabel: string;
  /** Avatar initial (defaults to the first letter of walletLabel). */
  avatarInitial?: string;
  /** "Manage wallet" → the consumer's wallet page. Row hidden if omitted. */
  onManageWallet?: () => void;
  /** "Start fresh" → the consumer ejects/resets (guard + perform on its side). Row hidden if omitted. */
  onStartFresh?: () => void;
  /** Sign-in/save UI revealed when "Save your wallet" is tapped (e.g. <SignInWithDexter/>). Row hidden if omitted. */
  saveSlot?: ReactNode;
  /** Short hint shown above the save UI. */
  saveHint?: string;
  /** Extra className composed after the brand classes. */
  className?: string;
}

/** The branded wallet dropdown. */
export function DexterWalletMenu(props: DexterWalletMenuProps): ReactElement {
  const { walletLabel, avatarInitial, onManageWallet, onStartFresh, saveSlot, saveHint, className } = props;
  useEffect(ensureWalletKitStyles, []);
  const [showSave, setShowSave] = useState(false);

  const initial = (avatarInitial ?? walletLabel.trim().charAt(0) ?? 'D').toUpperCase();

  if (showSave && saveSlot) {
    return (
      <div className={cx('dx-wmenu', className)}>
        <button
          type="button"
          className="dx-wmenu__item dx-wmenu__back"
          onClick={() => setShowSave(false)}
        >
          <span>← Back to wallet</span>
        </button>
        <div className="dx-wmenu__save">
          {saveHint ? <span className="dx-wmenu__savehint">{saveHint}</span> : null}
          {saveSlot}
        </div>
      </div>
    );
  }

  return (
    <div className={cx('dx-wmenu', className)}>
      <div className="dx-wmenu__id">
        <span className="dx-wmenu__avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="dx-wmenu__meta">
          <span className="dx-wmenu__name">{walletLabel}</span>
          <span className="dx-wmenu__sub">Your Dexter Wallet</span>
        </span>
      </div>
      <div className="dx-wmenu__list">
        {onManageWallet ? (
          <button type="button" className="dx-wmenu__item" onClick={onManageWallet}>
            <span>Manage wallet</span>
            <span className="dx-wmenu__icon" aria-hidden="true">↗</span>
          </button>
        ) : null}
        {saveSlot ? (
          <button type="button" className="dx-wmenu__item" onClick={() => setShowSave(true)}>
            <span>Save your wallet</span>
            <span className="dx-wmenu__icon" aria-hidden="true">↗</span>
          </button>
        ) : null}
        {onStartFresh ? (
          <button
            type="button"
            className="dx-wmenu__item dx-wmenu__item--danger"
            onClick={onStartFresh}
          >
            <span>Start fresh</span>
            <span className="dx-wmenu__icon" aria-hidden="true">⟵</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
