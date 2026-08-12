import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { enableAgentSpendMessage, revokeAgentSpendV2Message } from '@dexterai/vault/messages';
import { DEXTER_VAULT_PROGRAM_ID } from '@dexterai/vault/constants';
import { bytesToBase64url } from './base64';
import {
  assembleAgentSpendStatus,
  enableAgentSpend,
  revokeAgentSpend,
} from './agentSpend';

const passkeyVaultIdentity = {
  kind: 'passkey-vault' as const,
  userHandle: 'server-minted-handle',
};
const VAULT = new PublicKey('11111111111111111111111111111111');
const API = 'https://api.dexter.cash';

function hostedSigner() {
  return {
    signOperation: vi.fn(async () => ({
      signature: new Uint8Array(64).fill(1),
      clientDataJSON: new Uint8Array([2, 3, 4]),
      authenticatorData: new Uint8Array(37).fill(5),
    })),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('assembleAgentSpendStatus — the honest two-mode read', () => {
  it('reads armed from agentSpendArmed, NOT liveSessionCount (the trap)', () => {
    // The exact live case dexter-agents proved on TheMoneyShot vault:
    // a fully-armed automatic rail while V6 liveSessionCount === 0.
    const status = {
      agentSpendArmed: true,
      agentSpendRevokedAt: null,
      onchain: { usdcAtomic: '0', liveSessionCount: 0 },
    };
    const out = assembleAgentSpendStatus(status, []);
    expect(out.automatic.armed).toBe(true); // armed, DESPITE liveSessionCount=0
    expect(out.automatic.active).toBe(true); // null revokedAt → active
  });

  it('revoked: a revokedAt timestamp → active=false, timestamp preserved', () => {
    const status = {
      agentSpendArmed: false,
      agentSpendRevokedAt: '2026-06-25T00:00:00Z',
      onchain: { usdcAtomic: '1500000' },
    };
    const out = assembleAgentSpendStatus(status, []);
    expect(out.automatic.active).toBe(false);
    expect(out.automatic.revokedAt).toBe('2026-06-25T00:00:00Z');
    expect(out.balanceAtomic).toBe('1500000');
  });

  it('armed=null (indeterminate) is preserved, never coerced to a boolean', () => {
    const out = assembleAgentSpendStatus({ agentSpendArmed: null, agentSpendRevokedAt: null }, []);
    expect(out.automatic.armed).toBeNull();
  });

  it('missing agentSpendArmed → null (not false): we do not guess armed-state', () => {
    const out = assembleAgentSpendStatus({ agentSpendRevokedAt: null }, []);
    expect(out.automatic.armed).toBeNull();
  });

  it('never invents spend counters — absent stays undefined, not a false $0', () => {
    const out = assembleAgentSpendStatus({ agentSpendRevokedAt: null }, []);
    expect(out.automatic.spentTodayAtomic).toBeUndefined();
    expect(out.automatic.dailyCapAtomic).toBeUndefined();
  });

  it('passes spend counters through ONLY when the backend provides them', () => {
    const out = assembleAgentSpendStatus(
      {
        agentSpendRevokedAt: null,
        agentSpendArmed: true,
        agentSpendDaily: { spentTodayAtomic: '42000', dailyCapAtomic: '100000000' },
      },
      [],
    );
    expect(out.automatic.spentTodayAtomic).toBe('42000');
    expect(out.automatic.dailyCapAtomic).toBe('100000000');
  });

  it('maps Tabs (V6 sessions) into the tabs rail with labels + caps', () => {
    const sessions = [
      {
        sessionPubkey: 'PUBKEY1',
        counterparty: 'AGENTaaaaaaaaaaaaaaaaaaaaZZZZ',
        appName: 'hugen',
        live: true,
        spent: '10000',
        maxAmount: '5000000',
        expiresAt: 123,
      },
    ];
    const out = assembleAgentSpendStatus({ agentSpendArmed: false, agentSpendRevokedAt: null }, sessions);
    expect(out.tabs).toHaveLength(1);
    expect(out.tabs[0]).toMatchObject({
      id: 'PUBKEY1',
      label: 'hugen',
      capAtomic: '5000000',
      spentAtomic: '10000',
      live: true,
    });
  });

  it('Tab with no appName falls back to a shortened counterparty label', () => {
    const sessions = [
      {
        sessionPubkey: 'PK2',
        counterparty: 'ABCDEFGHIJKLMNOPQRSTUVWX',
        appName: null,
        live: true,
        spent: '0',
        maxAmount: '1000000',
        expiresAt: 9,
      },
    ];
    const out = assembleAgentSpendStatus({ agentSpendRevokedAt: null }, sessions);
    expect(out.tabs[0].label).toBe('ABCD…UVWX');
  });
});

describe('agent-spend WebAuthn server boundary', () => {
  it.each([
    ['revoke', revokeAgentSpend],
    ['enable', enableAgentSpend],
  ] as const)(
    'rejects a hostile API origin before fetch or WebAuthn for %s',
    async (_operation, invoke) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        invoke(
          passkeyVaultIdentity,
          'not-even-parsed-before-the-server-boundary',
          'https://attacker.example',
          'credential-id',
        ),
      ).rejects.toMatchObject({ code: 'untrusted_api_base' });

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('refuses raw in-page WebAuthn on a third-party origin and requires the hosted signer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      revokeAgentSpend(passkeyVaultIdentity, VAULT.toBase58(), API, 'credential-id'),
    ).rejects.toMatchObject({ code: 'hosted_signer_required' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a hosted operation signer on an arbitrary origin and submits compact bytes', async () => {
    const signer = hostedSigner();
    const nonce = 23n;
    const expiry = 2_000_000_100n;
    const operation = revokeAgentSpendV2Message({
      programId: DEXTER_VAULT_PROGRAM_ID,
      vaultPda: VAULT,
      nonce,
      expiry,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          nonce: nonce.toString(),
          expiry: Number(expiry),
          operationMessage: bytesToBase64url(operation),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revoked: true }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      revokeAgentSpend(
        passkeyVaultIdentity,
        VAULT.toBase58(),
        API,
        'credential-id',
        signer,
      ),
    ).resolves.toEqual({ revoked: true });

    expect(signer.signOperation).toHaveBeenCalledOnce();
    expect(signer.signOperation).toHaveBeenCalledWith(operation);
    const signedOperation = signer.signOperation.mock.calls[0] as unknown as [Uint8Array];
    expect(signedOperation[0]).toHaveLength(112);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const actionCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(String(actionCall[1].body));
    expect(body.nonce).toBe(nonce.toString());
    expect(Buffer.from(body.signedPasskeyPayload.signature, 'base64')).toHaveLength(64);
  });

  it('rejects a substituted revoke operation before hosted consent', async () => {
    const signer = hostedSigner();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nonce: '23',
        expiry: 2_000_000_100,
        operationMessage: bytesToBase64url(new Uint8Array(112).fill(9)),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      revokeAgentSpend(
        passkeyVaultIdentity,
        VAULT.toBase58(),
        API,
        'credential-id',
        signer,
      ),
    ).rejects.toMatchObject({ code: 'challenge_mismatch' });
    expect(signer.signOperation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('binds enable consent to the exact server operation before the hosted signer', async () => {
    const signer = hostedSigner();
    const nonce = 19n;
    const expiry = 2_000_000_000n;
    const operation = enableAgentSpendMessage({
      programId: DEXTER_VAULT_PROGRAM_ID,
      vaultPda: VAULT,
      nonce,
      expiry,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          nonce: nonce.toString(),
          expiry: Number(expiry),
          operationMessage: bytesToBase64url(operation),
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      enableAgentSpend(
        passkeyVaultIdentity,
        VAULT.toBase58(),
        API,
        'credential-id',
        signer,
      ),
    ).resolves.toEqual({ enabled: true });

    expect(signer.signOperation).toHaveBeenCalledWith(operation);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a substituted enable operation before hosted consent', async () => {
    const signer = hostedSigner();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nonce: '19',
        expiry: 2_000_000_000,
        operationMessage: bytesToBase64url(new Uint8Array(112).fill(9)),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      enableAgentSpend(
        passkeyVaultIdentity,
        VAULT.toBase58(),
        API,
        'credential-id',
        signer,
      ),
    ).rejects.toMatchObject({ code: 'challenge_mismatch' });
    expect(signer.signOperation).not.toHaveBeenCalled();
  });
});
