'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAccountPortfolio, type AccountPortfolio } from './accountPortfolio';
import type { DexterWalletView } from './useDexterConnection';

export interface UseAccountPortfolio extends AccountPortfolio {
  readonly loading: boolean;
  refresh(): Promise<void>;
}

interface OwnedPortfolio extends AccountPortfolio {
  key: string | null;
  loading: boolean;
}

/** Mount while the account panel is open and permitted to show wallet data. */
export function useAccountPortfolio(wallet: DexterWalletView | null): UseAccountPortfolio {
  const key = wallet === null ? null : JSON.stringify([
    wallet.userHandle, wallet.vaultPda, wallet.receiveAddress, wallet.network,
  ]);
  const currentKey = useRef(key);
  const currentWallet = useRef(wallet);
  currentKey.current = key;
  currentWallet.current = wallet;
  const generation = useRef(0);
  const inFlight = useRef<{
    key: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const [state, setState] = useState<OwnedPortfolio>({
    key, amount: null, partial: false, loading: key !== null,
  });

  const refresh = useCallback((): Promise<void> => {
    if (currentKey.current !== key) return Promise.resolve();
    const selectedWallet = currentWallet.current;
    if (key === null || selectedWallet === null) return Promise.resolve();
    if (inFlight.current?.key === key) return inFlight.current.promise;
    inFlight.current?.controller.abort();
    const request = ++generation.current;
    const controller = new AbortController();
    setState({ key, amount: null, partial: false, loading: true });
    const promise = (async () => {
      try {
        const portfolio = await fetchAccountPortfolio(selectedWallet, { signal: controller.signal });
        if (!controller.signal.aborted && currentKey.current === key && generation.current === request) {
          setState({ key, ...portfolio, loading: false });
        }
      } catch {
        if (!controller.signal.aborted && currentKey.current === key && generation.current === request) {
          setState({ key, amount: null, partial: false, loading: false });
        }
      } finally {
        if (inFlight.current?.controller === controller) inFlight.current = null;
      }
    })();
    inFlight.current = { key, controller, promise };
    return promise;
  }, [key]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
      inFlight.current?.controller.abort();
      inFlight.current = null;
    };
  }, [refresh]);

  // Render-time ownership prevents a previous amount flashing during the
  // interval between a wallet change and the next effect.
  const visible = state.key === key && key !== null ? state
    : { amount: null, partial: false, loading: key !== null };
  return { amount: visible.amount, partial: visible.partial, loading: visible.loading, refresh };
}
