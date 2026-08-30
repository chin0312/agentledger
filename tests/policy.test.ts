import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCapitalAllocationPolicy, evaluateServicePurchasePolicy, resolveFinancialPolicy } from "../lib/policy";
import { errorResponse, UpstreamTimeoutError } from "../lib/http";
import { fetchOkxTransactions, OkxApiError } from "../lib/okx";
import type { RuntimeConfig } from "../lib/config";
import { POST as evaluateActionPost } from "../app/api/evaluate-action/route";
import { POST as demoEvaluateActionPost } from "../app/api/demo/evaluate-action/route";
import { POST as demoCompanyHealthPost } from "../app/api/demo/company-health/route";
import { POST as demoRecommendationsPost } from "../app/api/demo/recommendations/route";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const basePolicy = {
  monthlySpendLimit: 500,
  reservePct: 20,
  maxProviderConcentrationPct: 35,
  maxSingleActionAmount: 100,
  maxStrategyAllocationPct: 35,
  maxStrategyAllocationAbsolute: 1500,
  dailyLossLimit: 100,
};

function serviceInput(overrides: Partial<Parameters<typeof evaluateServicePurchasePolicy>[0]> = {}) {
  return {
    action: { type: "service_purchase" as const, amount: 25, provider: "0xprovider" },
    currentSpend: 100,
    projectedSpend: 125,
    currentNormalizedSpend: 100,
    projectedNormalizedSpend: 125,
    currentProviderConcentrationPct: 10,
    projectedProviderConcentrationPct: 20,
    ...overrides,
  };
}

function capitalInput(overrides: Partial<Parameters<typeof evaluateCapitalAllocationPolicy>[0]> = {}) {
  return {
    action: { type: "capital_allocation" as const, amount: 100, strategy: "stable-v1" },
    currentStrategyAllocation: 500,
    totalCapital: 5000,
    dailyLossUsed: 20,
    ...overrides,
  };
}

function request(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function okxConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    demoMode: false,
    apiKey: "test-key",
    secretKey: "test-secret",
    passphrase: "test-passphrase",
    projectId: "",
    chains: ["1"],
    ...overrides,
  };
}

test("default financial policy loads correctly", () => {
  assert.deepEqual(resolveFinancialPolicy(), {
    reservePct: 20,
    cautionBudgetUtilizationPct: 75,
    criticalBudgetUtilizationPct: 90,
    maxProviderConcentrationPct: 35,
    maxStrategyAllocationPct: 35,
    cautionLossUtilizationPct: 70,
    criticalLossUtilizationPct: 90,
  });
});

test("caller policy overrides defaults", () => {
  const result = resolveFinancialPolicy({ reservePct: 10, maxProviderConcentrationPct: 60, monthlySpendLimit: 500 });
  assert.equal(result.reservePct, 10);
  assert.equal(result.maxProviderConcentrationPct, 60);
  assert.equal(result.monthlySpendLimit, 500);
  assert.equal(result.cautionBudgetUtilizationPct, 75);
});

test("hard monthly spend limit breach rejects", () => {
  const result = evaluateServicePurchasePolicy(
    serviceInput({ currentNormalizedSpend: 90, projectedNormalizedSpend: 110 }),
    { monthlySpendLimit: 100, reservePct: 0 },
  );
  assert.equal(result.decision, "reject");
  assert.ok(result.violatedPolicies.some((item) => item.rule === "monthly_spend_limit"));
});

test("budget caution threshold produces caution", () => {
  const result = evaluateServicePurchasePolicy(
    serviceInput({ currentNormalizedSpend: 70, projectedNormalizedSpend: 80 }),
    { monthlySpendLimit: 100, reservePct: 0 },
  );
  assert.equal(result.decision, "caution");
  assert.ok(result.warnings.some((item) => item.rule === "caution_budget_utilization"));
});

test("reserve requirement limits available spend", () => {
  const result = evaluateServicePurchasePolicy(
    serviceInput({ currentNormalizedSpend: 70, projectedNormalizedSpend: 85 }),
    { monthlySpendLimit: 100, reservePct: 20 },
  );
  assert.equal(result.decision, "reject");
  assert.ok(result.violatedPolicies.some((item) => item.rule === "reserve_requirement"));
});

test("max single action amount rejects", () => {
  const result = evaluateServicePurchasePolicy(serviceInput({ action: { type: "service_purchase", amount: 101, provider: "0xprovider" } }), { maxSingleActionAmount: 100 });
  assert.equal(result.decision, "reject");
  assert.ok(result.violatedPolicies.some((item) => item.rule === "max_single_action_amount"));
});

test("provider concentration moves from caution to reject at the hard boundary", () => {
  const caution = evaluateServicePurchasePolicy(serviceInput({ projectedProviderConcentrationPct: 42, currentProviderConcentrationPct: 40 }), { maxProviderConcentrationPct: 35 });
  const reject = evaluateServicePurchasePolicy(serviceInput({ projectedProviderConcentrationPct: 51, currentProviderConcentrationPct: 42 }), { maxProviderConcentrationPct: 35 });
  assert.equal(caution.decision, "caution");
  assert.equal(reject.decision, "reject");
});

test("capital absolute and percentage limits reject", () => {
  const absolute = evaluateCapitalAllocationPolicy(capitalInput({ currentStrategyAllocation: 1450 }), { maxStrategyAllocationAbsolute: 1500, maxStrategyAllocationPct: 100 });
  const percentage = evaluateCapitalAllocationPolicy(capitalInput({ currentStrategyAllocation: 300, totalCapital: 1000 }), { maxStrategyAllocationPct: 35 });
  assert.equal(absolute.decision, "reject");
  assert.ok(absolute.violatedPolicies.some((item) => item.rule === "max_strategy_allocation_absolute"));
  assert.equal(percentage.decision, "reject");
  assert.ok(percentage.violatedPolicies.some((item) => item.rule === "max_strategy_allocation_pct"));
});

test("capital loss caution and critical thresholds are enforced", () => {
  const caution = evaluateCapitalAllocationPolicy(capitalInput({ dailyLossUsed: 76 }), { dailyLossLimit: 100, maxStrategyAllocationPct: 100 });
  const reject = evaluateCapitalAllocationPolicy(capitalInput({ dailyLossUsed: 90 }), { dailyLossLimit: 100, maxStrategyAllocationPct: 100 });
  assert.equal(caution.decision, "caution");
  assert.equal(reject.decision, "reject");
  assert.ok(reject.violatedPolicies.some((item) => item.rule === "critical_loss_utilization"));
});

test("compliant service and capital actions are approved", () => {
  assert.equal(evaluateServicePurchasePolicy(serviceInput(), basePolicy).decision, "approve");
  assert.equal(evaluateCapitalAllocationPolicy(capitalInput(), basePolicy).decision, "approve");
});

test("demo service purchase evaluation is approved with explicit demo source", async () => {
  const response = await demoEvaluateActionPost(request("/api/demo/evaluate-action", {
    entity: "0xagentcompany",
    action: { type: "service_purchase", amount: 25, provider: "0xnewprovider" },
    context: { days: 30 },
    policy: basePolicy,
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.dataSource, "demo");
  assert.equal(body.decision, "approve");
});

test("demo service purchase concentration can return caution", async () => {
  const response = await demoEvaluateActionPost(request("/api/demo/evaluate-action", {
    entity: "0xagentcompany",
    action: { type: "service_purchase", amount: 1, provider: "0xresearchagent00000000000000000000000001" },
    policy: { maxProviderConcentrationPct: 45 },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.decision, "caution");
  assert.equal(body.approved, true);
});

test("demo capital allocation returns caution and reject decisions", async () => {
  const caution = await demoEvaluateActionPost(request("/api/demo/evaluate-action", {
    entity: "0xagentcompany",
    action: { type: "capital_allocation", amount: 250, strategy: "momentum-v2" },
    state: { currentStrategyAllocation: 1200, totalCapital: 5000, dailyLossUsed: 76 },
    policy: { maxStrategyAllocationAbsolute: 1500, maxStrategyAllocationPct: 35, dailyLossLimit: 100 },
  }));
  const reject = await demoEvaluateActionPost(request("/api/demo/evaluate-action", {
    entity: "0xagentcompany",
    action: { type: "capital_allocation", amount: 400, strategy: "momentum-v2" },
    state: { currentStrategyAllocation: 1200, totalCapital: 5000, dailyLossUsed: 20 },
    policy: { maxStrategyAllocationAbsolute: 1500, maxStrategyAllocationPct: 35, dailyLossLimit: 100 },
  }));
  assert.equal((await caution.json()).decision, "caution");
  assert.equal((await reject.json()).decision, "reject");
});

test("company health exposes policy status and recommendations honor caller thresholds", async () => {
  const response = await demoCompanyHealthPost(request("/api/demo/company-health", {
    address: "0xagentcompany",
    days: 30,
    monthlyBudget: 500,
    policy: { maxProviderConcentrationPct: 45 },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.policyStatus.compliant, true);
  assert.equal(body.policyStatus.warnings, 1);

  const recommendations = await demoRecommendationsPost(request("/api/demo/recommendations", {
    address: "0xagentcompany",
    days: 30,
    monthlyBudget: 500,
    policy: { maxProviderConcentrationPct: 45 },
  }));
  const recommendationsBody = await recommendations.json();
  assert.equal(recommendations.status, 200);
  assert.equal(recommendationsBody.recommendedActions[0].type, "provider_policy_violation");
  assert.equal(recommendationsBody.recommendedActions[0].target.desired, 45);
});

test("invalid action type and missing capital state return structured validation errors", async () => {
  const invalidType = await demoEvaluateActionPost(request("/api/demo/evaluate-action", { entity: "agent", action: { type: "unknown", amount: 1 } }));
  const missingState = await demoEvaluateActionPost(request("/api/demo/evaluate-action", { entity: "agent", action: { type: "capital_allocation", amount: 1, strategy: "x" } }));
  assert.equal(invalidType.status, 400);
  assert.equal((await invalidType.json()).error.code, "INVALID_REQUEST");
  assert.equal(missingState.status, 400);
  assert.equal((await missingState.json()).error.code, "INVALID_REQUEST");
});

test("production service evaluation never falls back to demo data", async () => {
  const previous = { key: process.env.OKX_API_KEY, secret: process.env.OKX_SECRET_KEY, passphrase: process.env.OKX_PASSPHRASE };
  delete process.env.OKX_API_KEY;
  delete process.env.OKX_SECRET_KEY;
  delete process.env.OKX_PASSPHRASE;
  try {
    const response = await evaluateActionPost(request("/api/evaluate-action", {
      entity: "0xagentcompany",
      action: { type: "service_purchase", amount: 1, provider: "0xprovider" },
      policy: { monthlySpendLimit: 500 },
    }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "PAYMENT_NOT_CONFIGURED");
  } finally {
    if (previous.key === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.OKX_SECRET_KEY; else process.env.OKX_SECRET_KEY = previous.secret;
    if (previous.passphrase === undefined) delete process.env.OKX_PASSPHRASE; else process.env.OKX_PASSPHRASE = previous.passphrase;
  }
});

test("request IDs are preserved or generated", async () => {
  const preserved = await demoCompanyHealthPost(request("/api/demo/company-health", { address: "agent" }, { "x-request-id": "smoke-test-123" }));
  const generated = await demoCompanyHealthPost(request("/api/demo/company-health", { address: "agent" }));
  assert.equal(preserved.headers.get("x-request-id"), "smoke-test-123");
  assert.match(generated.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

test("OKX 429 and 500 responses are retried", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts < 3) return new Response("busy", { status: 429 });
    return new Response(JSON.stringify({ code: "0", data: [{ cursor: "", transactionList: [] }] }), { status: 200 });
  };
  try {
    await fetchOkxTransactions({ address: "0xwallet", from: NOW - 1000, to: NOW + 1000, config: okxConfig() });
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }

  attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response("server", { status: 500 });
    return new Response(JSON.stringify({ code: "0", data: [{ cursor: "", transactionList: [] }] }), { status: 200 });
  };
  try {
    await fetchOkxTransactions({ address: "0xwallet", from: NOW - 1000, to: NOW + 1000, config: okxConfig() });
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authentication-style OKX 4xx responses are not retried", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response("unauthorized", { status: 401 });
  };
  try {
    await assert.rejects(
      fetchOkxTransactions({ address: "0xwallet", from: NOW - 1000, to: NOW + 1000, config: okxConfig() }),
      (error: unknown) => error instanceof OkxApiError && error.retryable === false,
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OKX timeout and retry exhaustion return safe structured errors", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (_input, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  try {
    await assert.rejects(
      fetchOkxTransactions({ address: "0xwallet", from: NOW - 1000, to: NOW + 1000, config: okxConfig({ okxTimeoutMs: 1 }) }),
      (error: unknown) => error instanceof UpstreamTimeoutError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => {
    attempts += 1;
    return new Response("server", { status: 500 });
  };
  try {
    await assert.rejects(
      fetchOkxTransactions({ address: "0xwallet", from: NOW - 1000, to: NOW + 1000, config: okxConfig() }),
      (error: unknown) => error instanceof OkxApiError && error.retryable === true,
    );
    assert.equal(attempts, 3);
    const errorBody = await errorResponse(new OkxApiError(true)).json();
    assert.deepEqual(errorBody, { error: { code: "OKX_API_ERROR", message: "Unable to retrieve live financial activity from OKX.", retryable: true } });
    assert.equal(JSON.stringify(errorBody).includes("test-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
