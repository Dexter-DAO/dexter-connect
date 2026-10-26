'use client';

import { useId, type CSSProperties } from 'react';
import { AccountLink, DEFAULT_ACCOUNT_NAVIGATION, type AccountLinkComponent, type AccountNavigation } from './accountNavigation';
import { ACCOUNT_CONTROL_CSS } from './accountControlStyles';

export interface DexterAccountSummaryProps {
  /** Formatted value from a read bound to the currently selected account. */
  amount: string | null;
  loading: boolean;
  partial?: boolean;
  refresh: () => Promise<void>;
  navigation?: Partial<AccountNavigation>;
  LinkComponent?: AccountLinkComponent;
  onNavigate?: () => void;
  styleNonce?: string;
}

/** The same balance and money actions used by DexterAccountControl. */
export function DexterAccountSummary({ amount, loading, partial = false, refresh,
  navigation, LinkComponent = AccountLink, onNavigate, styleNonce }: DexterAccountSummaryProps) {
  const id = useId();
  const links = { ...DEFAULT_ACCOUNT_NAVIGATION, ...navigation };
  const content = <>
    <span className="dx-account-amount" id={`${id}-amount`}
      style={{ '--amount-length': amount?.length ?? 6 } as CSSProperties}>
      {amount ?? <span className="dx-account-balanceState" role="status">{loading ? 'Loading balance...' : 'Balance unavailable'}</span>}
    </span>
    <span id={`${id}-label`} className="dx-account-balanceLabel">{partial ? 'Priced assets' : 'Portfolio value'}</span>
  </>;
  return <div className="dx-account-summary">
    <style nonce={styleNonce}>{ACCOUNT_CONTROL_CSS}</style>
    <div className="dx-account-balanceRow">
      {links.money ? <LinkComponent href={links.money.href} className="dx-account-balance" onClick={onNavigate}
        aria-label={links.money.label ?? 'Money'} aria-describedby={`${id}-amount ${id}-label`}>{content}</LinkComponent>
        : <div className="dx-account-balance">{content}</div>}
      {!loading && <button type="button" className="dx-account-refresh" aria-label="Refresh balance" onClick={() => void refresh()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 7a7 7 0 0 1 11.6-1L20 9M4 15l2.2 3A7 7 0 0 0 17.8 17"/></svg>
      </button>}
    </div>
    {(links.send || links.receive) && <div className="dx-account-moneyActions">
      {links.send && <LinkComponent href={links.send.href} onClick={onNavigate}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-5 5 5-5 5 5"/></svg>{links.send.label ?? 'Send'}
      </LinkComponent>}
      {links.receive && <LinkComponent href={links.receive.href} onClick={onNavigate}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14m-5-5 5 5 5-5"/></svg>{links.receive.label ?? 'Receive'}
      </LinkComponent>}
    </div>}
  </div>;
}
