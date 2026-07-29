import { useEffect, useId, useState, type ReactElement } from 'react';

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
  /** Disable every choice and the custom amount field. */
  disabled?: boolean;
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
  const { value, onChange, className, disabled = false } = props;
  useEffect(ensureConsentStyles, []);
  const [customOpen, setCustomOpen] = useState(false);
  const groupName = useId();

  // Custom is active when the user opened it OR the value is a non-preset amount
  // (a consumer can hydrate straight into a custom number).
  const customActive = customOpen || (value !== null && !isPreset(value));

  const selectPreset = (num: string): void => {
    if (disabled) return;
    setCustomOpen(false);
    onChange(num);
  };
  const selectCustom = (): void => {
    if (disabled) return;
    setCustomOpen(true);
    // Selecting Custom clears any preset chip; keep an existing custom amount,
    // else emit null (empty is not consent).
    onChange(isPreset(value) ? null : value);
  };

  return (
    <fieldset className={cx('dx-allow', className)} disabled={disabled}>
      <legend className="dx-sr-only">Monthly agent allowance</legend>
      {PRESETS.map(({ label, num }) => {
        const checked = !customActive && value === num;
        return (
          <label key={num} className="dx-allow__option">
            <input
              className="dx-allow__radio"
              type="radio"
              name={groupName}
              value={num}
              checked={checked}
              onChange={() => selectPreset(num)}
            />
            <span className="dx-allow__chip">{label}</span>
          </label>
        );
      })}
      <label className="dx-allow__option">
        <input
          className="dx-allow__radio"
          type="radio"
          name={groupName}
          value="custom"
          checked={customActive}
          onChange={selectCustom}
        />
        <span className="dx-allow__chip">Custom</span>
      </label>
      {customActive && (
        <input
          className="dx-allow__input"
          id={`${groupName}-custom`}
          inputMode="decimal"
          placeholder="$ amount"
          aria-label="Custom monthly allowance in USD"
          value={value ?? ''}
          disabled={disabled}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </fieldset>
  );
}
