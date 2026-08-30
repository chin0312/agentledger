import type { NormalizedTransaction, ProvidedFinancialState } from "./types";

export type NormalizedProviderState = {
  provider: string;
  spend: number;
  transactions: number;
  failedTransactions: number;
};

export type NormalizedFinancialState = {
  periodDays: number;
  inflows: number;
  outflows: number;
  incomingTransactions: number;
  outgoingTransactions: number;
  failedTransactions: number;
  firstHalfSpend: number;
  secondHalfSpend: number;
  providers: NormalizedProviderState[];
  failedProviders: Array<{ provider: string; transactions: number }>;
  totalTransactions: number;
};

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number`);
  }
}

function assertCount(value: number, field: string): void {
  assertFiniteNonNegative(value, field);
  if (!Number.isInteger(value) || value > 1_000_000) {
    throw new Error(`${field} must be a non-negative integer within the supported limit`);
  }
}

function assertPeriodDays(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 90) {
    throw new Error("periodDays must be an integer between 1 and 90");
  }
}

function round(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Converts caller-supplied factual aggregates into the internal state shape
 * consumed by the analysis engine. Conclusions are deliberately not accepted
 * here; all ratios and findings are derived downstream.
 */
export function normalizeFinancialState(state: ProvidedFinancialState): NormalizedFinancialState {
  assertPeriodDays(state.periodDays);
  assertFiniteNonNegative(state.cashFlow.inflows, "cashFlow.inflows");
  assertFiniteNonNegative(state.cashFlow.outflows, "cashFlow.outflows");
  if ((state.providers?.length ?? 0) > 100) {
    throw new Error("providers must contain at most 100 entries");
  }

  const providers = new Map<string, NormalizedProviderState>();
  for (const provider of state.providers ?? []) {
    assertFiniteNonNegative(provider.spend, "providers.spend");
    assertCount(provider.transactions, "providers.transactions");
    assertCount(provider.failedTransactions ?? 0, "providers.failedTransactions");
    const key = provider.provider.trim().toLowerCase();
    if (!key) {
      throw new Error("providers.provider must not be empty");
    }

    const existing = providers.get(key);
    if (existing) {
      existing.spend += provider.spend;
      existing.transactions += provider.transactions;
      existing.failedTransactions += provider.failedTransactions ?? 0;
    } else {
      providers.set(key, {
        provider: provider.provider.trim(),
        spend: provider.spend,
        transactions: provider.transactions,
        failedTransactions: provider.failedTransactions ?? 0,
      });
    }
  }

  const failedTransactions = state.failedTransactions ?? 0;
  assertCount(failedTransactions, "failedTransactions");
  const incomingTransactions = state.cashFlow.incomingTransactions ?? (state.cashFlow.inflows > 0 ? 1 : 0);
  const outgoingTransactions = state.cashFlow.outgoingTransactions ?? (
    providers.size > 0
      ? [...providers.values()].reduce((sum, provider) => sum + provider.transactions, 0)
      : state.cashFlow.outflows > 0
        ? 1
        : 0
  );
  assertCount(incomingTransactions, "cashFlow.incomingTransactions");
  assertCount(outgoingTransactions, "cashFlow.outgoingTransactions");

  const firstHalfSpend = state.spendVelocity?.firstHalf ?? state.cashFlow.outflows / 2;
  const secondHalfSpend = state.spendVelocity?.secondHalf ?? state.cashFlow.outflows / 2;
  assertFiniteNonNegative(firstHalfSpend, "spendVelocity.firstHalf");
  assertFiniteNonNegative(secondHalfSpend, "spendVelocity.secondHalf");

  const failedProviders = [...providers.values()]
    .filter((provider) => provider.failedTransactions > 0)
    .map((provider) => ({ provider: provider.provider, transactions: provider.failedTransactions }))
    .sort((left, right) => right.transactions - left.transactions || left.provider.localeCompare(right.provider));

  return {
    periodDays: state.periodDays,
    inflows: state.cashFlow.inflows,
    outflows: state.cashFlow.outflows,
    incomingTransactions,
    outgoingTransactions,
    failedTransactions,
    firstHalfSpend,
    secondHalfSpend,
    providers: [...providers.values()],
    failedProviders,
    totalTransactions: incomingTransactions + outgoingTransactions + failedTransactions,
  };
}

/** Converts normalized wallet transactions into the same source-agnostic state shape. */
export function normalizeTransactionState(options: {
  transactions: NormalizedTransaction[];
  from: number;
  to: number;
  periodDays: number;
}): NormalizedFinancialState {
  const relevantTransactions = options.transactions.filter(
    (transaction) => transaction.timestamp >= options.from && transaction.timestamp <= options.to,
  );
  const successfulTransactions = relevantTransactions.filter((transaction) => transaction.status === "success");
  const successfulIncoming = successfulTransactions.filter((transaction) => transaction.direction === "incoming");
  const successfulOutgoing = successfulTransactions.filter((transaction) => transaction.direction === "outgoing");
  const providers = new Map<string, NormalizedProviderState>();
  for (const transaction of successfulOutgoing) {
    const key = transaction.counterparty.trim().toLowerCase();
    const existing = providers.get(key);
    if (existing) {
      existing.spend += transaction.amount;
      existing.transactions += 1;
    } else {
      providers.set(key, {
        provider: transaction.counterparty,
        spend: transaction.amount,
        transactions: 1,
        failedTransactions: 0,
      });
    }
  }

  const failedProviders = new Map<string, { provider: string; transactions: number }>();
  for (const transaction of relevantTransactions.filter((item) => item.status === "failed")) {
    const key = transaction.counterparty.trim().toLowerCase();
    const existing = failedProviders.get(key);
    if (existing) {
      existing.transactions += 1;
    } else {
      failedProviders.set(key, { provider: transaction.counterparty, transactions: 1 });
    }
  }

  const midpoint = options.from + (options.to - options.from) / 2;
  const firstHalfSpend = successfulOutgoing
    .filter((transaction) => transaction.timestamp < midpoint)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const secondHalfSpend = successfulOutgoing
    .filter((transaction) => transaction.timestamp >= midpoint)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    periodDays: options.periodDays,
    inflows: successfulIncoming.reduce((sum, transaction) => sum + transaction.amount, 0),
    outflows: successfulOutgoing.reduce((sum, transaction) => sum + transaction.amount, 0),
    incomingTransactions: relevantTransactions.filter((transaction) => transaction.direction === "incoming").length,
    outgoingTransactions: relevantTransactions.filter((transaction) => transaction.direction === "outgoing").length,
    failedTransactions: relevantTransactions.filter((transaction) => transaction.status === "failed").length,
    firstHalfSpend,
    secondHalfSpend,
    providers: [...providers.values()],
    failedProviders: [...failedProviders.values()].sort(
      (left, right) => right.transactions - left.transactions || left.provider.localeCompare(right.provider),
    ),
    totalTransactions: relevantTransactions.length,
  };
}

export function spendVelocityChangePct(firstHalfSpend: number, secondHalfSpend: number): number {
  if (firstHalfSpend === 0) {
    return secondHalfSpend > 0 ? 100 : 0;
  }

  return round(((secondHalfSpend - firstHalfSpend) / firstHalfSpend) * 100);
}
