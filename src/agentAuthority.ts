import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { resolveDexterApiBase } from './trust';

export const AGENT_AUTHORITY_NAMESPACE =
  'dexter-governed-agent-surface-selection/v2' as const;
export const AGENT_AUTHORITY_STATUS_NAMESPACE =
  'dexter-governed-agent-surface-authority/v2' as const;
export const X402_PROTOCOL_ID = 'x402' as const;
export const X402_PROTOCOL_VERSION = 2 as const;
export const X402_ALLOWED_SCHEMES = Object.freeze(['exact', 'tab'] as const);
export const X402_ASSET = 'usdc' as const;
export const X402_COUNTERPARTY_SCOPE = 'any-valid-x402-seller' as const;
export const MAX_AUTHORITY_AMOUNT_ATOMIC = '18446744073709551615' as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const POSITIVE_ATOMIC = /^[1-9][0-9]{0,19}$/;
const NON_NEGATIVE_ATOMIC = /^(0|[1-9][0-9]{0,19})$/;
const U64_MAX_ATOMIC = BigInt(MAX_AUTHORITY_AMOUNT_ATOMIC);
const OAUTH_REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;
const DEVICE_USER_CODE = /^[A-Z0-9-]{6,32}$/;
const USDC_DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/;
const NO_CUSTOM_LIMIT_TTL_DAYS = 365;

export type AgentAuthorityTarget =
  | Readonly<{ kind: 'oauth-code'; requestId: string }>
  | Readonly<{ kind: 'device-code'; userCode: string }>;

export type AgentAuthorityApprovalMode = 'never' | 'always' | 'amount_or_risk';

export interface AgentAuthorityRuleBase {
  assetId: string;
  maxAmountAtomic: string;
  maxDailyAmountAtomic: string;
  maxAggregateAmountAtomic: string;
  approvalMode: AgentAuthorityApprovalMode;
  approvalThresholdAtomic: string | null;
  approvalEscalationReasons: readonly string[];
  blockedEscalationReasons: readonly string[];
}

export interface X402PaymentAuthorityRule extends AgentAuthorityRuleBase {
  assetId: typeof X402_ASSET;
  action: 'pay';
  protocolId: typeof X402_PROTOCOL_ID;
  protocolVersion: typeof X402_PROTOCOL_VERSION;
  allowedSchemes: typeof X402_ALLOWED_SCHEMES;
  counterpartyScope: typeof X402_COUNTERPARTY_SCOPE;
}

export interface TradeAuthorityRule extends AgentAuthorityRuleBase {
  action: 'buy' | 'sell';
  maxSlippageBps: number;
  maxPriceImpactBps: number;
}

export type AgentAuthorityRule = X402PaymentAuthorityRule | TradeAuthorityRule;

export interface AgentAuthorityBootstrapRequest {
  expectedVaultPda: string;
  target: AgentAuthorityTarget;
  agentLabel: string | null;
  grantExpiresAt: string;
  rules: readonly AgentAuthorityRule[];
}

export type StagedAgentAuthorityRule = AgentAuthorityRule & Readonly<{ id: string }>;

export interface AgentAuthorityAuthorization {
  namespace: typeof AGENT_AUTHORITY_NAMESPACE;
  status: 'owner_authorization_required';
  selectionId: string;
  operationId: string;
  ownerVaultPda: string;
  target: AgentAuthorityTarget;
  agentId: string;
  grantId: string;
  validFrom: string;
  grantExpiresAt: string;
  rules: readonly StagedAgentAuthorityRule[];
  rulesDigest: string;
  authorizationId: string;
  authorizationExpiresAt: string;
  authorizationOptions: PublicKeyCredentialRequestOptionsJSON;
  selectionDigest: string;
  request: AgentAuthorityBootstrapRequest;
}

export interface AgentAuthorityStagedReceipt {
  namespace: typeof AGENT_AUTHORITY_NAMESPACE;
  status: 'owner_authorized';
  selectionId: string;
  operationId: string;
  ownerVaultPda: string;
  target: AgentAuthorityTarget;
  agentId: string;
  grantId: string;
  validFrom: string;
  grantExpiresAt: string;
  rules: readonly StagedAgentAuthorityRule[];
  rulesDigest: string;
  authorizationId: string;
  selectionDigest: string;
}

export interface AgentAuthorityCapacity {
  maximumPerCallAmountAtomic: string;
  remainingPerCallAmountAtomic: string;
  maximumDailyAmountAtomic: string;
  usedDailyAmountAtomic: string;
  remainingDailyAmountAtomic: string;
  maximumAggregateAmountAtomic: string;
  usedAggregateAmountAtomic: string;
  remainingAggregateAmountAtomic: string;
  evaluatedAt: string;
  snapshotDigest: string;
}

export type AgentAuthorityActiveRole =
  | Readonly<{
      status: 'active';
      roleId: number;
      authoritySigner: string;
      sessionExpirySlot: number;
      currentSlot: number;
      resolutionDigest: string;
    }>
  | Readonly<{
      status: 'not-applicable' | 'unavailable';
      reason: string;
    }>;

export interface AgentAuthorityStatus {
  namespace: typeof AGENT_AUTHORITY_STATUS_NAMESPACE;
  mode: 'view_only' | 'bounded_payment_authority' | 'unavailable';
  active: boolean;
  inactiveReason: string | null;
  logicalGrantActive: boolean;
  principal: Readonly<{
    actor: 'owner' | 'agent';
    vaultPda: string;
    walletAddress: string;
    agentId: string | null;
  }> | null;
  source: 'mcp-link-token' | null;
  grantId: string | null;
  grantRevision: number | null;
  expiresAt: string | null;
  scopes: Readonly<{
    network: 'solana-mainnet';
    assetId: typeof X402_ASSET;
    action: 'pay';
    protocolId: typeof X402_PROTOCOL_ID;
    protocolVersion: typeof X402_PROTOCOL_VERSION;
    allowedSchemes: typeof X402_ALLOWED_SCHEMES;
    counterpartyScope: typeof X402_COUNTERPARTY_SCOPE;
  }> | null;
  capacity: AgentAuthorityCapacity | null;
  revoked: boolean | null;
  activeRole: AgentAuthorityActiveRole;
  fallback: false;
}

export type X402LimitDraft = Readonly<{
  perPaymentUsd: string;
  dailyUsd: string;
  aggregateUsd: string;
  expiresInDays: string;
}>;

export type X402Limits = Readonly<{
  perPaymentAtomic: string;
  dailyAtomic: string;
  aggregateAtomic: string;
  expiresAt: string;
}>;

export type X402LimitValidation =
  | Readonly<{ ok: true; limits: X402Limits }>
  | Readonly<{ ok: false; field: keyof X402LimitDraft; message: string }>;

// Compatibility aliases for the first dexter-fe consumer. New integrations
// should use the shorter X402 names above.
export type BoundedX402Draft = X402LimitDraft;
export type BoundedX402Limits = X402Limits;
export type BoundedX402Validation = X402LimitValidation;
export type BoundedX402Rule = X402PaymentAuthorityRule;
export type BoundedX402BootstrapRequest = AgentAuthorityBootstrapRequest &
  Readonly<{
    target: Readonly<{ kind: 'oauth-code'; requestId: string }>;
    agentLabel: string;
    rules: readonly [X402PaymentAuthorityRule];
  }>;
export interface BoundedX402Authorization {
  selectionId: string;
  operationId: string;
  ownerVaultPda: string;
  authorizationId: string;
  authorizationOptions: PublicKeyCredentialRequestOptionsJSON;
  agentId: string;
  grantId: string;
  validFrom: string;
  rulesDigest: string;
  selectionDigest: string;
  request: BoundedX402BootstrapRequest;
}
export interface BoundedX402StagedReceipt {
  namespace: typeof AGENT_AUTHORITY_NAMESPACE;
  status: 'owner_authorized';
  selectionId: string;
  operationId: string;
  ownerVaultPda: string;
  target: Readonly<{ kind: 'oauth-code'; requestId: string }>;
  agentId: string;
  grantId: string;
  validFrom: string;
  grantExpiresAt: string;
  rules: readonly [StagedAgentAuthorityRule];
  rulesDigest: string;
  authorizationId: string;
  selectionDigest: string;
}

export class AgentAuthorityError extends Error {
  constructor(
    public readonly code:
      | 'invalid_input'
      | 'owner_required'
      | 'request_refused'
      | 'invalid_response',
    message: string,
    public readonly status: number | null = null,
    public readonly serverCode: string | null = null,
  ) {
    super(message);
    this.name = 'AgentAuthorityError';
  }
}

export { AgentAuthorityError as BoundedX402AuthorityError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function exactTarget(value: unknown, expected: AgentAuthorityTarget): boolean {
  if (!isRecord(value) || value.kind !== expected.kind) return false;
  return expected.kind === 'oauth-code'
    ? value.requestId === expected.requestId && Object.keys(value).length === 2
    : value.userCode === expected.userCode && Object.keys(value).length === 2;
}

function validTarget(target: AgentAuthorityTarget): boolean {
  return target.kind === 'oauth-code'
    ? OAUTH_REQUEST_ID.test(target.requestId)
    : DEVICE_USER_CODE.test(target.userCode);
}

function validAtomic(value: string): boolean {
  if (!POSITIVE_ATOMIC.test(value)) return false;
  try {
    return BigInt(value) <= U64_MAX_ATOMIC;
  } catch {
    return false;
  }
}

function validReasons(reasons: readonly string[]): boolean {
  return reasons.length <= 32 && reasons.every((reason) =>
    /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(reason)
  );
}

function validRule(rule: AgentAuthorityRule): boolean {
  const base =
    IDENTIFIER.test(rule.assetId) &&
    validAtomic(rule.maxAmountAtomic) &&
    validAtomic(rule.maxDailyAmountAtomic) &&
    validAtomic(rule.maxAggregateAmountAtomic) &&
    BigInt(rule.maxAmountAtomic) <= BigInt(rule.maxDailyAmountAtomic) &&
    BigInt(rule.maxDailyAmountAtomic) <= BigInt(rule.maxAggregateAmountAtomic) &&
    ['never', 'always', 'amount_or_risk'].includes(rule.approvalMode) &&
    (rule.approvalThresholdAtomic === null || validAtomic(rule.approvalThresholdAtomic)) &&
    validReasons(rule.approvalEscalationReasons) &&
    validReasons(rule.blockedEscalationReasons);
  if (!base) return false;
  if (rule.action === 'pay') {
    return (
      rule.assetId === X402_ASSET &&
      rule.protocolId === X402_PROTOCOL_ID &&
      rule.protocolVersion === X402_PROTOCOL_VERSION &&
      rule.allowedSchemes.length === 2 &&
      rule.allowedSchemes[0] === 'exact' &&
      rule.allowedSchemes[1] === 'tab' &&
      rule.counterpartyScope === X402_COUNTERPARTY_SCOPE
    );
  }
  return (
    Number.isInteger(rule.maxSlippageBps) &&
    rule.maxSlippageBps >= 0 &&
    rule.maxSlippageBps <= 10_000 &&
    Number.isInteger(rule.maxPriceImpactBps) &&
    rule.maxPriceImpactBps >= 0 &&
    rule.maxPriceImpactBps <= 10_000
  );
}

function sameArray(actual: unknown, expected: readonly unknown[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function exactRule(value: unknown, expected: AgentAuthorityRule): value is StagedAgentAuthorityRule {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id)) {
    return false;
  }
  const common =
    value.assetId === expected.assetId &&
    value.action === expected.action &&
    value.maxAmountAtomic === expected.maxAmountAtomic &&
    value.maxDailyAmountAtomic === expected.maxDailyAmountAtomic &&
    value.maxAggregateAmountAtomic === expected.maxAggregateAmountAtomic &&
    value.approvalMode === expected.approvalMode &&
    value.approvalThresholdAtomic === expected.approvalThresholdAtomic &&
    sameArray(value.approvalEscalationReasons, expected.approvalEscalationReasons) &&
    sameArray(value.blockedEscalationReasons, expected.blockedEscalationReasons);
  if (!common) return false;
  if (expected.action === 'pay') {
    return (
      value.protocolId === expected.protocolId &&
      value.protocolVersion === expected.protocolVersion &&
      sameArray(value.allowedSchemes, expected.allowedSchemes) &&
      value.counterpartyScope === expected.counterpartyScope
    );
  }
  return (
    value.maxSlippageBps === expected.maxSlippageBps &&
    value.maxPriceImpactBps === expected.maxPriceImpactBps
  );
}

function exactRules(
  value: unknown,
  expected: readonly AgentAuthorityRule[],
): value is readonly StagedAgentAuthorityRule[] {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((rule, index) => exactRule(rule, expected[index]!))
  );
}

async function refusal(response: Response): Promise<never> {
  const payload = (await response.json().catch(() => null)) as unknown;
  const serverCode = isRecord(payload)
    ? typeof payload.code === 'string'
      ? payload.code
      : typeof payload.error === 'string'
        ? payload.error
        : null
    : null;
  if (response.status === 401) {
    throw new AgentAuthorityError(
      'owner_required',
      'Sign in as this wallet owner before granting agent authority.',
      response.status,
      serverCode,
    );
  }
  throw new AgentAuthorityError(
    'request_refused',
    serverCode ?? `agent_authority_${response.status}`,
    response.status,
    serverCode,
  );
}

function usdcAtomic(value: string): string | null {
  const trimmed = value.trim();
  const match = USDC_DECIMAL.exec(trimmed);
  if (!match) return null;
  const [whole = '0'] = trimmed.split('.');
  const fraction = (match[2] ?? '').padEnd(6, '0');
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fraction || '0');
  return atomic > 0n ? atomic.toString() : null;
}

export function noCustomX402Limits(nowUnixMs = Date.now()): X402Limits {
  if (!Number.isSafeInteger(nowUnixMs) || nowUnixMs < 0) {
    throw new AgentAuthorityError('invalid_input', 'The current time is invalid.');
  }
  return {
    perPaymentAtomic: MAX_AUTHORITY_AMOUNT_ATOMIC,
    dailyAtomic: MAX_AUTHORITY_AMOUNT_ATOMIC,
    aggregateAtomic: MAX_AUTHORITY_AMOUNT_ATOMIC,
    expiresAt: new Date(
      nowUnixMs + NO_CUSTOM_LIMIT_TTL_DAYS * 86_400_000,
    ).toISOString(),
  };
}

/** Parse owner-authored x402 limits without floating point. */
export function validateBoundedX402Draft(
  draft: X402LimitDraft,
  nowUnixMs = Date.now(),
): X402LimitValidation {
  const perPaymentAtomic = usdcAtomic(draft.perPaymentUsd);
  if (!perPaymentAtomic || BigInt(perPaymentAtomic) > U64_MAX_ATOMIC) {
    return {
      ok: false,
      field: 'perPaymentUsd',
      message: 'Enter a valid per-payment limit with no more than 6 decimal places.',
    };
  }
  const dailyAtomic = usdcAtomic(draft.dailyUsd);
  if (!dailyAtomic || BigInt(dailyAtomic) > U64_MAX_ATOMIC) {
    return {
      ok: false,
      field: 'dailyUsd',
      message: 'Enter a valid daily limit with no more than 6 decimal places.',
    };
  }
  const aggregateAtomic = usdcAtomic(draft.aggregateUsd);
  if (!aggregateAtomic || BigInt(aggregateAtomic) > U64_MAX_ATOMIC) {
    return {
      ok: false,
      field: 'aggregateUsd',
      message: 'Enter a valid total limit with no more than 6 decimal places.',
    };
  }
  if (BigInt(perPaymentAtomic) > BigInt(dailyAtomic)) {
    return {
      ok: false,
      field: 'perPaymentUsd',
      message: 'The per-payment limit cannot exceed the daily limit.',
    };
  }
  if (BigInt(dailyAtomic) > BigInt(aggregateAtomic)) {
    return {
      ok: false,
      field: 'dailyUsd',
      message: 'The daily limit cannot exceed the total limit.',
    };
  }
  const expiresInDays = Number(draft.expiresInDays);
  if (
    !/^\d{1,3}$/.test(draft.expiresInDays) ||
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 366
  ) {
    return {
      ok: false,
      field: 'expiresInDays',
      message: 'Choose an expiry between 1 and 366 days.',
    };
  }
  if (!Number.isSafeInteger(nowUnixMs) || nowUnixMs < 0) {
    throw new AgentAuthorityError('invalid_input', 'The current time is invalid.');
  }
  return {
    ok: true,
    limits: {
      perPaymentAtomic,
      dailyAtomic,
      aggregateAtomic,
      expiresAt: new Date(nowUnixMs + expiresInDays * 86_400_000).toISOString(),
    },
  };
}

export function buildX402PaymentRule(
  limits: Pick<X402Limits, 'perPaymentAtomic' | 'dailyAtomic' | 'aggregateAtomic'>,
  approval: Readonly<{
    mode?: AgentAuthorityApprovalMode;
    thresholdAtomic?: string | null;
    escalationReasons?: readonly string[];
    blockedReasons?: readonly string[];
  }> = {},
): X402PaymentAuthorityRule {
  const rule: X402PaymentAuthorityRule = {
    assetId: X402_ASSET,
    action: 'pay',
    protocolId: X402_PROTOCOL_ID,
    protocolVersion: X402_PROTOCOL_VERSION,
    allowedSchemes: X402_ALLOWED_SCHEMES,
    counterpartyScope: X402_COUNTERPARTY_SCOPE,
    maxAmountAtomic: limits.perPaymentAtomic,
    maxDailyAmountAtomic: limits.dailyAtomic,
    maxAggregateAmountAtomic: limits.aggregateAtomic,
    approvalMode: approval.mode ?? 'never',
    approvalThresholdAtomic: approval.thresholdAtomic ?? null,
    approvalEscalationReasons: approval.escalationReasons ?? [],
    blockedEscalationReasons: approval.blockedReasons ?? [],
  };
  if (!validRule(rule)) {
    throw new AgentAuthorityError('invalid_input', 'The x402 authority rule is invalid.');
  }
  return Object.freeze(rule);
}

export function buildAgentAuthorityRequest(input: {
  target: AgentAuthorityTarget;
  expectedVaultPda: string;
  agentLabel?: string | null;
  grantExpiresAt: string;
  rules: readonly AgentAuthorityRule[];
}): AgentAuthorityBootstrapRequest {
  const agentLabel = input.agentLabel === undefined ? null : input.agentLabel;
  if (
    !validTarget(input.target) ||
    input.expectedVaultPda.length < 1 ||
    input.expectedVaultPda.length > 128 ||
    (agentLabel !== null &&
      (agentLabel.length < 1 || agentLabel.length > 128 || agentLabel !== agentLabel.trim())) ||
    !isIsoDate(input.grantExpiresAt) ||
    input.rules.length < 1 ||
    input.rules.length > 64 ||
    !input.rules.every(validRule)
  ) {
    throw new AgentAuthorityError('invalid_input', 'The agent authority request is invalid.');
  }
  return Object.freeze({
    expectedVaultPda: input.expectedVaultPda,
    target: input.target,
    agentLabel,
    grantExpiresAt: input.grantExpiresAt,
    rules: Object.freeze([...input.rules]),
  });
}

export function buildBoundedX402BootstrapRequest(input: {
  requestId: string;
  expectedVaultPda: string;
  agentLabel: string;
  limits: X402Limits;
}): BoundedX402BootstrapRequest {
  return buildAgentAuthorityRequest({
    target: { kind: 'oauth-code', requestId: input.requestId },
    expectedVaultPda: input.expectedVaultPda,
    agentLabel: input.agentLabel.trim(),
    grantExpiresAt: input.limits.expiresAt,
    rules: [buildX402PaymentRule(input.limits)],
  }) as BoundedX402BootstrapRequest;
}

export async function beginAgentAuthority(input: {
  ownerAccessToken: string;
  operationId: string;
  request: AgentAuthorityBootstrapRequest;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<AgentAuthorityAuthorization> {
  if (!input.ownerAccessToken || !UUID.test(input.operationId)) {
    throw new AgentAuthorityError(
      'invalid_input',
      'An owner session and operation id are required.',
    );
  }
  const request = buildAgentAuthorityRequest(input.request);
  const response = await (input.fetchImpl ?? fetch)(
    `${resolveDexterApiBase(input.apiBase)}/api/passkey-vault/governed-assets/agent/mandates/bootstrap`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.ownerAccessToken}`,
        'content-type': 'application/json',
        'idempotency-key': input.operationId,
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    },
  );
  if (!response.ok) return refusal(response);
  const payload = (await response.json()) as unknown;
  if (
    !isRecord(payload) ||
    payload.namespace !== AGENT_AUTHORITY_NAMESPACE ||
    payload.status !== 'owner_authorization_required' ||
    !UUID.test(String(payload.selectionId ?? '')) ||
    payload.operationId !== input.operationId ||
    payload.ownerVaultPda !== request.expectedVaultPda ||
    !exactTarget(payload.target, request.target) ||
    !UUID.test(String(payload.agentId ?? '')) ||
    !UUID.test(String(payload.grantId ?? '')) ||
    !isIsoDate(payload.validFrom) ||
    payload.grantExpiresAt !== request.grantExpiresAt ||
    !exactRules(payload.rules, request.rules) ||
    typeof payload.rulesDigest !== 'string' ||
    !DIGEST.test(payload.rulesDigest) ||
    !UUID.test(String(payload.authorizationId ?? '')) ||
    !isIsoDate(payload.authorizationExpiresAt) ||
    !isRecord(payload.authorizationOptions) ||
    typeof payload.authorizationOptions.challenge !== 'string' ||
    payload.authorizationOptions.challenge.length < 16 ||
    typeof payload.selectionDigest !== 'string' ||
    !DIGEST.test(payload.selectionDigest)
  ) {
    throw new AgentAuthorityError(
      'invalid_response',
      'Dexter returned an invalid agent-authority challenge.',
    );
  }
  return {
    namespace: AGENT_AUTHORITY_NAMESPACE,
    status: 'owner_authorization_required',
    selectionId: payload.selectionId as string,
    operationId: input.operationId,
    ownerVaultPda: payload.ownerVaultPda as string,
    target: payload.target as AgentAuthorityTarget,
    agentId: payload.agentId as string,
    grantId: payload.grantId as string,
    validFrom: payload.validFrom,
    grantExpiresAt: payload.grantExpiresAt as string,
    rules: payload.rules as unknown as readonly StagedAgentAuthorityRule[],
    rulesDigest: payload.rulesDigest,
    authorizationId: payload.authorizationId as string,
    authorizationExpiresAt: payload.authorizationExpiresAt,
    authorizationOptions:
      payload.authorizationOptions as unknown as PublicKeyCredentialRequestOptionsJSON,
    selectionDigest: payload.selectionDigest,
    request,
  };
}

export async function stageAgentAuthority(input: {
  ownerAccessToken: string;
  authorization: AgentAuthorityAuthorization;
  credential: AuthenticationResponseJSON;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<AgentAuthorityStagedReceipt> {
  if (!input.ownerAccessToken || !isRecord(input.credential)) {
    throw new AgentAuthorityError(
      'invalid_input',
      'The owner authorization result is missing.',
    );
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${resolveDexterApiBase(input.apiBase)}/api/passkey-vault/governed-assets/agent/mandates/bootstrap/${input.authorization.selectionId}/complete`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.ownerAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        authorizationId: input.authorization.authorizationId,
        credential: input.credential,
      }),
      cache: 'no-store',
    },
  );
  if (!response.ok) return refusal(response);
  const payload = (await response.json()) as unknown;
  const authorization = input.authorization;
  if (
    !isRecord(payload) ||
    payload.namespace !== AGENT_AUTHORITY_NAMESPACE ||
    payload.status !== 'owner_authorized' ||
    payload.selectionId !== authorization.selectionId ||
    payload.operationId !== authorization.operationId ||
    payload.ownerVaultPda !== authorization.ownerVaultPda ||
    !exactTarget(payload.target, authorization.request.target) ||
    payload.agentId !== authorization.agentId ||
    payload.grantId !== authorization.grantId ||
    payload.validFrom !== authorization.validFrom ||
    payload.grantExpiresAt !== authorization.request.grantExpiresAt ||
    !exactRules(payload.rules, authorization.request.rules) ||
    payload.rulesDigest !== authorization.rulesDigest ||
    payload.authorizationId !== authorization.authorizationId ||
    payload.selectionDigest !== authorization.selectionDigest
  ) {
    throw new AgentAuthorityError(
      'invalid_response',
      'Dexter returned an invalid staged agent-authority receipt.',
    );
  }
  return payload as unknown as AgentAuthorityStagedReceipt;
}

export async function beginBoundedX402Authority(input: {
  accessToken: string;
  operationId: string;
  request: BoundedX402BootstrapRequest;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<BoundedX402Authorization> {
  return beginAgentAuthority({
    ownerAccessToken: input.accessToken,
    operationId: input.operationId,
    request: input.request,
    apiBase: input.apiBase,
    fetchImpl: input.fetchImpl,
  }) as unknown as Promise<BoundedX402Authorization>;
}

export async function stageBoundedX402Authority(input: {
  accessToken: string;
  authorization: BoundedX402Authorization;
  credential: AuthenticationResponseJSON;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<BoundedX402StagedReceipt> {
  return stageAgentAuthority({
    ownerAccessToken: input.accessToken,
    authorization: input.authorization as unknown as AgentAuthorityAuthorization,
    credential: input.credential,
    apiBase: input.apiBase,
    fetchImpl: input.fetchImpl,
  }) as Promise<BoundedX402StagedReceipt>;
}

export function exactAgentAuthorityApprovalRedirect(
  value: unknown,
  expectedGrantId: string,
): string {
  if (
    !UUID.test(expectedGrantId) ||
    !isRecord(value) ||
    value.ok !== true ||
    typeof value.redirect_url !== 'string' ||
    !isRecord(value.authority) ||
    value.authority.status !== 'active' ||
    value.authority.grantId !== expectedGrantId
  ) {
    throw new AgentAuthorityError(
      'invalid_response',
      'Dexter did not return the exact activated agent authority.',
    );
  }
  return value.redirect_url;
}

export function exactBoundedX402ApprovalRedirect(
  value: unknown,
  expectedGrantId: string,
): string {
  try {
    return exactAgentAuthorityApprovalRedirect(value, expectedGrantId);
  } catch (error) {
    if (error instanceof AgentAuthorityError) {
      throw new AgentAuthorityError(
        error.code,
        'Dexter did not return the exact activated payment authority.',
        error.status,
        error.serverCode,
      );
    }
    throw error;
  }
}

function validAuthorityStatus(value: unknown): value is AgentAuthorityStatus {
  if (
    !isRecord(value) ||
    value.namespace !== AGENT_AUTHORITY_STATUS_NAMESPACE ||
    !['view_only', 'bounded_payment_authority', 'unavailable'].includes(
      String(value.mode),
    ) ||
    typeof value.active !== 'boolean' ||
    !(value.inactiveReason === null || typeof value.inactiveReason === 'string') ||
    typeof value.logicalGrantActive !== 'boolean' ||
    !(value.grantId === null || (typeof value.grantId === 'string' && UUID.test(value.grantId))) ||
    !(value.grantRevision === null ||
      (Number.isInteger(value.grantRevision) && Number(value.grantRevision) >= 1)) ||
    !(value.expiresAt === null || isIsoDate(value.expiresAt)) ||
    !(value.revoked === null || typeof value.revoked === 'boolean') ||
    !(value.source === null || value.source === 'mcp-link-token') ||
    value.fallback !== false ||
    !isRecord(value.activeRole)
  ) {
    return false;
  }
  if (value.principal !== null) {
    if (
      !isRecord(value.principal) ||
      !['owner', 'agent'].includes(String(value.principal.actor)) ||
      typeof value.principal.vaultPda !== 'string' ||
      typeof value.principal.walletAddress !== 'string' ||
      !(value.principal.agentId === null ||
        (typeof value.principal.agentId === 'string' && UUID.test(value.principal.agentId)))
    ) return false;
  }
  const activeRole = value.activeRole;
  if (activeRole.status === 'active') {
    if (
      !Number.isInteger(activeRole.roleId) ||
      Number(activeRole.roleId) < 0 ||
      typeof activeRole.authoritySigner !== 'string' ||
      !Number.isInteger(activeRole.sessionExpirySlot) ||
      !Number.isInteger(activeRole.currentSlot) ||
      typeof activeRole.resolutionDigest !== 'string' ||
      !DIGEST.test(activeRole.resolutionDigest)
    ) return false;
  } else if (
    !['not-applicable', 'unavailable'].includes(String(activeRole.status)) ||
    typeof activeRole.reason !== 'string'
  ) {
    return false;
  }
  if (value.scopes !== null) {
    const scopes = value.scopes;
    if (
      !isRecord(scopes) ||
      scopes.network !== 'solana-mainnet' ||
      scopes.assetId !== X402_ASSET ||
      scopes.action !== 'pay' ||
      scopes.protocolId !== X402_PROTOCOL_ID ||
      scopes.protocolVersion !== X402_PROTOCOL_VERSION ||
      !sameArray(scopes.allowedSchemes, X402_ALLOWED_SCHEMES) ||
      scopes.counterpartyScope !== X402_COUNTERPARTY_SCOPE
    ) return false;
  }
  if (value.capacity !== null) {
    const capacity = value.capacity;
    if (!isRecord(capacity)) return false;
    const amounts = [
      capacity.maximumPerCallAmountAtomic,
      capacity.remainingPerCallAmountAtomic,
      capacity.maximumDailyAmountAtomic,
      capacity.usedDailyAmountAtomic,
      capacity.remainingDailyAmountAtomic,
      capacity.maximumAggregateAmountAtomic,
      capacity.usedAggregateAmountAtomic,
      capacity.remainingAggregateAmountAtomic,
    ];
    if (
      !amounts.every((amount) =>
        typeof amount === 'string' && NON_NEGATIVE_ATOMIC.test(amount)
      ) ||
      !isIsoDate(capacity.evaluatedAt) ||
      typeof capacity.snapshotDigest !== 'string' ||
      !DIGEST.test(capacity.snapshotDigest)
    ) return false;
  }
  if (value.mode === 'bounded_payment_authority') {
    if (
      value.principal?.actor !== 'agent' ||
      value.source !== 'mcp-link-token' ||
      value.grantId === null ||
      value.grantRevision === null ||
      value.expiresAt === null ||
      value.scopes === null ||
      value.capacity === null ||
      value.revoked !== false ||
      activeRole.status !== 'active'
    ) {
      return false;
    }
  }
  return true;
}

/** Read the current grant, capacity, and live role behind an OpenDexter bearer. */
export async function readAgentAuthority(input: {
  accessToken: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<AgentAuthorityStatus> {
  if (!input.accessToken) {
    throw new AgentAuthorityError('invalid_input', 'An OpenDexter access token is required.');
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${resolveDexterApiBase(input.apiBase)}/api/connector/oauth/authority`,
    {
      headers: { authorization: `Bearer ${input.accessToken}` },
      cache: 'no-store',
    },
  );
  if (!response.ok) return refusal(response);
  const payload = (await response.json()) as unknown;
  if (!validAuthorityStatus(payload)) {
    throw new AgentAuthorityError(
      'invalid_response',
      'Dexter returned an invalid agent-authority status.',
    );
  }
  return payload;
}
