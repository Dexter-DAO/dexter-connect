import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { DexterWalletView } from './useDexterConnection';

export type AccountLinkComponent = ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>>;
export interface AccountDestination { href: string; label?: string }
export interface AccountNavigation {
  money: AccountDestination | false;
  send: AccountDestination | false;
  receive: AccountDestination | false;
  activity: AccountDestination | false;
  agents: AccountDestination | false;
  profile: AccountDestination | false;
  support: AccountDestination | false;
  settings: AccountDestination | false;
}

/** Local app destinations can replace any hosted destination; false hides it. */
export const DEFAULT_ACCOUNT_NAVIGATION: Readonly<AccountNavigation> = Object.freeze({
  money: { href: 'https://dexter.cash/wallet?section=money', label: 'Money' },
  send: { href: 'https://dexter.cash/wallet/withdraw', label: 'Send' },
  receive: { href: 'https://dexter.cash/wallet/deposit', label: 'Receive' },
  activity: { href: 'https://dexter.cash/wallet?section=activity', label: 'Activity' },
  agents: { href: 'https://dexter.cash/wallet?section=agents', label: 'Apps and agents' },
  profile: { href: 'https://dexter.cash/profile', label: 'Profile' },
  support: { href: 'https://dexter.cash/support', label: 'Support' },
  settings: { href: 'https://dexter.cash/wallet?section=you', label: 'Account settings' },
});

export interface AccountMenuItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  hint?: string;
  /** The host remains responsible for authorizing its destination. */
  requires: 'account' | 'wallet';
}

export function AccountLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props}/>;
}

/** Hosted pages must verify the selected account before showing its contents. */
export function resolveAccountNavigation(navigation: Partial<AccountNavigation> | undefined, wallet: DexterWalletView | null): AccountNavigation {
  const links = { ...DEFAULT_ACCOUNT_NAVIGATION, ...navigation };
  if (!wallet?.userHandle) return links;
  for (const key of Object.keys(links) as (keyof AccountNavigation)[]) {
    const item = links[key];
    if (!item || !item.href.startsWith('https://dexter.cash/')) continue;
    const url = new URL(item.href);
    if (url.origin !== 'https://dexter.cash' || !(url.pathname === '/profile' || url.pathname === '/wallet' || url.pathname.startsWith('/wallet/'))) continue;
    url.searchParams.set('dexter_account', wallet.userHandle);
    links[key] = { ...item, href: url.toString() };
  }
  return links;
}
