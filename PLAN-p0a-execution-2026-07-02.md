# PLAN — P0a execution: the offline server pair

**Status:** active · 2026-07-02 · owner: **connect-fable** (boss seat per Branch, 2026-07-02)
**Executes:** SPEC §3 P0a + CONTRACT-dexter-session-token.md, both as amended 2026-07-02.
**Why this seat:** the prior commission chain evaporated (gtm commissioned vault-review 6/26; vault-review queued
it and was stood down 7/01; the reply never got read). P0a does not queue behind anyone's other work again.

## Ruling on the 2026-06-26 roadmap

The spec's five-axis analysis and phase split hold up against the code — ratified. Amendments:

1. **Priority order (mine):** P0a → session persistence (P1.1 client half) → the hygiene pair → README rewrite
   → P0b mount-core / P3 script tag. Rationale: server trust is the platform unlock; persistence is the first
   thing every adopter notices; distribution width comes after the story is real.
2. **The hygiene pair ships TOGETHER:** mount-time CSS injection + `"sideEffects"` field are one change.
   Adding `sideEffects: false` while CSS still injects at module load would let bundlers tree-shake the style
   injection away — half-shipping this pair is worse than not shipping it.
3. **README rewrite lands right after `./server` exists** — one rewrite covering the full surface (today it
   documents 4 of 36 exports and misstates the peer deps), not two passes a week apart.
4. **P2 hold REAFFIRMED.** The swig agent-spend re-platform gate stands. Before any P2 work, re-verify the final
   surface with main-fable — not against today's role-2 path.

## Work items

| # | What | Owner | Exit criterion |
|---|---|---|---|
| 1 | Vault peer floor `>=0.30.0` + devDep `^0.30.0` | connect-fable | **DONE 2026-07-02** — typecheck, build, 45/45 tests green |
| 2 | Hook SQL authored per CONTRACT §4 (incl. hardening) | connect-fable | SQL matches verified `user_vaults` semantics (checked live 7/02: `swig_address` = state addr; `user_handle` nullable bytea) |
| 3 | Hook deploy: create fn + grants (psql, DB-first) + platform enable (Auth → Hooks) | api-fable deploys · connect-fable verifies | freshly-minted live token decodes with `dexter:{ver,vault,userHandle}` and ALL standard claims intact |
| 4 | `@dexterai/connect/server` — `jose`, `algorithms:['ES256']` pinned, `(iss, jwksUrl)` parameterized, edge-safe | connect-fable | **DONE 2026-07-02** — TDD (16 tests: alg-confusion, iss/aud mismatch, expiry, tamper, kid rotation, JWKS cache, pre-hook tokens); live E2E: real prod token verified offline, cached verify 0.62ms/0 network, tamper rejected |
| 5 | First consumers | connect-fable | **Board half DONE 2026-07-02**: dexter-board migrated to `verifyDexterSession` (offline), GoTrue call deleted, E2E verified live (real token → 403 not_admin with correct sub; garbage → 401). Still open: the 10-line vanilla page on a REAL edge runtime (Workers/Vercel) — Node E2E alone doesn't prove the edge axis. |
| 6 | Publish 0.18.0 + Rule #7 consumer sweep | connect-fable | **Published 2026-07-02** (npm, tag latest). Sweep: board server-side migrated to 0.18.0; still open — dexter-fe (pins `^0.16.0`, AND sits on vault `^0.27.0` < the 0.30 wire-format floor — their vault bump precedes their connect bump; flagged to wallet-frontend-fable) and the board login page's esm.sh `@0.16.0` client import. |
| 7 | `<ConnectedSurfaces>` wallet-kit component (accepted from api-fable 2026-07-02) | connect-fable UI · api-fable backend | Architecture settled 7/02: core VERBS `listConnectedSurfaces()`/`revokeSurface(id)` run the challenge→sign→POST dance (agentSpend pattern — kill the consumer fork at the source); `<ConnectedSurfaces>` composes them, headless data-in/callback-out mode preserved. Wire: list endpoint LIVE (`/pair/link-token/list`, passkey-gated, hash ids only); revoke-by-id commissioned (fresh single-use assertion per revoke, response echoes `id`). Raw tokens never enter the SDK. **Copy constraint until money-path enforcement lands: revoke reads "disconnect this surface"; the vault-wide agent-spend switch stays the prominent security kill.** Exit: device-signed happy path (list → revoke-by-id → re-list shows `revoked: true`) run with a real passkey. |

## Risk register

- **The hook runs on every token mint for every user.** A throwing hook can take down all auth. Mitigations:
  body wrapped so any anomaly returns the event unchanged; verify with a real ceremony immediately after enable;
  rollback = disable the hook in platform config (instant), then drop the function.
- **Enablement is dashboard/Management-API config**, outside SQL — needs api-fable's or Branch's access. The
  function alone does nothing.
- **`dexter.origin` stays deferred** (CONTRACT §4): the hook cannot see the requesting site. It arrives when the
  receiver page passes it — do not fake it in the hook.
- **Phase-1 `iss` announces supabase.co.** Accepted per CONTRACT §3 (Branch, 6/26): deliberate sequencing, and the
  `(iss, jwksUrl)` parameterization keeps the Phase-2 sovereign cutover a config flip. Do not let it calcify.
