<p align="center">
  <img src="https://raw.githubusercontent.com/Dexter-DAO/dexter-x402-sdk/main/assets/dexter-wordmark.svg" alt="Dexter" width="360">
</p>

<h1 align="center">@dexterai/connect</h1>

<p align="center">
  <strong>Connect any app or agent to a Dexter Wallet. One passkey anchors the wallet, the owner session, and persistent agent authority across runtimes.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dexterai/connect"><img src="https://img.shields.io/npm/v/@dexterai/connect.svg" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/react-%3E=18-brightgreen.svg" alt="React"></a>
  <a href="https://www.w3.org/TR/webauthn-2/"><img src="https://img.shields.io/badge/auth-passkey-00FF88" alt="Passkey"></a>
</p>

---

## What this is

A `<SignInWithDexter/>` button returns an application session and a
**Dexter Wallet**. The same package creates and recovers wallets, signs exact
wallet operations in a Dexter-hosted window, installs OpenDexter in agent
runtimes, grants an agent persistent payment or trading authority, reports
remaining capacity, and verifies sessions on the server. The owner keeps the
root passkey. Agents receive narrower, revocable grants. Composes
[`@dexterai/vault`](https://www.npmjs.com/package/@dexterai/vault).

Four entry points cover the whole flow:

| Entry point | Runs in | What it gives you |
|---|---|---|
| `@dexterai/connect` | browser | wallet lifecycle, hosted signing, persistent agent authority, capacity reads, wallet storage, runtime install actions |
| `@dexterai/connect/react` | browser | `<SignInWithDexter/>`, the branded wallet kit, hooks |
| `@dexterai/connect/server` | Node 18+, Workers, Vercel edge | `verifyDexterSession`: offline session verification |
| `@dexterai/connect/worldid` | browser | `<VerifyPersonhood/>` World ID proof-of-personhood button |

## Install

```bash
npm install @dexterai/connect @dexterai/vault react
```

`@solana/web3.js` and `@worldcoin/idkit` are optional peers: the first for
passkey and agent-spend signing, the second only if you use the World ID button.

## Quick start

```tsx
import { SignInWithDexter } from '@dexterai/connect/react';

function Header() {
  return (
    <SignInWithDexter
      onSuccess={({ session, vault }) => {
        // session = auth tokens (camelCase); vault = the Dexter Wallet
        seatYourSession(session);
      }}
    />
  );
}
```

Signed out, it renders a **Sign in with Dexter** button. Connected, it becomes
the wallet chip: address plus **"$X.XX available."**

## Works on any website

The ceremony is not limited to dexter.cash. On a foreign origin, `passkeyLogin`
opens a hosted popup on `dexter.cash/connect`, runs the ceremony there, and
posts the result back to your page. A browser-stamped hello/ack binds the exact
popup window, hosted origin, caller origin, request nonce, and requested
operation; the caller-origin may be any HTTPS website and is not allowlisted.
The default `transport: 'auto'` picks the right mode; `'popup'` and `'inline'`
force it.

The connected `passkeySigner.signOperation(rawOperation)` follows the same
cross-origin rule. On an unrelated website it opens the pinned Dexter consent
window and sends the raw operation plus the selected vault identity only after
the exact hello/ack handshake. Those bytes are structured-cloned in a
`sign-request`; they are never put in the URL. The Dexter window displays the
requesting origin and operation-specific consent before returning the
on-chain-ready assertion bytes.

WebAuthn challenge and verification calls are pinned to
`https://api.dexter.cash`. The legacy `apiBase` option remains source-compatible
only for that exact value (an optional trailing slash is normalized); any other
server fails before a popup, fetch, or authenticator call. `apiBase` is never
placed in the hosted popup URL. The legacy `connectHost` option is likewise
compatibility-only and may name only `https://dexter.cash/connect`; this pins
the credential-handling window without restricting the embedding website.

```ts
import { passkeyLogin } from '@dexterai/connect';

const { session, vault } = await passkeyLogin({ transport: 'auto' });
```

By default, a successful sign-in immediately makes its wallet active in the
browser wallet store, preserving existing behavior. A flow that must finish a
separate account-level approval can instead keep the result provisional:

```ts
import { passkeyLogin, setActiveHandle } from '@dexterai/connect';

const result = await passkeyLogin({
  transport: 'auto',
  walletStore: 'provisional',
});

// Only after your approval has bound this exact wallet to the account:
if (result.vault) {
  setActiveHandle(
    result.vault.userHandle,
    result.vault.walletLabel ?? undefined,
    result.vault.credentialId,
  );
}
```

`provisional` suppresses both active-handle and wallet-roster writes on the
hosted Dexter origin and the calling origin. It does not weaken passkey
verification or persist a second identity. `recoverWallet`, `createWallet`, and
every terminal sign-in/create branch of `continueWithDexter` accept the same
option. A provisional creation still completes the passkey and Vault ceremony
and returns the full `CreateWalletResult`; explicitly call
`setActiveHandle(result.handle, result.label ?? undefined, result.credentialId)`
only after the separate approval succeeds. The only supported modes are exact
`commit` and `provisional`; omitted means `commit`.

## Create an owner-only wallet

An app can postpone agent authority and create the wallet with its owner
passkey only:

```ts
import { continueWithDexter } from '@dexterai/connect';

const result = await continueWithDexter({
  agentDelegation: 'deferred',
});
```

The hosted Dexter window omits the agent-allowance step. The initialize request
contains no spend limit or agent-session TTL. Existing wallets still sign in
normally, and the owner can add governed agent authority later.

`agentDelegation: 'deferred'` and `spendPolicy` are mutually exclusive. The SDK
rejects that combination before opening a popup, fetching a challenge, or
starting WebAuthn. Omitting `agentDelegation` preserves the existing
`configure-now` flow.

A `kind: 'signin'` continue result includes the verified session. A
`kind: 'create'` result proves that wallet creation completed but does not mint
an access session. If your server must bind the new identity immediately, ask
the user to finish `passkeyLogin()` on a subsequent user action and send only
that access token to your server for verification.

## Verify the session on your server

```ts
import { createDexterClient } from '@dexterai/connect/server';

const dexter = createDexterClient(); // parameterized on (iss, jwksUrl); defaults to Dexter's issuer

export async function handler(req: Request) {
  const auth = await dexter.authenticateRequest(req);
  if (!auth.isSignedIn) return new Response('unauthorized', { status: 401 });
  if (!auth.userHandle) return new Response('wallet identity required', { status: 403 });
  auth.userHandle;   // stable Dexter wallet principal from the signed claim
  auth.vaultAddress; // associated wallet capability, not your user primary key
  auth.sub;          // signed account subject backing this session
  auth.claims;       // full verified JWT payload
}
```

Verification is a local ES256 signature check against a cached JWKS. The first
call fetches the key set; every later call is pure local crypto with zero
network (measured at ~0.6ms). The algorithm list is pinned to ES256, and
issuer plus audience are always checked. `verifyDexterSession(token, options)`
does the same for a bare token string, and `jwtKey` accepts a public JWK for
fully networkless deployments.

## Hook (full control)

```tsx
import { useSignInWithDexter } from '@dexterai/connect/react';

const c = useSignInWithDexter();
await c.signIn();        // run the passkey ceremony
c.status;                // idle -> pending -> done -> error
c.vaultAddress;          // the Dexter Wallet address (base58)
c.usdcBalance;           // USD available (via Dexter's RPC), or null
c.disconnect();
```

| Field | What it is |
|---|---|
| `signIn()` / `disconnect()` | run the passkey ceremony / clear state |
| `status` / `isVaultConnected` | `idle->pending->done->error` / connected flag |
| `session` | auth session tokens (camelCase) |
| `vaultAddress` / `vaultPda` | the Dexter Wallet address / PDA |
| `usdcBalance` / `refreshBalance()` | USD available, best-effort via Dexter's RPC |
| `vault` / `credentialId` / `error` | raw vault payload / credential id / typed error |

## The wallet kit

Branded, presentational pieces that share one implementation across every
Dexter surface, themed with `--dx-*` CSS variables: `DexterButton` (and
`DexterMark`) for any action that should look like Dexter, `DexterWalletChip`
as the header trigger, `DexterWalletMenu` for manage / save / start-fresh, and
the `useDexterWallet` + `useIdentity` hooks to drive them.

## Agent spend

Connect can bind an OAuth or device-code connection to one persistent agent
and one composable grant. The same grant can carry x402 payment rules and
additional governed actions. It is staged by the owner, activated when the
connection token is minted, and read later from the runtime bearer.

```ts
import {
  beginAgentAuthority,
  buildAgentAuthorityRequest,
  buildX402PaymentRule,
  noCustomX402Limits,
  readAgentAuthority,
  stageAgentAuthority,
} from '@dexterai/connect';

const limits = noCustomX402Limits();
const request = buildAgentAuthorityRequest({
  target: { kind: 'device-code', userCode },
  expectedVaultPda: wallet.vaultPda,
  agentLabel: 'Hermes',
  grantExpiresAt: limits.expiresAt,
  rules: [buildX402PaymentRule(limits)],
});

const challenge = await beginAgentAuthority({
  ownerAccessToken,
  operationId: crypto.randomUUID(),
  request,
});

// Run startAuthentication({ optionsJSON: challenge.authorizationOptions })
// from the owner's confirmation gesture, then stage the returned credential.
await stageAgentAuthority({ ownerAccessToken, authorization: challenge, credential });

const authority = await readAgentAuthority({ accessToken: openDexterToken });
authority.grantId;
authority.capacity?.remainingPerCallAmountAtomic;
```

`buildBoundedX402BootstrapRequest`, `beginBoundedX402Authority`, and
`stageBoundedX402Authority` provide the x402-only path used by the hosted OAuth
setup screen. `validateBoundedX402Draft` parses custom USDC limits without
floating point. `noCustomX402Limits` records the owner's explicit choice not to
add a custom ceiling.

The older automatic agent-spend controls remain available while existing
wallets migrate:

```ts
import {
  assembleAgentSpendStatus,
  enableAgentSpend,
  revokeAgentSpend,
  createPasskeySigner,
} from '@dexterai/connect';
```

The verbs are framework-free and take `apiOrigin` as a parameter; the SDK
reads no environment variables.

## World ID

```tsx
import { VerifyPersonhood } from '@dexterai/connect/worldid';

<VerifyPersonhood onSuccess={(proof) => sendToYourVerifier(proof)} />
```

`useVerifyPersonhood` is the headless version. Requires the optional
`@worldcoin/idkit` peer.

## Wallet-only sign-in (no account session)

`recoverWallet` re-points a browser at an existing Dexter Wallet. The wallet
IS the sign-in; nothing else is minted. Use it when your surface treats the
wallet as the identity (the dexter.cash header does exactly this):

```ts
import { recoverWallet } from '@dexterai/connect';

const outcome = await recoverWallet({ preferImmediate: true }); // fire on TAP, never on mount
if (outcome.ok) {
  // outcome.vault.swigAddress and outcome.vault.walletLabel; the store and every
  // useIdentity/useDexterWallet surface is already updated.
} else if (outcome.reason === 'no_credential') {
  // this device has no wallet passkey; offer your create flow
} else if (outcome.reason === 'cancelled') {
  // the user dismissed the sheet; stay silent
}
```

It returns a discriminated outcome instead of throwing: user cancel is a
normal result in WebAuthn, not an exception. `preferImmediate` uses Chrome
149+'s immediate UI mode to fast-fail instantly when the device holds no
passkey (no empty account-picker sheet); everywhere else it falls back to the
normal modal. It works from any website. Off dexter.cash, the ceremony runs in
the hosted popup automatically.

React: `<SignInWithDexter mode="recover" preferImmediate onRecovered={…} />`
(after a successful recover the element renders null; show identity with
`DexterWalletChip` over `useIdentity`), or `useSignInWithDexter().recover()`.

## Wallet lifecycle

- `createWallet` mints a brand-new named passkey + vault; `passkeyLogin` signs
  an existing one in; `continueWithDexter` resumes a known wallet;
  `recoverWallet` restores the wallet with no account session.
- The **wallet store** (`getActiveHandle`, `listWallets`, `switchWallet`,
  `ejectActiveWallet`, `forgetWallet`, `subscribeWallet`) is the canonical
  owner of the active-wallet handle. Read and write through it rather than
  touching localStorage.
- The **WebAuthn Signal API** helpers (`renamePasskey`, `prunePasskey`,
  `syncAcceptedPasskeys`, `passkeySignalSupport`) keep the OS keychain in sync
  where the browser supports it.
- `resolveIdentity` combines the wallet handle with whatever account token you
  pass in; `ceremonyPhaseLabel` gives shared copy for connecting-step UI;
  `createAnonServerPolicy` builds the anonymous server policy for the signer.

## Peer dependencies

| Peer | Required | Why |
|---|---|---|
| `react` >=18 | yes | the `/react` and `/worldid` surfaces |
| `@dexterai/vault` ^0.43 | yes | hardened signer envelope validation + agent-spend message builders |
| `@solana/web3.js` | optional | passkey and agent-spend signing paths |
| `@worldcoin/idkit` | optional | only for `/worldid` |

The `/server` entry has none of these peers; it depends only on `jose`.

## License

MIT
