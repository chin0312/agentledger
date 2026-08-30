import type { NormalizedTransaction, StablecoinSymbol, TransactionDirection, TransactionStatus } from "./types";

export const DEMO_ANCHOR_MS = Date.parse("2026-08-27T12:00:00.000Z");

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const counterparties = {
  marketplace: "0xmarketplace0000000000000000000000000001",
  researchService: "0xresearchservice0000000000000000000001",
  client: "0xclient00000000000000000000000000000001",
  researchAgent: "0xresearchagent00000000000000000000000001",
  dataProvider: "0xdataprovider00000000000000000000000001",
  growthAgent: "0xgrowthagent000000000000000000000000001",
  codeReviewAgent: "0xcodereview000000000000000000000000001",
  designAgent: "0xdesignagent000000000000000000000000001",
} as const;

function txHash(index: number): string {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function timestamp(daysAgo: number, hour = 12): number {
  return DEMO_ANCHOR_MS - daysAgo * DAY_MS + (hour - 12) * HOUR_MS;
}

function transaction(
  index: number,
  daysAgo: number,
  symbol: StablecoinSymbol,
  amount: number,
  direction: TransactionDirection,
  counterparty: string,
  status: TransactionStatus = "success",
): NormalizedTransaction {
  return {
    txHash: txHash(index),
    timestamp: timestamp(daysAgo),
    symbol,
    amount,
    direction,
    counterparty,
    status,
  };
}

// Fixed offsets and amounts make demo responses useful and reproducible.
const DEMO_TRANSACTIONS: readonly NormalizedTransaction[] = [
  transaction(1, 28, "USDC", 65, "incoming", counterparties.marketplace),
  transaction(2, 24, "USDT", 42, "incoming", counterparties.researchService),
  transaction(3, 18, "USDG", 80, "incoming", counterparties.client),
  transaction(4, 12, "USDC", 55, "incoming", counterparties.marketplace),
  transaction(5, 6, "USDT", 40, "incoming", counterparties.researchService),
  transaction(6, 2, "USDG", 60, "incoming", counterparties.client),

  transaction(7, 29, "USDC", 18, "outgoing", counterparties.researchAgent),
  transaction(8, 27, "USDT", 8, "outgoing", counterparties.dataProvider),
  transaction(9, 25, "USDG", 6, "outgoing", counterparties.growthAgent),
  transaction(10, 22, "USDC", 7, "outgoing", counterparties.codeReviewAgent),
  transaction(11, 20, "USDT", 5, "outgoing", counterparties.designAgent),
  transaction(12, 17, "USDC", 12, "outgoing", counterparties.researchAgent),
  transaction(13, 16, "USDG", 9, "outgoing", counterparties.dataProvider),

  transaction(14, 14, "USDC", 24, "outgoing", counterparties.researchAgent),
  transaction(15, 12, "USDT", 15, "outgoing", counterparties.dataProvider),
  transaction(16, 10, "USDG", 30, "outgoing", counterparties.researchAgent),
  transaction(17, 9, "USDC", 12, "outgoing", counterparties.growthAgent),
  transaction(18, 8, "USDT", 10, "outgoing", counterparties.codeReviewAgent),
  transaction(19, 7, "USDC", 9, "outgoing", counterparties.designAgent),
  transaction(20, 6, "USDG", 26, "outgoing", counterparties.researchAgent),
  transaction(21, 5, "USDT", 12, "outgoing", counterparties.dataProvider),
  transaction(22, 4, "USDC", 14, "outgoing", counterparties.growthAgent),
  transaction(23, 3, "USDG", 18, "outgoing", counterparties.researchAgent),
  transaction(24, 2, "USDT", 16, "outgoing", counterparties.researchAgent, "failed"),
];

export function getDemoTransactions(): NormalizedTransaction[] {
  return DEMO_TRANSACTIONS.map((transaction) => ({ ...transaction }));
}
