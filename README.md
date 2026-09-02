<p align="center">
  <img src="https://raw.githubusercontent.com/Dexter-DAO/dexter-x402-sdk/main/assets/dexter-wordmark.svg" alt="Dexter" width="360">
</p>

<h1 align="center">@dexterai/connect</h1>

<p align="center">
  <strong>Add Dexter identity, Wallet access, or governed agent authority to a web app.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dexterai/connect"><img src="https://img.shields.io/npm/v/@dexterai/connect.svg" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/react-%3E=18-brightgreen.svg" alt="React"></a>
  <a href="https://www.w3.org/TR/webauthn-2/"><img src="https://img.shields.io/badge/auth-passkey-00FF88" alt="Passkey"></a>
</p>

## One Dexter identity

Each signed-in person has one active Dexter identity and one canonical Dexter
Wallet. A full connection returns the Wallet and account session from the same
passkey ceremony. Connect asks the Dexter API to verify that exact pair before
the app receives account-owned data or actions.

The browser may remember earlier Wallet passkeys for recovery. That roster stays
inside Connect. The product action is **Use another Dexter Wallet**, which runs a
fresh passkey ceremony and replaces the active identity only after verification.

Agent authority always requires a separate owner grant. Creating or connecting a
Wallet grants no agent spending authority.

## Install

```bash
npm install @dexterai/connect @dexterai/vault react
```

`@solana/web3.js` is optional and supports signing paths.
`@worldcoin/idkit` is optional and supports the World ID entry point.

## Entry points

| Import | Purpose |
|---|---|
| `@dexterai/connect` | Passkey ceremonies, hosted signing, lifecycle operations, and agent authority |
| `@dexterai/connect/react` | The canonical React control, hooks, and Dexter UI primitives |
| `@dexterai/connect/server` | Local verification of Dexter account sessions |
| `@dexterai/connect/worldid` | Optional World ID proof-of-personhood control |

## Canonical React integration

`useDexterConnection` is the controlled integration for a product header,
account menu, or connection screen. The host owns its account-session storage.
Connect owns the Wallet ceremony, pair verification, and display permissions.

```tsx
import { useDexterConnection } from '@dexterai/connect/react';

function DexterControl({ loading, session }: Props) {
  const dexter = useDexterConnection({
    intent: 'wallet',
    accountSession: loading
      ? { status: 'loading' }
      : session
        ? {
            status: 'authenticated',
            accessToken: session.access_token,
          }
        : { status: 'signed_out' },
    installAccountSession: async (next) => {
      await auth.setSession({
        access_token: next.accessToken,
        refresh_token: next.refreshToken,
      });
    },
    clearAccountSession: async () => {
      await auth.signOut();
    },
  });

  if (dexter.model.stage === 'checking') return <Spinner />;
  if (dexter.model.stage === 'connect') {
    return <button onClick={() => void dexter.connect()}>Connect Dexter</button>;
  }
  if (dexter.model.stage === 'repair') {
    return <button onClick={() => void dexter.connect()}>Reconnect Dexter</button>;
  }
  if (dexter.model.stage === 'offline' || dexter.model.stage === 'error') {
    return <button onClick={() => void dexter.retry()}>Try again</button>;
  }

  return <WalletMenu dexter={dexter} />;
}
```

The host callbacks are part of the identity transition:

- `installAccountSession` receives the session from the verified ceremony. The
  callback should resolve only after the host store publishes that exact access
  token.
- `clearAccountSession` removes that host session during **Disconnect Dexter**.
- `accountSession` maps the host store back into `loading`, `signed_out`, or
  `authenticated` with an access token.

If account installation fails, Connect restores the previous active Wallet. The
new identity stays hidden until the host session is installed.

## Integration intents

Choose one intent for each control.

| Intent | Capabilities requested | Ready state |
|---|---|---|
| `identity` | `identity` | Exact Wallet/account pair is bound |
| `wallet` | `identity`, `wallet.read`, `wallet.use` | Owner Wallet is present; account content still requires `bound` |
| `agent` | `identity`, `wallet.read`, `agent.authority` | Exact pair is bound; authority is granted in a separate owner flow |

`wallet.use` means the owner can use their own Wallet in the current app.
`agent.authority` means the app may offer a governed grant for an agent. The two
permissions are separate.

## Stage and permission model

Render from `dexter.model`, rather than inferring connection from a cached Wallet
or account token.

| Stage | Product response |
|---|---|
| `connect` | Offer the configured Dexter connection action |
| `checking` | Keep private content closed while the exact pair is verified |
| `ready` | Render only the fields enabled in `model.permissions` |
| `repair` | Offer the fresh passkey reconnect path |
| `offline` | Keep private Wallet and account content closed; offer retry |
| `error` | Show a concise error and offer retry |

The permission fields are:

| Field | Meaning |
|---|---|
| `walletIdentityVisible` | The active Wallet identity may be shown |
| `walletDataVisible` | Wallet balances and related data may be shown |
| `ownerWalletUseEnabled` | The owner may use this Wallet in the current app |
| `accountContentVisible` | The API verified `bound`; account-owned content may be shown |
| `agentAuthorityVisible` | A bound `agent` integration may present agent-authority controls |

Only `bound` unlocks account profile, roles, credit, servers, or other
account-owned content. A conflict enters the repair stage with private account
access closed.

## Lifecycle actions

The canonical control presents three identity actions:

| Action | Effect |
|---|---|
| **Use another Dexter Wallet** | Runs a fresh ceremony and keeps the replacement hidden until the API verifies the pair and the host installs the matching account session |
| **Disconnect Dexter** | Clears the host account session and active Wallet; the passkey remains on the device for a later sign-in |
| **Remove from this device** | Requires explicit confirmation, removes the local Wallet record, and asks the browser to remove its passkey |

Connect keeps the browser Wallet roster, raw switching methods, and partial
Wallet/account disconnects inside its recovery plumbing.

## Framework-neutral transition

Apps without React can use the same full transition directly:

```ts
import {
  connectDexterIdentity,
  disconnectDexterIdentity,
} from '@dexterai/connect';

const result = await connectDexterIdentity({
  transport: 'auto',
  installAccountSession: (session) => auth.setSession(session),
});

await disconnectDexterIdentity({
  clearAccountSession: () => auth.signOut(),
});
```

`connectDexterIdentity` keeps the passkey result provisional, verifies its exact
Wallet/account relation, then publishes the Wallet and asks the host to install
the matching account session.

## Hosted ceremonies

On another HTTPS origin, Connect opens the ceremony on `dexter.cash/connect` and
returns the result to the calling app. The browser handshake binds the popup,
hosted origin, caller origin, nonce, and requested operation. The hosted window
also handles consent for Wallet signing.

WebAuthn challenge and verification calls use `https://api.dexter.cash`. The
default `transport: 'auto'` selects inline or popup transport. Integrators can
force `popup` or `inline` when their environment requires it.

The first-party page uses the guarded hosted entry instead of importing raw
login or Wallet-store functions:

```ts
import { runHostedCeremony } from '@dexterai/connect/hosted';

const result = await runHostedCeremony({
  operation: 'continue',
  walletStore: 'provisional',
});
```

This entry runs only on `https://dexter.cash`. It pins the inline transport and
Dexter API while preserving provisional Wallet results for the opener. The root
package continues to expose the complete identity transition rather than its
private login and browser-roster steps.

### Repair a missing Vault record

Use this only after the API reports `vault_not_found` for an existing account.
The account holder must sign in to that same account again before starting the
repair.

```ts
import { recoverMissingVaultForAccount } from '@dexterai/connect';

const result = await recoverMissingVaultForAccount({
  accountAccessToken: session.access_token,
});

result.account.handle; // the X account confirmed by the API
result.vault.vaultPda;  // the Vault attached to that account
```

The passkey prompt runs in the pinned `dexter.cash` window. The account token
stays in the calling app. A successful repair attaches the missing Vault to the
account already signed in; it does not create an account, mint a new session, or
change the browser's active Wallet.

## Server verification

```ts
import { createDexterClient } from '@dexterai/connect/server';

const dexter = createDexterClient();

export async function handler(req: Request) {
  const auth = await dexter.authenticateRequest(req);
  if (!auth.isSignedIn) return new Response('unauthorized', { status: 401 });
  if (!auth.userHandle) {
    return new Response('wallet identity required', { status: 403 });
  }

  auth.userHandle;   // stable Dexter Wallet principal
  auth.vaultAddress; // Wallet capability
  auth.sub;          // account subject
  auth.claims;       // verified JWT payload
}
```

The server entry verifies ES256 signatures against Dexter's JWKS and checks the
issuer and audience. `verifyDexterSession` verifies a token directly.

## Wallet creation and recovery

`createWallet` creates an owner Wallet and passkey. Agent authority remains a
later, explicit owner action. `recoverWallet` runs a fresh Wallet ceremony for a
device that already holds a Dexter passkey. Product integrations should route
full account connection through `useDexterConnection` or
`connectDexterIdentity`, so the account and Wallet are verified together.

## Agent authority

Agent integrations build, present, and stage a separate owner grant. The grant
can include x402 payment rules or other governed actions. It is bound to the
selected Wallet and remains revocable.

Key helpers include `buildAgentAuthorityRequest`, `beginAgentAuthority`,
`stageAgentAuthority`, and `readAgentAuthority`. The bounded x402 helpers provide
the equivalent hosted setup path for x402-only grants.

## World ID

```tsx
import { VerifyPersonhood } from '@dexterai/connect/worldid';

<VerifyPersonhood onSuccess={(proof) => sendToYourVerifier(proof)} />
```

`useVerifyPersonhood` is the headless form. This entry requires the optional
`@worldcoin/idkit` peer.

## Peer dependencies

| Peer | Required | Purpose |
|---|---|---|
| `react` >=18 | yes | React and World ID entry points |
| `@dexterai/vault` ^0.43 | yes | Wallet signer and governed authority messages |
| `@solana/web3.js` | optional | Passkey and agent signing paths |
| `@worldcoin/idkit` | optional | World ID controls |

The server entry depends only on `jose`.

## License

MIT
