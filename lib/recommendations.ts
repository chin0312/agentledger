import type {
  CompanyHealthReport,
  FinancialRecommendation,
  FinancialRiskSignalType,
  FinancialStatus,
  FinancialPolicy,
  RecommendationsReport,
} from "./types";
import { APP_NAME, APP_VERSION } from "./types";
import { resolveFinancialPolicy } from "./policy";
import { deriveFinancialRiskSignals } from "./risk";

type Candidate = {
  score: number;
  order: number;
  recommendation: Omit<FinancialRecommendation, "priority">;
};

function round(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function display(value: number): string {
  return round(value).toFixed(2).replace(/\.00$/, "");
}

function severityScore(severity: FinancialRecommendation["severity"]): number {
  return { critical: 100, high: 70, medium: 40, low: 20 }[severity];
}

export function getFinancialStatus(report: CompanyHealthReport, policy?: FinancialPolicy): FinancialStatus {
  const signals = deriveFinancialRiskSignals(report, policy);
  if (signals.some((signal) => signal.severity === "critical")) {
    return "critical";
  }
  return signals.length > 0 ? "caution" : "healthy";
}

function buildExecutiveSummary(report: CompanyHealthReport, status: FinancialStatus, policy?: FinancialPolicy): string {
  if (status === "healthy") {
    return "Financial activity is healthy, with controlled spending and no material budget, concentration, cash-flow, or velocity risks identified.";
  }

  const drivers: string[] = [];
  for (const signal of deriveFinancialRiskSignals(report, policy)) {
    drivers.push(
      signal.type === "budget_utilization"
        ? signal.severity === "critical" ? "critical budget utilization" : "elevated budget utilization"
        : signal.type === "provider_concentration"
          ? signal.severity === "critical" ? "high provider concentration" : "provider concentration"
          : signal.type === "negative_cash_flow"
            ? "negative operating cash flow"
            : signal.type === "spend_acceleration"
              ? "accelerating spend"
              : "failed transactions",
    );
  }

  const driverText = drivers.length > 0 ? drivers.slice(0, 3).join(", ") : "moderate financial-control signals";
  return status === "critical"
    ? `Financial controls require immediate attention because of ${driverText}.`
    : `Financial activity remains sustainable, but ${driverText} require attention.`;
}

function addCandidate(candidates: Candidate[], order: number, recommendation: Omit<FinancialRecommendation, "priority">, boost = 0): void {
  candidates.push({
    score: severityScore(recommendation.severity) + boost,
    order,
    recommendation,
  });
}

export function buildFinancialRecommendations(report: CompanyHealthReport, policy?: FinancialPolicy): FinancialRecommendation[] {
  const resolved = resolveFinancialPolicy(policy);
  const riskSignals = deriveFinancialRiskSignals(report, policy);
  const cautionBudgetPct = resolved.cautionBudgetUtilizationPct;
  const providerLimitPct = resolved.maxProviderConcentrationPct;
  const reservePct = resolved.reservePct;
  const candidates: Candidate[] = [];
  let order = 0;
  const budget = report.budget;
  const largestCounterparty = report.topCounterparties[0];
  const riskFor = (type: FinancialRiskSignalType) => riskSignals.find((signal) => signal.type === type);

  if (budget && riskFor("budget_utilization")) {
    const budgetRisk = riskFor("budget_utilization");
    const isCritical = budgetRisk?.severity === "critical";
    addCandidate(
      candidates,
      order++,
      {
        type: "reduce_budget_pressure",
        severity: isCritical ? "critical" : "high",
        title: isCritical ? "Reduce discretionary spending immediately" : "Protect remaining operating budget",
        finding: `Normalized monthly spend is ${display(budget.usedPct)}% of the configured budget.`,
        implication: isCritical
          ? "The operating plan is close to exhausting its approved spending capacity."
          : "Only a limited share of the approved monthly budget remains for non-essential work.",
        recommendation: isCritical
          ? "Freeze or sharply reduce discretionary spending until budget utilization returns below a safer threshold."
          : "Prioritize essential services and reduce discretionary spending.",
        action: {
          type: "set_monthly_spend_cap",
          recommendedValue: isCritical ? round(budget.limit * (1 - reservePct / 100)) : round(budget.limit * (cautionBudgetPct / 100)),
          unit: "USD per month",
        },
        target: { metric: "budgetUtilizationPct", current: budget.usedPct, desired: isCritical ? round(100 - reservePct) : cautionBudgetPct },
        expectedImpact: isCritical
          ? "Create budget headroom and restore a more resilient operating reserve."
          : "Preserve budget capacity for essential operating activity.",
      },
      Math.max(0, budget.usedPct - (budgetRisk?.threshold ?? cautionBudgetPct)),
    );
  }

  const concentrationRisk = riskFor("provider_concentration");
  if (largestCounterparty && concentrationRisk) {
    const isCritical = concentrationRisk.severity === "critical";
    addCandidate(
      candidates,
      order++,
      {
        type: policy ? "provider_policy_violation" : "reduce_provider_concentration",
        severity: isCritical ? "critical" : "high",
        title: isCritical ? "Reduce dependency on the largest provider" : "Diversify provider allocation",
        finding: `${display(largestCounterparty.shareOfSpendPct)}% of operating spend goes to ${largestCounterparty.address}.`,
        implication: "The agent is exposed to pricing, availability, or execution changes from one provider.",
        recommendation: isCritical
          ? "Reduce dependency by routing future workload or spending to alternative providers."
          : "Benchmark alternatives and reduce further allocation to the dominant provider.",
        action: {
          type: "provider_spend_cap",
          target: largestCounterparty.address,
          recommendedValue: providerLimitPct,
          unit: "percent of operating spend",
        },
        target: {
          metric: "providerConcentrationPct",
          current: largestCounterparty.shareOfSpendPct,
          desired: providerLimitPct,
        },
        expectedImpact: "Reduce provider dependency and improve financial resilience.",
      },
      largestCounterparty.shareOfSpendPct,
    );
  }

  const accelerationRisk = riskFor("spend_acceleration");
  if (accelerationRisk) {
    const isCritical = accelerationRisk.severity === "critical";
    const temporaryCap = report.spendVelocity.firstHalf > 0 ? round(report.spendVelocity.firstHalf * 1.5) : 0;
    addCandidate(
      candidates,
      order++,
      {
        type: "control_spend_acceleration",
        severity: isCritical ? "critical" : "high",
        title: "Slow accelerating operating spend",
        finding: `Second-half spend was ${display(report.spendVelocity.changePct)}% higher than first-half spend.`,
        implication: "Current spending velocity may consume more operating capacity than the earlier run rate suggested.",
        recommendation: "Reduce discretionary spending temporarily and investigate which providers are driving the acceleration.",
        action: {
          type: "temporary_spend_cap",
          recommendedValue: temporaryCap,
          unit: "USD per half-period",
        },
        target: { metric: "spendAccelerationPct", current: report.spendVelocity.changePct, desired: 50 },
        expectedImpact: "Bring spending velocity closer to a controllable operating run rate.",
      },
      report.spendVelocity.changePct / 10,
    );
  }

  if (riskFor("negative_cash_flow")) {
    const deficit = round(Math.abs(report.cashFlow.net));
    addCandidate(
      candidates,
      order++,
      {
        type: "restore_positive_cash_flow",
        severity: "high",
        title: "Restore positive operating cash flow",
        finding: `Operating outflows exceed inflows by $${display(deficit)} in the selected period.`,
        implication: "The agent is consuming operating capital faster than it is replenishing it.",
        recommendation: "Reduce variable operating expenses until inflows once again cover operating spending.",
        action: {
          type: "reduce_variable_spend",
          recommendedValue: deficit,
          unit: "USD to reach break-even",
        },
        target: { metric: "netOperatingCashFlow", current: report.cashFlow.net, desired: 0 },
        expectedImpact: "Return the operating cycle to break-even or positive cash generation.",
      },
      deficit,
    );
  }

  const repeatedProvider = report.repeatedVendors[0];
  if (repeatedProvider) {
    const averagePaymentSize = round(repeatedProvider.spend / repeatedProvider.transactions);
    addCandidate(
      candidates,
      order++,
      {
        type: "review_repeated_provider_cost",
        severity: "medium",
        title: "Review repeated provider usage",
        finding: `${repeatedProvider.address} received ${repeatedProvider.transactions} payments totaling $${display(repeatedProvider.spend)}; average payment size was $${display(averagePaymentSize)}.`,
        implication: "Repeated demand may justify bundled pricing, subscription pricing, or a second provider.",
        recommendation: "Review whether bundled pricing, subscription pricing, or an alternative provider would improve cost efficiency.",
        target: { metric: "providerPaymentCount", current: repeatedProvider.transactions, desired: 2 },
        evidence: {
          paymentCount: repeatedProvider.transactions,
          totalSpend: repeatedProvider.spend,
          averagePaymentSize,
        },
        expectedImpact: "Improve purchasing efficiency without assuming unverified savings.",
      },
      repeatedProvider.transactions,
    );
  }

  if (riskFor("failed_transactions")) {
    const failedProvider = report.failedCounterparties[0];
    const providerText = failedProvider && failedProvider.transactions > 1
      ? ` Multiple failures share provider ${failedProvider.address}.`
      : "";
    addCandidate(
      candidates,
      order++,
      {
        type: "investigate_failed_transactions",
        severity: "medium",
        title: "Investigate failed transactions",
        finding: `${report.transactions.failed} relevant transaction${report.transactions.failed === 1 ? "" : "s"} failed.${providerText}`,
        implication: "Increasing allocation before understanding failures could create avoidable payment or service risk.",
        recommendation: "Investigate failed transactions before increasing allocation to affected providers.",
        target: { metric: "failedTransactionCount", current: report.transactions.failed, desired: 0 },
        expectedImpact: "Reduce payment failures and improve confidence in future financial decisions.",
      },
      report.transactions.failed,
    );
  }

  const budgetIsLow = budget && budget.usedPct <= cautionBudgetPct;
  const concentrationIsHealthy = !riskFor("provider_concentration");
  const velocityIsHealthy = !riskFor("spend_acceleration");
  if (report.cashFlow.net > 0 && budgetIsLow && concentrationIsHealthy && velocityIsHealthy) {
    const reserveTarget = round((budget?.limit ?? 0) * (reservePct / 100));
    const availableCapacity = round(Math.max(0, (budget?.limit ?? 0) * (1 - reservePct / 100) - (budget?.normalizedUsed ?? 0)));
    addCandidate(candidates, order++, {
      type: "use_available_financial_capacity",
      severity: "low",
      title: "Use available financial capacity deliberately",
      finding: `Operating cash flow is positive and normalized budget utilization is ${display(budget?.usedPct ?? 0)}%.`,
      implication: "The agent has room for controlled experimentation while preserving a reserve.",
      recommendation: `Financial capacity remains healthy. Additional experimentation budget of up to $${display(availableCapacity)} is available while preserving approximately a ${display(reservePct)}% reserve of $${display(reserveTarget)}.`,
      action: {
        type: "set_experimentation_cap",
        recommendedValue: availableCapacity,
        unit: "USD per month",
      },
      target: { metric: "budgetUtilizationPct", current: budget?.usedPct ?? 0, desired: round(100 - reservePct) },
      expectedImpact: "Enable measured experimentation without consuming the operating reserve.",
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates.slice(0, 3).map((candidate, index) => ({
    priority: index + 1,
    ...candidate.recommendation,
  }));
}

export function buildRecommendationSummary(
  report: CompanyHealthReport,
  recommendationsEndpoint = "/api/recommendations",
  policy?: FinancialPolicy,
): NonNullable<CompanyHealthReport["recommendationSummary"]> {
  const recommendations = buildFinancialRecommendations(report, policy);
  return {
    financialStatus: getFinancialStatus(report, policy),
    topPriority: recommendations[0]?.title ?? "No immediate financial action identified",
    recommendationsEndpoint,
  };
}

export function buildRecommendationsReport(
  report: CompanyHealthReport,
  generatedAt = new Date().toISOString(),
  policy?: FinancialPolicy,
): RecommendationsReport {
  const recommendedActions = buildFinancialRecommendations(report, policy);
  const financialStatus = getFinancialStatus(report, policy);
  return {
    service: APP_NAME,
    version: APP_VERSION,
    dataSource: report.dataSource,
    stateVerification: report.stateVerification,
    financialStatus,
    executiveSummary: buildExecutiveSummary(report, financialStatus, policy),
    recommendedActions,
    generatedAt,
  };
}
