// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true), startAuthentication: vi.fn(), startRegistration: vi.fn(),
}));
vi.mock('./popup', () => ({
  shouldUsePopup: vi.fn((transport?: string) => transport === 'popup'), openCeremonyPopup: vi.fn(),
}));

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { enrollAccountIdentity, signInAccountIdentity } from './accountIdentity';
import { openCeremonyPopup } from './popup';
import { bytesToBase64, bytesToBase64url } from './base64';
import { ConnectError } from './types';

const userHandle = bytesToBase64url(new Uint8Array(16).fill(1));
const otherHandle = bytesToBase64url(new Uint8Array(16).fill(2));
const credentialId = bytesToBase64url(new Uint8Array(32).fill(3));
const challenge = bytesToBase64url(new Uint8Array(32).fill(4));
const result = {
  profile: 'account-identity-v1',
  session: { accessToken: 'signed-identity-session', expiresAt: 2_000_000_000, expiresIn: 2_592_000, tokenType: 'Bearer' },
  credential: { userHandle, credentialId, publicKey: bytesToBase64(new Uint8Array([2, ...new Uint8Array(32).fill(5)])) },
};
const authentication = {
  id: credentialId, rawId: credentialId, type: 'public-key' as const, clientExtensionResults: {},
  response: { clientDataJSON: 'YQ', authenticatorData: 'Yg', signature: 'Yw', userHandle },
};
const registration = {
  id: credentialId, rawId: credentialId, type: 'public-key' as const, clientExtensionResults: {},
  response: { clientDataJSON: 'YQ', attestationObject: 'Yg' },
};
const loginChallenge = { options: { challenge, rpId: 'dexter.cash', userVerification: 'required' } };
const enrollChallenge = { options: {
  challenge, rp: { id: 'dexter.cash', name: 'Dexter' },
  user: { id: userHandle, name: 'generated', displayName: 'generated' },
  authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
} };

function response(value: unknown): Response { return new Response(JSON.stringify(value)); }
function setupFetch(options: unknown, complete: unknown = result) {
  const fetchMock = vi.fn().mockResolvedValueOnce(response(options)).mockResolvedValueOnce(response(complete));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://dexter.cash/connect');
  vi.mocked(startAuthentication).mockResolvedValue(authentication);
  vi.mocked(startRegistration).mockResolvedValue(registration);
  vi.mocked(openCeremonyPopup).mockResolvedValue(result);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('new Account credential identity', () => {
  it('signs in without Vault fields or writes to a wallet/session store', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const fetchMock = setupFetch(loginChallenge);
    const phases = vi.fn();
    const actual = await signInAccountIdentity({ onPhase: phases });
    expect(actual).toEqual(result);
    expect(Object.isFrozen(actual.session)).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.dexter.cash/api/connect/account-identity/login-challenge',
      'https://api.dexter.cash/api/connect/account-identity/login',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ credential: authentication });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(phases.mock.calls.flat()).toEqual(['challenge', 'passkey', 'verifying']);
    expect(writes).not.toHaveBeenCalled();
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('enrolls the server-assigned identity with one credential ceremony and no wallet initialization', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const fetchMock = setupFetch(enrollChallenge);
    expect(await enrollAccountIdentity({ name: '  Branch  ' })).toEqual(result);
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: {
      ...enrollChallenge.options,
      user: { id: userHandle, name: 'Branch', displayName: 'Branch' },
    } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.dexter.cash/api/connect/account-identity/enroll-challenge',
      'https://api.dexter.cash/api/connect/account-identity/enroll',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ credential: registration });
    expect(writes).not.toHaveBeenCalled();
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it.each(['signin', 'enroll'])('uses the distinct hosted %s operation', async operation => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const actual = operation === 'signin'
      ? await signInAccountIdentity({ transport: 'popup', targetUserHandle: userHandle })
      : await enrollAccountIdentity({ transport: 'popup', name: 'Branch' });
    expect(actual).toEqual(result);
    expect(openCeremonyPopup).toHaveBeenCalledWith(
      operation === 'signin' ? 'account-signin' : 'account-enroll',
      expect.objectContaining(operation === 'signin' ? { targetUserHandle: userHandle } : { name: 'Branch' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a legacy or malformed popup result', async () => {
    vi.mocked(openCeremonyPopup).mockResolvedValue({ session: result.session, vault: {} });
    await expect(signInAccountIdentity({ transport: 'popup' })).rejects.toMatchObject({ code: 'account_identity_result_malformed' });
  });

  it('checks the selected identity for both popup and inline results', async () => {
    await expect(signInAccountIdentity({ transport: 'popup', targetUserHandle: otherHandle })).rejects.toMatchObject({ code: 'target_account_mismatch' });
    setupFetch(loginChallenge);
    await expect(signInAccountIdentity({ targetUserHandle: otherHandle })).rejects.toMatchObject({ code: 'target_account_mismatch' });
  });

  it.each(['signin', 'enroll'])('rejects a returned credential different from the %s ceremony', async operation => {
    setupFetch(operation === 'signin' ? loginChallenge : enrollChallenge, {
      ...result, credential: { ...result.credential, credentialId: bytesToBase64url(new Uint8Array(32).fill(6)) },
    });
    await expect(operation === 'signin' ? signInAccountIdentity() : enrollAccountIdentity())
      .rejects.toMatchObject({ code: operation === 'signin'
        ? 'account_identity_credential_mismatch' : 'account_identity_request_uncertain' });
  });

  it('rejects enrollment under a handle different from the registration challenge', async () => {
    setupFetch(enrollChallenge, { ...result, credential: { ...result.credential, userHandle: otherHandle } });
    await expect(enrollAccountIdentity()).rejects.toMatchObject({ code: 'account_identity_request_uncertain' });
  });

  it.each([
    { ...loginChallenge.options, rpId: 'other.example' },
    { ...loginChallenge.options, userVerification: 'preferred' },
    { ...loginChallenge.options, challenge: 'YQ' },
  ])('rejects invalid login options before prompting', async options => {
    setupFetch({ options });
    await expect(signInAccountIdentity()).rejects.toMatchObject({ code: 'account_identity_challenge_malformed' });
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('requires resident P256 enrollment with user verification', async () => {
    setupFetch({ options: { ...enrollChallenge.options, authenticatorSelection: { userVerification: 'preferred' } } });
    await expect(enrollAccountIdentity()).rejects.toMatchObject({ code: 'account_identity_challenge_malformed' });
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('rejects malformed session and credential encodings', async () => {
    for (const complete of [
      { ...result, session: { ...result.session, tokenType: 'bearer' } },
      { ...result, session: { ...result.session, expiresAt: 0 } },
      { ...result, credential: { ...result.credential, userHandle: `${userHandle}==` } },
      { ...result, credential: { ...result.credential, publicKey: 'AA==' } },
    ]) {
      vi.mocked(openCeremonyPopup).mockResolvedValue(complete);
      await expect(signInAccountIdentity({ transport: 'popup' })).rejects.toMatchObject({ code: 'account_identity_result_malformed' });
    }
  });

  it('pins API, hosted origin and selected identity before network or credential work', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(signInAccountIdentity({ apiBase: 'https://other.example' })).rejects.toMatchObject({ code: 'untrusted_api_base' });
    await expect(enrollAccountIdentity({ connectHost: 'https://other.example' })).rejects.toMatchObject({ code: 'untrusted_connect_host' });
    await expect(signInAccountIdentity({ targetUserHandle: 'invalid' })).rejects.toMatchObject({ code: 'invalid_target_account' });
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://merchant.example');
    await expect(signInAccountIdentity({ transport: 'inline' })).rejects.toMatchObject({ code: 'hosted_ceremony_origin_required' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it('returns cancellation without submitting and permits a later explicit attempt', async () => {
    const fetchMock = setupFetch(loginChallenge);
    vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'));
    await expect(signInAccountIdentity()).rejects.toMatchObject({ code: 'user_cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setupFetch(loginChallenge);
    expect(await signInAccountIdentity()).toEqual(result);
  });

  it('retains an uncertain enrollment outcome without repeating the submission or creation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(enrollChallenge)).mockRejectedValueOnce(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(enrollAccountIdentity()).rejects.toMatchObject({ code: 'account_identity_request_uncertain' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(startRegistration).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', () => new Response('{', { status: 201 })],
    ['missing session', () => response({ profile: result.profile, credential: result.credential })],
    ['malformed credential', () => response({ ...result, credential: { ...result.credential, publicKey: 'AA==' } })],
    ['wrong binding', () => response({ ...result, credential: { ...result.credential, userHandle: otherHandle } })],
    ['server failure', () => new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 })],
    ['unreadable server failure', () => new Response('Bad Gateway', { status: 502 })],
  ])('preserves enrollment uncertainty after a %s response without another creation', async (_label, reply) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(enrollChallenge)).mockResolvedValueOnce(reply());
    vi.stubGlobal('fetch', fetchMock);
    await expect(enrollAccountIdentity()).rejects.toMatchObject({ code: 'account_identity_request_uncertain' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(startRegistration).toHaveBeenCalledTimes(1);
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'account_identity_verification_failed'],
    [409, 'challenge_unavailable'],
    [409, 'credential_changed'],
    [409, 'credential_exists'],
  ])('preserves the definite %s / %s response for the host recovery choice', async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(enrollChallenge))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: code }), { status }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(enrollAccountIdentity()).rejects.toMatchObject({ code });
    expect(startRegistration).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats an unknown enrollment response as uncertain instead of assuming a failed creation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(enrollChallenge))
      .mockResolvedValueOnce(new Response('unreadable', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(enrollAccountIdentity()).rejects.toMatchObject({ code: 'account_identity_request_uncertain' });
  });

  it('preserves uncertainty when the hosted result is unreadable or its window is lost', async () => {
    vi.mocked(openCeremonyPopup).mockResolvedValueOnce({ profile: result.profile });
    await expect(enrollAccountIdentity({ transport: 'popup' })).rejects.toMatchObject({ code: 'account_identity_request_uncertain' });
    for (const code of ['popup_closed', 'popup_timeout', 'popup_handshake_failed']) {
      vi.mocked(openCeremonyPopup).mockRejectedValueOnce(new ConnectError(code));
      await expect(enrollAccountIdentity({ transport: 'popup' })).rejects.toMatchObject({ code: 'account_identity_request_uncertain' });
    }
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('keeps a blocked popup and known existing credential distinct from uncertainty', async () => {
    for (const code of ['popup_blocked', 'credential_exists']) {
      vi.mocked(openCeremonyPopup).mockRejectedValueOnce(new ConnectError(code));
      await expect(enrollAccountIdentity({ transport: 'popup' })).rejects.toMatchObject({ code });
    }
  });

  it('snapshots the requested identity and rejects overlapping ceremonies', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(openCeremonyPopup).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const config = { transport: 'popup' as const, targetUserHandle: userHandle };
    const pending = signInAccountIdentity(config);
    config.targetUserHandle = otherHandle;
    await expect(enrollAccountIdentity()).rejects.toMatchObject({ code: 'account_identity_ceremony_in_progress' });
    finish(result);
    expect(await pending).toEqual(result);
  });
});
