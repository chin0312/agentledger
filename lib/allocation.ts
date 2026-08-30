import type { CanIAllocateReport, CanIAllocateRequest, DataSource } from "./types";
import { APP_NAME, APP_VERSION } from "./types";
import { evaluateCapitalAllocationPolicy } from "./policy";

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

export function buildAllocationDecision(input: CanIAllocateRequest, dataSource: DataSource = "provided_state"): CanIAllocateReport {
  const projectedAllocation = input.currentStrategyAllocation + input.proposedCapital;
  const projectedStrategyConcentrationPct = percentage(projectedAllocation, input.totalCapital);
  const strategyLimitUtilizationPct = percentage(projectedAllocation, input.strategyCapitalLimit);
  const lossBudgetUtilizationPct = percentage(input.dailyLossUsed, input.dailyLossLimit);
  // Preserve the specialist endpoint's established 50% concentration ceiling
  // while sharing the same evaluation mechanics as the generalized action API.
  const policyEvaluation = evaluateCapitalAllocationPolicy(
    {
      action: { type: "capital_allocation", amount: input.proposedCapital, strategy: input.strategy },
      currentStrategyAllocation: input.currentStrategyAllocation,
      totalCapital: input.totalCapital,
      dailyLossUsed: input.dailyLossUsed,
    },
    {
      maxStrategyAllocationPct: 50,
      maxStrategyAllocationAbsolute: input.strategyCapitalLimit,
      dailyLossLimit: input.dailyLossLimit,
    },
  );
  const decision = policyEvaluation.decision;
  const approved = decision !== "reject";
  const risk: CanIAllocateReport["risk"] = policyEvaluation.risk === "critical" ? "high" : policyEvaluation.risk;
  const reason = decision === "approve"
    ? "The allocation remains within the strategy limit, total capital, loss budget, and concentration policy."
    : policyEvaluation.recommendation;

  let recommendedMaximum = Math.max(
    0,
    Math.min(input.strategyCapitalLimit - input.currentStrategyAllocation, input.totalCapital - input.currentStrategyAllocation),
  );
  if (lossBudgetUtilizationPct >= 90) {
    recommendedMaximum = 0;
  }
  if (projectedStrategyConcentrationPct > 50) {
    recommendedMaximum = Math.min(recommendedMaximum, input.totalCapital * 0.5 - input.currentStrategyAllocation);
  }

  const recommendedAction: CanIAllocateReport["recommendedAction"] = {
    type: decision === "approve" ? "maintain_allocation" : decision === "caution" ? "cap_allocation" : "reduce_allocation",
    recommendedMaximum: round(Math.max(0, recommendedMaximum)),
  };

  return {
    service: APP_NAME,
    analysisVersion: APP_VERSION,
    dataSource,
    stateVerification: dataSource === "demo" ? "demo" : "caller_supplied",
    decision,
    approved,
    risk,
    reason,
    capital: {
      currentAllocation: round(input.currentStrategyAllocation),
      proposedCapital: round(input.proposedCapital),
      projectedAllocation: round(projectedAllocation),
      totalCapital: round(input.totalCapital),
      strategyCapitalLimit: round(input.strategyCapitalLimit),
      projectedStrategyConcentrationPct,
      strategyLimitUtilizationPct,
    },
    lossBudget: {
      used: round(input.dailyLossUsed),
      limit: round(input.dailyLossLimit),
      usedPct: lossBudgetUtilizationPct,
    },
    recommendedAction,
  };
}
