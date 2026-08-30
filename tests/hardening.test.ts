import assert from "node:assert/strict";
import test from "node:test";

import { POST as companyHealthPost } from "../app/api/company-health/route";
import { analyzeProvidedFinancialState, buildSpendDecision } from "../lib/analysis";
import { buildAllocationDecision } from "../lib/allocation";
import { normalizeFinancialState } from "../lib/financial-context";
import { buildFinancialRecommendations, getFinancialStatus } from "../lib/recommendations";
import { deriveFinancialRiskSignals } from "../lib/risk";
import { evaluateCapitalAllocationPolicy, evaluateServicePurchasePolicy } from "../lib/policy";
import { companyHealthSchema } from "../lib/validation";

const NOW = Date.parse("2026-08-30T00:00:00.000Z");

function state(overrides: Record<string, unknown> = {}) {
  return {
    periodDays: 30,
    cashFlow: { inflows: 200, outflows: 100 },
    ...overrides,
  } as Parameters<typeof normalizeFinancialState>[0];
}

function report(overrides: Record<string, unknown> = {}, monthlyBudget?: number) {
  return analyzeProvidedFinancialState({
    wallet: "provided-state",
    financialState: state(overrides),
    monthlyBudget,
    now: NOW,
  });
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/company-health", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("provider spend above outflows is rejected by request validation", async () => {
  const body = state({ providers: [{ provider: "provider-a", spend: 100.02, transactions: 1 }] });
  assert.equal(companyHealthSchema.safeParse(body).success, false);
  const response = await companyHealthPost(request({ source: "provided_state", financialState: body }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /must not exceed cashFlow\.outflows/);
});

test("partial provider spend below outflows is accepted", () => {
  const normalized = normalizeFinancialState(state({
    providers: [{ provider: "provider-a", spend: 20, transactions: 2 }],
  }));
  assert.equal(normalized.outflows, 100);
  assert.equal(normalized.providers[0]?.spend, 20);
});

test("duplicate providers aggregate case-insensitively including failed attempts", () => {
  const normalized = normalizeFinancialState(state({
    providers: [
      { provider: "Provider-A", spend: 20, transactions: 2, failedTransactions: 3 },
      { provider: " provider-a ", spend: 10, transactions: 1, failedTransactions: 2 },
    ],
  }));
  assert.deepEqual(normalized.providers, [{ provider: "Provider-A", spend: 30, transactions: 3, failedTransactions: 5 }]);
  assert.deepEqual(normalized.failedProviders, [{ provider: "Provider-A", transactions: 5 }]);
  assert.equal(normalized.failedTransactions, 5);
});

test("failed provider attempts are independent from successful transactions", () => {
  const normalized = normalizeFinancialState(state({
    providers: [{ provider: "provider-a", spend: 20, transactions: 1, failedTransactions: 4 }],
  }));
  assert.equal(normalized.providers[0]?.transactions, 1);
  assert.equal(normalized.providers[0]?.failedTransactions, 4);
});

test("explicit outgoing transaction total must cover known successful provider transactions", () => {
  const result = companyHealthSchema.safeParse(state({
    cashFlow: { inflows: 200, outflows: 100, outgoingTransactions: 2 },
    providers: [{ provider: "provider-a", spend: 20, transactions: 3 }],
  }));
  assert.equal(result.success, false);
});

test("known provider failures must be included in an explicit top-level failure count", () => {
  const result = companyHealthSchema.safeParse(state({
    providers: [{ provider: "provider-a", spend: 20, transactions: 1, failedTransactions: 2 }],
    failedTransactions: 1,
  }));
  assert.equal(result.success, false);
});

test("provider failures are derived when top-level failures are omitted", () => {
  const normalized = normalizeFinancialState(state({
    providers: [{ provider: "provider-a", spend: 20, transactions: 1, failedTransactions: 2 }],
  }));
  assert.equal(normalized.failedTransactions, 2);
});

test("financial risk signals expose critical budget risk consistently", () => {
  const current = report({}, 100);
  const signals = deriveFinancialRiskSignals(current);
  assert.equal(signals.find((signal) => signal.type === "budget_utilization")?.severity, "critical");
  assert.equal(getFinancialStatus(current), "critical");
  assert.equal(buildFinancialRecommendations(current)[0]?.severity, "critical");
});

test("critical provider concentration is shared by status and recommendations", () => {
  const current = report({
    cashFlow: { inflows: 200, outflows: 100 },
    providers: [
      { provider: "provider-a", spend: 60, transactions: 1 },
      { provider: "provider-b", spend: 40, transactions: 1 },
    ],
  });
  assert.equal(getFinancialStatus(current), "critical");
  assert.equal(buildFinancialRecommendations(current)[0]?.severity, "critical");
});

test("extreme spend acceleration produces a critical status and recommendation", () => {
  const current = report({
    cashFlow: { inflows: 400, outflows: 235 },
    spendVelocity: { firstHalf: 65, secondHalf: 170 },
  });
  assert.equal(getFinancialStatus(current), "critical");
  assert.equal(buildFinancialRecommendations(current).find((item) => item.type === "control_spend_acceleration")?.severity, "critical");
});

test("moderate spend acceleration produces caution rather than critical status", () => {
  const current = report({ spendVelocity: { firstHalf: 50, secondHalf: 90 } });
  assert.equal(getFinancialStatus(current), "caution");
  assert.equal(buildFinancialRecommendations(current).find((item) => item.type === "control_spend_acceleration")?.severity, "high");
});

test("negative cash flow is a caution signal unless another risk is critical", () => {
  const current = report({ cashFlow: { inflows: 20, outflows: 100 } });
  assert.equal(getFinancialStatus(current), "caution");
  assert.equal(deriveFinancialRiskSignals(current).find((signal) => signal.type === "negative_cash_flow")?.severity, "high");
});

test("failed transactions produce a caution signal", () => {
  const current = report({ failedTransactions: 1 });
  assert.equal(getFinancialStatus(current), "caution");
  assert.equal(deriveFinancialRiskSignals(current).find((signal) => signal.type === "failed_transactions")?.severity, "medium");
});

test("positive controlled activity remains healthy", () => {
  const current = report({ cashFlow: { inflows: 100, outflows: 20 } }, 100);
  assert.equal(getFinancialStatus(current), "healthy");
  assert.equal(buildFinancialRecommendations(current)[0]?.type, "use_available_financial_capacity");
});

test("recommendations remain capped at three and ordered deterministically", () => {
  const current = report({
    cashFlow: { inflows: 20, outflows: 100 },
    spendVelocity: { firstHalf: 10, secondHalf: 90 },
    providers: [
      { provider: "provider-a", spend: 60, transactions: 3 },
      { provider: "provider-b", spend: 40, transactions: 1 },
    ],
    failedTransactions: 1,
  }, 100);
  const first = buildFinancialRecommendations(current).map((item) => `${item.priority}:${item.type}:${item.severity}`);
  const second = buildFinancialRecommendations(current).map((item) => `${item.priority}:${item.type}:${item.severity}`);
  assert.deepEqual(first, second);
  assert.ok(first.length <= 3);
});

test("zero total capital produces finite deterministic allocation output", () => {
  const result = evaluateCapitalAllocationPolicy({
    action: { type: "capital_allocation", amount: 0, strategy: "zero" },
    currentStrategyAllocation: 0,
    totalCapital: 0,
    dailyLossUsed: 0,
  }, { maxStrategyAllocationPct: 35 });
  assert.equal(result.decision, "approve");
  assert.equal(Number.isFinite(result.strategyAllocationPct), true);
  assert.equal(Number.isFinite(result.strategyLimitUtilizationPct), true);
});

test("zero budget service purchase remains finite and deterministic", () => {
  const current = report({ cashFlow: { inflows: 0, outflows: 0 } });
  const result = buildSpendDecision({ report: current, proposedSpend: 0, monthlyBudget: 0 });
  assert.equal(result.decision, "approve");
  assert.equal(result.projectedBudgetUsedPct, 0);
  assert.equal(Number.isFinite(result.budgetRemainingAfterSpend), true);
});

test("budget caution and critical equality boundaries remain non-crossing", () => {
  const caution = evaluateServicePurchasePolicy({
    action: { type: "service_purchase", amount: 0, provider: "provider-a" },
    currentSpend: 75,
    projectedSpend: 75,
    currentNormalizedSpend: 75,
    projectedNormalizedSpend: 75,
    currentProviderConcentrationPct: 0,
    projectedProviderConcentrationPct: 0,
  }, { monthlySpendLimit: 100, reservePct: 0, cautionBudgetUtilizationPct: 75, criticalBudgetUtilizationPct: 90 });
  assert.equal(caution.decision, "approve");

  const critical = evaluateServicePurchasePolicy({
    action: { type: "service_purchase", amount: 0, provider: "provider-a" },
    currentSpend: 90,
    projectedSpend: 90,
    currentNormalizedSpend: 90,
    projectedNormalizedSpend: 90,
    currentProviderConcentrationPct: 0,
    projectedProviderConcentrationPct: 0,
  }, { monthlySpendLimit: 100, reservePct: 0, cautionBudgetUtilizationPct: 75, criticalBudgetUtilizationPct: 90 });
  assert.equal(critical.decision, "caution");
});

test("loss caution and critical equality boundaries remain deterministic", () => {
  const caution = evaluateCapitalAllocationPolicy({
    action: { type: "capital_allocation", amount: 0, strategy: "loss" },
    currentStrategyAllocation: 0,
    totalCapital: 1000,
    dailyLossUsed: 70,
  }, { dailyLossLimit: 100, cautionLossUtilizationPct: 70, criticalLossUtilizationPct: 90 });
  assert.equal(caution.decision, "approve");

  const critical = evaluateCapitalAllocationPolicy({
    action: { type: "capital_allocation", amount: 0, strategy: "loss" },
    currentStrategyAllocation: 0,
    totalCapital: 1000,
    dailyLossUsed: 90,
  }, { dailyLossLimit: 100, cautionLossUtilizationPct: 70, criticalLossUtilizationPct: 90 });
  assert.equal(critical.decision, "reject");
});

test("allocation recommended maximum never becomes negative when current state is over limit", () => {
  const result = buildAllocationDecision({
    agent: "agent",
    strategy: "strategy",
    proposedCapital: 0,
    currentStrategyAllocation: 100,
    totalCapital: 50,
    strategyCapitalLimit: 75,
    dailyLossUsed: 0,
    dailyLossLimit: 100,
  });
  assert.equal(result.recommendedAction.recommendedMaximum, 0);
});
