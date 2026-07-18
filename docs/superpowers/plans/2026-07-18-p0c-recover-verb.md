# P0c recoverWallet() Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution — this session's
> ruling defers subagent review panels to the follow-up adversarial session). Steps use checkbox (`- [ ]`) syntax.
> Written and executed by the same session that ran the recon (wf_670e2279-bdc); recon JSONs in the session
> scratchpad are the evidence base for every file:line below.

**Goal:** Ship `recoverWallet()` — wallet-only sign-in (no account session) — in @dexterai/connect 0.21.0, working
from any origin via the popup transport, and delete dexter-fe's hand-rolled ceremony the same day.

**Architecture:** New core verb `src/recover.ts` mirroring the enroll.ts ceremony skeleton (popup early-return →
inline: challenge → assertion → verify → vault hydrate → setActiveHandle), with the Chrome-149 immediate-UI bridge
absorbed into `src/immediate.ts`. React threading adds `mode: 'recover'` to useSignInWithDexter/SignInWithDexter.
No dexter-api changes: the verb absorbs the follow-up `/api/passkey-vault-anon/status` fetch (the zero-API-change
path; dexter-api-heal/-prop carry route copies, so API edits are out).

**Tech Stack:** TypeScript ESM, tsup (4 entries), vitest 4 (node default; `// @vitest-environment happy-dom` for DOM),
@simplewebauthn/browser ^13 (tsup-external runtime dep).

## Global Constraints

- Version: publish as **0.21.0** (npm latest is 0.20.0; local repo == 0.20.0, clean).
- **Copy rule (SPEC P1.4 forward-compat):** no new user-facing default string may contain "recover", "passkey",
  "credential", "assertion". Reuse `ceremonyPhaseLabel` phases challenge/passkey/verifying — do NOT extend `CeremonyPhase`.
- **Persistence discipline:** `setActiveHandle` fires on every success path (popup AND inline), never on rejection.
  NEW (fixes donor quirk): never before vault existence is confirmed.
- **Result-shape, not throws:** `recoverWallet` returns a discriminated `RecoverOutcome`; user-cancel is a normal
  outcome, not an exception. `popup_closed` maps to `cancelled`.
- **No account session**: the verb never touches `/login-challenge`/`/passkey-login` (Branch ruling 2026-07-05:
  the wallet IS the sign-in).
- **iOS fire-on-tap:** the verb must never be auto-invoked on mount; doc-comment carries the rule
  (donor rationale: tabs/setup/page.tsx:21-31).
- `tsc --noEmit` after every TS change (vitest does not typecheck — standing memory rule).
- Popup message envelope stays byte-compatible for existing ops (dexter-board's browser runs 0.16.0 popup code).

## File Structure

dexter-connect:
- Create: `src/httpError.ts` (shared readErrorCode — kills the 3× duplication in relay.ts/enroll.ts/anon-policy.ts)
- Create: `src/immediate.ts` (immediateGetSupported + immediateAuthentication + classifyWebAuthnRejection)
- Create: `src/recover.ts` (the verb) + `src/recover.test.ts`
- Modify: `src/popup.ts` (op union + preferImmediate param), `src/relay.ts` / `src/enroll.ts` / `src/anon-policy.ts`
  (use shared httpError), `src/types.ts` (RecoverOutcome/RecoverVault), `src/index.ts` (exports),
  `src/useSignInWithDexter.ts` + `src/SignInWithDexter.tsx` + `src/react.ts` (mode threading),
  `package.json` (0.21.0), `README.md`, `SPEC-first-rate-connect-sdk.md` (P0c shipped note)
- Test: `src/immediate.test.ts`, `src/recover.test.ts`, `src/recoverPersistence.test.tsx` (clone of
  signInPersistence.test.tsx template)

dexter-fe (ONE change, after publish):
- Modify: `app/connect/page.tsx` (op=recover: Op union :33, gate :86, run branch :115-120, result union :96),
  `app/components/header/NoWalletSignIn.tsx` (:45 → SDK verb; drop usePasskeyWalletAnon dep entirely),
  `app/tabs/setup/page.tsx` (handleRecover :312-323 → SDK verb), `package.json` (^0.21.0)
- Delete from `app/hooks/usePasskeyWalletAnon.ts`: recoverFromAuthenticator (:229-348), bridge (:373-446),
  RecoverOutcome type (:66-71), interface member (:89-99), return entry (:358), now-unused imports (:31,33-40).
  KEEP: mount restore, startProvisioning, fetchStatus, types, state machine.

dexter-agents: `package.json` ^0.19.0 → ^0.21.0. dexter-board (`~/.claude/skills/agent-mail/scripts/`):
`package.json` ^0.18.0 → ^0.21.0 AND the esm.sh literal `@0.16.0` → `@0.21.0` at `board-server.js:241`.

---

### Task 1: shared httpError + immediate bridge

**Interfaces produced:**
- `readErrorCode(res: Response, fallback: string): Promise<string>` (src/httpError.ts) — body `{error}` snake_case
  code else `http_<status>`, identical behavior to the three existing copies.
- `immediateGetSupported(): Promise<boolean>` — memoized module-level promise; `primeImmediateSupport()` called at
  recover.ts module scope (gesture-chain rule: no fresh await between tap and get()).
- `immediateAuthentication(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>` —
  native `credentials.get` with `uiMode:'immediate'` cast, null → DOMException('NotAllowedError'), shaped with the
  SDK's own src/base64.ts helpers (NOT simplewebauthn's).
- `classifyWebAuthnRejection(err: unknown): boolean` — regex `/notallowed|not ?allowed|abort|cancel|timed out|timeout|denied|ceremony/`
  over lowercase concat of `err.name + err.cause?.name + err.code + err.message` (cause matters: simplewebauthn wraps
  DOMException in WebAuthnError).

- [ ] Write failing tests `src/immediate.test.ts` (happy-dom): supported=false when getClientCapabilities absent /
  throws / lacks immediateGet; true when `{immediateGet:true}`; immediateAuthentication shapes id/rawId/response
  fields base64url and throws NotAllowedError on null; classifier true for DOMException NotAllowedError, for
  WebAuthnError{cause:{name:'NotAllowedError'}}, false for TypeError('network').
- [ ] Implement; refactor relay.ts:166-174, enroll.ts:213-221, anon-policy.ts:119-127 to import readErrorCode.
- [ ] `npx vitest run` all green + `npx tsc --noEmit` clean. Commit.

### Task 2: the core verb `recoverWallet()`

**Interfaces produced (src/types.ts):**
```ts
export interface RecoverVault { vaultPda: string; swigAddress: string; receiveAddress: string | null;
  isActivated: boolean; walletLabel: string | null }
export type RecoverOutcome =
  | { ok: true; userHandle: string; credentialId: string; vault: RecoverVault }
  | { ok: false; reason: 'no_credential' | 'cancelled' | 'error'; error?: ConnectError }
export interface RecoverWalletConfig extends DexterConnectConfig { preferImmediate?: boolean;
  onPhase?: (phase: CeremonyPhase) => void }
export declare function recoverWallet(config?: RecoverWalletConfig): Promise<RecoverOutcome>
```

**Inline leg (mirrors enroll.ts:87-143, endpoints per fe-donor recon):**
1. `shouldUsePopup(config.transport)` → popup leg (Task 3). SSR/no-WebAuthn → `{ok:false, reason:'error',
   error: ConnectError('webauthn_unsupported')}`.
2. onPhase('challenge') → POST `{apiBase}/api/passkey-anon/sign/recover-challenge` body `{}` →
   `{options}`; non-OK → outcome error with `await readErrorCode(res,'recover_challenge_failed')`.
3. onPhase('passkey') → `preferImmediate && await immediateGetSupported()` ? `immediateAuthentication(options)` :
   `startAuthentication({optionsJSON: options})`. Catch: `classifyWebAuthnRejection` →
   `{ok:false, reason: usedImmediate ? 'no_credential' : 'cancelled'}`; else reason 'error' (webauthn_failed).
4. onPhase('verifying') → POST `/recover-verify` `{credential}`. 404 → `{ok:false, reason:'no_credential'}`
   (passkey with no server row). Other non-OK → error outcome. 200 → `{verified, credentialId, userHandle}`.
5. Vault hydrate (still 'verifying'): GET `/api/passkey-vault-anon/status?user_handle=<handle>` →
   `{hasVault, vault:{vaultPda, swigAddress, receiveAddress, isActivated, walletLabel}}`. No vault →
   `{ok:false, reason:'error', error: ConnectError('vault_not_found')}` — and NO setActiveHandle (the donor-quirk fix;
   mapConnectError in fe already has copy for vault_not_found).
6. `setActiveHandle(userHandle, vault.walletLabel ?? undefined, credentialId)` — richer than the donor, which
   dropped label+credentialId (roster rows then lack the credentialId that eject's Signal prune wants).
7. Return ok outcome.

- [ ] Write failing `src/recover.test.ts` (node env; mock @simplewebauthn/browser, ./immediate, ./popup, fetch via
  vi.stubGlobal; real ./walletStore against happy-dom? — no: node env + mock ./walletStore like enroll.test.ts):
  happy path asserts endpoint order (recover-challenge → recover-verify → status), setActiveHandle called
  (handle, label, credentialId) AFTER status, ok outcome carries vault; verify-404 → no_credential + NO
  setActiveHandle; modal NotAllowedError → cancelled; immediate NotAllowedError → no_credential; status hasVault:false
  → error vault_not_found + NO setActiveHandle; challenge non-OK → error with server code.
- [ ] Implement `src/recover.ts` with the module-scope `primeImmediateSupport()` call and the fire-on-tap doc-comment.
  Export from `src/index.ts` with rationale block. Green + tsc clean. Commit.

### Task 3: popup transport leg + receiver contract

**Interfaces produced:** `openCeremonyPopup` op union gains `'recover'`; URL gains `&preferImmediate=1` when set;
caller-side mapping: envelope `{ok:true, result: RecoverOutcome}` always carries the OUTCOME (a completed ceremony
with a user decision is ok:true at the transport layer); popup infra errors map `popup_closed → cancelled`,
`popup_blocked/timeout/failed → {ok:false, reason:'error', error}`. On outcome.ok, caller re-runs
`setActiveHandle(handle, label, credentialId)` on the CONSUMER origin (enroll.ts:75-84 precedent — the receiver's
inline run wrote dexter.cash localStorage only).

- [ ] Extend recover.test.ts: popup path (mock ./popup) — outcome relayed verbatim, setActiveHandle re-fired on ok,
  popup_closed → cancelled, popup_blocked → error. Widen popup.ts op union + param. Green + tsc. Commit.

### Task 4: react threading (P0c.2)

**Interfaces produced (src/useSignInWithDexter.ts):** `UseSignInWithDexterConfig` gains
`mode?: 'signin' | 'recover'` (default 'signin'), `preferImmediate?: boolean`, `transport?`, `connectHost?`
(passthrough — CreateWalletPanel already exposes transport; the sign-in surface was the odd one out, and the new
knobs thread into BOTH verbs). Hook additions: `recovered: RecoverOutcome | null`; in recover mode `signIn()` runs
`recoverWallet`, success → status 'done', session stays null, vault stays null (ConnectVault is not constructible
from recover data — no publicKey/usdcAta; identity surfaces light up via the walletStore subscription instead).
`SignInWithDexter` gains `onRecovered?: (o: RecoverOutcome) => void` — explicitly destructured (the `...config`
spread would silently leak it into the hook config); in recover mode `showConnectedChip` defaults false.
SignInResult stays UNTOUCHED (session required — consumers read result.session).

- [ ] Failing `src/recoverPersistence.test.tsx` (happy-dom; clone signInPersistence template — real component + hook
  + verb + REAL walletStore, mock @simplewebauthn/browser + fetch, origin pinned to dexter.cash): tap in recover
  mode → getActiveHandle()===handle, roster row carries credentialId+label, NO session in hook, onRecovered fired
  with ok outcome; cancelled outcome → nothing persisted, onRecovered fired, no onError.
- [ ] Implement; export types from react.ts with Rule-#7 commentary. Green + tsc. Commit.

### Task 5: docs + version + publish 0.21.0

- [ ] README: root-verb section (recoverWallet with the fire-on-tap rule + outcome table) + react mode section.
- [ ] SPEC: mark P0c SHIPPED (version, date) in-place per §7 same-commit rule.
- [ ] package.json 0.21.0 → `npm run build` → `npx vitest run` (full suite) → `npx tsc --noEmit` → `npm publish`.
  Verify: `npm view @dexterai/connect dist-tags`. Commit + push.

### Task 6: dexter-fe migration (the exit criterion, ONE change)

- [ ] Bump `@dexterai/connect` ^0.21.0, `npm install`.
- [ ] `app/connect/page.tsx`: add 'recover' to Op union (:33) + validity gate; run branch
  `recoverWallet({transport:'inline', apiBase, preferImmediate: params.preferImmediate==='1'})`; post the outcome in
  the existing envelope; auto-close after post (fast-close on no_credential so Chrome-149 users don't stare at a
  dead popup). needsPolicy untouched (recover never births a wallet).
- [ ] `NoWalletSignIn.tsx`: `recoverWallet({preferImmediate:true})` from the SDK root; branch on outcome.reason
  exactly as today (no_credential → create nudge, cancelled → silent, error → retry copy); DELETE the
  usePasskeyWalletAnon import/usage (recover was its only use here — also removes a needless status-fetch on
  header mount).
- [ ] `tabs/setup/page.tsx` handleRecover → same verb call, same outcome branching.
- [ ] Delete the donor inventory from usePasskeyWalletAnon.ts (see File Structure). `npx tsc --noEmit`.
- [ ] `npm run build` → `pm2 restart dexter-fe` → verify: https://dexter.cash/connect?op=recover&… renders the
  ceremony page (not 'invalid link'); header renders; site 200s. Commit + push.

### Task 7: remaining consumers (Rule #7 sweep)

- [ ] dexter-agents: ^0.21.0, npm i, build, `pm2 restart dexter-agents`.
- [ ] dexter-board: package.json ^0.21.0 + `board-server.js:241` esm.sh literal → `@0.21.0`, npm i,
  `pm2 restart dexter-board`, verify status.dexter.cash 200 + sign-in script tag serves the new pin.
- [ ] Commit both.

### Task 8: handoff for the adversarial session + Branch's tap test

- [ ] Write `HANDOFF-p0c-adversarial.md` in dexter-connect: what shipped (commits, version), the attack surface
  (challenge-consumption atomicity, popup envelope fidelity, immediate-mode gesture chain, the vault_not_found
  ordering change, classifier regex against real browser errors, the un-rate-limited recover-challenge endpoint —
  pre-existing, flagged), and what the review session should try to break.
- [ ] Branch: tap "Sign in with Dexter" in the dexter.cash header on desktop — the live proof the fork died.

## Self-Review (run after writing)

Spec coverage: P0c.1 (Tasks 1-3), P0c.2 (Task 4), exit criterion (Task 6), Rule-#7 sweep (Task 7) — covered.
Type consistency: RecoverOutcome/RecoverVault defined once in types.ts, consumed by Tasks 2-4/6 by those names.
No placeholders: endpoint bodies, error codes, and line anchors are from recon evidence, not invented.
