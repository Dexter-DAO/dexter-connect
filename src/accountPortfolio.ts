import type { DexterWalletView } from './useDexterConnection';

const PORTFOLIO_URL = 'https://api.dexter.cash/api/passkey-vault-anon/portfolio';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export interface AccountPortfolio {
  readonly amount: string | null;
  readonly partial: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 384
    && /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
    && (!value.includes('.') || !value.endsWith('0'));
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function publicKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  let decoded = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  // Leading ones encode zero bytes; the remaining integer must fill exactly
  // the rest of a 32-byte address. No optional Solana package is needed.
  const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
  const payloadBytes = decoded === 0n ? 0 : Math.ceil(decoded.toString(16).length / 2);
  return leadingZeroes + payloadBytes === 32;
}

function observedAt(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function unavailable(): Error {
  return new Error('Account portfolio is unavailable.');
}

function roundUsd(value: string, places: number): string {
  const [whole, fraction = ''] = value.split('.');
  const scale = 10n ** BigInt(places);
  const kept = fraction.slice(0, places).padEnd(places, '0');
  const units = BigInt(whole) * scale + BigInt(kept)
    + ((fraction[places] ?? '0') >= '5' ? 1n : 0n);
  return `${units / scale}.${(units % scale).toString().padStart(places, '0')}`;
}

/** Cents for ordinary values; two significant digits for sub-cent holdings. */
function formatUsd(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const firstNonZero = fraction.search(/[1-9]/);
  if (whole === '0' && firstNonZero >= 2) {
    const rounded = roundUsd(value, firstNonZero + 2);
    if (rounded.split('.')[1].search(/[1-9]/) >= 2) {
      return `$${rounded.replace(/0+$/, '')}`;
    }
  }
  const [roundedWhole, cents] = roundUsd(value, 2).split('.');
  return `$${roundedWhole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

function parsePortfolio(body: unknown, wallet: DexterWalletView): AccountPortfolio {
  if (!record(body) || body.ok !== true || !record(body.portfolio)) throw unavailable();
  const p = body.portfolio;
  if (p.schemaVersion !== 1 || p.network !== 'solana-mainnet'
    || !publicKey(p.walletAddress) || !publicKey(p.vaultPda)
    || !observedAt(p.observedAt) || typeof p.holdingsComplete !== 'boolean'
    || !count(p.pricedHoldings) || !count(p.unpricedHoldings) || !count(p.omittedHoldings)
    || !decimal(p.pricedValueUsd)
    || !(p.portfolioValueUsd === null || decimal(p.portfolioValueUsd))) throw unavailable();

  // walletAddress in Connect is the Swig control account. The portfolio is
  // owned by receiveAddress; the API resolves it from this selected handle.
  if ((wallet.vaultPda && p.vaultPda !== wallet.vaultPda)
    || (wallet.receiveAddress && p.walletAddress !== wallet.receiveAddress)) throw unavailable();

  const complete = p.holdingsComplete && p.unpricedHoldings === 0
    && p.omittedHoldings === 0 && p.portfolioValueUsd !== null;
  if ((p.pricedHoldings === 0 && p.pricedValueUsd !== '0')
    || (complete && p.portfolioValueUsd !== p.pricedValueUsd)) throw unavailable();
  const value = complete ? p.portfolioValueUsd as string
    : p.pricedHoldings > 0 ? p.pricedValueUsd : null;
  return { amount: value === null ? null : formatUsd(value), partial: !complete };
}

async function readBody(response: Response): Promise<unknown> {
  const declaredSize = response.headers.get('content-length');
  if (declaredSize && Number(declaredSize) > MAX_RESPONSE_BYTES) throw unavailable();
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw unavailable();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Reads the selected account's portfolio without signing or moving funds. */
export async function fetchAccountPortfolio(
  wallet: DexterWalletView,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<AccountPortfolio> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(wallet.userHandle)
    || !wallet.vaultPda || !publicKey(wallet.vaultPda)
    || (wallet.receiveAddress !== null && !publicKey(wallet.receiveAddress))
    || (wallet.network !== null && wallet.network !== 'solana-mainnet')) throw unavailable();
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const controller = new AbortController();
  let rejectBoundary!: (reason: Error) => void;
  const boundary = new Promise<never>((_, reject) => { rejectBoundary = reject; });
  const abort = () => {
    controller.abort();
    rejectBoundary(new DOMException('Aborted', 'AbortError'));
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
    rejectBoundary(new DOMException('Timed out', 'TimeoutError'));
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await Promise.race([
      (options.fetch ?? fetch)(`${PORTFOLIO_URL}?user_handle=${encodeURIComponent(wallet.userHandle)}`, {
        cache: 'no-store', credentials: 'omit', signal: controller.signal,
      }),
      boundary,
    ]);
    if (!response.ok) throw unavailable();
    const body = await Promise.race([readBody(response), boundary]);
    return parsePortfolio(body, wallet);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}
