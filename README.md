# @dexterai/connect

**Sign in with Dexter** — a passkey connector. Tap your face, you're in.

Composes [`@dexterai/vault`](https://www.npmjs.com/package/@dexterai/vault). Two entry points:

- `@dexterai/connect` — framework-free relay client + types
- `@dexterai/connect/react` — `<SignInWithDexter/>` + `useSignInWithDexter()`

Dependencies: `@dexterai/vault` + `react` (peer) **only**. No payment-layer peers — a
sign-in button must not inherit a payment graph.

## Status

Scaffolding — Milestone 1. Build plan + frozen contracts:
`dexter-fe/docs/superpowers/plans/2026-06-20-signin-with-dexter-connect.md`.
