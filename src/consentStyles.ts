// Shared injected styles for the consent-at-birth surface (<AllowanceChips>,
// <CreateWalletPanel>). Same pattern as walletKitStyles/DexterButton: a single
// <style> injected once into <head>, class-based so states animate, themeable via
// --dx-* CSS vars, sharp corners by default (--dx-radius defaults to 0px). A consumer restyles
// by overriding the CSS variables on any ancestor — never by forking (Rule #7).
//
// The allowance chip mirrors the SDK's .78rem / 600 / .12em uppercase type
// convention (DexterButton); the active chip is the ember gradient with
// --dx-fg text. No emojis anywhere.

const STYLE_ID = 'dexter-connect-consent-styles';

const CONSENT_CSS = `
.dx-allow{
  display:flex; flex-wrap:wrap; gap:8px; align-items:center;
}
.dx-allow__chip{
  display:inline-flex; align-items:center; justify-content:center; padding:9px 15px;
  font:inherit; font-weight:600; font-size:.78rem; letter-spacing:.12em; text-transform:uppercase;
  font-variant-numeric:tabular-nums; cursor:pointer; background:transparent; color:inherit;
  border:1px solid color-mix(in srgb,var(--dx-ember,#f26c18) 45%,transparent);
  border-radius:var(--dx-radius,0px); -webkit-tap-highlight-color:transparent;
  transition:filter .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease, color .16s ease;
}
.dx-allow__chip:hover{ border-color:color-mix(in srgb,var(--dx-ember,#f26c18) 70%,transparent); filter:brightness(1.05); }
.dx-allow__chip:focus-visible{ outline:none; box-shadow:0 0 0 3px color-mix(in srgb,var(--dx-ember,#f26c18) 34%,transparent); }
.dx-allow__chip--active{
  background:linear-gradient(135deg,var(--dx-ember,#f26c18),var(--dx-ember-2,#ba3a00));
  color:var(--dx-fg,#fff4ea); border-color:color-mix(in srgb,var(--dx-ember,#f26c18) 55%,transparent);
  box-shadow:0 10px 22px color-mix(in srgb,var(--dx-ember,#f26c18) 22%,transparent);
}
.dx-allow__input{
  flex:1 1 130px; min-width:120px; padding:9px 13px; font:inherit; font-size:.9rem;
  font-variant-numeric:tabular-nums; color:inherit; background:transparent;
  border:1px solid color-mix(in srgb,var(--dx-ember,#f26c18) 45%,transparent);
  border-radius:var(--dx-radius,0px); -webkit-tap-highlight-color:transparent;
  transition:border-color .16s ease, box-shadow .16s ease;
}
.dx-allow__input:focus, .dx-allow__input:focus-visible{
  outline:none; border-color:color-mix(in srgb,var(--dx-ember,#f26c18) 70%,transparent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dx-ember,#f26c18) 30%,transparent);
}
.dx-allow__input::placeholder{ color:currentColor; opacity:.5; letter-spacing:.02em; text-transform:none; }

.dx-cwp{
  display:flex; flex-direction:column; gap:16px; font:inherit;
}
.dx-cwp__field{ display:flex; flex-direction:column; gap:8px; }
.dx-cwp__label{ font-size:.7rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; opacity:.62; }
.dx-cwp__name{
  padding:10px 13px; font:inherit; font-size:.95rem; color:inherit; background:transparent;
  border:1px solid color-mix(in srgb,currentColor 22%,transparent); border-radius:var(--dx-radius,0px);
  -webkit-tap-highlight-color:transparent; transition:border-color .16s ease, box-shadow .16s ease;
}
.dx-cwp__name:focus, .dx-cwp__name:focus-visible{
  outline:none; border-color:color-mix(in srgb,var(--dx-ember,#f26c18) 60%,transparent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dx-ember,#f26c18) 26%,transparent);
}
.dx-cwp__name::placeholder{ color:currentColor; opacity:.42; }
.dx-cwp__fine{ font-size:.76rem; line-height:1.5; opacity:.66; }
.dx-cwp__err{ font-size:.78rem; line-height:1.45; color:var(--dx-danger,#e5552e); }
`;

/** Inject the consent CSS once. Safe to call repeatedly + on the server (no-op). */
export function ensureConsentStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CONSENT_CSS;
  document.head.appendChild(el);
}

// Inject at module load too (covers above-the-fold use before the effect runs).
ensureConsentStyles();
