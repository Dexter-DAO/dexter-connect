import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_AUTHORITY_NAMESPACE,
  AGENT_AUTHORITY_STATUS_NAMESPACE,
  MAX_AUTHORITY_AMOUNT_ATOMIC,
  beginAgentAuthority,
  beginBoundedX402Authority,
  buildAgentAuthorityRequest,
  buildBoundedX402BootstrapRequest,
  buildX402PaymentRule,
  exactAgentAuthorityApprovalRedirect,
  noCustomX402Limits,
  readAgentAuthority,
  stageAgentAuthority,
  validateBoundedX402Draft,
  type AgentAuthorityAuthorization,
  type AgentAuthorityBootstrapRequest,
  type TradeAuthorityRule,
} from './agentAuthority';

const OPERATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELECTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AUTHORIZATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GRANT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const AGENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PAYMENT_RULE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TRADE_RULE_ID = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function limits() {
  const parsed = validateBoundedX402Draft(
    {
      perPaymentUsd: '0.10',
      dailyUsd: '1.00',
      aggregateUsd: '5',
      expiresInDays: '7',
    },
    Date.UTC(2026, 7, 5),
  );
  if (!parsed.ok) throw new Error('fixture failed');
  return parsed.limits;
}

function tradeRule(): TradeAuthorityRule {
  return {
    assetId: 'aapl-stock-token',
    action: 'buy',
    maxAmountAtomic: '1000000',
    maxDailyAmountAtomic: '5000000',
    maxAggregateAmountAtomic: '25000000',
    approvalMode: 'amount_or_risk',
    approvalThresholdAtomic: '750000',
    approvalEscalationReasons: ['price_impact'],
    blockedEscalationReasons: ['asset_unverified'],
    maxSlippageBps: 100,
    maxPriceImpactBps: 250,
  };
}

function beginPayload(request: AgentAuthorityBootstrapRequest) {
  return {
    namespace: AGENT_AUTHORITY_NAMESPACE,
    status: 'owner_authorization_required',
    selectionId: SELECTION_ID,
    operationId: OPERATION_ID,
    ownerVaultPda: request.expectedVaultPda,
    target: request.target,
    agentId: AGENT_ID,
    grantId: GRANT_ID,
    validFrom: '2026-08-05T00:00:00.000Z',
    grantExpiresAt: request.grantExpiresAt,
    rules: request.rules.map((rule, index) => ({
      ...rule,
      id: index === 0 ? PAYMENT_RULE_ID : TRADE_RULE_ID,
    })),
    rulesDigest: DIGEST,
    authorizationId: AUTHORIZATION_ID,
    authorizationExpiresAt: '2026-08-05T00:05:00.000Z',
    authorizationOptions: {
      challenge: 'Y2hhbGxlbmdlLWJvdW5kZWQtYWdlbnQtYXV0aG9yaXR5',
      rpId: 'dexter.cash',
    },
    selectionDigest: DIGEST,
  };
}

function authorization(
  request: AgentAuthorityBootstrapRequest,
): AgentAuthorityAuthorization {
  const payload = beginPayload(request);
  return {
    ...payload,
    namespace: AGENT_AUTHORITY_NAMESPACE,
    status: 'owner_authorization_required',
    target: request.target,
    rules: payload.rules,
    authorizationOptions: payload.authorizationOptions,
    request,
  };
}

describe('persistent agent authority', () => {
  it('parses custom limits exactly and represents no custom limit at the u64 ceiling', () => {
    expect(limits()).toEqual({
      perPaymentAtomic: '100000',
      dailyAtomic: '1000000',
      aggregateAtomic: '5000000',
      expiresAt: '2026-08-12T00:00:00.000Z',
    });
    expect(noCustomX402Limits(Date.UTC(2026, 7, 5))).toEqual({
      perPaymentAtomic: MAX_AUTHORITY_AMOUNT_ATOMIC,
      dailyAtomic: MAX_AUTHORITY_AMOUNT_ATOMIC,
      aggregateAtomic: MAX_AUTHORITY_AMOUNT_ATOMIC,
      expiresAt: '2027-08-05T00:00:00.000Z',
    });
    expect(validateBoundedX402Draft({
      perPaymentUsd: '18446744073709.551616',
      dailyUsd: '18446744073709.551616',
      aggregateUsd: '18446744073709.551616',
      expiresInDays: '7',
    })).toMatchObject({ ok: false, field: 'perPaymentUsd' });
    expect(validateBoundedX402Draft({
      perPaymentUsd: '2',
      dailyUsd: '1',
      aggregateUsd: '5',
      expiresInDays: '7',
    })).toMatchObject({ ok: false, field: 'perPaymentUsd' });
  });

  it('builds one composable device grant instead of separate payment and trading modes', () => {
    const request = buildAgentAuthorityRequest({
      target: { kind: 'device-code', userCode: 'ABCD-EFGH' },
      expectedVaultPda: 'selected-vault-pda',
      agentLabel: 'Hermes',
      grantExpiresAt: limits().expiresAt,
      rules: [buildX402PaymentRule(limits()), tradeRule()],
    });

    expect(request.target).toEqual({ kind: 'device-code', userCode: 'ABCD-EFGH' });
    expect(request.rules.map((rule) => rule.action)).toEqual(['pay', 'buy']);
    expect(request.rules[0]).toMatchObject({
      protocolId: 'x402',
      allowedSchemes: ['exact', 'tab'],
      counterpartyScope: 'any-valid-x402-seller',
    });
  });

  it('binds the exact OAuth request and requested rules to the owner challenge', async () => {
    const request = buildBoundedX402BootstrapRequest({
      requestId: 'vpair_abcdef1234',
      expectedVaultPda: 'selected-vault-pda',
      agentLabel: 'ChatGPT',
      limits: limits(),
    });
    const payload = beginPayload(request);
    const fetchImpl = vi.fn().mockResolvedValue(json(payload));

    const result = await beginBoundedX402Authority({
      accessToken: 'owner-token',
      operationId: OPERATION_ID,
      request,
      fetchImpl,
    });

    expect(result).toMatchObject({
      selectionId: SELECTION_ID,
      grantId: GRANT_ID,
      target: request.target,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://api.dexter.cash/api/passkey-vault/governed-assets/agent/mandates/bootstrap',
    );
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer owner-token');
    expect(new Headers(init.headers).get('idempotency-key')).toBe(OPERATION_ID);
    expect(JSON.parse(init.body)).toEqual(request);

    fetchImpl.mockResolvedValueOnce(json({
      ...payload,
      target: { kind: 'oauth-code', requestId: 'vpair_different1' },
    }));
    await expect(beginBoundedX402Authority({
      accessToken: 'owner-token',
      operationId: OPERATION_ID,
      request,
      fetchImpl,
    })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('stages a combined device-code grant only when the receipt matches every rule', async () => {
    const request = buildAgentAuthorityRequest({
      target: { kind: 'device-code', userCode: 'ABCD-EFGH' },
      expectedVaultPda: 'selected-vault-pda',
      agentLabel: 'Hermes',
      grantExpiresAt: limits().expiresAt,
      rules: [buildX402PaymentRule(limits()), tradeRule()],
    });
    const prepared = authorization(request);
    const receipt = {
      namespace: AGENT_AUTHORITY_NAMESPACE,
      status: 'owner_authorized',
      selectionId: SELECTION_ID,
      operationId: OPERATION_ID,
      ownerVaultPda: request.expectedVaultPda,
      target: request.target,
      agentId: AGENT_ID,
      grantId: GRANT_ID,
      validFrom: prepared.validFrom,
      grantExpiresAt: request.grantExpiresAt,
      rules: prepared.rules,
      rulesDigest: DIGEST,
      authorizationId: AUTHORIZATION_ID,
      selectionDigest: DIGEST,
    };
    const fetchImpl = vi.fn().mockResolvedValue(json(receipt));

    await expect(stageAgentAuthority({
      ownerAccessToken: 'owner-token',
      authorization: prepared,
      credential: { id: 'credential' } as never,
      fetchImpl,
    })).resolves.toMatchObject({
      status: 'owner_authorized',
      target: { kind: 'device-code' },
      grantId: GRANT_ID,
    });

    fetchImpl.mockResolvedValueOnce(json({
      ...receipt,
      rules: [prepared.rules[0], { ...prepared.rules[1], maxSlippageBps: 999 }],
    }));
    await expect(stageAgentAuthority({
      ownerAccessToken: 'owner-token',
      authorization: prepared,
      credential: { id: 'credential' } as never,
      fetchImpl,
    })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('reads active, exhausted, and unavailable authority without inventing fallback', async () => {
    const base = {
      namespace: AGENT_AUTHORITY_STATUS_NAMESPACE,
      mode: 'bounded_payment_authority',
      active: true,
      inactiveReason: null,
      logicalGrantActive: true,
      principal: {
        actor: 'agent',
        vaultPda: 'vault-pda',
        walletAddress: 'wallet-address',
        agentId: AGENT_ID,
      },
      source: 'mcp-link-token',
      grantId: GRANT_ID,
      grantRevision: 1,
      expiresAt: '2027-08-05T00:00:00.000Z',
      scopes: {
        network: 'solana-mainnet',
        assetId: 'usdc',
        action: 'pay',
        protocolId: 'x402',
        protocolVersion: 2,
        allowedSchemes: ['exact', 'tab'],
        counterpartyScope: 'any-valid-x402-seller',
      },
      capacity: {
        maximumPerCallAmountAtomic: '1000000',
        remainingPerCallAmountAtomic: '1000000',
        maximumDailyAmountAtomic: '5000000',
        usedDailyAmountAtomic: '0',
        remainingDailyAmountAtomic: '5000000',
        maximumAggregateAmountAtomic: '25000000',
        usedAggregateAmountAtomic: '0',
        remainingAggregateAmountAtomic: '25000000',
        evaluatedAt: '2026-08-24T12:00:00.000Z',
        snapshotDigest: DIGEST,
      },
      revoked: false,
      activeRole: {
        status: 'active',
        roleId: 2,
        authoritySigner: 'authority-signer',
        sessionExpirySlot: 100,
        currentSlot: 50,
        resolutionDigest: DIGEST,
      },
      fallback: false,
    };
    const fetchImpl = vi.fn().mockResolvedValue(json(base));
    await expect(readAgentAuthority({
      accessToken: 'runtime-token',
      fetchImpl,
    })).resolves.toMatchObject({ active: true, grantId: GRANT_ID, fallback: false });

    fetchImpl.mockResolvedValueOnce(json({
      ...base,
      active: false,
      inactiveReason: 'capacity_exhausted',
      capacity: { ...base.capacity, remainingPerCallAmountAtomic: '0' },
    }));
    await expect(readAgentAuthority({
      accessToken: 'runtime-token',
      fetchImpl,
    })).resolves.toMatchObject({ active: false, inactiveReason: 'capacity_exhausted' });
  });

  it('accepts only the final redirect for the exact staged grant', () => {
    expect(exactAgentAuthorityApprovalRedirect({
      ok: true,
      redirect_url: 'https://client.example/callback?code=one&state=two',
      authority: { status: 'active', grantId: GRANT_ID },
    }, GRANT_ID)).toBe('https://client.example/callback?code=one&state=two');

    expect(() => exactAgentAuthorityApprovalRedirect({
      ok: true,
      redirect_url: 'https://client.example/callback?code=one&state=two',
      authority: { status: 'active', grantId: AGENT_ID },
    }, GRANT_ID)).toThrow('exact activated agent authority');
  });
});
