import { analyzeCompanyHealth, analyzeProvidedFinancialState } from "./analysis";
import { getRuntimeConfig, requireLiveConfig } from "./config";
import { evaluateServicePurchasePolicy, policyStatusFromEvaluation } from "./policy";
import { buildRecommendationSummary } from "./recommendations";
import { getAnalysisNow, loadTransactions } from "./transactions";
import type { CompanyHealthRequest } from "./types";
import type { CompanyHealthReport, DataSource } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadCompanyHealth(
  input: CompanyHealthRequest,
  dataSource: DataSource,
  recommendationsEndpoint: string,
): Promise<CompanyHealthReport> {
  const config = getRuntimeConfig();
  if (dataSource === "okx") {
    requireLiveConfig(config);
  }

  const requestedBudget = input.policy?.monthlySpendLimit ?? input.monthlyBudget;
  let report: CompanyHealthReport;
  if (dataSource === "provided_state") {
    if (!input.financialState) {
      throw new Error("financialState is required for provided_state requests");
    }
    report = analyzeProvidedFinancialState({
      wallet: input.address ?? "provided-state",
      financialState: input.financialState,
      monthlyBudget: requestedBudget,
      now: Date.now(),
    });
  } else {
    const address = input.address ?? "";
    const days = input.days ?? 30;
    const now = getAnalysisNow(dataSource);
    const from = now - days * DAY_MS;
    const transactions = await loadTransactions({
      address,
      from,
      to: now,
      dataSource,
      config,
    });

    report = analyzeCompanyHealth({
      wallet: address,
      days,
      monthlyBudget: requestedBudget,
      now,
      dataSource,
      transactions,
    });
  }

  const effectivePolicy = input.policy
    ? {
        ...input.policy,
        monthlySpendLimit: input.policy.monthlySpendLimit ?? report.budget?.limit,
      }
    : undefined;
  const policyStatus = effectivePolicy
    ? policyStatusFromEvaluation(
        evaluateServicePurchasePolicy(
          {
            action: { type: "service_purchase", amount: 0, provider: report.topCounterparties[0]?.address ?? "" },
            currentSpend: report.cashFlow.spend,
            projectedSpend: report.cashFlow.spend,
            currentNormalizedSpend: report.budget?.normalizedUsed ?? report.cashFlow.spend * (30 / report.period.days),
            projectedNormalizedSpend: report.budget?.normalizedUsed ?? report.cashFlow.spend * (30 / report.period.days),
            currentProviderConcentrationPct: report.topCounterparties[0]?.shareOfSpendPct ?? 0,
            projectedProviderConcentrationPct: report.topCounterparties[0]?.shareOfSpendPct ?? 0,
          },
          effectivePolicy,
        ),
      )
    : undefined;

  return {
    ...report,
    ...(policyStatus ? { policyStatus } : {}),
    recommendationSummary: buildRecommendationSummary(report, recommendationsEndpoint, effectivePolicy),
  };
}
