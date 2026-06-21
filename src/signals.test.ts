import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  passkeySignalSupport,
  renamePasskey,
  prunePasskey,
  syncAcceptedPasskeys,
} from './signals';

function installPKC(methods: Record<string, any>) {
  (globalThis as any).window = { location: { hostname: 'dexter.cash' } };
  (globalThis as any).PublicKeyCredential = methods;
}

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).PublicKeyCredential;
  vi.restoreAllMocks();
});

describe('signals — feature detection', () => {
  it('reports all false when PublicKeyCredential is absent (SSR / unsupported)', () => {
    delete (globalThis as any).window;
    delete (globalThis as any).PublicKeyCredential;
    expect(passkeySignalSupport()).toEqual({ rename: false, prune: false, syncAccepted: false });
  });

  it('reports support per method that exists', () => {
    installPKC({ signalCurrentUserDetails: vi.fn(), signalUnknownCredential: vi.fn() });
    expect(passkeySignalSupport()).toEqual({ rename: true, prune: true, syncAccepted: false });
  });
});

describe('signals — calls', () => {
  beforeEach(() => {
    installPKC({
      signalCurrentUserDetails: vi.fn().mockResolvedValue(undefined),
      signalUnknownCredential: vi.fn().mockResolvedValue(undefined),
      signalAllAcceptedCredentials: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('renamePasskey fires signalCurrentUserDetails with defaulted rpId + displayName', async () => {
    const ok = await renamePasskey({ userId: 'U', name: 'Dexter Wallet' });
    expect(ok).toBe(true);
    expect((globalThis as any).PublicKeyCredential.signalCurrentUserDetails).toHaveBeenCalledWith({
      rpId: 'dexter.cash',
      userId: 'U',
      name: 'Dexter Wallet',
      displayName: 'Dexter Wallet',
    });
  });

  it('prunePasskey fires signalUnknownCredential', async () => {
    const ok = await prunePasskey({ credentialId: 'CID' });
    expect(ok).toBe(true);
    expect((globalThis as any).PublicKeyCredential.signalUnknownCredential).toHaveBeenCalledWith({
      rpId: 'dexter.cash',
      credentialId: 'CID',
    });
  });

  it('syncAcceptedPasskeys fires signalAllAcceptedCredentials (empty clears all)', async () => {
    const ok = await syncAcceptedPasskeys({ userId: 'U', acceptedCredentialIds: [] });
    expect(ok).toBe(true);
    expect((globalThis as any).PublicKeyCredential.signalAllAcceptedCredentials).toHaveBeenCalledWith({
      rpId: 'dexter.cash',
      userId: 'U',
      allAcceptedCredentialIds: [],
    });
  });
});

describe('signals — graceful when unsupported / throwing', () => {
  it('returns false (no throw) when the method is absent', async () => {
    installPKC({}); // no signal methods
    expect(await renamePasskey({ userId: 'U', name: 'x' })).toBe(false);
    expect(await prunePasskey({ credentialId: 'C' })).toBe(false);
    expect(await syncAcceptedPasskeys({ userId: 'U', acceptedCredentialIds: [] })).toBe(false);
  });

  it('returns false (no throw) when the native call rejects', async () => {
    installPKC({ signalUnknownCredential: vi.fn().mockRejectedValue(new Error('nope')) });
    expect(await prunePasskey({ credentialId: 'C' })).toBe(false);
  });
});
