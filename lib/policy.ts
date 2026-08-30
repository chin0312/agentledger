import { z } from "zod";

import type {
  CapitalAllocationAction,
  FinancialPolicy,
  PolicyEvaluation,
  PolicyRisk,
  PolicyStatus,
  PolicyViolation,
  ServicePurchaseAction,
} from "./types";

export const MAX_FINANCIAL_VALUE = 1_000_000_000_000_000;

export const financialPolicySchema = z
  .object({
    monthlySpendLimit: z.number().finite("monthlySpendLimit must be finite").min(0, "monthlySpendLimit must be greater than or equal to zero").max(MAX_FINANCIAL_VALUE, "monthlySpendLimit is unreasonably large").optional(),
    reservePct: z.number().finite("reservePct must be finite").min(0, "reservePct must be at least zero").max(100, "reservePct must be at most 100").optional(),
    cautionBudgetUtilizationPct: z.number().finite("cautionBudgetUtilizationPct must be finite").min(0, "cautionBudgetUtilizationPct must be at least zero").max(100, "cautionBudgetUtilizationPct must be at most 100").optional(),
    criticalBudgetUtilizationPct: z.number().finite("criticalBudgetUtilizationPct must be finite").min(0, "criticalBudgetUtilizationPct must be at least zero").max(100, "criticalBudgetUtilizationPct must be at most 100").optional(),
    maxProviderConcentrationPct: z.number().finite("maxProviderConcentrationPct must be finite").min(0, "maxProviderConcentrationPct must be at least zero").max(100, "maxProviderConcentrationPct must be at most 100").optional(),
    maxSingleActionAmount: z.number().finite("maxSingleActionAmount must be finite").min(0, "maxSingleActionAmount must be greater than or equal to zero").max(MAX_FINANCIAL_VALUE, "maxSingleActionAmount is unreasonably large").optional(),
    maxStrategyAllocationPct: z.number().finite("maxStrategyAllocationPct must be finite").min(0, "maxStrategyAllocationPct must be at least zero").max(100, "maxStrategyAllocationPct must be at most 100").optional(),
    maxStrategyAllocationAbsolute: z.number().finite("maxStrategyAllocationAbsolute must be finite").min(0, "maxStrategyAllocationAbsolute must be greater than or equal to zero").max(MAX_FINANCIAL_VALUE, "maxStrategyAllocationAbsolute is unreasonably large").optional(),
    dailyLossLimit: z.number().finite("dailyLossLimit must be finite").min(0, "dailyLossLimit must be greater than or equal to zero").max(MAX_FINANCIAL_VALUE, "dailyLossLimit is unreasonably large").optional(),
    cautionLossUtilizationPct: z.number().finite("cautionLossUtilizationPct must be finite").min(0, "cautionLossUtilizationPct must be at least zero").max(100, "cautionLossUtilizationPct must be at most 100").optional(),
    criticalLossUtilizationPct: z.number().finite("criticalLossUtilizationPct must be finite").min(0, "criticalLossUtilizationPct must be at least zero").max(100, "criticalLossUtilizationPct must be at most 100").optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.cautionBudgetUtilizationPct !== undefined &&
      value.criticalBudgetUtilizationPct !== undefined &&
      value.cautionBudgetUtilizationPct > value.criticalBudgetUtilizationPct
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cautionBudgetUtilizationPct"],
        message: "cautionBudgetUtilizationPct must be less than or equal to criticalBudgetUtilizationPct",
      });
    }
    if (
      value.cautionLossUtilizationPct !== undefined &&
      value.criticalLossUtilizationPct !== undefined &&
      value.cautionLossUtilizationPct > value.criticalLossUtilizationPct
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cautionLossUtilizationPct"],
        message: "cautionLossUtilizationPct must be less than or equal to criticalLossUtilizationPct",
      });
    }
  });

export type ResolvedFinancialPolicy = {
  monthlySpendLimit?: number;
  reservePct: number;
  cautionBudgetUtilizationPct: number;
  criticalBudgetUtilizationPct: number;
  maxProviderConcentrationPct: number;
  maxSingleActionAmount?: number;
  maxStrategyAllocationPct: number;
  maxStrategyAllocationAbsolute?: number;
  dailyLossLimit?: number;
  cautionLossUtilizationPct: number;
  criticalLossUtilizationPct: number;
};

export const DEFAULT_FINANCIAL_POLICY: Readonly<ResolvedFinancialPolicy> = Object.freeze({
  reservePct: 20,
  cautionBudgetUtilizationPct: 75,
  criticalBudgetUtilizationPct: 90,
  maxProviderConcentrationPct: 35,
  maxStrategyAllocationPct: 35,
  cautionLossUtilizationPct: 70,
  criticalLossUtilizationPct: 90,
});

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

export function resolveFinancialPolicy(policy?: FinancialPolicy): ResolvedFinancialPolicy {
  const parsed = financialPolicySchema.parse(policy ?? {});
  return {
    ...DEFAULT_FINANCIAL_POLICY,
    ...parsed,
  };
}

function violation(
  rule: string,
  severity: PolicyRisk,
  limit: number,
  current: number,
  projected: number,
  message: string,
): PolicyViolation {
  return {
    rule,
    severity,
    limit: round(limit),
    current: round(current),
    projected: round(projected),
    message,
  };
}

function evaluation(
  violatedPolicies: PolicyViolation[],
  warnings: PolicyViolation[],
  recommendation: string,
): PolicyEvaluation {
  if (violatedPolicies.length > 0) {
    const hasCritical = violatedPolicies.some((item) => item.severity === "critical");
    return {
      decision: "reject",
      risk: hasCritical ? "critical" : "high",
      violatedPolicies,
      warnings,
      recommendation,
    };
  }

  if (warnings.length > 0) {
    return {
      decision: "caution",
      risk: "medium",
      violatedPolicies,
      warnings,
      recommendation,
    };
  }

  return {
    decision: "approve",
    risk: "low",
    violatedPolicies,
    warnings,
    recommendation,
  };
}

export type ServicePurchasePolicyInput = {
  action: ServicePurchaseAction;
  currentSpend: number;
  projectedSpend: number;
  currentNormalizedSpend: number;
  projectedNormalizedSpend: number;
  currentProviderConcentrationPct: number;
  projectedProviderConcentrationPct: number;
};

export function evaluateServicePurchasePolicy(
  input: ServicePurchasePolicyInput,
  policy?: FinancialPolicy,
): PolicyEvaluation {
  const resolved = resolveFinancialPolicy(policy);
  const violatedPolicies: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];
  const budgetLimit = resolved.monthlySpendLimit;
  const currentAmount = input.action.amount;

  if (resolved.maxSingleActionAmount !== undefined && currentAmount > resolved.maxSingleActionAmount) {
    violatedPolicies.push(
      violation(
        "max_single_action_amount",
        "critical",
        resolved.maxSingleActionAmount,
        currentAmount,
        currentAmount,
        "The proposed action exceeds the configured maximum single-action amount.",
      ),
    );
  }

  if (budgetLimit !== undefined) {
    const currentBudgetPct = percentage(input.currentNormalizedSpend, budgetLimit);
    const projectedBudgetPct = percentage(input.projectedNormalizedSpend, budgetLimit);
    const reserveSpendLimit = budgetLimit * (1 - resolved.reservePct / 100);

    if (input.projectedNormalizedSpend > budgetLimit) {
      violatedPolicies.push(
        violation(
          "monthly_spend_limit",
          "critical",
          budgetLimit,
          input.currentNormalizedSpend,
          input.projectedNormalizedSpend,
          "The projected normalized spend exceeds the configured monthly spend limit.",
        ),
      );
    }

    if (input.projectedNormalizedSpend > reserveSpendLimit) {
      violatedPolicies.push(
        violation(
          "reserve_requirement",
          "critical",
          reserveSpendLimit,
          input.currentNormalizedSpend,
          input.projectedNormalizedSpend,
          `The projected normalized spend would consume the configured ${round(resolved.reservePct)}% operating reserve.`,
        ),
      );
    }

    if (projectedBudgetPct > resolved.criticalBudgetUtilizationPct) {
      violatedPolicies.push(
        violation(
          "critical_budget_utilization",
          "critical",
          resolved.criticalBudgetUtilizationPct,
          currentBudgetPct,
          projectedBudgetPct,
          "Projected budget utilization exceeds the configured critical threshold.",
        ),
      );
    } else if (projectedBudgetPct > resolved.cautionBudgetUtilizationPct) {
      warnings.push(
        violation(
          "caution_budget_utilization",
          "high",
          resolved.cautionBudgetUtilizationPct,
          currentBudgetPct,
          projectedBudgetPct,
          "Projected budget utilization exceeds the configured caution threshold.",
        ),
      );
    }
  }

  const providerLimit = resolved.maxProviderConcentrationPct;
  // A first-ever outgoing payment has no historical provider concentration.
  // Start measuring concentration once the wallet has operating spend.
  if (input.currentSpend > 0 && input.projectedProviderConcentrationPct > providerLimit) {
    const hardProviderLimit = Math.min(100, providerLimit + 15);
    const providerMessage = "The proposed action would increase provider concentration above the configured limit.";
    if (input.projectedProviderConcentrationPct > hardProviderLimit) {
      violatedPolicies.push(
        violation(
          "max_provider_concentration",
          "critical",
          providerLimit,
          input.currentProviderConcentrationPct,
          input.projectedProviderConcentrationPct,
          providerMessage,
        ),
      );
    } else {
      warnings.push(
        violation(
          "max_provider_concentration",
          "high",
          providerLimit,
          input.currentProviderConcentrationPct,
          input.projectedProviderConcentrationPct,
          providerMessage,
        ),
      );
    }
  }

  return evaluation(
    violatedPolicies,
    warnings,
    violatedPolicies.length > 0
      ? "Do not execute the service purchase until the violated financial policy is resolved."
      : warnings.length > 0
        ? "Proceed only if the service purchase is essential and monitor the flagged policy closely."
        : "The service purchase complies with the configured financial policy.",
  );
}

export type CapitalAllocationPolicyInput = {
  action: CapitalAllocationAction;
  currentStrategyAllocation: number;
  totalCapital: number;
  dailyLossUsed: number;
};

export function evaluateCapitalAllocationPolicy(
  input: CapitalAllocationPolicyInput,
  policy?: FinancialPolicy,
): PolicyEvaluation & {
  projectedStrategyAllocation: number;
  strategyAllocationPct: number;
  strategyLimitUtilizationPct: number;
  lossBudgetUsedPct: number;
} {
  const resolved = resolveFinancialPolicy(policy);
  const projectedStrategyAllocation = input.currentStrategyAllocation + input.action.amount;
  const strategyAllocationPct = percentage(projectedStrategyAllocation, input.totalCapital);
  const allowedByPercentage = input.totalCapital * (resolved.maxStrategyAllocationPct / 100);
  const percentageLimitUtilizationPct = percentage(projectedStrategyAllocation, allowedByPercentage);
  const strategyLimitUtilizationPct = resolved.maxStrategyAllocationAbsolute !== undefined
    ? percentage(projectedStrategyAllocation, resolved.maxStrategyAllocationAbsolute)
    : percentageLimitUtilizationPct;
  const lossBudgetUsedPct = resolved.dailyLossLimit === undefined
    ? 0
    : percentage(input.dailyLossUsed, resolved.dailyLossLimit);
  const violatedPolicies: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];

  if (resolved.maxSingleActionAmount !== undefined && input.action.amount > resolved.maxSingleActionAmount) {
    violatedPolicies.push(
      violation(
        "max_single_action_amount",
        "critical",
        resolved.maxSingleActionAmount,
        input.action.amount,
        input.action.amount,
        "The proposed allocation exceeds the configured maximum single-action amount.",
      ),
    );
  }

  if (projectedStrategyAllocation > input.totalCapital) {
    violatedPolicies.push(
      violation(
        "total_capital_limit",
        "critical",
        input.totalCapital,
        input.currentStrategyAllocation,
        projectedStrategyAllocation,
        "The projected allocation exceeds available total capital.",
      ),
    );
  }

  if (strategyAllocationPct > resolved.maxStrategyAllocationPct) {
    violatedPolicies.push(
      violation(
        "max_strategy_allocation_pct",
        "critical",
        resolved.maxStrategyAllocationPct,
        percentage(input.currentStrategyAllocation, input.totalCapital),
        strategyAllocationPct,
        "The projected strategy concentration exceeds the configured percentage limit.",
      ),
    );
  } else if (percentage(strategyAllocationPct, resolved.maxStrategyAllocationPct) > 80) {
    warnings.push(
      violation(
        "strategy_allocation_pct_utilization",
        "high",
        80,
        percentage(percentage(input.currentStrategyAllocation, input.totalCapital), resolved.maxStrategyAllocationPct),
        percentage(strategyAllocationPct, resolved.maxStrategyAllocationPct),
        "Projected strategy concentration is close to the configured percentage limit.",
      ),
    );
  }

  if (resolved.maxStrategyAllocationAbsolute !== undefined) {
    if (projectedStrategyAllocation > resolved.maxStrategyAllocationAbsolute) {
      violatedPolicies.push(
        violation(
          "max_strategy_allocation_absolute",
          "critical",
          resolved.maxStrategyAllocationAbsolute,
          input.currentStrategyAllocation,
          projectedStrategyAllocation,
          "The projected allocation exceeds the configured absolute strategy limit.",
        ),
      );
    } else if (strategyLimitUtilizationPct > 80) {
      warnings.push(
        violation(
          "strategy_allocation_absolute_utilization",
          "high",
          80,
          percentage(input.currentStrategyAllocation, resolved.maxStrategyAllocationAbsolute),
          strategyLimitUtilizationPct,
          "Projected allocation is close to the configured absolute strategy limit.",
        ),
      );
    }
  }

  if (resolved.dailyLossLimit !== undefined) {
    if (lossBudgetUsedPct >= resolved.criticalLossUtilizationPct) {
      violatedPolicies.push(
        violation(
          "critical_loss_utilization",
          "critical",
          resolved.criticalLossUtilizationPct,
          lossBudgetUsedPct,
          lossBudgetUsedPct,
          "Daily loss utilization has reached the configured critical threshold.",
        ),
      );
    } else if (lossBudgetUsedPct > resolved.cautionLossUtilizationPct) {
      warnings.push(
        violation(
          "caution_loss_utilization",
          "high",
          resolved.cautionLossUtilizationPct,
          lossBudgetUsedPct,
          lossBudgetUsedPct,
          "Daily loss utilization exceeds the configured caution threshold.",
        ),
      );
    }
  }

  return {
    ...evaluation(
      violatedPolicies,
      warnings,
      violatedPolicies.length > 0
        ? "Do not increase strategy allocation until the violated capital policy is resolved."
        : warnings.length > 0
          ? "The allocation is within hard limits, but the flagged capital policy requires caution."
          : "The capital allocation complies with the configured financial policy.",
    ),
    projectedStrategyAllocation: round(projectedStrategyAllocation),
    strategyAllocationPct,
    strategyLimitUtilizationPct,
    lossBudgetUsedPct,
  };
}

export function policyStatusFromEvaluation(result: PolicyEvaluation): PolicyStatus {
  return {
    compliant: result.violatedPolicies.length === 0,
    violations: result.violatedPolicies.length,
    warnings: result.warnings.length,
  };
}
