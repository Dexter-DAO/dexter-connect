import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { createWallet } from './enroll';
import { setActiveWallet } from './walletStore';

vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn(), startAuthentication: vi.fn() }));
vi.mock('./popup', () => ({ shouldUsePopup: () => false, openCeremonyPopup: vi.fn() }));
vi.mock('./walletStore', () => ({ setActiveWallet: vi.fn(() => true) }));
vi.mock('./walletProofSession', () => ({ walletProofSessionStore: { save: () => ({}), clear: vi.fn() } }));

const credential = { id: 'original-credential', rawId: 'original-credential', type: 'public-key',
  response: { attestationObject: 'AA', clientDataJSON: 'AA' }, clientExtensionResults: {} };
const proof = { token: 'signed-proof', tokenType: 'Bearer', expiresAt: 2_000_000_000, expiresIn: 2_592_000 };
const enrolled = { credentialId: credential.id, userHandle: 'original-handle', publicKey: 'original-key', walletIdentityProof: proof };
const initialized = { vaultPda: 'original-vault', swigStateAddress: 'original-swig', receiveAddress: 'original-receive' };
const ok = (value: unknown) => ({ ok: true, json: async () => value });
const failed = (error: string) => ({ ok: false, status: 500, json: async () => ({ error }) });
let values: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  vi.stubGlobal('navigator', { credentials: {} });
  vi.mocked(startRegistration).mockResolvedValue(credential as never);
  vi.mocked(startAuthentication).mockResolvedValue({ ...credential, response: {} } as never);
  fetchMock = vi.fn().mockResolvedValueOnce(ok({ options: { challenge: 'fresh', rp: { id: 'dexter.cash' }, user: { id: 'original-handle' } } }))
    .mockResolvedValueOnce(ok(enrolled)).mockResolvedValueOnce(failed('initialize_failed'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function resumeResponses(verified = { ...enrolled, verified: true }) {
  fetchMock.mockResolvedValueOnce(ok({ options: { challenge: 'recovery', rpId: 'dexter.cash' } }))
    .mockResolvedValueOnce(ok(verified)).mockResolvedValueOnce(ok(initialized));
}

describe('interrupted Wallet creation', () => {
  it('retries the original credential and preserves the name and allowance without creating a second passkey', async () => {
    await expect(createWallet({ transport: 'inline', name: 'Original', spendPolicy: { spendLimitAtomic: '5000000', sessionTtlSeconds: '2592000' } })).rejects.toMatchObject({ code: 'initialize_failed' });
    expect(setActiveWallet).not.toHaveBeenCalled();
    resumeResponses();
    const result = await createWallet({ transport: 'inline', name: 'Different' });
    expect(result.handle).toBe('original-handle');
    expect(startRegistration).toHaveBeenCalledOnce();
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: expect.objectContaining({ allowCredentials: [{ id: credential.id, type: 'public-key' }] }) });
    const initializeCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/initialize'));
    expect(initializeCalls).toHaveLength(2);
    expect(JSON.parse(initializeCalls[1][1].body)).toMatchObject({ userHandle: 'original-handle', credentialId: credential.id, label: 'Original', spendLimitAtomic: '5000000' });
    expect(values.size).toBe(0);
  });

  it('resumes after a module reload using the retained checkpoint', async () => {
    await expect(createWallet({ transport: 'inline', name: 'Original' })).rejects.toMatchObject({ code: 'initialize_failed' });
    vi.resetModules();
    const reloaded = await import('./enroll');
    resumeResponses();
    const result = await reloaded.createWallet({ transport: 'inline' });
    expect(result.vault.walletLabel).toBe('Original');
    expect(startRegistration).toHaveBeenCalledOnce();
    expect(values.size).toBe(0);
  });

  it('keeps the checkpoint and rejects a recovery response for another handle', async () => {
    await expect(createWallet({ transport: 'inline' })).rejects.toMatchObject({ code: 'initialize_failed' });
    resumeResponses({ ...enrolled, verified: true, userHandle: 'another-handle' });
    await expect(createWallet({ transport: 'inline' })).rejects.toMatchObject({ code: 'creation_credential_mismatch' });
    expect(startRegistration).toHaveBeenCalledOnce();
    expect(setActiveWallet).not.toHaveBeenCalled();
    expect(values.size).toBe(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/initialize'))).toHaveLength(1);
  });

  it('recovers an enrollment completion response lost after the server saved the credential', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(ok({ options: { challenge: 'fresh', rp: { id: 'dexter.cash' }, user: { id: 'original-handle' } } }))
      .mockRejectedValueOnce(new TypeError('network interrupted'));
    await expect(createWallet({ transport: 'inline' })).rejects.toThrow('network interrupted');
    fetchMock.mockResolvedValueOnce(failed('challenge_replayed'));
    resumeResponses();
    expect((await createWallet({ transport: 'inline' })).handle).toBe('original-handle');
    expect(startRegistration).toHaveBeenCalledOnce();
    expect(values.size).toBe(0);
  });

  it('keeps provisional recovery out of the active Wallet roster', async () => {
    await expect(createWallet({ transport: 'inline', walletStore: 'provisional' })).rejects.toMatchObject({ code: 'initialize_failed' });
    resumeResponses();
    await createWallet({ transport: 'inline', walletStore: 'provisional' });
    expect(setActiveWallet).not.toHaveBeenCalled();
    expect(startRegistration).toHaveBeenCalledOnce();
  });
});
