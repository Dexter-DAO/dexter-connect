// @vitest-environment happy-dom

import { act, StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useDexterIdentity,
  type DexterAccountSession,
  type UseDexterIdentity,
} from './useDexterIdentity';
import { disconnectActiveWallet, setActiveWallet } from './walletStore';
import { walletProofSessionStore } from './walletProofSession';
import { flush, render } from './testRender';
import { bytesToBase64url } from './base64';

const walletIdentityProof = {
  token: 'wallet-proof',
  tokenType: 'Bearer' as const,
  expiresAt: 2_000_000_000,
  expiresIn: 2_592_000,
};

const HANDLE = 'AAAAAAAAAAAAAAAAAAAAAA';
const VAULT_PDA = '11111111111111111111111111111111';

function jwt(subject: string): string {
  const encode = (value: unknown) =>
    bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: subject }),
    encode('signature'),
  ].join('.');
}

const ACCOUNT_A = jwt('11111111-1111-4111-8111-111111111111');
const ACCOUNT_B = jwt('22222222-2222-4222-8222-222222222222');

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  setActiveWallet({
    handle: HANDLE,
    label: 'BranchWallet',
    credentialId: 'cred-a',
    vaultPda: VAULT_PDA,
  });
  walletProofSessionStore.save(HANDLE, walletIdentityProof);
});

describe('useDexterIdentity', () => {
  it('stays hydrating while account auth loads, then verifies the exact pair', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        response(200, { relation: 'bound' }),
    );
    let accountSession: DexterAccountSession = { status: 'loading' };
    let current!: UseDexterIdentity;
    function Harness() {
      current = useDexterIdentity({ accountSession, fetch: fetchMock });
      return null;
    }
    const view = await render(<Harness />);

    expect(current.relation.runtime.phase).toBe('hydrating');
    expect(current.identity.hasAccountAccess).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    accountSession = { status: 'authenticated', accessToken: 'account-a' };
    await view.rerender(<Harness />);
    await flush();

    expect(current.relation.relation).toBe('bound');
    expect(current.identity.hasAccountAccess).toBe(true);
    expect(current.identity.accountToken).toBe('account-a');
    await view.unmount();
  });

  it('removes account access on the account-switch render before verification finishes', async () => {
    let releaseSecond!: (value: Response) => void;
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      const token = (init?.headers as Record<string, string>).Authorization;
      if (token === `Bearer ${ACCOUNT_A}`) {
        return Promise.resolve(response(200, { relation: 'bound' }));
      }
      return new Promise<Response>((resolve) => {
        releaseSecond = resolve;
      });
    });
    let accountSession: DexterAccountSession = {
      status: 'authenticated',
      accessToken: ACCOUNT_A,
    };
    let current!: UseDexterIdentity;
    function Harness() {
      current = useDexterIdentity({ accountSession, fetch: fetchMock });
      return null;
    }
    const view = await render(<Harness />);
    await flush();
    expect(current.identity.hasAccountAccess).toBe(true);

    accountSession = {
      status: 'authenticated',
      accessToken: ACCOUNT_B,
    };
    await view.rerender(<Harness />);

    expect(current.identity.hasAccountAccess).toBe(false);
    expect(current.identity.accountToken).toBeNull();
    expect(current.relation.relation).toBe('wallet_only');

    await act(async () => {
      releaseSecond(response(200, { relation: 'conflict' }));
    });
    await flush();
    expect(current.relation.relation).toBe('conflict');
    expect(current.identity.hasAccountAccess).toBe(false);
    await view.unmount();
  });

  it('account sign-out leaves the Wallet and its retained proof intact', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        response(200, { relation: 'bound' }),
    );
    let accountSession: DexterAccountSession = {
      status: 'authenticated',
      accessToken: 'account-a',
    };
    let current!: UseDexterIdentity;
    function Harness() {
      current = useDexterIdentity({ accountSession, fetch: fetchMock });
      return null;
    }
    const view = await render(<Harness />);
    await flush();
    expect(current.identity.hasAccountAccess).toBe(true);

    accountSession = { status: 'signed_out' };
    await view.rerender(<Harness />);
    await flush();

    expect(current.relation.relation).toBe('wallet_only');
    expect(current.identity.userHandle).toBe(HANDLE);
    expect(walletProofSessionStore.load(HANDLE)).not.toBeNull();
    await view.unmount();
  });

  it('keeps account access closed while offline and recovers on retry', async () => {
    let online = false;
    const fetchMock = vi.fn(async () => {
      if (!online) throw new TypeError('offline');
      return response(200, { relation: 'bound' });
    });
    const accountSession: DexterAccountSession = {
      status: 'authenticated',
      accessToken: 'account-a',
    };
    let current!: UseDexterIdentity;
    function Harness() {
      current = useDexterIdentity({ accountSession, fetch: fetchMock });
      return null;
    }
    const view = await render(<Harness />);
    await flush();

    expect(current.relation.runtime.phase).toBe('offline');
    expect(current.identity.hasAccountAccess).toBe(false);

    online = true;
    await act(async () => {
      await current.retry();
    });

    expect(current.relation.relation).toBe('bound');
    expect(current.identity.hasAccountAccess).toBe(true);
    await view.unmount();
  });

  it('continues observing Wallet changes after the StrictMode effect replay', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        response(200, { relation: 'bound' }),
    );
    const accountSession: DexterAccountSession = {
      status: 'authenticated',
      accessToken: ACCOUNT_A,
    };
    let current!: UseDexterIdentity;
    function Harness() {
      current = useDexterIdentity({ accountSession, fetch: fetchMock });
      return null;
    }
    const view = await render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await flush();
    expect(current.relation.relation).toBe('bound');

    await act(async () => {
      expect(disconnectActiveWallet()).toBe(true);
    });
    await flush();

    expect(current.relation.relation).toBe('none');
    await view.unmount();
  });
});
