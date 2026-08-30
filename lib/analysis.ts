import type {
  BudgetReport,
  CompanyHealthReport,
  CounterpartyReport,
  DataSource,
  FailedCounterpartyReport,
  Insight,
  NormalizedTransaction,
  StateVerification,
  StablecoinSymbol,
} from "./types";
import { APP_NAME, APP_VERSION, SUPPORTED_ASSETS } from "./types";
import { normalizeFinancialState, normalizeTransactionState, spendVelocityChangePct, type NormalizedFinancialState } from "./financial-context";
import { evaluateServicePurchasePolicy } from "./policy";
import { DAY_MS } from "./transactions";

const MONTHLY_DAYS = 30;

export type AnalysisOptions = {
  wallet: string;
  days: number;
  monthlyBudget?: number;
  now: number;
  dataSource: DataSource;
  transactions: NormalizedTransaction[];
};

function round(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function percentage(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return round((value / total) * 100);
}

export function normalizeMonthlySpend(spend: number, days: number): number {
  return spend * (MONTHLY_DAYS / days);
}

function displayNumber(value: number): string {
  return round(value).toFixed(2).replace(/\.00$/, "");
}

function buildBudget(monthlyBudget: number | undefined, spend: number, days: number): BudgetReport | null {
  if (monthlyBudget === undefined) {
    return null;
  }

  const normalizedUsed = normalizeMonthlySpend(spend, days);
  return {
    limit: round(monthlyBudget),
    used: round(spend),
    normalizedUsed: round(normalizedUsed),
    usedPct: monthlyBudget === 0 ? (normalizedUsed > 0 ? 100 : 0) : percentage(normalizedUsed, monthlyBudget),
    remaining: round(monthlyBudget - normalizedUsed),
    periodDays: days,
  };
}

function buildCounterparties(state: NormalizedFinancialState): CounterpartyReport[] {
  return [...state.providers]
    .sort((left, right) => right.spend - left.spend || left.provider.localeCompare(right.provider))
    .map((provider) => ({
      address: provider.provider,
      spend: round(provider.spend),
      transactions: provider.transactions,
      shareOfSpendPct: percentage(provider.spend, state.outflows),
    }));
}

function buildFailedCounterparties(state: NormalizedFinancialState): FailedCounterpartyReport[] {
  return state.failedProviders.map((provider) => ({
    address: provider.provider,
    transactions: provider.transactions,
  }));
}

function stateVerificationFor(dataSource: DataSource): StateVerification {
  return dataSource === "demo" ? "demo" : dataSource === "okx" ? "okx_fetched" : "caller_supplied";
}

function buildInsights(options: {
  budget: BudgetReport | null;
  topCounterparties: CounterpartyReport[];
  repeatedVendors: CounterpartyReport[];
  failed: number;
  revenue: number;
  spend: number;
  net: number;
  firstHalf: number;
  secondHalf: number;
  changePct: number;
  totalTransactions: number;
}): Insight[] {
  const insights: Insight[] = [];

  if (options.budget) {
    const { usedPct } = options.budget;
    if (usedPct > 90) {
      insights.push({
        type: "budget_utilization",
        severity: "critical",
        title: "Budget utilization is critical",
        message: `Normalized monthly spend is ${displayNumber(usedPct)}% of the configured budget.`,
        metric: usedPct,
      });
    } else if (usedPct > 75) {
      insights.push({
        type: "budget_utilization",
        severity: "warning",
        title: "Budget utilization is elevated",
        message: `Normalized monthly spend is ${displayNumber(usedPct)}% of the configured budget.`,
        metric: usedPct,
      });
    } else {
      insights.push({
        type: "budget_utilization",
        severity: "positive",
        title: "Budget utilization is controlled",
        message: `Normalized monthly spend is ${displayNumber(usedPct)}% of the configured budget.`,
        metric: usedPct,
      });
    }
  }

  const largestCounterparty = options.topCounterparties[0];
  if (largestCounterparty && largestCounterparty.shareOfSpendPct > 35) {
    const severity = largestCounterparty.shareOfSpendPct > 50 ? "critical" : "warning";
    insights.push({
      type: "counterparty_concentration",
      severity,
      title: "High vendor concentration",
      message: `${displayNumber(largestCounterparty.shareOfSpendPct)}% of operating spend went to ${largestCounterparty.address}.`,
      metric: largestCounterparty.shareOfSpendPct,
    });
  }

  for (const vendor of options.repeatedVendors) {
    insights.push({
      type: "repeated_vendor",
      severity: "info",
      title: "Repeated vendor detected",
      message: `${vendor.address} received ${vendor.transactions} successful outgoing payments.`,
      metric: vendor.transactions,
    });
  }

  if (options.failed > 0) {
    insights.push({
      type: "failed_transactions",
      severity: "warning",
      title: "Failed stablecoin transactions detected",
      message: `${options.failed} relevant transaction${options.failed === 1 ? "" : "s"} failed and did not count toward cash flow.`,
      metric: options.failed,
    });
  }

  if (options.revenue > options.spend) {
    insights.push({
      type: "cash_flow",
      severity: "positive",
      title: "Operating cash flow is positive",
      message: `Operating inflows exceeded outflows by $${displayNumber(options.net)}.`,
      metric: round(options.net),
    });
  } else if (options.spend > options.revenue) {
    insights.push({
      type: "cash_flow",
      severity: "warning",
      title: "Operating cash flow is negative",
      message: `Operating outflows exceeded inflows by $${displayNumber(Math.abs(options.net))}.`,
      metric: round(options.net),
    });
  }

  if (options.secondHalf > options.firstHalf && options.changePct > 50) {
    insights.push({
      type: "spend_acceleration",
      severity: "warning",
      title: "Spending is accelerating",
      message: `Second-half spend was ${displayNumber(options.changePct)}% higher than first-half spend.`,
      metric: round(options.changePct),
    });
  }

  if (options.totalTransactions < 3) {
    insights.push({
      type: "low_activity",
      severity: "info",
      title: "Limited transaction activity",
      message: "Confidence is limited because fewer than 3 relevant transactions were found.",
      metric: options.totalTransactions,
    });
  }

  return insights;
}

export function analyzeNormalizedFinancialState(options: {
  wallet: string;
  now: number;
  dataSource: DataSource;
  monthlyBudget?: number;
  state: NormalizedFinancialState;
}): CompanyHealthReport {
  const days = options.state.periodDays;
  const from = options.now - days * DAY_MS;
  const to = options.now;
  const revenue = options.state.inflows;
  const spend = options.state.outflows;
  const net = revenue - spend;
  const firstHalf = options.state.firstHalfSpend;
  const secondHalf = options.state.secondHalfSpend;
  const changePct = spendVelocityChangePct(firstHalf, secondHalf);
  const topCounterparties = buildCounterparties(options.state);
  const repeatedVendors = topCounterparties.filter((counterparty) => counterparty.transactions >= 3);
  const budget = buildBudget(options.monthlyBudget, spend, days);
  const insights = buildInsights({
    budget,
    topCounterparties,
    repeatedVendors,
    failed: options.state.failedTransactions,
    revenue,
    spend,
    net,
    firstHalf,
    secondHalf,
    changePct,
    totalTransactions: options.state.totalTransactions,
  });

  return {
    service: APP_NAME,
    analysisVersion: APP_VERSION,
    wallet: options.wallet,
    dataSource: options.dataSource,
    stateVerification: stateVerificationFor(options.dataSource),
    period: {
      days,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
    currency: "USD",
    assetsAnalyzed: SUPPORTED_ASSETS,
    cashFlow: {
      revenue: round(revenue),
      spend: round(spend),
      net: round(net),
    },
    budget,
    transactions: {
      total: options.state.totalTransactions,
      incoming: options.state.incomingTransactions,
      outgoing: options.state.outgoingTransactions,
      failed: options.state.failedTransactions,
    },
    spendVelocity: {
      firstHalf: round(firstHalf),
      secondHalf: round(secondHalf),
      changePct: round(changePct),
    },
    topCounterparties,
    repeatedVendors,
    failedCounterparties: buildFailedCounterparties(options.state),
    insights,
    generatedAt: new Date(options.now).toISOString(),
  };
}

export function analyzeCompanyHealth(options: AnalysisOptions): CompanyHealthReport {
  const from = options.now - options.days * DAY_MS;
  const state = normalizeTransactionState({
    transactions: options.transactions,
    from,
    to: options.now,
    periodDays: options.days,
  });
  return analyzeNormalizedFinancialState({
    wallet: options.wallet,
    now: options.now,
    dataSource: options.dataSource,
    monthlyBudget: options.monthlyBudget,
    state,
  });
}

export function analyzeProvidedFinancialState(options: {
  wallet: string;
  financialState: import("./types").ProvidedFinancialState;
  monthlyBudget?: number;
  now: number;
}): CompanyHealthReport {
  return analyzeNormalizedFinancialState({
    wallet: options.wallet,
    now: options.now,
    dataSource: "provided_state",
    monthlyBudget: options.monthlyBudget,
    state: normalizeFinancialState(options.financialState),
  });
}

export function getVendorConcentration(report: CompanyHealthReport, vendor: string): number {
  const match = report.topCounterparties.find(
    (counterparty) => counterparty.address.toLowerCase() === vendor.trim().toLowerCase(),
  );
  return match?.shareOfSpendPct ?? 0;
}

function getVendorSpend(report: CompanyHealthReport, vendor: string): number {
  const match = report.topCounterparties.find(
    (counterparty) => counterparty.address.toLowerCase() === vendor.trim().toLowerCase(),
  );
  return match?.spend ?? 0;
}

export function buildSpendDecision(options: {
  report: CompanyHealthReport;
  proposedSpend: number;
  monthlyBudget: number;
  vendor?: string;
}): {
  approved: boolean;
  decision: "approve" | "caution" | "reject";
  risk: "low" | "medium" | "high";
  reason: string;
  currentSpend: number;
  normalizedCurrentSpend: number;
  proposedSpend: number;
  projectedSpend: number;
  normalizedProjectedSpend: number;
  monthlyBudget: number;
  projectedBudgetUsedPct: number;
  budgetRemainingAfterSpend: number;
  financialImpact: {
    currentBudgetUsedPct: number;
    projectedBudgetUsedPct: number;
    budgetRemainingAfterSpend: number;
  };
  vendorConcentration?: {
    currentPct: number;
    projectedPct: number;
    warning: boolean;
  };
  recommendation: string;
  warnings: string[];
} {
  const currentSpend = options.report.cashFlow.spend;
  const projectedSpend = currentSpend + options.proposedSpend;
  const normalizedCurrentSpend = normalizeMonthlySpend(currentSpend, options.report.period.days);
  const normalizedProjectedSpend = normalizeMonthlySpend(projectedSpend, options.report.period.days);
  const projectedBudgetUsedPct =
    options.monthlyBudget === 0
      ? normalizedProjectedSpend > 0
        ? 100
        : 0
      : percentage(normalizedProjectedSpend, options.monthlyBudget);
  const budgetRemainingAfterSpend = options.monthlyBudget - normalizedProjectedSpend;
  const exceedsFullBudget = options.proposedSpend > options.monthlyBudget;
  const currentBudgetUsedPct =
    options.monthlyBudget === 0
      ? normalizedCurrentSpend > 0
        ? 100
        : 0
      : percentage(normalizedCurrentSpend, options.monthlyBudget);
  const historicalVendorSpend = options.vendor ? getVendorSpend(options.report, options.vendor) : 0;
  const currentVendorPct = percentage(historicalVendorSpend, currentSpend);
  const projectedVendorPct = options.vendor
    ? percentage(historicalVendorSpend + options.proposedSpend, projectedSpend)
    : 0;
  const vendorWarning = Boolean(options.vendor && (currentVendorPct > 50 || projectedVendorPct > 50));
  // Keep the specialist endpoint's historical 50% provider control threshold
  // while routing the actual decision through the shared policy engine.
  const policyEvaluation = evaluateServicePurchasePolicy(
    {
      action: { type: "service_purchase", amount: options.proposedSpend, provider: options.vendor ?? "" },
      currentSpend,
      projectedSpend,
      currentNormalizedSpend: normalizedCurrentSpend,
      projectedNormalizedSpend: normalizedProjectedSpend,
      currentProviderConcentrationPct: currentVendorPct,
      projectedProviderConcentrationPct: projectedVendorPct,
    },
    {
      monthlySpendLimit: options.monthlyBudget,
      maxProviderConcentrationPct: 50,
    },
  );
  const approved = policyEvaluation.decision !== "reject";
  let decision = policyEvaluation.decision;
  let risk: "low" | "medium" | "high" = policyEvaluation.risk === "critical" ? "high" : policyEvaluation.risk;
  let reason = exceedsFullBudget
    ? `The proposed spend of $${displayNumber(options.proposedSpend)} exceeds the full monthly budget of $${displayNumber(options.monthlyBudget)}.`
    : decision === "reject"
      ? policyEvaluation.violatedPolicies[0]?.message ?? "The proposed spend violates the configured financial policy."
      : decision === "caution"
        ? `The proposed spend keeps projected monthly budget utilization at ${displayNumber(projectedBudgetUsedPct)}%; proceed with caution.`
        : `The proposed spend keeps projected monthly budget utilization at ${displayNumber(projectedBudgetUsedPct)}%.`;

  const warnings: string[] = [];
  if (options.vendor && vendorWarning) {
    if (currentVendorPct > 50) {
      warnings.push(
        `Vendor ${options.vendor} already represents ${displayNumber(currentVendorPct)}% of historical outgoing spend.`,
      );
    }
    if (projectedVendorPct > 50 && projectedVendorPct >= currentVendorPct) {
      warnings.push(
        `This transaction would make vendor ${options.vendor} represent ${displayNumber(projectedVendorPct)}% of projected outgoing spend.`,
      );
    }
  }

  if (vendorWarning && approved && options.proposedSpend > 0) {
    if (decision === "approve") {
      decision = "caution";
      risk = "medium";
    }
    reason = `The transaction is within budget but would increase provider concentration to ${displayNumber(projectedVendorPct)}%, above the 50% control threshold.`;
  }

  const recommendation = decision === "reject"
    ? policyEvaluation.recommendation
    : vendorWarning
      ? "Proceed only if the provider is necessary; otherwise route the task to an alternative provider."
      : decision === "caution"
        ? "Proceed only if the expense is essential and monitor the remaining budget closely."
        : "Proceed under the current budget policy.";

  return {
    approved,
    decision,
    risk,
    reason,
    currentSpend: round(currentSpend),
    normalizedCurrentSpend: round(normalizedCurrentSpend),
    proposedSpend: round(options.proposedSpend),
    projectedSpend: round(projectedSpend),
    normalizedProjectedSpend: round(normalizedProjectedSpend),
    monthlyBudget: round(options.monthlyBudget),
    projectedBudgetUsedPct,
    budgetRemainingAfterSpend: round(budgetRemainingAfterSpend),
    financialImpact: {
      currentBudgetUsedPct,
      projectedBudgetUsedPct,
      budgetRemainingAfterSpend: round(budgetRemainingAfterSpend),
    },
    ...(options.vendor
      ? {
          vendorConcentration: {
            currentPct: currentVendorPct,
            projectedPct: projectedVendorPct,
            warning: vendorWarning,
          },
        }
      : {}),
    recommendation,
    warnings: [
      ...policyEvaluation.warnings.map((warning) => warning.message),
      ...warnings,
    ],
  };
}

export const stablecoinAssets: readonly StablecoinSymbol[] = SUPPORTED_ASSETS;
