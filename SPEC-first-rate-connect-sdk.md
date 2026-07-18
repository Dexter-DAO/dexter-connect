# SPEC — `@dexterai/connect`: the first-rate "Sign in with Dexter" SDK

**Status:** proposed roadmap (HARDENED v2) · 2026-06-26 · author: gtm (first non-React implementer, gating status.dexter.cash)
**2026-07-02 v3 (connect-fable — owner, per Branch):** ratified with corrections after a six-way audit. (1) The
dexter-fe receiver page has been LIVE since 2026-06-21 (dexter-fe d2d3835, dexter.cash/connect) — the §2 "transport
inert off-origin" row was stale when this spec was written; corrected below. (2) §4 decision 7 RESOLVED: peer floor
`>=0.30.0` — a wire-format requirement, not import hygiene (2026-07-01 mainnet program upgrade, slot 430313330;
vault <0.30 builds stale account lists for `finalize_withdrawal`/`settle_tab`/`settle_locked`). Applied + verified
(typecheck/build/45 tests green on 0.30.0). (3) vault-review stood down 2026-07-01; its P0a.0 commission is VOID —
P0a is owned end-to-end by connect-fable, hook deploy coordinated with api-fable. Execution order + owners:
`PLAN-p0a-execution-2026-07-02.md`.
**2026-07-18 v4 (x402gle-SIWD session, per Branch):** three consumer-truth additions from live forensics (Branch's
eject incident, a full dexter-fe drift audit, x402gle adoption prep): NEW **P0c** (the recover verb — the missing
wallet-only sign-in dexter-fe hand-rolled in its header), NEW **P1.4** (human-words copy contract + the eject split —
the 0.20.0 default "Eject wallet" deletes the passkey from the OS credential manager while users read it as
disconnect), and a new §6 row (verified-display chain truth in dexter-fe — World ID's once-per-human-per-action rule
makes the stale "Verify with World App" button a permanent dead-end on every browser missing the localStorage hint).
Priority order for x402gle (consumer #3, after board + dexter-fe): **P0c → P1.4 → P1.1, then x402gle installs.**
**Why this exists:** the SDK was built bottom-up (0.1.0 → 0.16.0) with no design doc — only a README.
The *vision* lives in `dexter-thesis/architecture/ROADMAP-the-approve-layer-consent-onramp-2026-06-18.md`,
but that roadmap frames Sign-in-with-Dexter as a *dexter-fe surface to expose*, not as a *distributable
SDK*. This is the "Per-subsystem plan (next artifact)" that roadmap deferred at its line 177. **It lives in
this repo on purpose** — so the builder reads it where they work, not in a thesis doc they never open.

**v2 changelog (vs the 2026-06-26 v1 draft):** corrected the current-state table against the fleet code
audit; replaced "verify against GoTrue" with an offline-verifiable Dexter-native signed assertion; made
the **session-token format** an explicit gate that precedes the server SDK; split P0 into P0a (server
pair, the #1 gap) and P0b (the UI mount-core), and rescoped the web component from "extract the button
CSS" to "extract a framework-neutral mount core both `./react` and `<dexter-signin>` wrap"; promoted
theming-as-a-contract to P1; pulled the agent-spend superpower out from behind the UI refactor and noted
it needs **new** high-level primitives, not just UI; flagged the dexter-fe receiver page as a named
cross-repo dependency and corrected the transport status; baked the security mitigations (offline verify,
sideEffects, peer-floor pin, mount-time CSS) into hard requirements.

---

## 0. The one-sentence product

**One passkey tap gives any website a non-custodial Dexter Wallet *and* the rails for an agent to spend
from it under enforceable on-chain limits — login, wallet, and agent-authorization in a single ceremony,
the user never surrendering custody.** Google/Apple/Privy ship identity. Only Dexter ships identity that is
*also money an agent can move without a custodian.* That superpower is the spine of this SDK, not a footnote.

The mechanism behind that sentence is already in the repo: `createPasskeySigner` returns the `@dexterai/vault`
guest signer whose `signOperation()` is the literal agent-spend / x402 rail. The SDK's job is to wrap that
rail in a one-call surface no incumbent can ship.

## 1. The bar: widget → platform

A first-rate identity SDK is judged on five axes. Today's `@dexterai/connect` is a **client-side React
widget**; a platform clears all five:

1. **One UI, every surface** — React, Vue, Svelte, plain HTML, SSR — one stateful implementation, N thin wrappers.
2. **Client + server as a pair** — the consumer verifies a Dexter session **offline**, never reverse-engineering it.
3. **The full session lifecycle** — not just the ceremony: refresh, expiry, persistence, silent re-auth, sign-out-everywhere.
4. **The lowest possible barrier** — one `<script>` tag or three lines.
5. **The Dexter superpower surfaced** — wallet + balance + agent-spend + pay as composable, one-call drop-ins.

**What every benchmark converged on (the patterns we are stealing):**
- One framework-agnostic core; framework SDKs are thin wrappers (Clerk `Clerk` class, Stripe `elements.create().mount(node)`, Privy js-sdk-core, wagmi `@wagmi/core`).
- **Offline / networkless session verification** with a cached public key — Clerk `jwtKey`, Privy `jwtVerificationKey`, Auth0 cached JWKS, Dynamic JWKS, Stripe `constructEvent`. Nobody calls home on the hot path.
- A **published, documented, server-verifiable token format** as the seam between client login and server session.
- Theming as a **structured contract** (named theme + tokens + stable per-element class API), not a flat escape hatch — this is the documented anti-fork mechanism.
- A UI ladder: full drop-in → headless render-prop → imperative modal hooks, all over one core.
- Dual distribution: npm **and** a self-initializing `<script>` tag keyed off a data attribute.

## 2. Current state (verified against code audit, 2026-06-26, v0.16.0)

| Area | State | Reality |
|---|---|---|
| Logic core (`.`) | **Complete, framework-free, but BROWSER-ONLY** | `passkeyLogin`, `createWallet`, `continueWithDexter`, `resolveIdentity`, `walletStore`, `signals`, `agentSpend` (read + on/off verbs), `createAnonServerPolicy`, **`createPasskeySigner` (the agent-spend rail)**, `ceremonyPhaseLabel`. No React in the `.` graph — but it hard-depends on `window`/`navigator`/`localStorage`/`atob`/`fetch` + `@simplewebauthn/browser` + `@solana/web3.js`. **It cannot run server-side; the server SDK is a genuinely new build, not a reuse of `.`.** |
| Any-origin transport | **LIVE end-to-end** (corrected 2026-07-02) | `popup.ts` (opener) is real & hardened: `event.origin === hostOrigin` + `requestId` nonce + block/close/timeout. The receiver page shipped in dexter-fe on 2026-06-21 (d2d3835, `app/connect/page.tsx`) and is deployed at dexter.cash/connect; its message shape matches `popup.ts` exactly. The any-website transport works in prod today. |
| UI | **React-only, 384 lines of stateful `.tsx`** | `<SignInWithDexter>` (connected-chip state machine), `<DexterButton>`, `<DexterMark>`, `DexterWalletChip`, `DexterWalletMenu`, hooks. The reactive render/state story is React's; a custom element must re-implement it framework-free. **Not** a CSS-extraction task. |
| Server SDK | **MISSING** | `exports` has only `.` and `./react`. No `./server`, no `verifyDexterSession`, no token format. Every backend hand-rolls `/auth/v1/user`. **#1 gap in all five benchmarks.** |
| Session lifecycle | **MISSING — and nothing persists** | `passkeyLogin` returns `{accessToken, refreshToken, expiresAt, expiresIn, tokenType}` — a **Supabase/GoTrue (custodial) session**. Nothing consumes `refreshToken`/`expiresAt`. Tokens live in React state only and are **gone on reload**; only the wallet handle survives (`walletStore`). No refresh, no expiry timer, no `onAuthStateChange`, no sign-out-everywhere. |
| Distribution | ESM-only | `tsup format:['esm']`. No IIFE/UMD, no `globalName`, no unpkg/jsdelivr, no `<script>` self-init. `esm.sh` works. |
| Theming | **Flat escape hatch, not a system** | `--dx-*` CSS vars + `className`. No structured `appearance` object, no stable per-element class contract, no importable presets, no headless tier. |
| Superpower surfaces | **stops one layer short** | `agentSpend` ships only the **on/off switch** (`enable`/`revokeAgentSpend`) + **status READ** (`assembleAgentSpendStatus`) + the raw `createPasskeySigner`. The actual **authorize-an-agent / open-a-Tab / pay-an-x402 CALL is UNWRAPPED** — the consumer must hand-drive `signer.signOperation()` with `@dexterai/vault` tab builders. The headline has no one-call surface. |
| Build hygiene | **two latent SSR/tree-shake hazards** | `DexterButton.tsx` and `walletKitStyles.ts` inject CSS at **module-load** time (side-effecting import: `walletKitStyles.ts:57` calls `ensureWalletKitStyles()`); `package.json` has **no `sideEffects` field**. SSR import touches the DOM; bundlers can't tree-shake unused UI. |
| Peer floor | **too low for the agentSpend surface** | peer `@dexterai/vault '>=0.22'`, devDep `^0.24`. agentSpend WRITE verbs import `revokeAgentSpendMessage`/`enableAgentSpendMessage` from `@dexterai/vault/messages` — confirmed in 0.25, not guaranteed in 0.22. A consumer on 0.22 can fail the import at runtime (silent version drift, Rule #7). |
| Internal-but-unexported | building blocks exist, not reachable | `fetchUsdcBalance` (tested, but private to the React hook), `ensureDexterButtonStyles`/`ensureWalletKitStyles`/`cx`, `shouldUsePopup`/`openCeremonyPopup`, all base64 codecs. The P0b style injectors **already exist** — the gap is the framework-neutral markup/state, not the style functions. |

**Correction to the v1 claim "the button CSS is the whole UI problem in one sentence":** false. `BUTTON_CSS`
is the easy 10%. The wallet-kit CSS is already a framework-free `.ts` module and both injectors already
exist. The real work is the **384 lines of stateful React markup** — connecting phases, the connected chip,
the wallet menu, the agent-spend consent — which must be re-expressed once, framework-free, so React and a
custom element are two thin wrappers over **one** stateful core (not two forks — the exact bypass-drift Rule #7 hunts).

## 3. The build — phased, threads the Approve Layer roadmap

> Maps to Approve-Layer **Phase 2 ("make Approve embeddable and callable")**, which was named but never
> specced. P0a is the keystone; it also *immediately* retires the board's hand-rolled GoTrue call.
> **P0a and P0b are decoupled on purpose** so the server SDK ships even if the UI refactor slips.

### P0a — The session-token format + the offline server pair (THE keystone, #1 gap)

This is the single most-repeated "steal" across all five benchmarks. It precedes all UI work.

- **P0a.0 — Publish the Dexter session-token FORMAT (gate; do this first, in this file).**
  Define the seam before writing the verifier. At the end of the ceremony, dexter-api mints a **Dexter-native
  signed assertion** — a short-lived JWT (or signed message) carrying at minimum:
  `{ vault: <pubkey>, sub, agentGrant: <scope|null>, nonce, origin: <opener>, iat, exp }`, signed by a Dexter
  key. **This is NOT the GoTrue token.** GoTrue stays an internal implementation detail of the ceremony; the
  relying party never sees or verifies it. Publish **JWKS at `https://dexter.cash/.well-known/jwks.json`**.
  Document here: the claims schema, signing key + rotation, JWKS location, `exp`/refresh semantics, and the
  cookie-vs-bearer transport convention. *Without this format the verifier has nothing to verify — v1 dodged
  this by saying "validate against GoTrue."*

- **P0a.1 — `@dexterai/connect/server` (Node + edge, OFFLINE verify).**
  New package entry. Mirror `@clerk/backend` / `@privy-io/server-auth`:
  - `createDexterClient({ apiBase, jwtKey? })` — pass the public key at construction for **zero network on the hot path**.
  - `verifyDexterSession(token) → { isSignedIn, vaultAddress, sub, agentGrant, sessionClaims }` — **networkless P-256/JWKS signature check**, never a call home. (Falls back to fetching+caching JWKS only if `jwtKey` is omitted.)
  - `authenticateRequest(req) → { isSignedIn, vaultAddress, sub, sessionClaims }` — the one framework-neutral middleware primitive (Clerk/Auth0 shape).
  - A resource client: `client.wallets.get(vault)`, `client.identity.resolve(...)` (server-side `resolveIdentity`).
  - **`constructEvent(rawBody, sig, secret)`** — in-SDK webhook signature verification (Stripe model) so a relying party reconciles a completed ceremony server-side without hand-rolling HMAC. **Decide its scope as part of P0a, not later.**
  - **Hard requirement:** runs on Cloudflare Workers / Vercel edge. This is impossible if verification round-trips to GoTrue — which is *why* offline verify is mandatory, not a preference.
  - **The `.` core cannot be reused server-side (browser-only). This is a fresh build.**

  *Exit: the status.dexter.cash board imports `verifyDexterSession` and deletes its hand-rolled GoTrue call,
  AND a deliberately non-React **10-line vanilla-HTML page hits the verify path on edge**. The board alone is
  not sufficient proof — it exercises neither the edge nor the non-React axis.*

### P0b — The framework-neutral UI mount-core (decoupled from P0a)

Rescoped from v1. Do **not** hand-roll a custom element that re-implements the state machine. Copy the
proven model: imperative DOM-mount (Stripe `elements.create().mount(node)`, Clerk `mountSignIn(el)`).

- **P0b.1 — Extract a framework-neutral `DexterConnect` mount-core.**
  A class over the existing logic core: `dexterConnect.create('signin'|'wallet'|'agentSpend').mount(node)`
  returning a handle with `.on('login'|'wallet'|'ready'|'error')`, `.update(opts)`, `.unmount()`, plus
  `openModal()` and `addListener(state)`. **One stateful implementation.**
- **P0b.2 — Both `./react` and `<dexter-signin>` become thin wrappers** over the mount-core. `<SignInWithDexter>`
  re-expressed as a binding; a `<dexter-signin>` / `<dexter-button>` custom element registered for
  Vue/Svelte/Astro/vanilla.
- **Hard requirement (SSR/tree-shake):** CSS injection moves to **mount/effect time only — never module load.**
  Add `"sideEffects": false` (or a precise file list) to `package.json`. Ship a `cssStringFromTheme()`-style
  string for SSR injection so App Router consumers render the signed-in state without hydration flicker.
- **Surface table stakes the mount-core makes cheap:** a headless render-prop `<SignInWithDexter.Custom>{({ openModal, account, status, mounted }) => …}</SignInWithDexter.Custom>`; imperative hooks `useDexterModal()` / `useDexterWallet()`; an explicit **auth state-machine enum** `'loading' | 'unauthenticated' | 'authenticated' | 'reconnecting'` threaded into every render; a **pre-formatted account object** `{ address, vaultAddress, displayName, displayBalance, balanceSymbol, hasPendingTx }` (and **make `fetchUsdcBalance` a public primitive** — today it's locked in the hook).

  *Exit: a **Vue or plain-HTML** drop-in of `<dexter-signin>` — NOT the React board — proves the any-framework axis.*

### P0c — The recover verb (added v4; the missing wallet-only sign-in) — **SHIPPED 0.21.0, 2026-07-18**

**Shipped:** `recoverWallet({ preferImmediate?, transport?, connectHost?, apiBase?, onPhase? })` returning a
discriminated `RecoverOutcome` (ok | no_credential | cancelled | error — cancel is a result, not a throw);
immediate-UI bridge absorbed into `src/immediate.ts`; popup transport `op=recover` (+`preferImmediate` param);
react threading via `useSignInWithDexter().recover()` + `<SignInWithDexter mode="recover" onRecovered>`. Two
improvements over the fe donor: persistence happens only AFTER vault confirmation (kills the vaultless-handle
quirk), and the roster row carries walletLabel + credentialId (donor dropped both). Consumer migration + fork
deletion tracked in the plan (docs/superpowers/plans/2026-07-18-p0c-recover-verb.md).

dexter-fe's header "Sign in with Dexter" — the most-used sign-in surface on dexter.cash — does not call the SDK.
The SDK ships create + login (account tokens) but no wallet-only recover, so the fe hand-rolled the whole ceremony
(`usePasskeyWalletAnon.ts:231-348`), including a self-labeled-temporary Chrome-149 immediate-UI WebAuthn bridge:
SDK clothing (`DexterButton`) over a private ceremony. Textbook Rule-#7 drift, caused by a missing verb — the verb
ships here, then the fork dies.

- **P0c.1 — `recoverWallet({ preferImmediate? })`** (code name only; user-facing copy stays "Sign in with Dexter",
  see P1.4): discoverable-credential assertion over `/api/passkey-anon/sign/recover-challenge` → `/recover-verify`
  → `setActiveHandle()`. Mints NO account session — per the 2026-07-05 ruling the wallet IS the sign-in. Absorb the
  immediate-UI bridge behind `preferImmediate` (instant no-passkey fast-fail on Chrome 149+); delete the bridge when
  @simplewebauthn ships `uiMode` support.
- **P0c.2 — thread it through `useSignInWithDexter` / `SignInWithDexter`** as a mode, so a header like dexter-fe's
  (or x402gle's) is a component drop-in, not a bespoke composition.

*Exit: dexter-fe's `NoWalletSignIn` drives the SDK verb and the fe's hand-rolled recover ceremony + bridge are
DELETED in the same change (Rule #7 — the consumer migrates with the publish, never after).*

### P1 — Session lifecycle + theming contract + consent

- **P1.1 — Session lifecycle on the NEW assertion, not GoTrue.**
  Built on the P0a.0 Dexter signed assertion (the GoTrue refresh token is an internal ceremony detail, ripped
  out when auth goes passkey-native — do not build the loop on it). Ship: persistence (documented cookie via
  JWE/iron-session, or bearer), silent re-auth via `continueWithDexter`-as-`checkSession()` on boot, rolling
  expiry + absolute + inactivity timeouts, `onAuthStateChange`, and a `logout()` that **both clears the local
  session AND revokes the on-chain agent-spend grant** (the federated-logout analog every benchmark ships) +
  a server revocation endpoint. Framework-free, with a React hook over it.
- **P1.2 — Theming as a CONTRACT (the Rule #7 fork-prevention surface — promoted from P3).**
  A structured Dexter **Appearance API**: `{ theme: 'dexter'|'dark'|'flat', variables: { colorPrimary, colorBackground, colorText, fontFamily, borderRadius, buttonBorderRadius, … (~20 tokens) }, elements/rules: { '.dx-button-primary': {…}, '.dx-wallet-chip': {…}, '.dx-agent-limit': {…} } }`.
  A **stable, whitelisted per-element class contract** + 2–3 importable presets (a `@dexterai/connect-themes`
  equivalent), themed via **CSS vars on the DOM** so the SAME styling drives React and the custom element.
  Explicitly: this is the documented cure for bypass/fork drift — with only flat `--dx-*` vars and no
  per-element class, consumers fork the markup the moment they restyle the chip.
- **P1.3 — Consent surface (cross-repo; receiver lives in dexter-fe).**
  The hosted `dexter.cash/connect` page shows **"<origin> wants you to sign in"** (the opener origin is already
  passed in `popup.ts`). The hosted-popup origin owns keyboard nav, ARIA, validation, and anti-phishing — the
  trust+a11y boundary (Stripe-iframe model) consumers can't regress. **This is dexter-fe rendering work, a
  second consumer of the token format — track it as a cross-repo dependency (§6), not as a dexter-connect task.**
- **P1.4 — Human-words copy contract + the eject split (added v4).** Two rules, enforced in SDK defaults.
  (a) **No default string requires knowing what a passkey is.** "Recover", "eject", "credential", "assertion" never
  reach a user; `ceremonyPhaseLabel`'s anti-hand-roll discipline extends to every user-facing default in the kit.
  (b) **Disconnect and destroy are different verbs.** Today `eject` + the Signal-API prune removes the passkey from
  the OS credential manager, while the 0.20.0 default menu row reads "Eject wallet" — Branch read it as disconnect
  and lost a passkey to it (2026-07-17; an empty shell, nothing of value — this time). Split the surface: the default
  row becomes disconnect/switch (reversible, no Signal prune, the passkey survives); permanent removal becomes a
  separate action whose confirm says in plain words "this deletes the sign-in key from your device — you won't be
  able to open this wallet from here again," and only THAT path prunes. Ship the relabel + split as one release so
  no consumer ever renders the old default again.

### P2 — Surface the superpower (pulled forward; needs NEW primitives, not just UI)

The audit corrects v1's "the logic exists; this is UI + flow, not new primitives": **false.** connect ships
the on/off switch + status read + raw signer; the authorize-and-spend CALL is unwrapped. This needs new
high-level API, and it is the only un-copyable surface — it must not sit behind the UI refactor.

> **⛔ GATING DEPENDENCY (2026-06-26) — HOLD P2 until the new program's agent-spend surface lands.**
> These primitives wrap the agent-spend *rail*, and that rail is being **re-platformed** in the program
> rebuild: from **backend-enforced caps** to **on-chain swig destination/recurring limits (#18/#19) +
> per-agent `SubAccount` custody compartments** (grand-reveal ↔ vault-review adjudication, 2026-06-26).
> Building P2 now against the current backend role-2 mechanism = wrapping a rail that's being replaced (the
> "built twice" trap). **P2 must wrap the FINAL swig surface, not today's `revokeAgentSpendMessage`/role-2
> path.** Moving-surface owners: grand-reveal (swig capability mapping) + vault-review (adjudication). The
> identity keystone (P0a) is *unaffected* by this — it's orthogonal and ships independently. See §6.

- **P2.1 — One-call agent-spend primitives** wrapping the `signOperation` + tab-builder dance:
  `agentSpend.authorize({ limit, perTx, until })`, `agentSpend.openTab(...)`, `agentSpend.pay(x402Request)`.
- **P2.2 — A capability-token mint:** `getToken({ scope })` (the Clerk pattern) deriving a **scoped,
  server-verifiable** grant from the one ceremony — the natural home for an x402 / agent-spend authorization.
- **P2.3 — `createAgentKey()`** registering the agent as a **first-class P-256 principal with zero default
  permissions** (aligns with Dexter's own canon: an agent can be a P-256 principal and can hold root), then
  explicit allow-policies — least-privilege by construction (Turnkey `fetchOrCreateP256ApiKeyUser` + policy DSL).
- **P2.4 — `<GrantAgentAccess>` / `<AgentSpendConsent>` drop-in:** the enforceable-limit consent ceremony
  ("this app may spend up to $X, max $Y/tx, until Z") with explicit grant, a live visibility panel, and
  one-tap revocation (Dynamic Delegated-Access UX). The headline drop-in, not a prop.
- **Trust framing:** Dexter's limits are enforced **on-chain**, a strictly stronger story than Privy/Turnkey's
  enclave trust. Lead with that. (Default copy honors the §5 guardrail — no credit/personhood language yet.)

### P3 — Distribution + remaining table stakes

- **`<script>` CDN global** — `connect.browser.js` (IIFE/UMD + `globalName`) that **self-initializes from a
  `data-dexter-*` attribute** and auto-mounts (Clerk `data-clerk-publishable-key` / GIS `g_id_signin` model),
  plus a `loadDexterConnect()` npm loader and a deferred `/pure` variant. The 3-lines barrier (axis 4) and the
  path for the any-origin story to reach non-React sites. **Keep React + vault + web3.js as PEER deps, not bundled** (wagmi discipline).
- a11y / keyboard / reduced-motion audit; `locale:'auto'` i18n; `loader:'auto'` skeleton; full TS declarations versioned to a pinned Dexter API version.
- **Discoverability:** an `llms.txt`, an `examples/` starters repo, and **side-by-side npm + script-tag quickstarts** (Privy/Stripe/Auth0 all ship these). One key, one mount, working in three lines.
- A **multi-language verify snippet** (start with one Python `jose` example) for non-JS backends.

## 4. Decisions Branch must make before P0

1. **Token substrate — RESOLVED 2026-06-26.** Full design in `CONTRACT-dexter-session-token.md`. Verified live:
   the Supabase project **already signs ES256/P-256** and publishes a JWKS, so **offline verification works today**
   with zero Supabase change. The token is the Supabase access token + a `dexter` claim object injected by a Custom
   Access Token Hook. Issuer is **parameterized** (`iss`,`jwksUrl`) so Phase 2 (sovereign `iss: dexter.cash`) is a
   config flip, not a rewrite. **The only Phase-1 dexter-api work = one Postgres hook function** — still needs an owner.
2. **Signing key + JWKS — RESOLVED for Phase 1.** No new key: Supabase holds the ES256 key and operates the JWKS
   (rotation included). A Dexter-held key is a Phase-2 concern only (see CONTRACT §3, §6).
3. **Server SDK runtime targets.** Node + Cloudflare Workers + Vercel edge — all three? (Offline verify makes all three trivial; confirm the matrix.)
4. **Webhook/event verification scope** — ship `constructEvent` in P0a, or defer? (Recommend P0a so it's never an afterthought.)
5. **Custom element vs. mount-core only for P0b** — confirm the mount-core-first model (both wrappers thin) over a hand-rolled stateful custom element.
6. **dexter-fe receiver/consent page owner** — the transport is inert without it; who ships and versions it against the token format?
7. **`@dexterai/vault` peer floor** — **RESOLVED 2026-07-02: `>=0.30.0`** (main-fable ruling). Not merely the
   import floor: the 2026-07-01 mainnet program upgrade (slot 430313330) changed account layouts, so vault <0.30
   fails on-chain against prod. Applied in package.json (peer + devDep); typecheck/build/45 tests green on 0.30.0.

## 5. Guardrail (capi, 2026-06-18) — keep internal until the provisional files

Credit / "spend money you don't have" / personhood framing stays **internal until the provisional files**.
The public SDK leads with the **safety + destination** edge only (non-custodial wallet + enforceable on-chain
limits). P2 drop-ins and all default copy must honor this — no credit/personhood language in shipped strings.

## 6. Cross-repo dependencies (do not hide these — Rule #7 + the §7 meta-rule)

| Dependency | Repo | Blocks | Sync rule |
|---|---|---|---|
| Ceremony **receiver page** (runs inline ceremony, postMessages result) | dexter-fe | **SHIPPED 2026-06-21** (d2d3835; live at dexter.cash/connect) | versions with the token format; second consumer of P0a.0 |
| Consent surface (P1.3, "<origin> wants to sign in") | dexter-fe | P1.3 | rendering work; not a dexter-connect task — track separately |
| Verified-display chain truth (v4): `VerifyInvite` shows "Verify with World App" on any browser lacking the localStorage hint, but World ID 4.0 = ONE verification per human per action EVER — for a verified human the button is a permanent dead-end. Display must trust the on-chain `vault.node` probe the component already runs. | dexter-fe | UX truth for every verified user on a second device | consumer-side fix, no SDK change; ~a dozen lines in `app/components/wallet/home/VerifyInvite.tsx` |
| Token-mint + JWKS endpoint | dexter-api | P0a.0, P0a.1 | the assertion is minted here; JWKS served from dexter.cash |
| **Agent-spend rail (swig surface)** | dexter-vault / program (grand-reveal + vault-review) | **all of P2** | agent-spend is migrating from backend-enforced caps to on-chain swig destination-limits (#18/#19) + per-agent `SubAccount`; P2 wraps the FINAL surface, not today's role-2 (grand-reveal ↔ vault-review, 2026-06-26) |

A shared-package change isn't done until every consumer adopts it. When the token format ships, the dexter-fe
receiver, the dexter-api mint, and `@dexterai/connect/server` move together — or it's drift.

## 7. The meta-rule this spec enforces

A capability that isn't written where the builder works doesn't exist to the next session. This spec lives
in `dexter-connect/`. When a feature ships, it updates this file in the same commit. The SDK's README points
here. No more vision-in-thesis / code-in-repo split — that split is exactly why we had v0.16.0 and no plan.
