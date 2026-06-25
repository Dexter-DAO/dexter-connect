import { describe, it, expect } from 'vitest';
import { assembleAgentSpendStatus } from './agentSpend';

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
