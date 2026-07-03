# Consent-at-Birth in the SDK + Handle Persistence — @dexterai/connect 0.19.0

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Implementer/reviewer floor: **Opus 4.8**; money-perimeter review at Fable tier. Steps use `- [ ]` checkboxes.

**Goal:** Every door that creates a Dexter wallet collects the user-authored agent allowance (Branch's consent-at-birth ruling), the authored number becomes a server-side write-once consent record consumed by the warmup gate that actually arms spend authority, and the SDK's login/popup paths finally persist the active handle. One SDK release (0.19.0), one API change, every consumer migrated.

**Architecture:** dexter-connect: `createWallet` gains optional `spendPolicy` threaded into the `/initialize` body (wire slot proven — `coolingOffSeconds` already rides there); handle persistence added at the four missing success paths; `./react` gains an `AllowanceChips` primitive + a turnkey `CreateWalletPanel` in the `--dx-*` styled-injection convention. dexter-api: two write-once columns on `user_vaults`, `/initialize` validates+records, `/status` serves back, `/warmup` falls back to the stored record ONLY when the body omits a policy (body wins; NULL still 400s — fail-closed intact). Consumers: dexter-fe adopts the SDK panel/chips at `/wallet`, `/tabs/setup`, `/connect`; dexter-agents bumped off 0.11; dexter-mcp's unused dep dropped.

**Ruling contract (binding, verbatim sources in recon):** chips exactly `$5/$20/$50/Custom`, NONE pre-selected; Create disabled until a valid authored amount; zero is not consent; never a hardcoded default anywhere (program enforces via errors 6093/6094); TTL fixed `2592000` and never user-editable; the authored number must be CONSUMED (deploys the swig at warmup), not stashed inert.

## Global Constraints

- Repos: `~/websites/dexter-connect` (main), `~/websites/dexter-api` (main), `~/websites/dexter-fe` (wallet-launch-surfaces), `~/websites/dexter-agents` (agent-mail-protocol), `~/websites/dexter-mcp` (main). Commit per task; push after each repo's work lands.
- **Money perimeter:** `/warmup` changes (Task 4) deploy ONLY after a Fable-tier adversarial review (solo-fable mode: this session self-gates in main-fable's stead) + evidence: updated `__tests__/passkeyVaultAnonWarmup*.test.ts` green AND prod negative-path curl showing `400 spend_policy_required` when body omits AND no stored record.
- **Write-once consent:** birth-policy columns are set once (create, or first non-NULL write); re-running `/initialize` with a different number must NOT overwrite. No env/config/server default may ever populate them.
- **DB change** follows the dexter-db-migration convention: raw SQL via psql against live Supabase, hand-edit `prisma/schema.prisma`, `npx prisma generate`, commit both, migration file is documentation. `prisma migrate deploy` and `db pull` are banned.
- **SDK versioning:** 0.19.0, additive only (optional param, new exports, bugfix). Never publish uncommitted src; dexter-connect main gets pushed BEFORE publish.
- dexter-connect test runner: vitest (`npm test`), build `tsup`, typecheck `tsc --noEmit`. TTL constant lives in the SDK once: `export const SESSION_TTL_30D = '2592000'` (types or a policy module) — consumers stop re-declaring it.
- UI: `--dx-*` theming vars only (`--dx-ember:#f26c18`, `--dx-ember-2:#ba3a00`, `--dx-fg:#fff4ea`, `--dx-radius:0px`), injected-once stylesheet pattern (mirror `walletKitStyles`), sharp corners, no emojis, chips read like `.dx-wchip` with an ember-gradient active state.

---

## Task 0: dexter-connect hygiene

- [ ] Inspect the dirty `package-lock.json` hunk (`git diff package-lock.json`) — it is the 0.18.0 version-bump leftover (2 lines). Commit it as `chore: sync lockfile to 0.18.0`.
- [ ] `git push` (main is ~10 commits ahead of origin — includes the published 0.18.0 source). Verify `git status -sb` shows in-sync.

## Task 1: SDK — spendPolicy through the create ceremony (TDD)

**Files:** `src/types.ts`, `src/enroll.ts`, `src/policy.ts` (new), `src/policy.test.ts` (new), `src/enroll.test.ts` (extend if exists, else create with mocked fetch).

- [ ] `src/policy.ts` (new, pure):

```ts
/** Consent-at-birth allowance (Branch rulings 2026-07-02/03).
 *  The user authors the number; zero is not consent; TTL is fixed 30d and
 *  never user-editable; no caller may invent a default. */

export const SESSION_TTL_30D = '2592000';

export interface SpendPolicy {
  /** Role-2 allowance, atomic USDC (6dp), decimal string. User-authored. */
  spendLimitAtomic: string;
  /** Fixed 30d. Present for wire compatibility; always SESSION_TTL_30D. */
  sessionTtlSeconds: string;
}

/** Parse user-entered USD ("5", "$20", "1,000", "20.5") to atomic USDC.
 *  Null on anything invalid — callers must not invent a fallback. */
export function usdToAtomic(input: string): bigint | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  try {
    return BigInt(whole) * 1_000_000n + BigInt((frac + '000000').slice(0, 6));
  } catch {
    return null;
  }
}

/** Null when invalid or zero (zero is not consent). */
export function authoredPolicy(usdInput: string): SpendPolicy | null {
  const atomic = usdToAtomic(usdInput);
  if (atomic === null || atomic <= 0n) return null;
  return { spendLimitAtomic: atomic.toString(), sessionTtlSeconds: SESSION_TTL_30D };
}
```

- [ ] Tests first (`src/policy.test.ts`): port the proven cases from dexter-fe `app/lib/vault/birthPolicy.test.ts` — whole dollars, `$`/comma/decimals, `0.000001 → 1n`, rejects garbage/negative/>6dp/empty, the float-divergence magnitudes (`9999999999.999999 → 9_999_999_999_999_999n`), `authoredPolicy('0') → null`, TTL always `2592000`.
- [ ] `CreateWalletConfig` (enroll.ts:35-44) gains `spendPolicy?: SpendPolicy`. Thread into `initializeVault` body (enroll.ts:166-170): when present, body carries `spendLimitAtomic` + `sessionTtlSeconds` (always send `SESSION_TTL_30D`, ignore caller-tampered TTL by overwriting). Popup path: do NOT add allowance params to the popup URL — for third-party origins the allowance is authored ON the hosted /connect page (none-preselected forbids opener suggestions anyway).
- [ ] Export `SpendPolicy`, `SESSION_TTL_30D`, `usdToAtomic`, `authoredPolicy` from the root entry. Tests + typecheck + build green. Commit.

## Task 2: SDK — handle persistence at the four missing paths (TDD)

**Files:** `src/relay.ts`, `src/enroll.ts`, tests.

Recon-verified sites (grep before editing):
1. `passkeyLogin` inline (relay.ts:62): `const result = await submitLogin(apiBase, response); if (result.vault) setActiveHandle(result.vault.userHandle, undefined, result.vault.credentialId); return result;`
2. `passkeyLogin` popup return (relay.ts:40-45): await the popup result, same guarded persist, then return.
3. `continueWithDexter` popup return (relay.ts:82-88): await; persist from `kind:'create'` (top-level `handle`/`credentialId`) or `kind:'signin'` (`vault?.userHandle`), guarded.
4. `createWallet` popup return (enroll.ts:66-72): await; persist from the returned `CreateWalletResult` (`handle`, `name`, `credentialId`) so third-party-origin creates persist on the CALLER's localStorage.

- [ ] Tests first: mock `setActiveHandle`'s storage (or spy on the store) + mocked fetch/popup; assert each path persists on success and does NOT persist when `vault` is absent or the ceremony rejects.
- [ ] Implement, tests green, typecheck, build. Commit: `fix: persist the active handle on every login/create success path — popup and inline`.

## Task 3: SDK — AllowanceChips + CreateWalletPanel (./react)

**Files:** `src/react.ts` (or sibling component files per repo convention), styles via the injected-once pattern.

- [ ] `AllowanceChips({ value, onChange }: { value: string | null; onChange: (usd: string | null) => void })` — renders `$5 / $20 / $50 / Custom` as one radiogroup, NONE selected initially, Custom opens a decimal input (`inputMode="decimal"`, placeholder `$ amount`); emits the raw USD string or null. Styling: `.dx-chip` transparent bg + 1px `color-mix` ember border, uppercase letterspaced, active = ember gradient; all via `--dx-*` vars; `--dx-radius` respected.
- [ ] `CreateWalletPanel(props: { onCreated?: (r: CreateWalletResult) => void; onError?: (e: ConnectError) => void; apiBase?; transport?; showName?: boolean })` — composed: optional name field (label "Name your wallet"), `AllowanceChips` under label "What agents may spend, per 30 days", fine print "Your number, your tap. Agents can never spend past it, and you can revoke any time.", `DexterButton` CTA "Create your Dexter Wallet" disabled until `authoredPolicy(value)` is non-null, live `ceremonyPhaseLabel` states while running, ConnectError surfaced via `onError` + inline message. Internally calls `createWallet({ name, spendPolicy: authoredPolicy(value)!, ... })`.
- [ ] Export both from `./react`. Visual verification deferred to the consumer browser pass (Task 6/8). Typecheck + build green. Commit.

## Task 4: dexter-api — the consent record (MONEY PERIMETER)

**Files:** `prisma/schema.prisma`, new documentation migration dir, `src/routes/passkeyVaultAnon.ts`, `src/vault/spendPolicy.ts` (reuse `parseRequiredSpendPolicy`), `__tests__/passkeyVaultAnon*` tests.

- [ ] DDL via psql (then hand-edit schema.prisma `user_vaults`, `npx prisma generate`):

```sql
ALTER TABLE user_vaults
  ADD COLUMN IF NOT EXISTS birth_spend_limit_atomic bigint,
  ADD COLUMN IF NOT EXISTS birth_policy_authored_at timestamptz;
COMMENT ON COLUMN user_vaults.birth_spend_limit_atomic IS
  'Consent-at-birth agent allowance, atomic USDC. USER-AUTHORED ONLY (validated client value from /initialize). Write-once. NULL = never authored; warmup must still 400 without a body policy.';
```

- [ ] `/initialize` (passkeyVaultAnon.ts:1316-1334): parse optional body `spendLimitAtomic`+`sessionTtlSeconds` with `parseRequiredSpendPolicy` semantics applied to the PAIR when present (present-but-invalid → `400 invalid_spend_policy`; absent → proceed, columns stay NULL). Write on the create branch; on the existing-row branch write ONLY if `birth_spend_limit_atomic IS NULL` (write-once; never clobber — mirror the ensureUserVaultRow on-conflict discipline at :1611-1623).
- [ ] `/status` (:717-738 vault object): add `birthSpendLimitAtomic: row.birth_spend_limit_atomic?.toString() ?? null`.
- [ ] `/warmup` (:1117-1128): body policy present → exactly today's behavior (body wins). Body absent → load the row; if `birth_spend_limit_atomic` non-null, use `{spendLimitAtomic: stored, sessionTtlSeconds: SESSION_TTL_30D}`; else **unchanged `400 spend_policy_required`**. No other path. Comment the fallback with the ruling: "serve back what the user authored, never default when absent."
- [ ] Tests: extend the warmup suite — (a) body policy still wins over a stored record, (b) omitted body + stored record arms with the stored number, (c) omitted body + NULL record still 400s, (d) `/initialize` write-once (second call with different number does not overwrite), (e) `/initialize` invalid policy 400s. All existing fail-closed assertions stay green.
- [ ] **Fable-tier adversarial money review of this diff before deploy** (controller dispatches; verdict recorded in ledger). Then build, `pm2 restart dexter-api`, prod evidence: negative curl (omitted body, no record → 400 `spend_policy_required`) + `/status` shows the field. Commit + push.

## Task 5: publish 0.19.0

- [ ] dexter-connect: version → 0.19.0, changelog note, commit, **push**, `npm run build && npm test && npm publish`, verify `npm view @dexterai/connect dist-tags.latest` → 0.19.0.

## Task 6: dexter-fe migration (the flagship door)

- [ ] Bump `@dexterai/connect` → `^0.19.0`, install.
- [ ] `/wallet` CreatePanel: replace the local name-field+DexterButton create block with the SDK `CreateWalletPanel` (keep the page's SignInWithDexter + error block wiring); DELETE the now-redundant local `setActiveHandle` workaround in `handleSignIn` (SDK persists) — verify the gate still flips via `useDexterWallet().activeHandle`.
- [ ] `/tabs/setup`: `handleStart` path gains chips — render SDK `AllowanceChips` above the create CTA; `usePasskeyWalletAnon.startProvisioning(name, spendPolicy)` threads it to `createWallet`. Create disabled until authored (pairing flows untouched).
- [ ] `/connect` hosted page: `op=create` (and continue→create) renders `AllowanceChips` before running `createWallet` with the authored policy — third-party-origin creates now collect consent on the hosted page.
- [ ] `app/lib/vault/birthPolicy.ts`: retire — localStorage record superseded by the server record (`/status.birthSpendLimitAtomic`); delete module + tests, or reduce to a re-export of the SDK helpers if anything still imports `usdToAtomic`/`SESSION_TTL_30D` (grep and migrate importers to `@dexterai/connect`). `firstUse.ts` keeps its own `SESSION_TTL_30D`? — NO: import from the SDK, delete the local constant (one source).
- [ ] Tests + build + prerender guard + `pm2 restart dexter-fe` + prod verify (chips visible on /wallet + /tabs/setup, none pre-selected, Create gated) + push.

## Task 7: remaining consumers

- [ ] dexter-agents: bump `^0.11.0` → `^0.19.0`, install, typecheck/build the provider (`src/app/providers/dexter-connect-provider.tsx` — verify `useSignInWithDexter` + `createWallet` still compile; adapt signatures if 0.12-0.19 changed them), `pm2 restart dexter-agents`, smoke `curl` the app. Push.
- [ ] dexter-mcp: remove the unused `@dexterai/connect` dependency line (zero source imports — recon-verified), commit only package.json+lock. Push.

## Task 8: end-to-end evidence (the anti-overclaim gate)

- [ ] Real-flow proof on prod: create a fresh wallet through `dexter.cash/wallet` with a chip authored (Playwright-driven virtual authenticator if possible; else document as Branch-device test), then: `psql` the new `user_vaults` row shows `birth_spend_limit_atomic` = the authored number; `/status` returns it; warmup negative-path curl still 400s for a policy-less vault. Screenshots of chips on all three doors to Branch.
- [ ] Ledger + memory update; flag the review verdicts and any deviations.

## Deferred (named, not parked)

- OpenTabConsent pre-fill from the birth record (fresh authorship still wins) + its private `usdToAtomic` → SDK import — next fe touch.
- Signature-bound consent (fold policy bytes into the signed warmup message) — a NEW hardening, main-fable-class design question, not a regression fix.
- On-ramp lane, then OAuth advertisement (Branch-sequenced last).

## Self-review

- Ruling coverage: chips/none-preselected/zero-not-consent/TTL-fixed/no-defaults all enforced in `policy.ts` + panel gating + server validation; the number is CONSUMED (warmup fallback) — the inert-chips failure cannot recur.
- Fail-closed proof obligations named as tests (a)-(e) — a silent weakening fails the suite.
- Rule 7: every consumer named with exact files; the SDK becomes the single source for policy helpers and TTL; fe's local copies deleted.
- Persistence fix covers all four recon-verified holes, including third-party popup creates.
