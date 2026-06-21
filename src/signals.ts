// @dexterai/connect — WebAuthn Signal API wrappers.
//
// Keep the OS keychain / password manager in sync with reality:
//   - rename a passkey AFTER creation (the rename we thought impossible),
//   - auto-remove a deleted/stale passkey so the welded-old-wallet entry
//     disappears from the user's list on its own — no Settings spelunking.
//
// These are NATIVE browser methods that talk directly to the OS credential
// store, so they CANNOT be polyfilled — where a browser doesn't implement them
// (today: likely iOS Safari) every function here no-ops and returns false, and
// naming-at-creation remains the floor. Pure runtime feature-detection: the
// capability lights up per-browser automatically, no UA sniffing, no support
// spreadsheet. All functions are SSR-safe and never throw.

type Signalable = {
  signalCurrentUserDetails?: (o: {
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }) => Promise<void>;
  signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
  signalAllAcceptedCredentials?: (o: {
    rpId: string;
    userId: string;
    allAcceptedCredentialIds: string[];
  }) => Promise<void>;
};

function pkc(): Signalable | null {
  if (typeof window === 'undefined') return null;
  const g = (globalThis as { PublicKeyCredential?: Signalable }).PublicKeyCredential;
  return g ?? null;
}

function defaultRpId(): string {
  return typeof window !== 'undefined' ? window.location.hostname : '';
}

export interface PasskeySignalSupport {
  /** signalCurrentUserDetails — rename a passkey post-creation. */
  rename: boolean;
  /** signalUnknownCredential — remove one stale passkey from the manager. */
  prune: boolean;
  /** signalAllAcceptedCredentials — reconcile the full valid set. */
  syncAccepted: boolean;
}

/**
 * What the CURRENT browser supports, by direct feature-detection. Instant, no
 * network, no UA sniffing — tells you exactly what will light up on THIS device
 * (e.g. call once on Branch's iPhone to learn its Safari's status).
 */
export function passkeySignalSupport(): PasskeySignalSupport {
  const p = pkc();
  return {
    rename: typeof p?.signalCurrentUserDetails === 'function',
    prune: typeof p?.signalUnknownCredential === 'function',
    syncAccepted: typeof p?.signalAllAcceptedCredentials === 'function',
  };
}

/**
 * Rename a passkey in the OS keychain AFTER creation. `userId` is the base64url
 * user handle; `rpId` defaults to the current host. Returns true if the signal
 * fired, false if unsupported/failed (caller treats false as "left as-is").
 */
export async function renamePasskey(args: {
  userId: string;
  name: string;
  displayName?: string;
  rpId?: string;
}): Promise<boolean> {
  const p = pkc();
  if (typeof p?.signalCurrentUserDetails !== 'function') return false;
  try {
    await p.signalCurrentUserDetails({
      rpId: args.rpId ?? defaultRpId(),
      userId: args.userId,
      name: args.name,
      displayName: args.displayName ?? args.name,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tell the OS manager a credential is gone so it removes that passkey from the
 * user's list — the welded-old-wallet auto-cleanup. `credentialId` is base64url.
 * Returns true if fired, false if unsupported/failed.
 */
export async function prunePasskey(args: {
  credentialId: string;
  rpId?: string;
}): Promise<boolean> {
  const p = pkc();
  if (typeof p?.signalUnknownCredential !== 'function') return false;
  try {
    await p.signalUnknownCredential({
      rpId: args.rpId ?? defaultRpId(),
      credentialId: args.credentialId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Declare the FULL set of still-valid credential IDs for a user; the manager
 * prunes anything not listed. Use after sign-in or eject to reconcile in one
 * shot (pass `[]` to clear all of a user's passkeys). Returns true if fired.
 */
export async function syncAcceptedPasskeys(args: {
  userId: string;
  acceptedCredentialIds: string[];
  rpId?: string;
}): Promise<boolean> {
  const p = pkc();
  if (typeof p?.signalAllAcceptedCredentials !== 'function') return false;
  try {
    await p.signalAllAcceptedCredentials({
      rpId: args.rpId ?? defaultRpId(),
      userId: args.userId,
      allAcceptedCredentialIds: args.acceptedCredentialIds,
    });
    return true;
  } catch {
    return false;
  }
}
