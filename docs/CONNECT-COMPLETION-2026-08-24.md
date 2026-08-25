# Connect completion

Date: 2026-08-24

This is the release sequence for turning `@dexterai/connect` from a passkey and wallet kit into Dexter's complete connection layer. A missing package export is a product gap. A working capability in another repository does not count as Connect support until the package owns the contract and every consumer adopts it.

## Current baseline

`0.26.4` already provides:

- create, sign in, recover, and continue with a Dexter Wallet;
- hosted passkey ceremonies from any website;
- a hosted signer for exact wallet operations;
- active-wallet storage, switching, naming, and keychain signals;
- React buttons, wallet identity components, and install actions for agent runtimes;
- local server verification of Dexter sessions;
- automatic agent-spend status and enable or revoke controls;
- World ID proof acquisition.

The package still stops before the complete economic connection:

- it models the old automatic wallet-wide allowance separately from current governed agent grants;
- it does not enroll device-code clients into persistent agent authority;
- it does not preserve or resume a paid request through grant setup, one-purchase approval, or seller Tab consent;
- it does not expose grant editing, renewal, pause, revocation, or capacity history as a coherent SDK;
- it has no framework-neutral mount surface;
- its public description still reduces the product to passkey sign-in;
- its consumers still contain private copies of connection logic and older package pins.

## Release 0.27: composable agent authority

Owner: `dexter-connect`

- [x] Export OAuth and device-code authority targets.
- [x] Export one grant request that accepts x402, buy, and sell rules on the same agent.
- [x] Export owner-passkey challenge and completion calls.
- [x] Bind every response to the exact target, wallet, rules, grant, and operation.
- [x] Export custom x402 limits and the explicit no-custom-limit choice.
- [x] Export the live authority, capacity, and active-role read for an OpenDexter bearer.
- [x] Prove the existing `dexter-fe` bounded-x402 flow can delete its private protocol copy.
- [ ] Publish `0.27.0` and update every consumer to the exact version.

Release gate:

1. Connect tests, typecheck, build, and package inspection pass.
2. `dexter-fe` imports the package implementation and deletes `opendexterOAuthAuthority.ts`.
3. The production connection creates an agent-bound token whose authority read names the exact grant and revision.

## Device-code connection

Owners: `dexter-api`, `dexter-fe`, OpenDexter

- [ ] `/wallet/connect` collects or confirms the agent's authority before approving the device code.
- [ ] The page stages a `device-code` authority selection through Connect.
- [ ] Token issuance requires that staged agent authority for money-capable OpenDexter clients.
- [ ] Remove the current no-selection path that turns a device connection into owner payment authority.
- [ ] Return a distinct structured result when enrollment is required.
- [ ] Re-run the original paid request under the new agent-bound token after enrollment.

Release gate:

`opendexter connect` -> owner chooses authority -> passkey -> agent-bound token -> fresh check -> governed Exact or Tab -> receipt.

The proof must show the agent id, grant id, revision, selected rule, capacity reservation, and `fallback: false`.

## Paid-request continuation

Owners: `dexter-connect`, OpenDexter, `dexter-mcp`, Hermes integration

One continuation result must distinguish:

- persistent agent enrollment;
- a one-purchase owner approval;
- seller-specific Tab consent;
- completed payment;
- deterministic refusal;
- retryable service uncertainty.

The result must carry the continuation URL, request identity, frozen quote or intent identity, expiry, and the fields required to resume. Text-only errors are not the contract.

Release gate:

The user asks once. Authorization may interrupt the request, but after authorization the runtime resumes the same request and returns the result and receipt without asking the user to restate it.

## Authority management

Owners: `dexter-connect`, `dexter-api`, `dexter-fe`, iOS

- [ ] Export typed rotate, renew, pause, resume, and revoke operations.
- [ ] Export current rules, remaining capacity, expiry, revision, and connected surfaces.
- [ ] Add a first-party React authority editor and a framework-neutral core.
- [ ] Replace the old `CreateWalletPanel` mandatory wallet-wide allowance with the current agent-grant model.
- [ ] Let owners begin with no custom limit or author exact limits.
- [ ] Make later edits available from web and iOS.
- [ ] Retire the automatic role-2 API after every live consumer moves to governed grants.

## One connection surface

Owners: `dexter-connect`, `dexter-fe`

- [ ] Extract the hosted ceremony state machine from `app/connect/page.tsx` into Connect.
- [ ] Make React a thin binding over the same state machine.
- [ ] Add a plain HTML or custom-element mount path.
- [ ] Publish one appearance contract for buttons, wallet identity, authority, approvals, and errors.
- [ ] Keep the Dexter-hosted window as the passkey and financial-consent boundary.
- [ ] Turn bare `/connect` navigation into the public Connect product and developer page while preserving active ceremony links.

## Server and session lifecycle

Owner: `dexter-connect`

- [ ] Replace `agentGrant: unknown` with the governed grant and revision contract.
- [ ] Add session persistence, refresh, expiry events, and explicit sign-out.
- [ ] Add server helpers for webhook or continuation verification.
- [ ] Export the balance read that React currently keeps private.
- [ ] Document issuer, audience, key rotation, and edge-runtime support against the current deployment.

## Consumer cleanup

Owners: each consuming repository

- [x] Locate the `dexter-fe` private bounded-x402 implementation.
- [x] Prove it can import the Connect implementation without changing the live flow.
- [ ] Publish and land that deletion.
- [ ] Update the main frontend from `0.26.4` to `0.27.0`.
- [ ] Update the docs application from `^0.24.4` to the exact current version.
- [ ] Inventory and delete remaining private ceremony, wallet, authority, and install logic after equivalent Connect exports land.

## Public product page

The public `/connect` page must explain the full product, not one claim:

- one Dexter Wallet across websites, apps, and agent runtimes;
- passkey-rooted self-custody;
- economic identity that persists when the model or runtime changes;
- scoped agent authority for payment and other governed actions;
- Exact and Tab payment paths;
- owner approvals and revocation;
- capacity and receipt history;
- offline-verifiable application sessions;
- install paths for ChatGPT, Claude, Codex, Claude Code, Hermes, Cursor, VS Code, and any MCP runtime;
- one package for browser, React, server, and proof-of-personhood integrations.

The page ships after its claims are mapped to live behavior or an explicitly named release in this sequence. It does not hide unfinished work; it links supported actions directly and presents near-term capability as product direction only until its release gate passes.
