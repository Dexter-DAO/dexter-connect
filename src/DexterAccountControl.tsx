'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ConnectError } from './types';
import type { UseDexterConnection } from './useDexterConnection';
import { CreateWalletPanel } from './CreateWalletPanel';
import { AccountFace, AccountMark } from './accountBrand';
import { ACCOUNT_CONTROL_CSS } from './accountControlStyles';
import { AccountLink, resolveAccountNavigation, type AccountLinkComponent, type AccountMenuItem, type AccountNavigation } from './accountNavigation';
import { DexterAccountSummary } from './DexterAccountSummary';
import { useAccountPortfolio } from './useAccountPortfolio';

type ConnectionAction = 'connect' | 'switch' | 'retry' | 'disconnect';

export interface DexterAccountControlProps {
  /** Reuse the app's canonical useDexterConnection instance. */
  connection: UseDexterConnection;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shown only after the connection verifies account access. */
  profile?: { name?: string; email?: string };
  navigation?: Partial<AccountNavigation>;
  /** Host-specific links. The connection also gates the required access. */
  items?: readonly AccountMenuItem[];
  LinkComponent?: AccountLinkComponent;
  /** Optional adapter for an existing portfolio reader; presentation stays shared. */
  renderSummary?: (onNavigate: () => void) => ReactNode;
  formatError?: (code?: string) => string;
  className?: string;
  triggerClassName?: string;
  styleNonce?: string;
}

/** Branded account entry with canonical connection, balance and settings. */
export function DexterAccountControl({ connection: dexter, open: controlledOpen,
  onOpenChange, profile, navigation, items = [], LinkComponent = AccountLink,
  renderSummary, formatError = accountConnectionError, className = '', triggerClassName = '', styleNonce,
}: DexterAccountControlProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => { if (controlledOpen === undefined) setOwnOpen(next); onOpenChange?.(next); };
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<ConnectionAction | null>(null);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createdHandle, setCreatedHandle] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [panelShift, setPanelShift] = useState(0);
  const pendingAction = useRef(false);
  const control = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const isOpen = useRef(open);
  isOpen.current = open;
  const changeOpen = useRef(setOpen);
  changeOpen.current = setOpen;
  const reduced = useReducedMotion();
  const id = useId();
  const permissions = dexter.model.permissions;
  const checking = !ready || dexter.model.stage === 'checking';
  const busy = checking || pending !== null || dexter.operation !== 'idle';
  const hasIdentity = ready && (dexter.identity.hasWallet || dexter.identity.hasAccount);
  const email = permissions.accountContentVisible ? profile?.email?.trim() ?? '' : '';
  const name = permissions.accountContentVisible ? profile?.name?.trim() ?? '' : '';
  const title = permissions.walletIdentityVisible ? dexter.identity.walletLabel?.trim() || 'Your Dexter account'
    : name || email.split('@')[0] || 'Your Dexter account';
  const canCreate = !checking && dexter.model.stage === 'connect';
  const canOpenWallet = dexter.model.stage === 'ready' && permissions.walletDataVisible;
  const finishCreation = Boolean(createdHandle && !permissions.accountContentVisible);
  const needsConnection = ['connect', 'repair', 'offline', 'error'].includes(dexter.model.stage);
  const links = resolveAccountNavigation(navigation, dexter.activeWallet);
  const headerWallet = canOpenWallet && !busy && dexter.activeWallet?.userHandle ? dexter.activeWallet : null;
  const close = () => changeOpen.current(false);

  useEffect(() => setReady(true), []);
  useEffect(() => {
    if (permissions.accountContentVisible || (dexter.activeWallet?.userHandle && dexter.activeWallet.userHandle !== createdHandle)) {
      setCreatedHandle(null);
    }
  }, [createdHandle, dexter.activeWallet?.userHandle, permissions.accountContentVisible]);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!control.current || !panel.current) return;
      const width = panel.current.offsetWidth;
      const normalLeft = control.current.getBoundingClientRect().right - width;
      const left = Math.max(16, Math.min(normalLeft, window.innerWidth - width - 16));
      setPanelShift(left - normalLeft);
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  useEffect(() => {
    if (!open) { setError(''); setCreateOpen(false); setManageOpen(false); return; }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !control.current?.contains(event.target)) changeOpen.current(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      changeOpen.current(false); trigger.current?.focus();
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !control.current?.contains(event.target)) changeOpen.current(false);
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key);
    window.addEventListener('focusin', focus);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key);
      window.removeEventListener('focusin', focus);
    };
  }, [open]);

  const run = async (action: ConnectionAction) => {
    if (busy || pendingAction.current) return;
    pendingAction.current = true; setPending(action); setError('');
    try {
      if (action === 'connect') {
        const target = createdHandle ?? (canOpenWallet && !permissions.accountContentVisible ? dexter.activeWallet?.userHandle : undefined);
        if (target) await dexter.connect({ userHandle: target });
        else await dexter.connect();
        setCreatedHandle(null);
      }
      if (action === 'switch') { await dexter.useAnotherDexterWallet(); setCreatedHandle(null); }
      if (action === 'retry') await dexter.retry();
      if (action === 'disconnect') { await dexter.disconnectDexter(); setCreatedHandle(null); close(); }
    } catch (caught) {
      setError(action === 'disconnect' ? 'Dexter could not finish that action. Try again.'
        : formatError(caught instanceof ConnectError ? caught.code : dexter.error?.code));
    } finally { pendingAction.current = false; setPending(null); }
  };

  return <div className={`dx-account-control ${className}`} ref={control}>
    <style nonce={styleNonce}>{ACCOUNT_CONTROL_CSS}</style>
    <button className={`dx-account-trigger ${triggerClassName}`} ref={trigger} type="button"
      aria-label={open ? 'Close Dexter account' : 'Open Dexter account'} aria-expanded={open}
      aria-controls={`${id}-menu`} aria-haspopup="dialog" onClick={() => setOpen(!open)}><AccountMark/></button>
    <AnimatePresence>
      {open && <motion.section id={`${id}-menu`} role="dialog" aria-labelledby={`${id}-title`}
        className="dx-account-panel" ref={panel}
        style={{ right: -panelShift }}
        initial={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : .985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : -4 }}
        transition={{ duration: reduced ? 0 : .2, ease: [.25, .65, .3, 1] }}
        onAnimationComplete={() => {
          if (isOpen.current && document.activeElement === trigger.current) panel.current?.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus();
        }}>
        <div className="dx-account-identity"><AccountFace/><div><h3 id={`${id}-title`}>
          {headerWallet && links.money ? <LinkComponent href={links.money.href} onClick={close} title="Open wallet">{title}</LinkComponent> : title}
        </h3>
          {(checking || email) && <p>{checking ? 'Opening your account...' : email}</p>}
          {headerWallet?.receiveAddress && <ReceiveAddressCopy
            key={`${headerWallet.userHandle}:${headerWallet.vaultPda}:${headerWallet.receiveAddress}`}
            address={headerWallet.receiveAddress}
          />}
        </div></div>
        {checking ? <p className="dx-account-status" role="status">Checking your connection...</p> : <>
          {canCreate && createOpen ? <div className="dx-account-creation">
            <button type="button" className="dx-account-back" onClick={() => setCreateOpen(false)}>Back to sign in</button>
            <CreateWalletPanel agentDelegation="deferred" terminology="account" withMark={false} onCreated={(result) => { setCreatedHandle(result.handle); setCreateOpen(false); }}/>
          </div> : <>
            {(needsConnection || finishCreation) && <div className="dx-account-entry">
              {dexter.model.stage === 'repair' && <p className="dx-account-explanation">Reconnect your passkey to continue.</p>}
              <button type="button" className="dx-account-primary" disabled={busy}
                onClick={() => void run(dexter.model.primaryAction === 'retry' ? 'retry' : 'connect')}>
                {busy ? 'Opening passkey...' : finishCreation ? 'Finish signing in' : dexter.model.stage === 'repair' ? 'Reconnect Dexter'
                  : dexter.model.stage === 'error' || dexter.model.stage === 'offline' ? 'Try again' : 'Sign in with Dexter'}
              </button>
              {canCreate && !finishCreation && <button type="button" className="dx-account-create" onClick={() => setCreateOpen(true)} disabled={busy}>Create account</button>}
            </div>}
            {canOpenWallet && <div key={`${dexter.activeWallet?.userHandle ?? 'account'}:${dexter.activeWallet?.vaultPda ?? ''}`}>
              {renderSummary ? renderSummary(close) : <DefaultSummary connection={dexter} navigation={links} LinkComponent={LinkComponent} onNavigate={close} styleNonce={styleNonce}/>}
            </div>}
            {(canOpenWallet || permissions.accountContentVisible) && <nav className="dx-account-destinations" aria-label="Your account">
              {canOpenWallet && (['activity', 'agents'] as const).map(key => {
                const item = links[key];
                return item && <LinkComponent key={key} href={item.href} onClick={close}><AccountIcon kind={key}/><span>{item.label ?? (key === 'activity' ? 'Activity' : 'Apps and agents')}</span></LinkComponent>;
              })}
              {items.filter(item => item.requires === 'wallet' ? canOpenWallet : permissions.accountContentVisible).map(item =>
                <LinkComponent key={item.id} href={item.href} onClick={close}>{item.icon}<span>{item.label}</span>{item.hint && <span className="dx-account-destinationHint">{item.hint}</span>}</LinkComponent>)}
            </nav>}
            {hasIdentity && <div className="dx-account-connection">
              <div className="dx-account-accountFooter"><div className="dx-account-accountLinks">
                {permissions.accountContentVisible && links.profile && <LinkComponent href={links.profile.href} onClick={close}>{links.profile.label ?? 'Profile'}</LinkComponent>}
                {links.support && <LinkComponent href={links.support.href} onClick={close}>{links.support.label ?? 'Support'}</LinkComponent>}
              </div><button className="dx-account-manage" type="button" aria-label="Account settings" aria-controls={`${id}-settings`} aria-expanded={manageOpen} onClick={() => setManageOpen(!manageOpen)}><AccountIcon kind="settings"/></button></div>
              {manageOpen && <motion.div id={`${id}-settings`} className="dx-account-connectionActions"
                initial={reduced ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .16 }}>
                {canOpenWallet && links.settings && <LinkComponent href={links.settings.href} onClick={close}>{links.settings.label ?? 'Account settings'}</LinkComponent>}
                {canOpenWallet && !permissions.accountContentVisible && <button type="button" onClick={() => void run('connect')} disabled={busy}>Sign in to this app</button>}
                {dexter.model.stage === 'ready' && <button type="button" onClick={() => void run('switch')} disabled={busy}>Switch account</button>}
                <button type="button" onClick={() => void run('disconnect')} disabled={busy}>{pending === 'disconnect' ? 'Disconnecting...' : 'Disconnect Dexter'}</button>
              </motion.div>}
            </div>}
          </>}
        </>}
        {error && <p className="dx-account-error" role="alert">{error}</p>}
      </motion.section>}
    </AnimatePresence>
  </div>;
}

function ReceiveAddressCopy({ address }: { address: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    setStatus('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(address);
      if (mounted.current) setStatus('copied');
    } catch {
      if (mounted.current) setStatus('error');
    } finally {
      pending.current = false;
    }
  };
  const compact = address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
  return <div className="dx-account-address">
    <button type="button" className="dx-account-copy" aria-label="Copy receive address" title={address}
      disabled={status === 'copying'} aria-busy={status === 'copying'} onClick={() => void copy()}>
      <span>{compact}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {status === 'copied' ? <path d="m5 12 4 4L19 6"/> : <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></>}
      </svg>
    </button>
    <span className="dx-account-copyFeedback" role="status" aria-live="polite">
      {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed. Try again.' : ''}
    </span>
  </div>;
}

function DefaultSummary({ connection, ...props }: Pick<DexterAccountControlProps, 'connection' | 'navigation' | 'LinkComponent' | 'styleNonce'> & { onNavigate: () => void }) {
  const balance = useAccountPortfolio(connection.activeWallet);
  return <DexterAccountSummary {...balance} {...props}/>;
}

function AccountIcon({ kind }: { kind: 'activity' | 'agents' | 'settings' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'activity' ? <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></>
      : kind === 'agents' ? <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><path d="M14 6h4v5M6 14v4h5"/></>
      : <><path d="m10 3-.7 2.2-2 .9-2.1-.5-2 3.5 1.5 1.6v2.6l-1.5 1.6 2 3.5 2.1-.5 2 .9L10 21h4l.7-2.2 2-.9 2.1.5 2-3.5-1.5-1.6v-2.6l1.5-1.6-2-3.5-2.1.5-2-.9L14 3z"/><circle cx="12" cy="12" r="3"/></>}
  </svg>;
}

function accountConnectionError(code?: string) {
  if (code === 'credential_not_found') return 'No Dexter account found for this passkey on this device.';
  if (code === 'vault_not_found') return 'This passkey is not linked to a Dexter account yet.';
  if (code === 'verification_failed') return 'Passkey verification failed. Try again.';
  if (code === 'missing_credential') return 'No passkey was selected.';
  return 'Something went wrong signing in with your passkey.';
}
