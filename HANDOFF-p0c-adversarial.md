# HANDOFF — P0c recover verb: adversarial review session

> For the NEXT session (fresh, adversarial). This session (2026-07-18, Fable) built and shipped P0c under a
> standing rule: adversarial multi-agent review is deferred to you so the build session stays on Fable. TDD +
> own end-to-end verification was the floor here; you are the ceiling. Ship a patch release (0.21.1) if you
> find anything real.

## What shipped — @dexterai/connect 0.21.0 (published npm, tag latest; commit 51f4659 + follow-ups)

`recoverWallet(config?)` — wallet-only sign-in, NO account session (Branch ruling 2026-07-05: the wallet IS the
sign-in). Ceremony: `recover-challenge` → discoverable assertion (immediate-UI bridge behind `preferImmediate`)
→ `recover-verify` → `/api/passkey-vault-anon/status` hydrate → `setActiveHandle`. Returns a discriminated
`RecoverOutcome` (`ok | no_credential | cancelled | error`) — user cancel is a result, never a throw.

- **New files:** `src/recover.ts`, `src/immediate.ts` (Chrome-149 bridge + capability probe + rejection
  classifier), `src/httpError.ts` (shared `readErrorCode`, killed 3× duplication). Tests: `recover.test.ts` (12),
  `immediate.test.ts` (12), `httpError.test.ts` (3), `recoverPersistence.test.tsx` (3). Full suite 135 green,
  `tsc --noEmit` clean.
- **React (P0c.2):** `useSignInWithDexter().recover()` + `recovered`; `<SignInWithDexter mode="recover" onRecovered>`.
  `signIn()`/`SignInResult` untouched (dexter-agents reads `result.session`). Added `transport`/`connectHost`/
  `preferImmediate` to the hook config.
- **Popup:** `openCeremonyPopup` op union gains `'recover'` + `preferImmediate` param. Receiver
  (dexter-fe `app/connect/page.tsx`) relays the OUTCOME as `{ok:true, result: RecoverOutcome}` so
  no_credential/cancelled survive the postMessage boundary; `popup_closed → cancelled`.
- **Consumers migrated (Rule #7, all live):** dexter-fe ^0.21.0 — the hand-rolled recover ceremony + immediate
  bridge DELETED from `usePasskeyWalletAnon.ts` (448→277 lines; `recoverFromAuthenticator` is now a thin adapter
  over the verb), `NoWalletSignIn` calls the verb directly. dexter-agents ^0.21.0. dexter-board 0.21.0 (server dep
  + esm.sh browser pin).

## Two deliberate improvements over the fe donor (verify they're actually better, not just different)

1. **Persist only after vault confirmation.** The donor called `setActiveHandle` on verify success, THEN fetched
   status — so a verified-but-vaultless handle got persisted (`recover_no_vault_for_handle`). The verb hydrates
   first and returns `error: vault_not_found` with NOTHING persisted. Confirm no path persists before the vault check.
2. **Roster carries walletLabel + credentialId.** Donor passed handle only. Confirm the eject Signal-API prune
   still finds the credentialId.

## Attack surface — where to push hardest

- **Challenge-consumption atomicity:** `recover-challenge`/`recover-verify` share `issueAnonRecoverChallenge`/
  `consumeAnonRecoverChallenge` with `login-challenge`/`passkey-login` (one pool, `purpose='sign'`, `is_anon`,
  `user_handle IS NULL`). A recover-side change silently affects account login. (dexter-api, out of this repo.)
- **Popup envelope fidelity:** dexter-board's browser still runs 0.16.0 popup code against the deployed receiver.
  I kept `{v:1, type:'dexter-connect:result', requestId, ok, result}` byte-compatible for op=signin — verify the
  recover additions didn't perturb the signin shape. Try a cross-version popup handshake.
- **Immediate-mode gesture chain:** `primeImmediateSupport()` runs at module load. Confirm no fresh `await` sits
  between the tap and `navigator.credentials.get()` on a real Safari/iOS device (the silent on-device regression).
  Also: `uiMode` rides the TOP LEVEL of the get() options, not `publicKey` — re-verify against a real Chrome 149.
- **Classifier regex** (`classifyWebAuthnRejection`): stringly-typed against error messages. Test against real
  browser DOMExceptions AND simplewebauthn-wrapped `WebAuthnError` (cause chain), not just synthetic errors.
- **no_credential overload:** covers both immediate-mode instant-reject (no passkey on device) AND verify-404
  (passkey exists, no server row). Both nudge "create" — for the 404 case, a user could mint a second wallet
  believing they recovered. Worth a distinct signal?
- **Un-rate-limited `recover-challenge`** (PRE-EXISTING, flagged not caused): every unauthenticated POST inserts a
  `passkey_challenges` row, no rate limit. P0c makes it a headline SDK path — free DB-write amplifier. Flag to
  Branch alongside the admin fast-track CLI work.
- **dexter-api-heal / dexter-api-prop** carry copies of `passkeySignAnon.ts`. Confirm whether they're live deploy
  targets before anyone extends the recover-verify response.

## Branch's live proof (do first, before attacking)

Tap **"Sign in with Dexter"** in the dexter.cash header on desktop → Face ID → the header flips to the wallet
menu. That is the hand-rolled fork replaced by the SDK verb, running in prod. If it works, the exit criterion held.
