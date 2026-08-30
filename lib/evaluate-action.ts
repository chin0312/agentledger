import { normalizeMonthlySpend } from "./analysis";
import { loadCompanyHealth } from "./financial-service";
import { evaluateCapitalAllocationPolicy, evaluateServicePurchasePolicy, resolveFinancialPolicy } from "./policy";
import type { DataSource, EvaluateActionRequest, EvaluateActionResponse, FinancialPolicy } from "./types";
import { APP_NAME, APP_VERSION } from "./types";

const DAY_COUNT = 30;

function round(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function percentage(value: number, total: number): number {
  if (total <= 0) {
    return value > 0 ? 100 : 0;
  }

  return round((value / total) * 100);
}

function display(value: number): string {
  return round(value).toFixed(2).replace(/\.00$/, "");
}

function findProviderSpend(report: Awaited<ReturnType<typeof loadCompanyHealth>>, provider: string): number {
  const match = report.topCounterparties.find(
    (counterparty) => counterparty.address.toLowerCase() === provider.trim().toLowerCase(),
  );
  return match?.spend ?? 0;
}

function servicePurchaseReason(
  result: ReturnType<typeof evaluateServicePurchasePolicy>,
  projectedBudgetPct: number | null,
): string {
  const budgetWarning = [...result.violatedPolicies, ...result.warnings].find(
    (item) => item.rule === "monthly_spend_limit" || item.rule === "reserve_requirement" || item.rule.includes("budget_utilization"),
  );
  if (budgetWarning && projectedBudgetPct !== null) {
    return result.decision === "reject"
      ? `Reject the service purchase because projected normalized monthly budget utilization would be ${display(projectedBudgetPct)}%, outside the configured safe range.`
      : `The service purchase keeps projected monthly budget utilization at ${display(projectedBudgetPct)}%; proceed with caution.`;
  }

  const policyIssue = result.violatedPolicies[0] ?? result.warnings[0];
  return result.decision === "approve"
    ? "The service purchase complies with the configured financial policy."
    : policyIssue?.message ?? result.recommendation;
}

function servicePurchaseRecommendedMaximum(
  report: Awaited<ReturnType<typeof loadCompanyHealth>>,
  input: Extract<EvaluateActionRequest["action"], { type: "service_purchase" }>,
  policy: FinancialPolicy | undefined,
  currentSpend: number,
  currentNormalizedSpend: number,
  providerSpend: number,
): number {
  const resolved = resolveFinancialPolicy(policy);
  const maximums: number[] = [];
  if (resolved.maxSingleActionAmount !== undefined) {
    maximums.push(resolved.maxSingleActionAmount);
  }

  if (resolved.monthlySpendLimit !== undefined) {
    const availableNormalized = Math.max(
      0,
      resolved.monthlySpendLimit * (1 - resolved.reservePct / 100) - currentNormalizedSpend,
    );
    maximums.push(availableNormalized * (report.period.days / DAY_COUNT));
  }

  if (currentSpend > 0 && resolved.maxProviderConcentrationPct < 100) {
    const providerLimit = resolved.maxProviderConcentrationPct / 100;
    maximums.push(Math.max(0, (providerLimit * currentSpend - providerSpend) / (1 - providerLimit)));
  }

  if (maximums.length === 0) {
    return round(input.amount);
  }

  return round(Math.max(0, Math.min(...maximums)));
}

async function evaluateServicePurchase(
  input: EvaluateActionRequest,
  dataSource: DataSource,
): Promise<EvaluateActionResponse> {
  if (input.action.type !== "service_purchase") {
    throw new Error("evaluateServicePurchase received a non-service action");
  }

  const days = input.context?.days ?? DAY_COUNT;
  const serviceDataSource: DataSource = dataSource === "demo"
    ? "demo"
    : input.financialState || input.source === "provided_state"
      ? "provided_state"
      : dataSource;
  const report = await loadCompanyHealth(
    {
      address: input.entity,
      days,
      monthlyBudget: input.policy?.monthlySpendLimit,
      policy: input.policy,
      ...(input.financialState ? { financialState: input.financialState, source: "provided_state" as const } : {}),
    },
    serviceDataSource,
    "/api/recommendations",
  );
  const currentSpend = report.cashFlow.spend;
  const projectedSpend = currentSpend + input.action.amount;
  const currentNormalizedSpend = report.budget?.normalizedUsed ?? normalizeMonthlySpend(currentSpend, days);
  const projectedNormalizedSpend = normalizeMonthlySpend(projectedSpend, days);
  const providerSpend = findProviderSpend(report, input.action.provider);
  const currentProviderConcentrationPct = percentage(providerSpend, currentSpend);
  const projectedProviderConcentrationPct = percentage(providerSpend + input.action.amount, projectedSpend);
  const result = evaluateServicePurchasePolicy(
    {
      action: input.action,
      currentSpend,
      projectedSpend,
      currentNormalizedSpend,
      projectedNormalizedSpend,
      currentProviderConcentrationPct,
      projectedProviderConcentrationPct,
    },
    input.policy,
  );
  const projectedBudgetPct =
    input.policy?.monthlySpendLimit === undefined
      ? null
      : percentage(projectedNormalizedSpend, input.policy.monthlySpendLimit);
  const recommendedMaximum = servicePurchaseRecommendedMaximum(
    report,
    input.action,
    input.policy,
    currentSpend,
    currentNormalizedSpend,
    providerSpend,
  );

  return {
    service: APP_NAME,
    version: APP_VERSION,
    actionType: input.action.type,
    dataSource: report.dataSource,
    stateVerification: report.stateVerification,
    decision: result.decision,
    approved: result.decision !== "reject",
    risk: result.risk,
    reason: servicePurchaseReason(result, projectedBudgetPct),
    violatedPolicies: result.violatedPolicies,
    warnings: result.warnings,
    recommendation: result.recommendation,
    recommendedAction: {
      type: result.decision === "approve" ? "proceed" : result.decision === "caution" ? "review_before_purchase" : "reduce_action_amount",
      target: input.action.provider,
      recommendedMaximum,
    },
    projectedState: {
      spend: round(projectedSpend),
      normalizedSpend: round(projectedNormalizedSpend),
      ...(input.policy?.monthlySpendLimit === undefined
        ? {}
        : { budgetRemaining: round(input.policy.monthlySpendLimit - projectedNormalizedSpend) }),
      providerConcentrationPct: projectedProviderConcentrationPct,
    },
    generatedAt: new Date().toISOString(),
  };
}

function capitalAllocationRecommendedMaximum(
  input: Extract<EvaluateActionRequest["action"], { type: "capital_allocation" }>,
  state: NonNullable<EvaluateActionRequest["state"]>,
  policy: FinancialPolicy | undefined,
  lossBudgetUsedPct: number,
): number {
  const resolved = resolveFinancialPolicy(policy);
  const maximums = [
    Math.max(0, state.totalCapital - state.currentStrategyAllocation),
    Math.max(0, state.totalCapital * (resolved.maxStrategyAllocationPct / 100) - state.currentStrategyAllocation),
  ];
  if (resolved.maxStrategyAllocationAbsolute !== undefined) {
    maximums.push(Math.max(0, resolved.maxStrategyAllocationAbsolute - state.currentStrategyAllocation));
  }
  if (resolved.maxSingleActionAmount !== undefined) {
    maximums.push(resolved.maxSingleActionAmount);
  }
  if (resolved.dailyLossLimit !== undefined && lossBudgetUsedPct >= resolved.criticalLossUtilizationPct) {
    return 0;
  }

  return round(Math.max(0, Math.min(...maximums)));
}

function capitalAllocationReason(
  result: ReturnType<typeof evaluateCapitalAllocationPolicy>,
): string {
  const lossWarning = [...result.violatedPolicies, ...result.warnings].find((item) => item.rule.includes("loss_utilization"));
  if (lossWarning) {
    return result.decision === "reject"
      ? "Reject the allocation because the configured daily loss policy is at its critical threshold."
      : `The allocation remains within hard strategy limits, but daily loss utilization has reached ${display(result.lossBudgetUsedPct)}%.`;
  }

  return result.decision === "approve"
    ? "The capital allocation complies with the configured financial policy."
    : result.violatedPolicies[0]?.message ?? result.warnings[0]?.message ?? result.recommendation;
}

function evaluateCapitalAllocation(
  input: EvaluateActionRequest,
  dataSource: DataSource,
): EvaluateActionResponse {
  if (input.action.type !== "capital_allocation" || !input.state) {
    throw new Error("capital_allocation requires state");
  }

  const result = evaluateCapitalAllocationPolicy(
    {
      action: input.action,
      currentStrategyAllocation: input.state.currentStrategyAllocation,
      totalCapital: input.state.totalCapital,
      dailyLossUsed: input.state.dailyLossUsed,
    },
    input.policy,
  );
  const recommendedMaximum = capitalAllocationRecommendedMaximum(input.action, input.state, input.policy, result.lossBudgetUsedPct);

  return {
    service: APP_NAME,
    version: APP_VERSION,
    actionType: input.action.type,
    dataSource: dataSource === "demo" ? "demo" : "provided_state",
    stateVerification: dataSource === "demo" ? "demo" : "caller_supplied",
    decision: result.decision,
    approved: result.decision !== "reject",
    risk: result.risk,
    reason: capitalAllocationReason(result),
    violatedPolicies: result.violatedPolicies,
    warnings: result.warnings,
    recommendation: result.recommendation,
    recommendedAction: {
      type: result.decision === "approve" ? "maintain_allocation" : result.decision === "caution" ? "cap_allocation" : "reduce_allocation",
      recommendedMaximum,
    },
    projectedState: {
      strategyAllocation: result.projectedStrategyAllocation,
      strategyAllocationPct: result.strategyAllocationPct,
      lossBudgetUsedPct: result.lossBudgetUsedPct,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function evaluateAction(
  input: EvaluateActionRequest,
  dataSource: DataSource,
): Promise<EvaluateActionResponse> {
  return input.action.type === "service_purchase"
    ? evaluateServicePurchase(input, dataSource)
    : evaluateCapitalAllocation(input, dataSource);
}
