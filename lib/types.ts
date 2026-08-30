export const APP_NAME = "AgentLedger" as const;
export const APP_VERSION = "0.3.2" as const;

export const SUPPORTED_ASSETS = ["USDT", "USDC", "USDG"] as const;

export type StablecoinSymbol = (typeof SUPPORTED_ASSETS)[number];
export type TransactionDirection = "incoming" | "outgoing";
export type TransactionStatus = "success" | "failed";
export type DataSource = "provided_state" | "demo" | "okx";
export type StateVerification = "caller_supplied" | "okx_fetched" | "demo";
export type InsightSeverity = "info" | "positive" | "warning" | "critical";
export type FinancialStatus = "healthy" | "caution" | "critical";
export type RecommendationSeverity = "low" | "medium" | "high" | "critical";
export type PolicyDecision = "approve" | "caution" | "reject";
export type PolicyRisk = "low" | "medium" | "high" | "critical";

export type FinancialPolicy = {
  monthlySpendLimit?: number;
  reservePct?: number;
  cautionBudgetUtilizationPct?: number;
  criticalBudgetUtilizationPct?: number;
  maxProviderConcentrationPct?: number;
  maxSingleActionAmount?: number;
  maxStrategyAllocationPct?: number;
  maxStrategyAllocationAbsolute?: number;
  dailyLossLimit?: number;
  cautionLossUtilizationPct?: number;
  criticalLossUtilizationPct?: number;
};

export type PolicyViolation = {
  rule: string;
  severity: PolicyRisk;
  limit: number;
  current: number;
  projected: number;
  message: string;
};

export type PolicyEvaluation = {
  decision: PolicyDecision;
  risk: PolicyRisk;
  violatedPolicies: PolicyViolation[];
  warnings: PolicyViolation[];
  recommendation: string;
};

export type PolicyStatus = {
  compliant: boolean;
  violations: number;
  warnings: number;
};

export type NormalizedTransaction = {
  txHash: string;
  timestamp: number;
  symbol: StablecoinSymbol;
  amount: number;
  direction: TransactionDirection;
  counterparty: string;
  status: TransactionStatus;
};

export type ProvidedFinancialState = {
  periodDays: number;
  cashFlow: {
    inflows: number;
    outflows: number;
    incomingTransactions?: number;
    outgoingTransactions?: number;
  };
  spendVelocity?: {
    firstHalf: number;
    secondHalf: number;
  };
  providers?: Array<{
    provider: string;
    spend: number;
    transactions: number;
    failedTransactions?: number;
  }>;
  failedTransactions?: number;
};

export type CompanyHealthRequest = {
  source?: "provided_state" | "okx";
  address?: string;
  days?: number;
  monthlyBudget?: number;
  policy?: FinancialPolicy;
  financialState?: ProvidedFinancialState;
};

export type BudgetReport = {
  limit: number;
  used: number;
  normalizedUsed: number;
  usedPct: number;
  remaining: number;
  periodDays: number;
};

export type CounterpartyReport = {
  address: string;
  spend: number;
  transactions: number;
  shareOfSpendPct: number;
};

export type FailedCounterpartyReport = {
  address: string;
  transactions: number;
};

export type Insight = {
  type:
    | "budget_utilization"
    | "counterparty_concentration"
    | "repeated_vendor"
    | "failed_transactions"
    | "cash_flow"
    | "spend_acceleration"
    | "low_activity";
  severity: InsightSeverity;
  title: string;
  message: string;
  metric: number;
};

export type CompanyHealthReport = {
  service: typeof APP_NAME;
  analysisVersion: typeof APP_VERSION;
  wallet: string;
  dataSource: DataSource;
  stateVerification: StateVerification;
  period: {
    days: number;
    from: string;
    to: string;
  };
  currency: "USD";
  assetsAnalyzed: readonly StablecoinSymbol[];
  cashFlow: {
    revenue: number;
    spend: number;
    net: number;
  };
  budget: BudgetReport | null;
  transactions: {
    total: number;
    incoming: number;
    outgoing: number;
    failed: number;
  };
  spendVelocity: {
    firstHalf: number;
    secondHalf: number;
    changePct: number;
  };
  topCounterparties: CounterpartyReport[];
  repeatedVendors: CounterpartyReport[];
  failedCounterparties: FailedCounterpartyReport[];
  insights: Insight[];
  policyStatus?: PolicyStatus;
  recommendationSummary?: RecommendationSummary;
  generatedAt: string;
};

export type RecommendationSummary = {
  financialStatus: FinancialStatus;
  topPriority: string;
  recommendationsEndpoint: string;
};

export type FinancialRecommendation = {
  priority: number;
  type: string;
  severity: RecommendationSeverity;
  title: string;
  finding: string;
  implication: string;
  recommendation: string;
  action?: {
    type: string;
    target?: string;
    recommendedValue?: number;
    unit?: string;
  };
  target?: {
    metric: string;
    current: number;
    desired: number;
  };
  evidence?: {
    paymentCount: number;
    totalSpend: number;
    averagePaymentSize: number;
  };
  expectedImpact: string;
};

export type RecommendationsReport = {
  service: typeof APP_NAME;
  version: typeof APP_VERSION;
  dataSource: DataSource;
  stateVerification: StateVerification;
  financialStatus: FinancialStatus;
  executiveSummary: string;
  recommendedActions: FinancialRecommendation[];
  generatedAt: string;
};

export type SpendDecision = "approve" | "caution" | "reject";
export type SpendRisk = "low" | "medium" | "high";

export type CanISpendReport = {
  service: typeof APP_NAME;
  analysisVersion: typeof APP_VERSION;
  dataSource: DataSource;
  stateVerification?: StateVerification;
  approved: boolean;
  decision: SpendDecision;
  risk: SpendRisk;
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
};

export type AllocationDecision = "approve" | "caution" | "reject";
export type AllocationRisk = "low" | "medium" | "high";

export type CanIAllocateReport = {
  service: typeof APP_NAME;
  analysisVersion: typeof APP_VERSION;
  dataSource: DataSource;
  stateVerification: StateVerification;
  decision: AllocationDecision;
  approved: boolean;
  risk: AllocationRisk;
  reason: string;
  capital: {
    currentAllocation: number;
    proposedCapital: number;
    projectedAllocation: number;
    totalCapital: number;
    strategyCapitalLimit: number;
    projectedStrategyConcentrationPct: number;
    strategyLimitUtilizationPct: number;
  };
  lossBudget: {
    used: number;
    limit: number;
    usedPct: number;
  };
  recommendedAction: {
    type: "reduce_allocation" | "cap_allocation" | "maintain_allocation";
    recommendedMaximum: number;
  };
};

export type CanIAllocateRequest = {
  agent: string;
  strategy: string;
  proposedCapital: number;
  currentStrategyAllocation: number;
  totalCapital: number;
  strategyCapitalLimit: number;
  dailyLossUsed: number;
  dailyLossLimit: number;
};

export type ServicePurchaseAction = {
  type: "service_purchase";
  amount: number;
  provider: string;
};

export type CapitalAllocationAction = {
  type: "capital_allocation";
  amount: number;
  strategy: string;
};

export type EvaluateActionRequest = {
  entity: string;
  action: ServicePurchaseAction | CapitalAllocationAction;
  source?: "provided_state" | "okx";
  financialState?: ProvidedFinancialState;
  context?: {
    days?: number;
  };
  state?: {
    currentStrategyAllocation: number;
    totalCapital: number;
    dailyLossUsed: number;
  };
  policy?: FinancialPolicy;
};

export type EvaluateActionResponse = {
  service: typeof APP_NAME;
  version: typeof APP_VERSION;
  actionType: ServicePurchaseAction["type"] | CapitalAllocationAction["type"];
  dataSource: DataSource;
  stateVerification: StateVerification;
  decision: PolicyDecision;
  approved: boolean;
  risk: PolicyRisk;
  reason: string;
  violatedPolicies: PolicyViolation[];
  warnings: PolicyViolation[];
  recommendation: string;
  recommendedAction?: {
    type: string;
    target?: string;
    recommendedMaximum?: number;
  };
  projectedState: {
    spend?: number;
    normalizedSpend?: number;
    budgetRemaining?: number;
    providerConcentrationPct?: number;
    strategyAllocation?: number;
    strategyAllocationPct?: number;
    lossBudgetUsedPct?: number;
  };
  generatedAt: string;
};
