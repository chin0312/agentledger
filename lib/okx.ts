import { createHmac } from "node:crypto";

import type { NormalizedTransaction, StablecoinSymbol, TransactionStatus } from "./types";
import type { RuntimeConfig } from "./config";
import { AppError, UpstreamTimeoutError } from "./http";

const OKX_BASE_URL = "https://web3.okx.com";
const TRANSACTION_HISTORY_PATH = "/api/v6/dex/post-transaction/transactions-by-address";
const MAX_PAGES = 20;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 50;

type OkxAddressEntry = { address?: unknown; amount?: unknown };

type OkxTransaction = {
  txHash?: unknown;
  txTime?: unknown;
  symbol?: unknown;
  amount?: unknown;
  from?: unknown;
  to?: unknown;
  txStatus?: unknown;
};

type OkxResponse = {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
};

export class OkxApiError extends AppError {
  constructor(retryable = true) {
    super("OKX_API_ERROR", "Unable to retrieve live financial activity from OKX.", 502, retryable);
    this.name = "OkxApiError";
  }
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const direct = toStringValue(value);
    return direct ? [direct] : [];
  }

  return value
    .map((entry): string | null => {
      if (typeof entry === "string") {
        return toStringValue(entry);
      }

      if (entry && typeof entry === "object") {
        return toStringValue((entry as OkxAddressEntry).address);
      }

      return null;
    })
    .filter((address): address is string => Boolean(address));
}

function parseAmount(transaction: OkxTransaction): number | null {
  const value = Number(transaction.amount);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }

  return null;
}

function normalizeStatus(value: unknown): TransactionStatus | null {
  const status = toStringValue(value)?.toLowerCase();
  if (status === "success") {
    return "success";
  }

  if (["fail", "failed", "failure", "reverted", "cancelled", "canceled"].includes(status ?? "")) {
    return "failed";
  }

  // Pending transactions are not yet operating cash flow and are excluded.
  return null;
}

function normalizeSymbol(value: unknown): StablecoinSymbol | null {
  const symbol = toStringValue(value)?.toUpperCase();
  return symbol === "USDT" || symbol === "USDC" || symbol === "USDG" ? symbol : null;
}

export function normalizeOkxTransactions(
  transactions: OkxTransaction[],
  walletAddress: string,
): NormalizedTransaction[] {
  const wallet = walletAddress.trim().toLowerCase();
  const normalized: NormalizedTransaction[] = [];

  for (const transaction of transactions) {
    const txHash = toStringValue(transaction.txHash);
    const symbol = normalizeSymbol(transaction.symbol);
    const status = normalizeStatus(transaction.txStatus);
    const timestampValue = Number(transaction.txTime);
    const timestamp = timestampValue < 1_000_000_000_000 ? timestampValue * 1000 : timestampValue;
    const amount = parseAmount(transaction);
    const from = extractAddresses(transaction.from);
    const to = extractAddresses(transaction.to);
    const isOutgoing = from.some((address) => address.toLowerCase() === wallet);
    const isIncoming = to.some((address) => address.toLowerCase() === wallet);

    if (
      !txHash ||
      !symbol ||
      !status ||
      !Number.isFinite(timestamp) ||
      amount === null ||
      amount < 0 ||
      isOutgoing === isIncoming
    ) {
      continue;
    }

    const direction = isOutgoing ? "outgoing" : "incoming";
    const candidates = direction === "outgoing" ? to : from;
    const counterparty = candidates.find((address) => address.toLowerCase() !== wallet) ?? candidates[0];

    if (!counterparty) {
      continue;
    }

    normalized.push({
      txHash,
      timestamp,
      symbol,
      amount,
      direction,
      counterparty,
      status,
    });
  }

  return normalized;
}

function signRequest(timestamp: string, requestPath: string, secretKey: string): string {
  return createHmac("sha256", secretKey)
    .update(`${timestamp}GET${requestPath}`)
    .digest("base64");
}

function makeHeaders(config: RuntimeConfig, requestPath: string): Headers {
  const timestamp = new Date().toISOString();
  const headers = new Headers({
    Accept: "application/json",
    "OK-ACCESS-KEY": config.apiKey,
    "OK-ACCESS-SIGN": signRequest(timestamp, requestPath, config.secretKey),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": config.passphrase,
  });

  if (config.projectId) {
    headers.set("OK-ACCESS-PROJECT", config.projectId);
  }

  return headers;
}

function extractPage(payload: OkxResponse): { transactions: OkxTransaction[]; cursor?: string } {
  if (!Array.isArray(payload.data)) {
    throw new OkxApiError(false);
  }

  const transactions: OkxTransaction[] = [];
  let cursor: string | undefined;

  for (const block of payload.data) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const record = block as { transactions?: unknown; transactionList?: unknown; cursor?: unknown };
    if (Array.isArray(record.transactions)) {
      transactions.push(...(record.transactions as OkxTransaction[]));
    }
    if (Array.isArray(record.transactionList)) {
      transactions.push(...(record.transactionList as OkxTransaction[]));
    }

    const blockCursor = toStringValue(record.cursor);
    if (blockCursor) {
      cursor = blockCursor;
    }
  }

  return { transactions, cursor };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function waitBeforeRetry(retryNumber: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** retryNumber));
}

async function fetchWithRetry(config: RuntimeConfig, requestPath: string): Promise<Response> {
  const timeoutMs = config.okxTimeoutMs ?? 8_000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(`${OKX_BASE_URL}${requestPath}`, {
        method: "GET",
        headers: makeHeaders(config, requestPath),
        signal: controller.signal,
        cache: "no-store",
      });

      if (shouldRetryStatus(response.status) && attempt < MAX_RETRIES) {
        await response.body?.cancel();
        await waitBeforeRetry(attempt);
        continue;
      }

      return response;
    } catch {
      if (timedOut) {
        if (attempt < MAX_RETRIES) {
          await waitBeforeRetry(attempt);
          continue;
        }

        throw new UpstreamTimeoutError();
      }

      if (attempt < MAX_RETRIES) {
        await waitBeforeRetry(attempt);
        continue;
      }

      throw new OkxApiError(true);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new OkxApiError(true);
}

export async function fetchOkxTransactions(options: {
  address: string;
  from: number;
  to: number;
  config: RuntimeConfig;
}): Promise<NormalizedTransaction[]> {
  const allTransactions: OkxTransaction[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      address: options.address,
      chains: options.config.chains.join(","),
      begin: String(Math.floor(options.from)),
      end: String(Math.floor(options.to)),
      limit: options.config.chains.length > 1 ? "100" : "20",
    });

    if (cursor) {
      query.set("cursor", cursor);
    }

    const requestPath = `${TRANSACTION_HISTORY_PATH}?${query.toString()}`;
    const response = await fetchWithRetry(options.config, requestPath);

    if (!response.ok) {
      throw new OkxApiError(shouldRetryStatus(response.status));
    }

    let payload: OkxResponse;
    try {
      payload = (await response.json()) as OkxResponse;
    } catch {
      throw new OkxApiError(false);
    }

    if (payload.code !== "0") {
      throw new OkxApiError(false);
    }

    const pageResult = extractPage(payload);
    allTransactions.push(...pageResult.transactions);

    if (!pageResult.cursor || pageResult.cursor === cursor || pageResult.transactions.length === 0) {
      break;
    }

    cursor = pageResult.cursor;
  }

  return normalizeOkxTransactions(allTransactions, options.address).filter(
    (transaction) => transaction.timestamp >= options.from && transaction.timestamp <= options.to,
  );
}
