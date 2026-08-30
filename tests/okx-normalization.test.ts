import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFinancialState, normalizeTransactionState } from "../lib/financial-context";
import type { NormalizedTransaction } from "../lib/types";

function transaction(options: {
  index: number;
  direction: "incoming" | "outgoing";
  status: "success" | "failed";
  amount: number;
  counterparty?: string;
  timestamp?: number;
}): NormalizedTransaction {
  return {
    txHash: `0xnormalization${options.index}`,
    timestamp: options.timestamp ?? options.index * 10,
    symbol: "USDC",
    amount: options.amount,
    direction: options.direction,
    counterparty: options.counterparty ?? `provider-${options.index}`,
    status: options.status,
  };
}

function normalize(transactions: NormalizedTransaction[]) {
  return normalizeTransactionState({ transactions, from: 0, to: 100, periodDays: 30 });
}

test("failed outgoing transactions are excluded from successful outgoing counts", () => {
  const state = normalize([
    transaction({ index: 1, direction: "outgoing", status: "success", amount: 10 }),
    transaction({ index: 2, direction: "outgoing", status: "success", amount: 20 }),
    transaction({ index: 3, direction: "outgoing", status: "failed", amount: 30 }),
  ]);

  assert.equal(state.outgoingTransactions, 2);
  assert.equal(state.failedTransactions, 1);
  assert.equal(state.totalTransactions, 3);
  assert.equal(state.outflows, 30);
});

test("failed incoming transactions do not become failed providers", () => {
  const state = normalize([
    transaction({ index: 1, direction: "incoming", status: "failed", amount: 50, counterparty: "client-a" }),
  ]);

  assert.equal(state.incomingTransactions, 0);
  assert.equal(state.outgoingTransactions, 0);
  assert.equal(state.failedTransactions, 1);
  assert.equal(state.totalTransactions, 1);
  assert.deepEqual(state.failedProviders, []);
  assert.equal(state.inflows, 0);
});

test("failed providers include only failed outgoing attempts", () => {
  const state = normalize([
    transaction({ index: 1, direction: "outgoing", status: "failed", amount: 10, counterparty: "Provider-A" }),
    transaction({ index: 2, direction: "outgoing", status: "failed", amount: 20, counterparty: "provider-a" }),
    transaction({ index: 3, direction: "incoming", status: "failed", amount: 30, counterparty: "Provider-A" }),
  ]);

  assert.deepEqual(state.failedProviders, [{ provider: "Provider-A", transactions: 2 }]);
});

test("mixed OKX transactions preserve the successful-count invariant", () => {
  const state = normalize([
    transaction({ index: 1, direction: "incoming", status: "success", amount: 100 }),
    transaction({ index: 2, direction: "outgoing", status: "success", amount: 40, counterparty: "provider-a" }),
    transaction({ index: 3, direction: "incoming", status: "failed", amount: 200 }),
    transaction({ index: 4, direction: "outgoing", status: "failed", amount: 80, counterparty: "provider-a" }),
  ]);

  assert.equal(state.incomingTransactions + state.outgoingTransactions + state.failedTransactions, state.totalTransactions);
  assert.equal(state.incomingTransactions, 1);
  assert.equal(state.outgoingTransactions, 1);
  assert.equal(state.failedTransactions, 2);
  assert.equal(state.totalTransactions, 4);
  assert.equal(state.inflows, 100);
  assert.equal(state.outflows, 40);
  assert.deepEqual(state.failedProviders, [{ provider: "provider-a", transactions: 1 }]);
});

test("provided-state normalization keeps successful and failed counts separate", () => {
  const state = normalizeFinancialState({
    periodDays: 30,
    cashFlow: { inflows: 100, outflows: 40, incomingTransactions: 1, outgoingTransactions: 1 },
    providers: [{ provider: "provider-a", spend: 40, transactions: 1, failedTransactions: 1 }],
    failedTransactions: 1,
  });

  assert.equal(state.incomingTransactions, 1);
  assert.equal(state.outgoingTransactions, 1);
  assert.equal(state.failedTransactions, 1);
  assert.equal(state.totalTransactions, 3);
  assert.deepEqual(state.failedProviders, [{ provider: "provider-a", transactions: 1 }]);
});
