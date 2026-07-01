// @dexterai/connect/worldid — the shared World ID "verify personhood" surface.
//
// Promotes the internal capture rig's proven IDKitRequestWidget flow into ONE
// shared, config-driven React component every consumer imports — the personhood
// sibling of <SignInWithDexter> (Rule #7: shared surface, never hand-rolled).
//
// Its ONLY job is proof ACQUISITION: it hands back the raw IDKitResult (the v4
// Orb OPRFNullifier proof + public signals). What to DO with the proof —
// establish a fresh trustless CreditRoot vs upgrade an operator-attested one — is
// the facilitator's job (the /identity endpoints), never this button's.
//
// @worldcoin/idkit is an OPTIONAL peer dependency, pulled in ONLY by consumers
// that import this subpath, so the sign-in surface (./react) stays lean.

import { useEffect, useState, type ReactElement } from 'react';
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
  type RpContext,
} from '@worldcoin/idkit';
import { DexterButton, ensureDexterButtonStyles } from './DexterButton';

export type VerifyPersonhoodPhase =
  | 'loading' // fetching the server-signed RP context
  | 'ready' // RP context in hand; button armed
  | 'rp_error' // RP context fetch/sign failed
  | 'verified'; // a proof was captured

export interface VerifyPersonhoodConfig {
  /** World ID app id (`app_…`), from the developer portal. */
  appId: `app_${string}`;
  /** The registered action (e.g. `dexter-credit-root-v2`) — pins the nullifier namespace. */
  action: string;
  /** `production` | `staging`. Default `production`. */
  environment?: 'production' | 'staging';
  /**
   * URL that returns the SERVER-SIGNED RP context as `{ rp_context: RpContext }`.
   * The RP signing key is server-side only (never the browser), so the consumer
   * exposes an endpoint that signs the request and returns just the signed
   * context. Mirrors the capture rig's `/api/rp-context`.
   */
  rpContextUrl: string;
  /** Optional `fetch` init for the RP-context request (auth headers, etc.). */
  rpContextInit?: RequestInit;
}

export interface UseVerifyPersonhood {
  phase: VerifyPersonhoodPhase;
  error: string | null;
  result: IDKitResult | null;
  /** Open the World App verification sheet. No-op until phase is 'ready'/'verified'. */
  open: () => void;
  /** The IDKitRequestWidget element to render (null until the RP context loads). */
  widget: ReactElement | null;
}

/**
 * Headless hook: manages the RP-context fetch + IDKit lifecycle and hands back
 * the raw proof. Render `widget` and call `open()` from your own UI, or use the
 * turnkey <VerifyPersonhood> below.
 */
export function useVerifyPersonhood(
  config: VerifyPersonhoodConfig,
  onProof?: (result: IDKitResult) => void,
  onError?: (error: Error) => void,
): UseVerifyPersonhood {
  const { appId, action, environment = 'production', rpContextUrl, rpContextInit } = config;
  const [phase, setPhase] = useState<VerifyPersonhoodPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [result, setResult] = useState<IDKitResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(rpContextUrl, { cache: 'no-store', ...rpContextInit });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message ?? `RP context fetch failed (HTTP ${res.status})`);
        if (cancelled) return;
        setRpContext(data.rp_context as RpContext);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err.message);
        setPhase('rp_error');
        onError?.(err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpContextUrl]);

  const widget: ReactElement | null = rpContext ? (
    <IDKitRequestWidget
      app_id={appId}
      action={action}
      rp_context={rpContext}
      // Orb credential (v4 proof_of_human, issuer schema 1). The Orb issuer key is
      // in-field, so the proof clears the field-element gate that blocks the
      // passport path (World ID bug #3813619). This is the canonical credit-root
      // credential — establish_credit_root only consumes the v4 Orb OPRFNullifier proof.
      preset={proofOfHuman()}
      // Reject legacy (v3) fallbacks — a proof format establish_credit_root cannot consume.
      allow_legacy_proofs={false}
      environment={environment}
      open={isOpen}
      onOpenChange={setIsOpen}
      onSuccess={(res: IDKitResult) => {
        setResult(res);
        setPhase('verified');
        onProof?.(res);
      }}
      onError={(code: string) => {
        const err = new Error(`World App error: ${code}`);
        setError(err.message);
        onError?.(err);
      }}
    />
  ) : null;

  return {
    phase,
    error,
    result,
    open: () => {
      if (phase === 'ready' || phase === 'verified') setIsOpen(true);
    },
    widget,
  };
}

export interface VerifyPersonhoodProps extends VerifyPersonhoodConfig {
  /** Fired with the raw World ID v4 proof the moment verification completes. */
  onProof?: (result: IDKitResult) => void;
  /** Fired with the typed error if RP signing or verification fails. */
  onError?: (error: Error) => void;
  /** Button label when armed. Default "Verify your personhood". */
  label?: string;
  /** Label after a proof is captured. Default "Verify again". */
  verifiedLabel?: string;
  /** 'primary' = filled ember (default), 'secondary' = outline. */
  variant?: 'primary' | 'secondary';
  /** Full-width button. */
  block?: boolean;
  /** Extra className composed after the brand classes. */
  className?: string;
}

/**
 * Turnkey "Verify your personhood" element — the personhood sibling of
 * <SignInWithDexter>. Renders the branded DexterButton (loading while the RP
 * context signs server-side) that opens World App; on success hands the raw
 * IDKitResult to `onProof`. Brand voice: no emojis. Themeable via --dx-* vars.
 */
export function VerifyPersonhood(props: VerifyPersonhoodProps): ReactElement {
  const {
    onProof,
    onError,
    label = 'Verify your personhood',
    verifiedLabel = 'Verify again',
    variant = 'primary',
    block = false,
    className,
    ...config
  } = props;
  useEffect(ensureDexterButtonStyles, []);
  const v = useVerifyPersonhood(config, onProof, onError);

  return (
    <>
      <DexterButton
        onClick={v.open}
        loading={v.phase === 'loading'}
        loadingLabel="Preparing…"
        variant={variant}
        block={block}
        className={className}
        disabled={v.phase === 'rp_error'}
      >
        {v.phase === 'verified' ? verifiedLabel : label}
      </DexterButton>
      {v.widget}
    </>
  );
}
