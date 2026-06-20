<p align="center">
  <img src="https://raw.githubusercontent.com/Dexter-DAO/dexter-x402-sdk/main/assets/dexter-wordmark.svg" alt="Dexter" width="360">
</p>

<h1 align="center">@dexterai/connect</h1>

<p align="center">
  <strong>Sign in with Dexter — passkey sign-in for any app. Tap your face, you're in: a non-custodial Dexter Wallet and its live USD balance, in one component.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dexterai/connect"><img src="https://img.shields.io/npm/v/@dexterai/connect.svg" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/react-%3E=18-brightgreen.svg" alt="React"></a>
  <a href="https://www.w3.org/TR/webauthn-2/"><img src="https://img.shields.io/badge/auth-passkey-00FF88" alt="Passkey"></a>
</p>

---

## What this is

A React connector that adds **"Sign in with Dexter"** to any app. One
`<SignInWithDexter/>` button runs a discoverable passkey ceremony — the user
taps their face and you get back a session plus their non-custodial **Dexter
Wallet** (address + live USD balance). No password, no seed phrase, no
extension.

The user holds their own keys. Nothing here is custodial — only the user's
passkey moves funds, enforced on-chain. Composes
[`@dexterai/vault`](https://www.npmjs.com/package/@dexterai/vault); the only
peer is React.

## Install

```bash
npm install @dexterai/connect react
```

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

Signed out, it renders a **Sign in with Dexter** button. On success it becomes
a compact chip — the Dexter Wallet address + **"$X.XX available."**

## Hook (full control)

For your own UI, use the hook directly:

```tsx
import { useSignInWithDexter } from '@dexterai/connect/react';

const c = useSignInWithDexter();
await c.signIn();        // run the passkey ceremony
c.status;                // idle → pending → done → error
c.vaultAddress;          // the Dexter Wallet address (base58)
c.usdcBalance;           // USD available (via Dexter's RPC), or null
c.disconnect();
```

## What `useSignInWithDexter()` gives you

| Field | What it is |
|---|---|
| `signIn()` / `disconnect()` | run the passkey ceremony / clear state |
| `status` / `isVaultConnected` | `idle→pending→done→error` / connected flag |
| `session` | auth session tokens (camelCase) |
| `vaultAddress` / `vaultPda` | the Dexter Wallet address / PDA |
| `usdcBalance` / `refreshBalance()` | USD available, best-effort via Dexter's RPC |
| `vault` / `credentialId` / `error` | raw vault payload / credential id / typed error |

## Exports

- `@dexterai/connect` — framework-free: `passkeyLogin()`, `ConnectError`, types.
- `@dexterai/connect/react` — `<SignInWithDexter/>`, `useSignInWithDexter()`.

## License

MIT
