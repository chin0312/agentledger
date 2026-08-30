import type { CompanyHealthReport, FinancialPolicy, FinancialRiskSignal } from "./types";
import { resolveFinancialPolicy } from "./policy";

/**
 * Derives material financial-control signals shared by status and
 * recommendations. Informational and positive observations are intentionally
 * excluded because they should not downgrade a healthy financial status.
 */
export function deriveFinancialRiskSignals(
  report: CompanyHealthReport,
  policy?: FinancialPolicy,
): FinancialRiskSignal[] {
  const resolved = resolveFinancialPolicy(policy);
  const signals: FinancialRiskSignal[] = [];
  const budgetPct = report.budget?.usedPct;
  if (budgetPct !== undefined && budgetPct > resolved.cautionBudgetUtilizationPct) {
    signals.push({
      type: "budget_utilization",
      severity: budgetPct > resolved.criticalBudgetUtilizationPct ? "critical" : "high",
      metric: budgetPct,
      threshold: budgetPct > resolved.criticalBudgetUtilizationPct
        ? resolved.criticalBudgetUtilizationPct
        : resolved.cautionBudgetUtilizationPct,
    });
  }

  const concentrationPct = report.topCounterparties[0]?.shareOfSpendPct ?? 0;
  if (concentrationPct > resolved.maxProviderConcentrationPct) {
    const hardLimit = Math.min(100, resolved.maxProviderConcentrationPct + 15);
    signals.push({
      type: "provider_concentration",
      severity: concentrationPct > hardLimit ? "critical" : "high",
      metric: concentrationPct,
      threshold: concentrationPct > hardLimit ? hardLimit : resolved.maxProviderConcentrationPct,
    });
  }

  if (report.spendVelocity.secondHalf > report.spendVelocity.firstHalf && report.spendVelocity.changePct > 50) {
    signals.push({
      type: "spend_acceleration",
      severity: report.spendVelocity.changePct > 100 ? "critical" : "high",
      metric: report.spendVelocity.changePct,
      threshold: report.spendVelocity.changePct > 100 ? 100 : 50,
    });
  }

  if (report.cashFlow.net < 0) {
    signals.push({
      type: "negative_cash_flow",
      severity: "high",
      metric: report.cashFlow.net,
      threshold: 0,
    });
  }

  if (report.transactions.failed > 0) {
    signals.push({
      type: "failed_transactions",
      severity: "medium",
      metric: report.transactions.failed,
      threshold: 0,
    });
  }

  return signals;
}
