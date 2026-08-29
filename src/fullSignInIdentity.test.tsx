// @vitest-environment happy-dom

import { act, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

import { startAuthentication } from '@simplewebauthn/browser';
import {
  REMOVE_DEXTER_FROM_DEVICE_CONFIRMATION,
  useDexterConnection,
  type UseDexterConnection,
} from './useDexterConnection';
import type { DexterAccountSession } from './useDexterIdentity';
import { bytesToBase64url } from './base64';
import { flush, render } from './testRender';
import { getActiveWallet, listWallets, setActiveWallet } from './walletStore';
import { walletProofSessionStore } from './walletProofSession';

const HANDLE_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const HANDLE_B = 'AQEBAQEBAQEBAQEBAQEBAQ';
const VAULT_A = '11111111111111111111111111111111';
const VAULT_B = 'So11111111111111111111111111111111111111112';
const ACCOUNT_A_SUBJECT = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B_SUBJECT = '22222222-2222-4222-8222-222222222222';

function jwt(subject: string, tokenId: string): string {
  const encode = (value: unknown) =>
    bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: subject, jti: tokenId }),
    encode(`signature-${tokenId}`),
  ].join('.');
}

const ACCOUNT_A = jwt(ACCOUNT_A_SUBJECT, 'a');
const ACCOUNT_B = jwt(ACCOUNT_B_SUBJECT, 'b');

const walletB = {
  vaultPda: VAULT_B,
  swigAddress: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
  receiveAddress: null,
  usdcAta: null,
  publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  userHandle: HANDLE_B,
  credentialId: 'credential-b',
  walletLabel: 'Second Wallet',
};

const proofA = {
  token: 'proof-a',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};

const proofB = {
  token: 'proof-b',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

interface Observation {
  readonly stage: UseDexterConnection['model']['stage'];
  readonly relation: UseDexterConnection['relation']['relation'];
  readonly accountAccess: boolean;
  readonly userHandle: string | null;
  readonly activeWalletHandle: string | null;
}

const mockStartAuthentication = vi.mocked(startAuthentication);

beforeEach(() => {
  window.localStorage.clear();
  setActiveWallet({
    handle: HANDLE_A,
    credentialId: 'credential-a',
    vaultPda: VAULT_A,
  });
  walletProofSessionStore.save(HANDLE_A, proofA);
  (window as unknown as { happyDOM?: { setURL?: (url: string) => void } })
    .happyDOM?.setURL?.('https://dexter.cash/wallet');
  mockStartAuthentication.mockResolvedValue({
    id: 'credential-b',
    rawId: 'credential-b',
    response: {},
    clientExtensionResults: {},
    type: 'public-key',
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function createFetch(bindingRelation: 'bound' | 'conflict' = 'bound') {
  return vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/login-challenge')) {
      return jsonResponse(200, { options: { challenge: 'challenge' } });
    }
    if (url.endsWith('/passkey-login')) {
      return jsonResponse(200, {
        accessToken: ACCOUNT_B,
        refreshToken: 'refresh-b',
        expiresAt: 2_000_000_000,
        expiresIn: 3_600,
        tokenType: 'bearer',
        vault: walletB,
        walletIdentityProof: proofB,
      });
    }
    if (url.endsWith('/api/passkey-anon/binding/resolve')) {
      return jsonResponse(200, { relation: bindingRelation });
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

describe('canonical full Dexter identity transition', () => {
  it('moves A/A to B/B without exposing a mixed identity', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    const observations: Observation[] = [];
    let connection!: UseDexterConnection;

    function Harness() {
      const [accountSession, setAccountSession] =
        useState<DexterAccountSession>({
          status: 'authenticated',
          accessToken: ACCOUNT_A,
        });
      const installAccountSession = useCallback(
        async (session: { accessToken: string }) => {
          setAccountSession({
            status: 'authenticated',
            accessToken: session.accessToken,
          });
        },
        [],
      );
      const clearAccountSession = useCallback(async () => {
        setAccountSession({ status: 'signed_out' });
      }, []);
      connection = useDexterConnection({
        intent: 'wallet',
        accountSession,
        installAccountSession,
        clearAccountSession,
        fetch: fetchMock,
        passkey: { transport: 'inline' },
      });
      observations.push({
        stage: connection.model.stage,
        relation: connection.relation.relation,
        accountAccess: connection.identity.hasAccountAccess,
        userHandle: connection.identity.userHandle,
        activeWalletHandle: connection.activeWallet?.userHandle ?? null,
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();
    expect(connection.relation.relation).toBe('bound');
    observations.length = 0;

    await act(async () => {
      await connection.useAnotherDexterWallet();
    });
    await flush();

    expect(getActiveWallet()?.handle).toBe(HANDLE_B);
    expect(connection.relation.relation).toBe('bound');
    expect(connection.identity).toMatchObject({
      userHandle: HANDLE_B,
      hasAccountAccess: true,
    });
    expect(
      observations.some(
        (entry) =>
          entry.relation === 'wallet_only' ||
          entry.relation === 'account_only',
      ),
    ).toBe(false);
    expect(
      observations.every(
        (entry) =>
          entry.stage !== 'checking' ||
          (!entry.accountAccess &&
            entry.userHandle === null &&
            entry.activeWalletHandle === null),
      ),
    ).toBe(true);

    const bindingCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith('/api/passkey-anon/binding/resolve'),
    );
    expect(bindingCalls).toHaveLength(3);
    expect(bindingCalls[1]?.[1]).toMatchObject({
      headers: {
        Authorization: `Bearer ${ACCOUNT_B}`,
        'X-Dexter-Wallet-Proof': 'proof-b',
      },
      body: JSON.stringify({
        activeWallet: { userHandle: HANDLE_B, vaultPda: VAULT_B },
      }),
    });
    await view.unmount();
  });

  it('keeps A/A bound when the host rejects the new account session', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    let connection!: UseDexterConnection;

    function Harness() {
      const accountSession: DexterAccountSession = {
        status: 'authenticated',
        accessToken: ACCOUNT_A,
      };
      connection = useDexterConnection({
        intent: 'identity',
        accountSession,
        installAccountSession: async () => {
          throw new Error('host rejected session');
        },
        clearAccountSession: async () => undefined,
        fetch: fetchMock,
        passkey: { transport: 'inline' },
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();
    expect(connection.relation.relation).toBe('bound');

    await act(async () => {
      await expect(connection.useAnotherDexterWallet()).rejects.toMatchObject({
        code: 'account_session_install_failed',
      });
    });
    await flush();

    expect(getActiveWallet()?.handle).toBe(HANDLE_A);
    expect(connection.relation).toMatchObject({
      relation: 'bound',
      privateAccountAccess: false,
    });
    expect(connection.model.stage).toBe('error');
    expect(connection.identity.hasAccountAccess).toBe(false);
    expect(connection.activeWallet).toBeNull();
    await view.unmount();
  });

  it('unlocks the control when the post-install binding check fails', async () => {
    let bindingCalls = 0;
    const normalFetch = createFetch();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/passkey-anon/binding/resolve')) {
        bindingCalls += 1;
        if (bindingCalls === 3) {
          return jsonResponse(503, { error: 'temporarily_unavailable' });
        }
      }
      return normalFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    let connection!: UseDexterConnection;

    function Harness() {
      const [accountSession, setAccountSession] =
        useState<DexterAccountSession>({
          status: 'authenticated',
          accessToken: ACCOUNT_A,
        });
      connection = useDexterConnection({
        intent: 'identity',
        accountSession,
        installAccountSession: async (session) => {
          setAccountSession({
            status: 'authenticated',
            accessToken: session.accessToken,
          });
        },
        clearAccountSession: async () => {
          setAccountSession({ status: 'signed_out' });
        },
        fetch: fetchMock,
        passkey: { transport: 'inline' },
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();

    await act(async () => {
      await expect(connection.connect()).rejects.toMatchObject({
        code: 'temporarily_unavailable',
      });
    });
    await flush();

    expect(connection.operation).toBe('idle');
    expect(connection.error?.code).toBe('temporarily_unavailable');
    expect(connection.model.stage).toBe('error');
    expect(getActiveWallet()?.handle).toBe(HANDLE_A);
    await view.unmount();
  });

  it('repairs an account-only session with its matching Wallet', async () => {
    window.localStorage.clear();
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    let connection!: UseDexterConnection;

    function Harness() {
      const [accountSession, setAccountSession] =
        useState<DexterAccountSession>({
          status: 'authenticated',
          accessToken: ACCOUNT_B,
        });
      connection = useDexterConnection({
        intent: 'identity',
        accountSession,
        installAccountSession: async (session) => {
          setAccountSession({
            status: 'authenticated',
            accessToken: session.accessToken,
          });
        },
        clearAccountSession: async () => {
          setAccountSession({ status: 'signed_out' });
        },
        fetch: fetchMock,
        passkey: { transport: 'inline' },
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();
    expect(connection.relation.relation).toBe('account_only');
    expect(connection.model.stage).toBe('repair');

    await act(async () => {
      await connection.connect();
    });
    await flush();

    expect(connection.relation.relation).toBe('bound');
    expect(connection.model.stage).toBe('ready');
    expect(connection.identity.userHandle).toBe(HANDLE_B);
    await view.unmount();
  });

  it('clears the active identity without deleting its device passkey', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    let connection!: UseDexterConnection;

    function Harness() {
      const [accountSession, setAccountSession] =
        useState<DexterAccountSession>({
          status: 'authenticated',
          accessToken: ACCOUNT_A,
        });
      connection = useDexterConnection({
        intent: 'identity',
        accountSession,
        installAccountSession: async () => undefined,
        clearAccountSession: async () => {
          setAccountSession({ status: 'signed_out' });
        },
        fetch: fetchMock,
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();
    expect(connection.relation.relation).toBe('bound');

    await act(async () => {
      expect(await connection.disconnectDexter()).toBe(true);
    });
    await flush();

    expect(connection.relation.relation).toBe('none');
    expect(getActiveWallet()).toBeNull();
    expect(listWallets().map((wallet) => wallet.handle)).toContain(HANDLE_A);
    expect(walletProofSessionStore.load(HANDLE_A)).not.toBeNull();
    await view.unmount();
  });

  it('restores the bound identity when host sign-out fails', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    let connection!: UseDexterConnection;

    function Harness() {
      const accountSession: DexterAccountSession = {
        status: 'authenticated',
        accessToken: ACCOUNT_A,
      };
      connection = useDexterConnection({
        intent: 'identity',
        accountSession,
        installAccountSession: async () => undefined,
        clearAccountSession: async () => {
          throw new Error('host sign-out failed');
        },
        fetch: fetchMock,
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();

    await act(async () => {
      await expect(connection.disconnectDexter()).rejects.toMatchObject({
        code: 'account_session_clear_failed',
      });
    });
    await flush();

    expect(connection.operation).toBe('idle');
    expect(connection.relation).toMatchObject({
      relation: 'bound',
      privateAccountAccess: false,
    });
    expect(connection.model.stage).toBe('error');
    expect(connection.identity.hasAccountAccess).toBe(false);
    expect(connection.activeWallet).toBeNull();
    expect(getActiveWallet()?.handle).toBe(HANDLE_A);
    await view.unmount();
  });

  it('requires confirmation before deleting the local Wallet', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    let connection!: UseDexterConnection;

    function Harness() {
      const [accountSession, setAccountSession] =
        useState<DexterAccountSession>({
          status: 'authenticated',
          accessToken: ACCOUNT_A,
        });
      connection = useDexterConnection({
        intent: 'identity',
        accountSession,
        installAccountSession: async () => undefined,
        clearAccountSession: async () => {
          setAccountSession({ status: 'signed_out' });
        },
        fetch: fetchMock,
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();
    expect(await connection.removeFromThisDevice('wrong' as never)).toEqual({
      removedFromRoster: false,
      passkeyPruned: false,
    });
    expect(getActiveWallet()?.handle).toBe(HANDLE_A);

    await act(async () => {
      await connection.removeFromThisDevice(
        REMOVE_DEXTER_FROM_DEVICE_CONFIRMATION,
      );
    });
    await flush();

    expect(getActiveWallet()).toBeNull();
    expect(listWallets()).toEqual([]);
    expect(walletProofSessionStore.load(HANDLE_A)).toBeNull();
    await view.unmount();
  });

  it('serializes identity actions so two transitions cannot race', async () => {
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    let connection!: UseDexterConnection;

    function Harness() {
      const [accountSession, setAccountSession] =
        useState<DexterAccountSession>({
          status: 'authenticated',
          accessToken: ACCOUNT_A,
        });
      connection = useDexterConnection({
        intent: 'identity',
        accountSession,
        installAccountSession: async (session) => {
          setAccountSession({
            status: 'authenticated',
            accessToken: session.accessToken,
          });
        },
        clearAccountSession: async () => {
          setAccountSession({ status: 'signed_out' });
        },
        fetch: fetchMock,
        passkey: { transport: 'inline' },
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();

    await act(async () => {
      const first = connection.connect();
      await expect(connection.disconnectDexter()).rejects.toMatchObject({
        code: 'identity_operation_in_progress',
      });
      await first;
    });
    await flush();

    expect(connection.relation.relation).toBe('bound');
    expect(connection.identity.userHandle).toBe(HANDLE_B);
    await view.unmount();
  });

  it('surfaces a failed initial ceremony as an error stage', async () => {
    window.localStorage.clear();
    const fetchMock = createFetch();
    vi.stubGlobal('fetch', fetchMock);
    mockStartAuthentication.mockRejectedValueOnce(new Error('cancelled'));
    let connection!: UseDexterConnection;

    function Harness() {
      connection = useDexterConnection({
        intent: 'identity',
        accountSession: { status: 'signed_out' },
        installAccountSession: async () => undefined,
        clearAccountSession: async () => undefined,
        fetch: fetchMock,
        passkey: { transport: 'inline' },
      });
      return null;
    }

    const view = await render(<Harness />);
    await flush();

    await act(async () => {
      await expect(connection.connect()).rejects.toMatchObject({
        code: 'webauthn_failed',
      });
    });
    await flush();

    expect(connection.operation).toBe('idle');
    expect(connection.model.stage).toBe('error');
    expect(connection.activeWallet).toBeNull();
    await view.unmount();
  });
});
