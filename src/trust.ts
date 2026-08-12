import { ConnectError } from './types';

/** The only server allowed to mint or verify Dexter WebAuthn challenges. */
export const DEXTER_API_BASE = 'https://api.dexter.cash';

/** The canonical Dexter-hosted ceremony page trusted by arbitrary openers. */
export const DEXTER_CONNECT_HOST = 'https://dexter.cash/connect';

/** Dexter passkeys are registered to this relying-party id. */
export const DEXTER_RP_ID = 'dexter.cash';

/**
 * Keep the historical apiBase option source-compatible, but never let it select
 * a WebAuthn server. A third-party integrator controls its own website; it does
 * not control the server whose challenge the Dexter-origin popup signs.
 */
export function resolveDexterApiBase(apiBase?: string): typeof DEXTER_API_BASE {
  if (
    apiBase === undefined ||
    (typeof apiBase === 'string' && apiBase.replace(/\/+$/, '') === DEXTER_API_BASE)
  ) {
    return DEXTER_API_BASE;
  }
  throw new ConnectError(
    'untrusted_api_base',
    `Dexter WebAuthn is pinned to ${DEXTER_API_BASE}`,
  );
}

/**
 * Keep the historical connectHost option source-compatible without allowing a
 * caller to replace the trusted ceremony window. The opener website remains
 * arbitrary; only the popup that handles Dexter credentials is pinned.
 */
export function resolveDexterConnectHost(
  connectHost?: string,
): typeof DEXTER_CONNECT_HOST {
  if (
    connectHost === undefined ||
    (typeof connectHost === 'string' &&
      connectHost.replace(/\/+$/, '') === DEXTER_CONNECT_HOST)
  ) {
    return DEXTER_CONNECT_HOST;
  }
  throw new ConnectError(
    'untrusted_connect_host',
    `Dexter WebAuthn ceremonies are pinned to ${DEXTER_CONNECT_HOST}`,
  );
}

/** Resolve an optional RP id without allowing a caller/server to retarget it. */
export function resolveDexterRpId(rpId?: string): typeof DEXTER_RP_ID {
  if (rpId === undefined || rpId === DEXTER_RP_ID) return DEXTER_RP_ID;
  throw new ConnectError('untrusted_rp_id', `Dexter WebAuthn is pinned to ${DEXTER_RP_ID}`);
}

/** Byte equality for binding the server response to the exact requested op. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}
