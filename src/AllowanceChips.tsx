import { useEffect, useState, type ReactElement, type KeyboardEvent } from 'react';

import { cx } from './DexterButton';
import { ensureConsentStyles } from './consentStyles';

// ─────────────────────────────────────────────────────────────────────────────
// AllowanceChips — the consent-at-birth allowance primitive (Branch rulings
// 2026-07-02/03). One radiogroup: $5 / $20 / $50 / Custom, with NONE selected
// initially (zero is not consent; the user authors the number; nothing invents a
// default). A preset emits its plain number string ('5' / '20' / '50'); Custom
// opens a decimal input that emits the raw USD string (build the SpendPolicy from
// it with authoredPolicy()). Presentational + controlled: the consumer owns the
// value and does whatever it likes with it. Themeable via --dx-* CSS vars.
// ─────────────────────────────────────────────────────────────────────────────

export interface AllowanceChipsProps {
  /** The authored USD amount as a raw string, or null when nothing is chosen.
   *  NONE selected initially → pass null. Preset chips echo '5' / '20' / '50';
   *  Custom echoes whatever the user types. */
  value: string | null;
  /** Fired with the raw USD string (or null when Custom is opened empty). */
  onChange: (usd: string | null) => void;
  /** Extra className composed after the brand classes. */
  className?: string;
}

const PRESETS: ReadonlyArray<{ label: string; num: string }> = [
  { label: '$5', num: '5' },
  { label: '$20', num: '20' },
  { label: '$50', num: '50' },
];
const PRESET_NUMS = PRESETS.map((p) => p.num);
const isPreset = (v: string | null): v is string => v !== null && PRESET_NUMS.includes(v);

/** The consent-at-birth allowance chips. */
export function AllowanceChips(props: AllowanceChipsProps): ReactElement {
  const { value, onChange, className } = props;
  useEffect(ensureConsentStyles, []);
  const [customOpen, setCustomOpen] = useState(false);

  // Custom is active when the user opened it OR the value is a non-preset amount
  // (a consumer can hydrate straight into a custom number).
  const customActive = customOpen || (value !== null && !isPreset(value));

  const selectPreset = (num: string): void => {
    setCustomOpen(false);
    onChange(num);
  };
  const selectCustom = (): void => {
    setCustomOpen(true);
    // Selecting Custom clears any preset chip; keep an existing custom amount,
    // else emit null (empty is not consent).
    onChange(isPreset(value) ? null : value);
  };

  const onChipKeyDown = (e: KeyboardEvent<HTMLDivElement>, select: () => void): void => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      // Space must not scroll the page (native default for the key).
      e.preventDefault();
      select();
    }
  };

  return (
    <div className={cx('dx-allow', className)} role="radiogroup" aria-label="Monthly agent allowance">
      {PRESETS.map(({ label, num }) => {
        const checked = !customActive && value === num;
        return (
          <div
            key={num}
            role="radio"
            aria-checked={checked}
            tabIndex={0}
            className={cx('dx-allow__chip', checked && 'dx-allow__chip--active')}
            onClick={() => selectPreset(num)}
            onKeyDown={(e) => onChipKeyDown(e, () => selectPreset(num))}
          >
            {label}
          </div>
        );
      })}
      <div
        role="radio"
        aria-checked={customActive}
        tabIndex={0}
        className={cx('dx-allow__chip', customActive && 'dx-allow__chip--active')}
        onClick={selectCustom}
        onKeyDown={(e) => onChipKeyDown(e, selectCustom)}
      >
        Custom
      </div>
      {customActive && (
        <input
          className="dx-allow__input"
          inputMode="decimal"
          placeholder="$ amount"
          aria-label="Custom monthly allowance in USD"
          value={value ?? ''}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
