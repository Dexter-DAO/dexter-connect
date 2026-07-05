// Shared injected styles for the Dexter wallet kit (<DexterWalletChip>,
// <DexterWalletMenu>). Same pattern as DexterButton: a single <style> injected
// once into <head>, class-based so states animate, themeable via --dx-* CSS vars,
// sharp corners by default (--dx-radius defaults to 0px). A consumer restyles by overriding the
// CSS variables on any ancestor — never by forking (Rule #7).

const STYLE_ID = 'dexter-connect-wallet-kit-styles';

const WALLET_KIT_CSS = `
.dx-wchip{
  display:inline-flex; align-items:center; gap:9px; max-width:240px;
  padding:6px 12px 6px 7px; font:inherit; font-weight:600; font-size:.74rem;
  letter-spacing:.1em; text-transform:uppercase; cursor:pointer; background:transparent;
  color:inherit; border:1px solid color-mix(in srgb,var(--dx-ember,#f26c18) 42%,transparent);
  border-radius:var(--dx-radius,0px); -webkit-tap-highlight-color:transparent;
  transition:filter .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.dx-wchip:hover{ filter:brightness(1.08); box-shadow:0 8px 18px color-mix(in srgb,var(--dx-ember,#f26c18) 18%,transparent); }
.dx-wchip:focus-visible{ outline:none; box-shadow:0 0 0 3px color-mix(in srgb,var(--dx-ember,#f26c18) 34%,transparent); }
.dx-wchip--signedout{ border-color:color-mix(in srgb,currentColor 22%,transparent); padding-left:12px; }
.dx-wchip__avatar{
  width:22px; height:22px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;
  border-radius:50%; overflow:hidden; font-size:.72rem; font-weight:700; letter-spacing:0; line-height:1;
  background:linear-gradient(135deg,var(--dx-ember,#f26c18),var(--dx-ember-2,#ba3a00)); color:var(--dx-fg,#fff4ea);
}
.dx-wchip__avatar img{ width:100%; height:100%; object-fit:cover; }
.dx-wchip__label{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.dx-wmenu{ display:flex; flex-direction:column; min-width:248px; }
.dx-wmenu__id{ display:flex; align-items:center; gap:10px; padding:13px 15px; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); }
.dx-wmenu__avatar{ width:32px; height:32px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; font-weight:700; font-size:.85rem; line-height:1; background:linear-gradient(135deg,var(--dx-ember,#f26c18),var(--dx-ember-2,#ba3a00)); color:var(--dx-fg,#fff4ea); }
.dx-wmenu__meta{ display:flex; flex-direction:column; gap:2px; min-width:0; }
.dx-wmenu__name{ font-weight:700; font-size:.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dx-wmenu__sub{ font-size:.66rem; letter-spacing:.12em; text-transform:uppercase; opacity:.55; }
.dx-wmenu__list{ display:flex; flex-direction:column; padding:6px; }
.dx-wmenu__item{ display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; padding:10px 12px; font:inherit; font-size:.82rem; font-weight:600; text-align:left; background:transparent; border:none; color:inherit; cursor:pointer; transition:background .12s ease; }
.dx-wmenu__item:hover{ background:color-mix(in srgb,var(--dx-ember,#f26c18) 10%,transparent); }
.dx-wmenu__item--danger{ color:var(--dx-danger,#e5552e); }
.dx-wmenu__icon{ opacity:.45; font-size:.9rem; }
.dx-wmenu__back{ border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent); opacity:.85; }
.dx-wmenu__save{ display:flex; flex-direction:column; gap:9px; padding:13px 15px; }
.dx-wmenu__savehint{ font-size:.78rem; line-height:1.4; opacity:.7; }
`;

/** Inject the wallet-kit CSS once. Safe to call repeatedly + on the server (no-op). */
export function ensureWalletKitStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = WALLET_KIT_CSS;
  document.head.appendChild(el);
}

// Inject at module load too (covers above-the-fold use before the effect runs).
ensureWalletKitStyles();
