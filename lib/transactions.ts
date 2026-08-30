import { DEMO_ANCHOR_MS, getDemoTransactions } from "./demo-data";
import { fetchOkxTransactions } from "./okx";
import type { RuntimeConfig } from "./config";
import type { DataSource, NormalizedTransaction } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function getAnalysisNow(dataSource: DataSource): number {
  return dataSource === "demo" ? DEMO_ANCHOR_MS : Date.now();
}

export async function loadTransactions(options: {
  address: string;
  from: number;
  to: number;
  dataSource: DataSource;
  config: RuntimeConfig;
}): Promise<NormalizedTransaction[]> {
  if (options.dataSource === "demo") {
    return getDemoTransactions().filter(
      (transaction) => transaction.timestamp >= options.from && transaction.timestamp <= options.to,
    );
  }

  return fetchOkxTransactions(options);
}
