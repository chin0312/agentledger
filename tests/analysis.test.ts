import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCompanyHealth, buildSpendDecision } from "../lib/analysis";
import { normalizeOkxTransactions } from "../lib/okx";
import type { NormalizedTransaction } from "../lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-27T12:00:00.000Z");

function transaction(options: {
  index: number;
  daysAgo: number;
  amount: number;
  direction: "incoming" | "outgoing";
  counterparty?: string;
  status?: "success" | "failed";
}): NormalizedTransaction {
  return {
    txHash: `0xtest${options.index}`,
    timestamp: NOW - options.daysAgo * DAY_MS,
    symbol: "USDC",
    amount: options.amount,
    direction: options.direction,
    counterparty: options.counterparty ?? `0xvendor${options.index}`,
    status: options.status ?? "success",
  };
}

function report(transactions: NormalizedTransaction[], monthlyBudget?: number) {
  return analyzeCompanyHealth({
    wallet: "0xwallet",
    days: 30,
    monthlyBudget,
    now: NOW,
    dataSource: "demo",
    transactions,
  });
}

test("positive cash flow is reported", () => {
  const result = report([
    transaction({ index: 1, daysAgo: 5, amount: 100, direction: "incoming" }),
    transaction({ index: 2, daysAgo: 4, amount: 40, direction: "outgoing" }),
  ]);

  assert.deepEqual(result.cashFlow, { revenue: 100, spend: 40, net: 60 });
  assert.equal(result.insights.find((insight) => insight.type === "cash_flow")?.severity, "positive");
});

test("negative cash flow is reported", () => {
  const result = report([
    transaction({ index: 1, daysAgo: 5, amount: 20, direction: "incoming" }),
    transaction({ index: 2, daysAgo: 4, amount: 40, direction: "outgoing" }),
  ]);

  assert.deepEqual(result.cashFlow, { revenue: 20, spend: 40, net: -20 });
  assert.equal(result.insights.find((insight) => insight.type === "cash_flow")?.severity, "warning");
});

test("budget utilization below 75 percent is positive", () => {
  const result = report([transaction({ index: 1, daysAgo: 4, amount: 50, direction: "outgoing" })], 100);
  assert.equal(result.budget?.usedPct, 50);
  assert.equal(result.insights.find((insight) => insight.type === "budget_utilization")?.severity, "positive");
});

test("budget utilization from 75 to 90 percent is a warning", () => {
  const result = report([transaction({ index: 1, daysAgo: 4, amount: 80, direction: "outgoing" })], 100);
  assert.equal(result.budget?.usedPct, 80);
  assert.equal(result.insights.find((insight) => insight.type === "budget_utilization")?.severity, "warning");
});

test("budget utilization above 90 percent is critical", () => {
  const result = report([transaction({ index: 1, daysAgo: 4, amount: 95, direction: "outgoing" })], 100);
  assert.equal(result.budget?.usedPct, 95);
  assert.equal(result.insights.find((insight) => insight.type === "budget_utilization")?.severity, "critical");
});

test("counterparty concentration identifies the largest recipient", () => {
  const result = report([
    transaction({ index: 1, daysAgo: 4, amount: 60, direction: "outgoing", counterparty: "0xA" }),
    transaction({ index: 2, daysAgo: 3, amount: 40, direction: "outgoing", counterparty: "0xB" }),
  ]);

  assert.equal(result.topCounterparties[0]?.shareOfSpendPct, 60);
  assert.equal(result.insights.find((insight) => insight.type === "counterparty_concentration")?.severity, "critical");
});

test("repeated vendors require at least three successful outgoing payments", () => {
  const result = report([
    transaction({ index: 1, daysAgo: 4, amount: 10, direction: "outgoing", counterparty: "0xrepeat" }),
    transaction({ index: 2, daysAgo: 3, amount: 10, direction: "outgoing", counterparty: "0xREPEAT" }),
    transaction({ index: 3, daysAgo: 2, amount: 10, direction: "outgoing", counterparty: "0xrepeat" }),
  ]);

  assert.equal(result.repeatedVendors[0]?.transactions, 3);
  assert.equal(result.insights.filter((insight) => insight.type === "repeated_vendor").length, 1);
});

test("spend velocity compares the two halves of the selected period", () => {
  const result = report([
    transaction({ index: 1, daysAgo: 25, amount: 10, direction: "outgoing" }),
    transaction({ index: 2, daysAgo: 10, amount: 25, direction: "outgoing" }),
  ]);

  assert.deepEqual(result.spendVelocity, { firstHalf: 10, secondHalf: 25, changePct: 150 });
  assert.equal(result.insights.find((insight) => insight.type === "spend_acceleration")?.severity, "warning");
});

test("can-i-spend approves a low-utilization proposal", () => {
  const result = buildSpendDecision({
    report: report([transaction({ index: 1, daysAgo: 4, amount: 20, direction: "outgoing" })], 100),
    proposedSpend: 10,
    monthlyBudget: 100,
  });

  assert.equal(result.decision, "approve");
  assert.equal(result.approved, true);
  assert.equal(result.risk, "low");
});

test("can-i-spend returns caution between 75 and 90 percent", () => {
  const result = buildSpendDecision({
    report: report([transaction({ index: 1, daysAgo: 4, amount: 70, direction: "outgoing" })], 100),
    proposedSpend: 10,
    monthlyBudget: 100,
  });

  assert.equal(result.decision, "caution");
  assert.equal(result.approved, true);
  assert.equal(result.risk, "medium");
});

test("can-i-spend rejects above 90 percent", () => {
  const result = buildSpendDecision({
    report: report([transaction({ index: 1, daysAgo: 4, amount: 80, direction: "outgoing" })], 100),
    proposedSpend: 15,
    monthlyBudget: 100,
  });

  assert.equal(result.decision, "reject");
  assert.equal(result.approved, false);
  assert.equal(result.risk, "high");
});

test("OKX normalization filters unsupported assets and pending transfers", () => {
  const result = normalizeOkxTransactions(
    [
      {
        txHash: "0xokx-success",
        txTime: String(NOW),
        symbol: "usdc",
        amount: "12.5",
        from: [{ address: "0xWALLET" }],
        to: [{ address: "0xVendor" }],
        txStatus: "success",
      },
      {
        txHash: "0xokx-failed",
        txTime: String(NOW),
        symbol: "USDT",
        amount: "0",
        from: [{ address: "0xother" }],
        to: [{ address: "0xwallet" }],
        txStatus: "fail",
      },
      {
        txHash: "0xokx-pending",
        txTime: String(NOW),
        symbol: "USDG",
        amount: "10",
        from: [{ address: "0xwallet" }],
        to: [{ address: "0xother" }],
        txStatus: "pending",
      },
      {
        txHash: "0xokx-ignored",
        txTime: String(NOW),
        symbol: "DAI",
        amount: "10",
        from: [{ address: "0xwallet" }],
        to: [{ address: "0xother" }],
        txStatus: "success",
      },
    ],
    "0xwallet",
  );

  assert.deepEqual(
    result.map(({ txHash, symbol, amount, direction, counterparty, status }) => ({
      txHash,
      symbol,
      amount,
      direction,
      counterparty,
      status,
    })),
    [
      { txHash: "0xokx-success", symbol: "USDC", amount: 12.5, direction: "outgoing", counterparty: "0xVendor", status: "success" },
      { txHash: "0xokx-failed", symbol: "USDT", amount: 0, direction: "incoming", counterparty: "0xother", status: "failed" },
    ],
  );
});
