<p align="center">
  <img src="https://raw.githubusercontent.com/Dexter-DAO/dexter-x402-sdk/main/assets/dexter-wordmark.svg" alt="Dexter" width="360">
</p>

<h1 align="center">@dexterai/connect</h1>

<p align="center">
  <strong>Sign in with Dexter. One passkey tap gives any website a non-custodial Dexter Wallet, and gives any server an offline-verifiable session.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dexterai/connect"><img src="https://img.shields.io/npm/v/@dexterai/connect.svg" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/react-%3E=18-brightgreen.svg" alt="React"></a>
  <a href="https://www.w3.org/TR/webauthn-2/"><img src="https://img.shields.io/badge/auth-passkey-00FF88" alt="Passkey"></a>
</p>

---

## What this is

A `<SignInWithDexter/>` button runs a discoverable passkey ceremony. The user
taps their face, and your app gets back a session plus their **Dexter
Wallet**: address, live USD balance, and the rails for an agent to spend from
it under on-chain limits. The user holds their own keys; only their passkey
moves funds, enforced on-chain. Composes
[`@dexterai/vault`](https://www.npmjs.com/package/@dexterai/vault).

Four entry points cover the whole flow:

| Entry point | Runs in | What it gives you |
|---|---|---|
| `@dexterai/connect` | browser | framework-free core: `passkeyLogin`, `createWallet`, `continueWithDexter`, the wallet store, agent-spend controls |
| `@dexterai/connect/react` | browser | `<SignInWithDexter/>`, the branded wallet kit, hooks |
| `@dexterai/connect/server` | Node 18+, Workers, Vercel edge | `verifyDexterSession`: offline session verification |
| `@dexterai/connect/worldid` | browser | `<VerifyPersonhood/>` World ID proof-of-personhood button |

## Install

```bash
npm install @dexterai/connect @dexterai/vault react
```

`@solana/web3.js` and `@worldcoin/idkit` are optional peers: the first for
agent-spend signing, the second only if you use the World ID button.

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
posts the result back to your page (origin-checked and nonce-bound on both
sides). The default `transport: 'auto'` picks the right mode; `'popup'` and
`'inline'` force it.

```ts
import { passkeyLogin } from '@dexterai/connect';

const { session, vault } = await passkeyLogin({ transport: 'auto' });
```

## Verify the session on your server

```ts
import { createDexterClient } from '@dexterai/connect/server';

const dexter = createDexterClient(); // parameterized on (iss, jwksUrl); defaults to Dexter's issuer

export async function handler(req: Request) {
  const auth = await dexter.authenticateRequest(req);
  if (!auth.isSignedIn) return new Response('unauthorized', { status: 401 });
  auth.sub;          // stable user id
  auth.vaultAddress; // the Dexter Wallet address, from the signed dexter claim
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

The control surface for letting an agent spend from the connected wallet:

```ts
import {
  assembleAgentSpendStatus, // honest two-mode status read
  enableAgentSpend,         // the on switch
  revokeAgentSpend,         // the off switch
  createPasskeySigner,      // @dexterai/vault guest signer for x402 / tab flows
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

## Wallet lifecycle

- `createWallet` mints a brand-new named passkey + vault; `passkeyLogin` signs
  an existing one in; `continueWithDexter` resumes a known wallet.
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
| `@dexterai/vault` >=0.30 | yes | signer + agent-spend message builders (0.30 matches the deployed program's account layout) |
| `@solana/web3.js` | optional | agent-spend signing paths |
| `@worldcoin/idkit` | optional | only for `/worldid` |

The `/server` entry has none of these peers; it depends only on `jose`.

## License

MIT
