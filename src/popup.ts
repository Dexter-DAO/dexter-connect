import { ConnectError } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Hosted-popup transport — "Sign in with Dexter on ANY website."
//
// WebAuthn credentials are bound to the rpId origin (dexter.cash), so an in-page
// ceremony only works on Dexter's own origins. To make it work from a stranger
// site, the ceremony runs in a popup on the Dexter origin (dexter.cash/connect)
// and posts the result back to window.opener with a strict target-origin check.
// The public API (signIn / createWallet) is unchanged — this is transport behind
// the same calls.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONNECT_HOST = 'https://dexter.cash/connect';
const POPUP_TIMEOUT_MS = 120_000;
const CANONICAL_ORIGIN = 'https://dexter.cash';

/**
 * Decide whether a ceremony routes through the hosted popup.
 * 'auto' = inline ONLY on the canonical Dexter origin; popup everywhere else
 * (incl. subdomains like beta.dexter.cash, where in-page WebAuthn 400s because
 * the subdomain isn't in dexter-api's RP_CONFIG.origins). Correct-by-construction
 * so no consumer has to know that gotcha.
 */
export function shouldUsePopup(transport?: 'auto' | 'popup' | 'inline'): boolean {
  if (transport === 'popup') return true;
  if (transport === 'inline') return false;
  if (typeof window === 'undefined') return false; // SSR: no popup
  return window.location.origin !== CANONICAL_ORIGIN;
}

interface PopupResultMessage {
  v: 1;
  type: 'dexter-connect:result';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message?: string };
}

/**
 * Run a ceremony (sign-in or create) via the hosted popup, returning the SAME
 * shape the inline path returns (SignInResult | CreateWalletResult). Strict
 * checks: the result is accepted only from the hosted origin and only when its
 * requestId nonce matches this call. Rejects on block / close / timeout / error.
 */
export function openCeremonyPopup<T>(
  op: 'signin' | 'create' | 'continue' | 'recover',
  config: { connectHost?: string; name?: string; apiBase?: string; preferImmediate?: boolean } = {},
): Promise<T> {
  if (typeof window === 'undefined') {
    return Promise.reject(new ConnectError('not_browser', 'popup ceremony requires a browser'));
  }
  const host = (config.connectHost ?? DEFAULT_CONNECT_HOST).replace(/\/$/, '');
  const hostOrigin = new URL(host).origin;
  const openerOrigin = window.location.origin;
  const requestId = makeNonce();

  const params = new URLSearchParams({ v: '1', op, requestId, origin: openerOrigin });
  if (config.name) params.set('name', config.name);
  if (config.apiBase) params.set('apiBase', config.apiBase);
  if (config.preferImmediate) params.set('preferImmediate', '1');
  const url = `${host}?${params.toString()}`;

  return new Promise<T>((resolve, reject) => {
    const popup = window.open(url, 'dexter-connect', popupFeatures());
    if (!popup) {
      reject(
        new ConnectError('popup_blocked', 'the Dexter sign-in popup was blocked — allow popups for this site'),
      );
      return;
    }

    let settled = false;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== hostOrigin) return; // only trust the hosted origin
      const data = event.data as PopupResultMessage | undefined;
      if (!data || data.type !== 'dexter-connect:result' || data.requestId !== requestId) return;
      if (data.ok) finish(() => resolve(data.result as T));
      else
        finish(() =>
          reject(new ConnectError(data.error?.code ?? 'popup_failed', data.error?.message)),
        );
    };

    const closedTimer = window.setInterval(() => {
      if (popup.closed) finish(() => reject(new ConnectError('popup_closed', 'the sign-in window was closed')));
    }, 500);
    const timeout = window.setTimeout(
      () => finish(() => reject(new ConnectError('popup_timeout', 'the sign-in window timed out'))),
      POPUP_TIMEOUT_MS,
    );

    function finish(act: () => void) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
      window.clearTimeout(timeout);
      try {
        popup?.close();
      } catch {
        /* cross-origin close can throw after navigation — ignore */
      }
      act();
    }

    window.addEventListener('message', onMessage);
  });
}

function popupFeatures(): string {
  const w = 420;
  const h = 660;
  const sy = typeof window !== 'undefined' ? window.screenY || 0 : 0;
  const sx = typeof window !== 'undefined' ? window.screenX || 0 : 0;
  const sh = typeof window !== 'undefined' ? window.screen?.height ?? h : h;
  const sw = typeof window !== 'undefined' ? window.screen?.width ?? w : w;
  const top = Math.max(0, Math.round((sh - h) / 2 + sy));
  const left = Math.max(0, Math.round((sw - w) / 2 + sx));
  return `popup,width=${w},height=${h},left=${left},top=${top}`;
}

/** Correlation nonce (NOT a secret) — crypto.randomUUID, else getRandomValues. */
function makeNonce(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const a = new Uint8Array(16);
    c.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `rid-${new URL(location.href).searchParams.get('v') ?? ''}-${(typeof performance !== 'undefined' ? performance.now() : 0)}`;
}
