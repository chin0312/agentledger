import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest, NextResponse } from "next/server";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@okxweb3/x402-core/http";
import type { FacilitatorClient } from "@okxweb3/x402-core/server";

import { POST as companyHealthPost } from "../app/api/company-health/route";
import { evaluateActionHandler } from "../app/api/evaluate-action/route";
import { recommendationsHandler } from "../app/api/recommendations/route";
import { analyzeProvidedFinancialState } from "../lib/analysis";
import { evaluateAction } from "../lib/evaluate-action";
import { normalizeFinancialState } from "../lib/financial-context";
import { createX402Handler, type X402PaymentConfig } from "../lib/x402";

const PAY_TO = "0x0000000000000000000000000000000000000001";
const paymentConfig: X402PaymentConfig = {
  network: "eip155:196",
  payToAddress: PAY_TO,
  recommendationsPrice: "$0.01",
  policyGuardPrice: "$0.02",
};

const financialState = {
  periodDays: 30,
  cashFlow: { inflows: 342, outflows: 235 },
  spendVelocity: { firstHalf: 65, secondHalf: 170 },
  providers: [
    { provider: "research-agent", spend: 128, transactions: 6 },
    { provider: "data-agent", spend: 42, transactions: 3 },
  ],
  failedTransactions: 1,
};

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function nextRequest(path: string, body: unknown, headers: HeadersInit = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function facilitator(): FacilitatorClient {
  return {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }],
      extensions: [],
      signers: {},
    }),
    verify: async () => ({ isValid: true }),
    settle: async () => ({ success: true, status: "success", transaction: "0xmock-settlement", network: "eip155:196" }),
  };
}

async function paidRequest(
  handler: (request: NextRequest) => Promise<NextResponse>,
  path: string,
  body: unknown,
): Promise<NextResponse> {
  const unpaid = await handler(nextRequest(path, body));
  assert.equal(unpaid.status, 402);
  const encodedChallenge = unpaid.headers.get("PAYMENT-REQUIRED");
  assert.ok(encodedChallenge);
  const challenge = decodePaymentRequiredHeader(encodedChallenge);
  const paymentSignature = encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: challenge.accepts[0],
    payload: {},
  });
  return handler(nextRequest(path, body, { "PAYMENT-SIGNATURE": paymentSignature }));
}

test("provided financial state is normalized into derived health metrics without OKX", async () => {
  const previous = { ...process.env };
  delete process.env.OKX_API_KEY;
  delete process.env.OKX_SECRET_KEY;
  delete process.env.OKX_PASSPHRASE;
  try {
    const response = await companyHealthPost(request("/api/company-health", {
      source: "provided_state",
      financialState,
      monthlyBudget: 500,
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dataSource, "provided_state");
    assert.equal(body.stateVerification, "caller_supplied");
    assert.equal(body.cashFlow.net, 107);
    assert.equal(body.budget.usedPct, 47);
    assert.equal(body.spendVelocity.changePct, 161.54);
    assert.equal(body.topCounterparties[0].address, "research-agent");
    assert.equal(body.topCounterparties[0].shareOfSpendPct, 54.47);
    assert.equal(body.repeatedVendors.length, 2);
    assert.equal(body.transactions.failed, 1);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previous)) process.env[key] = value;
  }
});

test("provided state aggregates duplicate providers and ignores caller conclusions", () => {
  const normalized = normalizeFinancialState({
    ...financialState,
    providers: [
      { provider: "Research-Agent", spend: 100, transactions: 2 },
      { provider: "research-agent", spend: 28, transactions: 4 },
    ],
  });
  assert.deepEqual(normalized.providers, [{ provider: "Research-Agent", spend: 128, transactions: 6, failedTransactions: 0 }]);

  assert.equal("conclusion" in normalized, false);
});

test("provided state derives neutral velocity when velocity is omitted", () => {
  const report = analyzeProvidedFinancialState({
    wallet: "provided-state",
    financialState: { periodDays: 30, cashFlow: { inflows: 10, outflows: 20 } },
    now: Date.parse("2026-08-30T00:00:00.000Z"),
  });
  assert.deepEqual(report.spendVelocity, { firstHalf: 10, secondHalf: 10, changePct: 0 });
  assert.equal(report.stateVerification, "caller_supplied");
});

test("paid Recommendations reaches the existing engine with provided state", async () => {
  const handler = createX402Handler("recommendations", recommendationsHandler, { config: paymentConfig, facilitatorClient: facilitator() });
  const response = await paidRequest(handler, "/api/recommendations", {
    source: "provided_state",
    financialState,
    monthlyBudget: 500,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dataSource, "provided_state");
  assert.equal(body.stateVerification, "caller_supplied");
  assert.ok(Array.isArray(body.recommendedActions));
  assert.ok(response.headers.get("PAYMENT-RESPONSE"));
});

test("paid Policy Guard evaluates a service purchase from provided state", async () => {
  const handler = createX402Handler("policyGuard", evaluateActionHandler, { config: paymentConfig, facilitatorClient: facilitator() });
  const response = await paidRequest(handler, "/api/evaluate-action", {
    entity: "agent-123",
    action: { type: "service_purchase", amount: 25, provider: "new-provider" },
    financialState,
    policy: { monthlySpendLimit: 500, reservePct: 20, maxProviderConcentrationPct: 35, maxSingleActionAmount: 100 },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dataSource, "provided_state");
  assert.equal(body.stateVerification, "caller_supplied");
  assert.equal(body.decision, "approve");
  assert.equal(body.projectedState.spend, 260);
  assert.ok(response.headers.get("PAYMENT-RESPONSE"));
});

test("capital allocation remains state-driven without wallet data", async () => {
  const result = await evaluateAction({
    entity: "trading-agent",
    action: { type: "capital_allocation", amount: 250, strategy: "momentum-v2" },
    state: { currentStrategyAllocation: 1200, totalCapital: 5000, dailyLossUsed: 76 },
    policy: { maxStrategyAllocationAbsolute: 1500, maxStrategyAllocationPct: 35, dailyLossLimit: 100 },
  }, "okx");
  assert.equal(result.dataSource, "provided_state");
  assert.equal(result.stateVerification, "caller_supplied");
  assert.equal(result.decision, "caution");
});

test("invalid caller conclusions are rejected as structured input", async () => {
  const response = await companyHealthPost(request("/api/company-health", {
    source: "provided_state",
    financialState: { ...financialState, conclusion: "critical" },
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
});
