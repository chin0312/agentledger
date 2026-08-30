import assert from "node:assert/strict";
import test from "node:test";

import { buildAllocationDecision } from "../lib/allocation";
import { analyzeCompanyHealth, buildSpendDecision } from "../lib/analysis";
import { buildFinancialRecommendations, buildRecommendationsReport, getFinancialStatus } from "../lib/recommendations";
import { fetchOkxTransactions } from "../lib/okx";
import type { NormalizedTransaction } from "../lib/types";
import { POST as companyHealthPost } from "../app/api/company-health/route";
import { POST as demoCompanyHealthPost } from "../app/api/demo/company-health/route";
import { POST as demoRecommendationsPost } from "../app/api/demo/recommendations/route";
import { POST as recommendationsPost } from "../app/api/recommendations/route";
import { POST as spendPost } from "../app/api/can-i-spend/route";
import { POST as allocatePost } from "../app/api/can-i-allocate/route";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const LIVE_ENV_KEYS = ["DEMO_MODE", "OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE", "OKX_PROJECT_ID", "OKX_CHAINS"];

function transaction(options: {
  index: number;
  daysAgo: number;
  amount: number;
  direction: "incoming" | "outgoing";
  counterparty?: string;
  status?: "success" | "failed";
}): NormalizedTransaction {
  return {
    txHash: `0xupgrade${options.index}`,
    timestamp: NOW - options.daysAgo * DAY_MS,
    symbol: "USDC",
    amount: options.amount,
    direction: options.direction,
    counterparty: options.counterparty ?? `0xvendor${options.index}`,
    status: options.status ?? "success",
  };
}

function report(transactions: NormalizedTransaction[], monthlyBudget?: number) {
  return analyzeCompanyHealth({
    wallet: "0xwallet",
    days: 30,
    monthlyBudget,
    now: NOW,
    dataSource: "demo",
    transactions,
  });
}

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function clearLiveEnvironment(): Record<string, string | undefined> {
  const previous = Object.fromEntries(LIVE_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of LIVE_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.DEMO_MODE = "true";
  return previous;
}

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const key of LIVE_ENV_KEYS) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
}

test("budget pressure creates a prioritized recommendation", () => {
  const result = buildFinancialRecommendations(
    report([transaction({ index: 1, daysAgo: 20, amount: 80, direction: "outgoing" })], 100),
  );
  const recommendation = result.find((item) => item.type === "reduce_budget_pressure");
  assert.equal(recommendation?.severity, "high");
  assert.equal(recommendation?.target?.desired, 75);
});

test("provider concentration creates a critical recommendation above 50 percent", () => {
  const result = buildFinancialRecommendations(
    report([
      transaction({ index: 1, daysAgo: 4, amount: 60, direction: "outgoing", counterparty: "0xdominant" }),
      transaction({ index: 2, daysAgo: 3, amount: 40, direction: "outgoing", counterparty: "0xother" }),
    ]),
  );
  const recommendation = result.find((item) => item.type === "reduce_provider_concentration");
  assert.equal(recommendation?.severity, "critical");
  assert.equal(recommendation?.target?.current, 60);
});

test("spend acceleration creates a recommendation", () => {
  const result = buildFinancialRecommendations(
    report([
      transaction({ index: 1, daysAgo: 25, amount: 20, direction: "outgoing" }),
      transaction({ index: 2, daysAgo: 5, amount: 60, direction: "outgoing" }),
    ]),
  );
  assert.equal(result.find((item) => item.type === "control_spend_acceleration")?.severity, "critical");
});

test("negative cash flow recommends reaching break-even", () => {
  const result = buildFinancialRecommendations(
    report([
      transaction({ index: 1, daysAgo: 5, amount: 20, direction: "incoming" }),
      transaction({ index: 2, daysAgo: 4, amount: 45, direction: "outgoing" }),
    ]),
  );
  const recommendation = result.find((item) => item.type === "restore_positive_cash_flow");
  assert.equal(recommendation?.severity, "high");
  assert.equal(recommendation?.action?.recommendedValue, 25);
});

test("repeated providers include count, total and average payment size", () => {
  const result = buildFinancialRecommendations(
    report([
      transaction({ index: 1, daysAgo: 25, amount: 100, direction: "incoming" }),
      transaction({ index: 2, daysAgo: 20, amount: 10, direction: "outgoing", counterparty: "0xrepeat" }),
      transaction({ index: 3, daysAgo: 21, amount: 20, direction: "outgoing", counterparty: "0xREPEAT" }),
      transaction({ index: 4, daysAgo: 22, amount: 30, direction: "outgoing", counterparty: "0xrepeat" }),
    ]),
  );
  const recommendation = result.find((item) => item.type === "review_repeated_provider_cost");
  assert.deepEqual(recommendation?.evidence, { paymentCount: 3, totalSpend: 60, averagePaymentSize: 20 });
});

test("positive financial capacity is recommended only with a healthy profile", () => {
  const result = buildFinancialRecommendations(
    report([
      transaction({ index: 1, daysAgo: 25, amount: 100, direction: "incoming" }),
      transaction({ index: 2, daysAgo: 25, amount: 5, direction: "outgoing", counterparty: "0xa" }),
      transaction({ index: 3, daysAgo: 24, amount: 5, direction: "outgoing", counterparty: "0xb" }),
      transaction({ index: 4, daysAgo: 23, amount: 5, direction: "outgoing", counterparty: "0xc" }),
      transaction({ index: 5, daysAgo: 22, amount: 5, direction: "outgoing", counterparty: "0xd" }),
    ], 100),
  );
  assert.equal(result[0]?.type, "use_available_financial_capacity");
  assert.equal(result[0]?.action?.recommendedValue, 60);
});

test("recommendations are sorted by severity and capped at three", () => {
  const result = buildFinancialRecommendations(
    report([
      transaction({ index: 1, daysAgo: 25, amount: 5, direction: "outgoing", counterparty: "0xsmall" }),
      transaction({ index: 2, daysAgo: 5, amount: 90, direction: "outgoing", counterparty: "0xdominant" }),
      transaction({ index: 3, daysAgo: 4, amount: 10, direction: "incoming" }),
      transaction({ index: 4, daysAgo: 3, amount: 10, direction: "outgoing", counterparty: "0xrepeat" }),
      transaction({ index: 5, daysAgo: 2, amount: 10, direction: "outgoing", counterparty: "0xrepeat" }),
      transaction({ index: 6, daysAgo: 1, amount: 10, direction: "outgoing", counterparty: "0xrepeat" }),
    ], 100),
  );
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.priority), [1, 2, 3]);
  assert.equal(result[0]?.severity, "critical");
});

test("financial status distinguishes healthy, caution and critical", () => {
  assert.equal(getFinancialStatus(report([transaction({ index: 1, daysAgo: 4, amount: 20, direction: "outgoing" })], 100)), "critical");
  assert.equal(
    getFinancialStatus(
      report([
        transaction({ index: 1, daysAgo: 5, amount: 20, direction: "incoming" }),
        transaction({ index: 2, daysAgo: 4, amount: 15, direction: "outgoing", counterparty: "0xa" }),
        transaction({ index: 3, daysAgo: 5, amount: 15, direction: "outgoing", counterparty: "0xb" }),
      ], 100),
    ),
    "caution",
  );
  assert.equal(
    getFinancialStatus(
      report([
        transaction({ index: 1, daysAgo: 5, amount: 100, direction: "incoming" }),
        transaction({ index: 2, daysAgo: 20, amount: 10, direction: "outgoing", counterparty: "0xa" }),
        transaction({ index: 3, daysAgo: 21, amount: 10, direction: "outgoing", counterparty: "0xb" }),
        transaction({ index: 4, daysAgo: 22, amount: 10, direction: "outgoing", counterparty: "0xc" }),
        transaction({ index: 5, daysAgo: 23, amount: 10, direction: "outgoing", counterparty: "0xd" }),
      ], 100),
    ),
    "healthy",
  );
});

test("missing monthly budget does not create a budget recommendation", () => {
  const result = buildFinancialRecommendations(
    report([
      transaction({ index: 1, daysAgo: 5, amount: 100, direction: "incoming" }),
      transaction({ index: 2, daysAgo: 4, amount: 10, direction: "outgoing" }),
    ]),
  );
  assert.equal(result.some((item) => item.type === "reduce_budget_pressure"), false);
  assert.equal(report([transaction({ index: 1, daysAgo: 4, amount: 10, direction: "outgoing" })]).budget, null);
});

test("spend guard downgrades an affordable spend when concentration crosses 50 percent", () => {
  const health = report([
    transaction({ index: 1, daysAgo: 4, amount: 42, direction: "outgoing", counterparty: "0xvendor" }),
    transaction({ index: 2, daysAgo: 3, amount: 58, direction: "outgoing", counterparty: "0xother" }),
  ], 300);
  const result = buildSpendDecision({ report: health, proposedSpend: 20, monthlyBudget: 300, vendor: "0xVENDOR" });
  assert.equal(result.decision, "caution");
  assert.equal(result.approved, true);
  assert.deepEqual(result.vendorConcentration, { currentPct: 42, projectedPct: 51.67, warning: true });
  assert.equal(result.financialImpact.currentBudgetUsedPct, 33.33);
});

test("capital guard approves a healthy allocation", () => {
  const result = buildAllocationDecision({
    agent: "0xagent",
    strategy: "stable-v1",
    proposedCapital: 100,
    currentStrategyAllocation: 500,
    totalCapital: 5000,
    strategyCapitalLimit: 1500,
    dailyLossUsed: 20,
    dailyLossLimit: 100,
  });
  assert.equal(result.decision, "approve");
  assert.equal(result.capital.projectedAllocation, 600);
  assert.equal(result.capital.projectedStrategyConcentrationPct, 12);
  assert.equal(result.capital.strategyLimitUtilizationPct, 40);
});

test("capital guard cautions on high loss-budget usage", () => {
  const result = buildAllocationDecision({
    agent: "0xagent",
    strategy: "stable-v1",
    proposedCapital: 100,
    currentStrategyAllocation: 500,
    totalCapital: 5000,
    strategyCapitalLimit: 1500,
    dailyLossUsed: 76,
    dailyLossLimit: 100,
  });
  assert.equal(result.decision, "caution");
  assert.equal(result.risk, "medium");
  assert.equal(result.lossBudget.usedPct, 76);
});

test("capital guard rejects strategy limit and extreme loss budget violations", () => {
  const limitResult = buildAllocationDecision({
    agent: "0xagent",
    strategy: "stable-v1",
    proposedCapital: 400,
    currentStrategyAllocation: 1200,
    totalCapital: 5000,
    strategyCapitalLimit: 1500,
    dailyLossUsed: 20,
    dailyLossLimit: 100,
  });
  assert.equal(limitResult.decision, "reject");
  assert.equal(limitResult.recommendedAction.recommendedMaximum, 300);

  const lossResult = buildAllocationDecision({
    agent: "0xagent",
    strategy: "stable-v1",
    proposedCapital: 1,
    currentStrategyAllocation: 100,
    totalCapital: 5000,
    strategyCapitalLimit: 1500,
    dailyLossUsed: 90,
    dailyLossLimit: 100,
  });
  assert.equal(lossResult.decision, "reject");
  assert.equal(lossResult.recommendedAction.recommendedMaximum, 0);
});

test("capital guard calculations remain internally correct", () => {
  const result = buildAllocationDecision({
    agent: "0xagent",
    strategy: "momentum-v2",
    proposedCapital: 250,
    currentStrategyAllocation: 1200,
    totalCapital: 5000,
    strategyCapitalLimit: 1500,
    dailyLossUsed: 76,
    dailyLossLimit: 100,
  });
  assert.equal(result.capital.projectedAllocation, result.capital.currentAllocation + result.capital.proposedCapital);
  assert.equal(result.capital.projectedStrategyConcentrationPct, 29);
  assert.equal(result.capital.strategyLimitUtilizationPct, 96.67);
  assert.equal(result.lossBudget.usedPct, 76);
  assert.equal(result.recommendedAction.recommendedMaximum, 300);
});

test("invalid allocation input returns a structured validation error", async () => {
  const response = await allocatePost(request("/api/can-i-allocate", { agent: "", strategy: "x" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "INVALID_REQUEST", message: "agent is required" },
  });
});

test("production company health never falls back to demo data", async () => {
  const previous = clearLiveEnvironment();
  try {
    const response = await companyHealthPost(request("/api/company-health", { address: "0xagentcompany" }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "LIVE_DATA_UNAVAILABLE",
        message: "Live OKX credentials are not configured for this deployment.",
      },
    });
  } finally {
    restoreEnvironment(previous);
  }
});

test("production recommendations and spend guard never fall back to demo data", async () => {
  const previous = clearLiveEnvironment();
  try {
    const recommendationResponse = await recommendationsPost(request("/api/recommendations", { address: "0xagentcompany" }));
    const spendResponse = await spendPost(request("/api/can-i-spend", { address: "0xagentcompany", proposedSpend: 1, monthlyBudget: 100 }));
    assert.equal(recommendationResponse.status, 503);
    assert.equal(spendResponse.status, 503);
    assert.equal((await recommendationResponse.json()).error.code, "PAYMENT_NOT_CONFIGURED");
    assert.equal((await spendResponse.json()).error.code, "LIVE_DATA_UNAVAILABLE");
  } finally {
    restoreEnvironment(previous);
  }
});

test("demo company health and recommendations are explicit and deterministic", async () => {
  const previous = clearLiveEnvironment();
  try {
    const healthBody = { address: "0xagentcompany", days: 30, monthlyBudget: 500 };
    const firstHealth = await demoCompanyHealthPost(request("/api/demo/company-health", healthBody));
    const secondHealth = await demoCompanyHealthPost(request("/api/demo/company-health", healthBody));
    const firstRecommendations = await demoRecommendationsPost(request("/api/demo/recommendations", healthBody));
    const secondRecommendations = await demoRecommendationsPost(request("/api/demo/recommendations", healthBody));
    const healthJson = await firstHealth.json();
    assert.equal(healthJson.dataSource, "demo");
    assert.deepEqual(healthJson, await secondHealth.json());
    assert.deepEqual(await firstRecommendations.json(), await secondRecommendations.json());
    assert.equal((await demoCompanyHealthPost(request("/api/demo/company-health", healthBody))).status, 200);
  } finally {
    restoreEnvironment(previous);
  }
});

test("live API failures are surfaced as OKX_API_ERROR", async () => {
  const previous = clearLiveEnvironment();
  const originalFetch = globalThis.fetch;
  process.env.DEMO_MODE = "false";
  process.env.OKX_API_KEY = "test-key";
  process.env.OKX_SECRET_KEY = "test-secret";
  process.env.OKX_PASSPHRASE = "test-passphrase";
  globalThis.fetch = async () => {
    throw new Error("simulated upstream outage");
  };
  try {
    const response = await companyHealthPost(request("/api/company-health", { address: "0xagentcompany" }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: {
        code: "OKX_API_ERROR",
        message: "Unable to retrieve live financial activity from OKX.",
        retryable: true,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment(previous);
  }
});

test("OKX history adapter reads the current transactionList response shape", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      code: "0",
      msg: "success",
      data: [{
        cursor: "",
        transactionList: [{
          txHash: "0xokx-history",
          txTime: String(NOW),
          symbol: "USDC",
          amount: "12.5",
          from: [{ address: "0xwallet" }],
          to: [{ address: "0xvendor" }],
          txStatus: "success",
        }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await fetchOkxTransactions({
      address: "0xwallet",
      from: NOW - DAY_MS,
      to: NOW + DAY_MS,
      config: {
        demoMode: false,
        apiKey: "test-key",
        secretKey: "test-secret",
        passphrase: "test-passphrase",
        projectId: "",
        chains: ["1"],
      },
    });
    assert.equal(result[0]?.txHash, "0xokx-history");
    assert.match(requestedUrl, /limit=20/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recommendations report contains a concise summary and at most three actions", () => {
  const result = buildRecommendationsReport(
    report([
      transaction({ index: 1, daysAgo: 25, amount: 10, direction: "incoming" }),
      transaction({ index: 2, daysAgo: 5, amount: 30, direction: "outgoing", counterparty: "0xvendor" }),
    ], 100),
    new Date(NOW).toISOString(),
  );
  assert.equal(result.version, "0.3.3");
  assert.ok(result.executiveSummary.length > 0);
  assert.ok(result.recommendedActions.length <= 3);
});
