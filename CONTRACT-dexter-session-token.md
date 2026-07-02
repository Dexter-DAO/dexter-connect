# CONTRACT — the Dexter session token (offline-verifiable)

**Status:** ratified design · 2026-06-26 · author: gtm · the gating artifact for `@dexterai/connect` P0a.
**2026-07-02 (connect-fable, owner):** ratified as build canon. Folded vault-review's 2026-06-26 review into §4
(base64url SQL, DEFINER/search-path/grant hardening, null-row return-unchanged) — that reply sat unread in gtm's
inbox for 6 days. Verified live today: `user_vaults` has BOTH `vault_pda` and `swig_address` columns; `swig_address`
is the swig state address (the SDK's own `ConnectVault.swigAddress`, "the user-facing Dexter Wallet address"), so the
§2 mapping stands. `user_handle` is NULLABLE in prod (check constraint allows either identity leg) — the hook emits
`dexter.userHandle` only when present. Build owner: connect-fable; hook deploy coordinated with api-fable.
**Who builds against this (lockstep — change the claim shape → all three move together, Rule #7):**
`@dexterai/connect/server` (verifier), the dexter-fe receiver page (passes the token back), dexter-api (mints it).

This is the **one seam** between "a user signed in with Dexter" and "a server trusts it." Every server — including
edge runtimes (Cloudflare Workers, Vercel edge) — verifies it **offline**: no call to Supabase, no call to dexter-api,
just a local signature check against a published key. That is the whole point.

---

## 0. The decisive fact (verified live, not assumed)

The Dexter Supabase project (`qdgumpoqnthrjfmqziwm`) is **already on Supabase's asymmetric-JWT system.** Confirmed:

```
GET https://qdgumpoqnthrjfmqziwm.supabase.co/auth/v1/.well-known/jwks.json
→ { "keys": [ { "kty":"EC", "crv":"P-256", "alg":"ES256", "use":"sig", "kid":"9d0a2716-…" } ] }
```

So the access token dexter-api already mints (via `mintSupabaseSession`, the magic-link-OTP dance at
`dexter-api/src/utils/supabaseAdmin.ts:326`) is an **ES256/P-256 JWT, JWKS-verifiable offline today.** P-256 is the
same curve as the WebAuthn passkeys (`-7`/ES256) and the chain — one curve end to end. The "verify against GoTrue
`/auth/v1/user`" pattern (what the status.dexter.cash board currently uses) is therefore **already replaceable with
offline verification, with zero Supabase change.** The only thing missing for a *Dexter* token is the Dexter claims.

## 1. Algorithm — **ES256** (locked)

ECDSA P-256 / SHA-256. It is the passkey curve, the chain curve, Supabase's live signing curve, FAPI-recommended, and
`jose`-verifiable in every edge runtime. Not negotiable; everything else is already on it. (EdDSA is technically nicer
but breaks the one-curve property and has uneven KMS support; RS256 is FAPI-discouraged. Neither applies.)

## 2. The token — header + claims

**Header:** `{ "alg": "ES256", "typ": "JWT", "kid": "<jwks kid>" }` — verifiers select the key by `kid`.

**Claims.** Registered claims are Supabase's standard set (already present); Dexter-specific data lives under a single
namespaced `dexter` object claim — collision-proof against future Supabase reserved claims, trivially versioned, read as
`payload.dexter.vault`.

| Claim | Type | Meaning | Source |
|---|---|---|---|
| `iss` | string | issuer — **parameterized** (see §3) | Supabase (now) |
| `sub` | string (uuid) | the Supabase user id, stable per passkey `user_handle` | existing |
| `aud` | string | the relying party / API audience (RP verifies it was minted *for them*) | Supabase default `authenticated`; see §3 |
| `exp` `iat` `nbf` | number | lifetime (short — minutes; pair with refresh, §5) | Supabase |
| `session_id` | string | the revocable session anchor | Supabase |
| `aal` | string | passkey assurance level (for step-up) | Supabase |
| **`dexter`** | object | **the Dexter payload — injected by the access-token hook (§4)** | NEW (hook) |
| `dexter.ver` | number | claim-format version (start `1`) — lets the wire format evolve | hook |
| `dexter.vault` | string (base58) | the swig **state** address — the canonical vault id. **Stored column, hook-readable.** The on-chain deposit/wallet address is *derived* from it (`resolveSwigWalletAddress`, an RPC call) by consumers — a Postgres hook cannot compute it. If the deposit address must live in the token, store it as a column or mint in Node (Phase 2). | `user_vaults.swig_address` (stored) |
| `dexter.userHandle` | string (b64url) | the 16-byte passkey handle (the identity root) | `user_vaults.user_handle` |
| `dexter.origin` | string | the site that initiated the ceremony (hosted-popup model) | passed from the receiver page |
| `dexter.agentGrant` | object \| null | the agent-spend authorization, **once P2 lands** (held — see SPEC §3 P2 gate) | future |

## 3. Issuer strategy — ride Supabase now, sovereign later as a **config flip**

> **NOTED / committed direction (Branch, 2026-06-26):** riding Supabase is a *deliberate temporary sequencing,
> not the end state.* Phase 2 (Dexter-signed token, `iss: dexter.cash`) is the **intended destination** — it
> honors the standing "off legacy Supabase auth → passkey-sovereign" direction. Phase 1 ships first only because
> it's free and changes nothing functional; the design below guarantees the cutover stays a config flip so the
> ops cost of a sovereign signer is paid *when the independence is worth it, not before.* Do not let Phase 1
> calcify into "we're a Supabase shop."

Two phases, **identical claim shape** in both, so the wire format never changes when the issuer does:

- **Phase 1 (now, cheap, correct):** ride Supabase's ES256 signer + JWKS. `iss = https://qdgumpoqnthrjfmqziwm.supabase.co/auth/v1`,
  JWKS = that host's `/.well-known/jwks.json`. dexter-api change = **one Custom Access Token Hook** (§4). Done.
- **Phase 2 (when sovereignty matters):** mint a Dexter-signed token. `iss = https://dexter.cash`, JWKS = `jwks.dexter.cash`.
  This sheds the Supabase-key/uptime coupling (the token currently *announces* `…supabase.co` in `iss`).

**The contract requirement that makes Phase 2 a config change, not a rewrite:** verifiers **parameterize on `(iss, jwksUrl)`**
— never hardcode Supabase. The `dexter.*` claim shape is signer-independent. Cutting over = changing two config values +
standing up the Dexter signer; no consumer code changes.

## 4. Minting — the Custom Access Token Hook (the only new dexter-api work, Phase 1)

A Postgres function `public.custom_access_token_hook(event jsonb) returns jsonb` (Supabase's supported mechanism; runs
**before** signing, so its output is sealed into the ES256 JWT and visible to every offline verifier):

- Read the `user_vaults` row for `event.user_id` (the synthetic Supabase user, keyed to the passkey handle).
  Lookup: `WHERE supabase_user_id = (event->>'user_id')::uuid` — served by the existing partial unique index.
- Set `claims.dexter = { ver:1, vault, userHandle, agentGrant:null }`. `userHandle` is emitted only when the
  column is non-null (nullable in prod; the `user_vaults_identity_present` check allows either identity leg).
- **`userHandle` encoding — canonical padless base64url, in SQL** (the standard-base64 → base64url translate is
  the classic place this silently breaks; use exactly this):
  ```sql
  rtrim(translate(encode(user_handle, 'base64'), '+/', '-_'), '=')
  ```
- **Missing row → return the event UNCHANGED.** Mostly unreachable (the Supabase user is minted in the same
  enroll flow that creates the vault); the only window is a partial/interrupted enroll. Cheap defensive coding,
  not load-bearing — an auth-flow hook that hard-errors on a missing row is fragile regardless. Same rule for any
  internal error: wrap the body so a throwing hook can never take down all token minting.
- **Hardening (the hook runs inside the auth flow with elevated trust):** `SECURITY DEFINER` with a pinned
  `SET search_path = ''` and fully-qualified `public.user_vaults`; `GRANT EXECUTE` to `supabase_auth_admin`
  ONLY — revoke from `public`/`authenticated`/`anon`. A hook callable or modifiable by other roles is a
  claim-injection / auth-bypass surface.
- **Enablement is PLATFORM config** (Supabase dashboard Auth → Hooks, or the Management API) — the function
  existing in `pg_proc` is necessary, not sufficient. Deploy = create fn + grants + enable hook + verify a
  freshly-minted token carries `dexter.*` with all standard claims intact.
- **Never clobber** the required claims (`iss/aud/exp/iat/sub/role/aal/session_id/...`) — add only.
- **`origin` is NOT set here** — the hook can't see the requesting site (it runs inside Supabase at issue time).
  `dexter.origin` is supplied by the sign-in flow (the receiver page knows the opener origin) and is optional for
  Phase 1; defer it until the receiver page lands rather than fake it in the hook.

No change to the WebAuthn verification or `mintSupabaseSession`; the hook fires inside Supabase at token-issue time.
(The seam if we ever mint a *Dexter-signed* token instead: `passkeySignAnon.ts:427`, after the session mint — every
identity field is already in hand there. Phase 2 only.)

## 5. Verification — the canonical `jose` pattern (Node + edge)

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

// Config, not hardcoded — Phase 2 flips these two values only.
const ISS = process.env.DEXTER_TOKEN_ISS  // Phase 1: https://<ref>.supabase.co/auth/v1
const JWKS_URL = process.env.DEXTER_JWKS_URL // Phase 1: `${ISS}/.well-known/jwks.json`

// Module scope — created ONCE per isolate so the JWKS caches across requests (effectively offline on the hot path).
const JWKS = createRemoteJWKSet(new URL(JWKS_URL), { cacheMaxAge: 600_000, cooldownDuration: 30_000, timeoutDuration: 5_000 })

export async function verifyDexterSession(token: string, audience: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISS,
    audience,                 // RP asserts the token was minted for it
    algorithms: ['ES256'],    // PIN the alg — defeats alg-confusion / alg:none
  })
  return payload              // payload.sub, payload.dexter.vault, ...
}
```

Hard requirements: **pin `algorithms: ['ES256']`**; always check `iss` + `aud`; create the JWKS set once per isolate.
First call fetches the JWKS; every later call resolves the key from the in-isolate cache with no network — a pure local
ECDSA verify. A rotated `kid` triggers exactly one cooldown-bounded refetch.

## 6. Rotation

- **Phase 1:** Supabase owns rotation (multi-`kid` JWKS; old key trusted until its tokens expire). Verifiers need nothing —
  `jose` handles `kid` selection. Only constraint: don't cache the JWKS locally longer than Supabase's ~10-min edge TTL.
- **Phase 2:** standard 3-phase dual-sign when Dexter holds the key — publish new `kid` alongside old → flip signing →
  retire old after ≥ max token lifetime.

## 7. Versioning + lockstep

`dexter.ver` starts at `1`. Any breaking change to the `dexter.*` shape bumps it, and the three consumers
(`@dexterai/connect/server`, the dexter-fe receiver, the dexter-api hook) ship together — that's the §6 cross-repo rule
in the SPEC. A shared-format change isn't done until all three adopt it.

## 8. Immediate dogfood

The status.dexter.cash board can migrate off its `/auth/v1/user` call-home to this offline verifier *today* (Phase 1,
no hook needed — it only checks identity, not the `dexter.*` claims). First proof of the offline path, zero new infra.
