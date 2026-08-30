import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest, NextResponse } from "next/server";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@okxweb3/x402-core/http";
import type { FacilitatorClient } from "@okxweb3/x402-core/server";

import { GET as healthGet } from "../app/api/health/route";
import { POST as companyHealthPost } from "../app/api/company-health/route";
import { POST as demoRecommendationsPost } from "../app/api/demo/recommendations/route";
import { POST as recommendationsPost } from "../app/api/recommendations/route";
import { POST as evaluateActionPost } from "../app/api/evaluate-action/route";
import {
  createX402Handler,
  DEFAULT_POLICY_GUARD_PRICE_USD,
  DEFAULT_RECOMMENDATIONS_PRICE_USD,
  getMarketplacePaymentMetadata,
  getPaymentConfigurationStatus,
  type X402PaymentConfig,
} from "../lib/x402";

const PAY_TO = "0x0000000000000000000000000000000000000001";
const LIVE_ENV_KEYS = [
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_PASSPHRASE",
  "AGENTLEDGER_PAY_TO_ADDRESS",
  "AGENTLEDGER_RECOMMENDATIONS_PRICE_USD",
  "AGENTLEDGER_POLICY_GUARD_PRICE_USD",
];

const paymentConfig: X402PaymentConfig = {
  network: "eip155:196",
  payToAddress: PAY_TO,
  recommendationsPrice: "$0.01",
  policyGuardPrice: "$0.02",
};

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function saveEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(LIVE_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function clearEnvironment(): void {
  for (const key of LIVE_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const key of LIVE_ENV_KEYS) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }
}

function facilitator(options: { valid?: boolean } = {}): FacilitatorClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }],
      extensions: [],
      signers: {},
    }),
    verify: async () => {
      calls.push("verify");
      return options.valid === false ? { isValid: false, invalidReason: "invalid_payment" } : { isValid: true };
    },
    settle: async () => {
      calls.push("settle");
      return { success: true, status: "success", transaction: "0xmock-settlement", network: "eip155:196" };
    },
  };
}

function nextRequest(path: string, init: { method?: string; headers?: HeadersInit; body?: BodyInit } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, init);
}

async function paymentHeaderFor(
  handler: (request: NextRequest) => Promise<NextResponse>,
  path: string,
): Promise<string> {
  const response = await handler(nextRequest(path, { method: "POST", body: "{}" }));
  assert.equal(response.status, 402);
  const header = response.headers.get("PAYMENT-REQUIRED");
  assert.ok(header);
  return header;
}

test("payment metadata exposes the launch prices and X Layer network", () => {
  const previous = saveEnvironment();
  try {
    clearEnvironment();
    const metadata = getMarketplacePaymentMetadata();
    assert.equal(metadata.network, "eip155:196");
    assert.equal(metadata.recommendationsPricing, "0.01 USDT/use");
    assert.equal(metadata.policyGuardPricing, "0.02 USDT/use");
    assert.equal(DEFAULT_RECOMMENDATIONS_PRICE_USD, 0.01);
    assert.equal(DEFAULT_POLICY_GUARD_PRICE_USD, 0.02);
  } finally {
    restoreEnvironment(previous);
  }
});

test("payment configuration reports seller and facilitator readiness without exposing secrets", () => {
  const previous = saveEnvironment();
  try {
    clearEnvironment();
    process.env.OKX_API_KEY = "key-not-logged";
    process.env.OKX_SECRET_KEY = "secret-not-logged";
    process.env.OKX_PASSPHRASE = "passphrase-not-logged";
    process.env.AGENTLEDGER_PAY_TO_ADDRESS = PAY_TO;
    const status = getPaymentConfigurationStatus();
    assert.equal(status.payToConfigured, true);
    assert.equal(status.x402Configured, true);
    assert.equal(JSON.stringify(status).includes("secret-not-logged"), false);
  } finally {
    restoreEnvironment(previous);
  }
});

test("unpaid recommendations return an SDK-generated 402 challenge at 0.01 USDT", async () => {
  let executions = 0;
  const handler = createX402Handler(
    "recommendations",
    async () => {
      executions += 1;
      return NextResponse.json({ ok: true });
    },
    { config: paymentConfig, facilitatorClient: facilitator() },
  );

  const header = await paymentHeaderFor(handler, "/api/recommendations");
  const challenge = decodePaymentRequiredHeader(header);
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.accepts[0]?.network, "eip155:196");
  assert.equal(challenge.accepts[0]?.payTo, PAY_TO);
  assert.equal(challenge.accepts[0]?.amount, "10000");
  assert.equal(executions, 0);
});

test("unpaid Policy Guard returns an SDK-generated 402 challenge at 0.02 USDT", async () => {
  const handler = createX402Handler(
    "policyGuard",
    async () => NextResponse.json({ ok: true }),
    { config: paymentConfig, facilitatorClient: facilitator() },
  );

  const challenge = decodePaymentRequiredHeader(await paymentHeaderFor(handler, "/api/evaluate-action"));
  assert.equal(challenge.accepts[0]?.network, "eip155:196");
  assert.equal(challenge.accepts[0]?.payTo, PAY_TO);
  assert.equal(challenge.accepts[0]?.amount, "20000");
});

test("valid Recommendations payment reaches the existing handler and returns a receipt", async () => {
  const mockFacilitator = facilitator();
  let executions = 0;
  const handler = createX402Handler(
    "recommendations",
    async () => {
      executions += 1;
      return NextResponse.json({ result: "existing-recommendation-handler" });
    },
    { config: paymentConfig, facilitatorClient: mockFacilitator },
  );
  const challenge = decodePaymentRequiredHeader(await paymentHeaderFor(handler, "/api/recommendations"));
  const paymentSignature = encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: challenge.accepts[0],
    payload: {},
  });

  const response = await handler(nextRequest("/api/recommendations", {
    method: "POST",
    headers: { "PAYMENT-SIGNATURE": paymentSignature },
    body: "{}",
  }));
  assert.equal(response.status, 200);
  assert.equal(executions, 1);
  assert.deepEqual(mockFacilitator.calls, ["verify", "settle"]);
  assert.ok(response.headers.get("PAYMENT-RESPONSE"));
  assert.deepEqual(await response.json(), { result: "existing-recommendation-handler" });
});

test("valid Policy Guard payment reaches the existing handler", async () => {
  const mockFacilitator = facilitator();
  let executions = 0;
  const handler = createX402Handler(
    "policyGuard",
    async () => {
      executions += 1;
      return NextResponse.json({ result: "existing-policy-handler" });
    },
    { config: paymentConfig, facilitatorClient: mockFacilitator },
  );
  const challenge = decodePaymentRequiredHeader(await paymentHeaderFor(handler, "/api/evaluate-action"));
  const paymentSignature = encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: challenge.accepts[0],
    payload: {},
  });

  const response = await handler(nextRequest("/api/evaluate-action", {
    method: "POST",
    headers: { "PAYMENT-SIGNATURE": paymentSignature },
    body: "{}",
  }));
  assert.equal(response.status, 200);
  assert.equal(executions, 1);
  assert.deepEqual(mockFacilitator.calls, ["verify", "settle"]);
  assert.ok(response.headers.get("PAYMENT-RESPONSE"));
});

test("invalid payment does not execute the protected handler", async () => {
  const mockFacilitator = facilitator({ valid: false });
  let executions = 0;
  const handler = createX402Handler(
    "recommendations",
    async () => {
      executions += 1;
      return NextResponse.json({ result: "must-not-run" });
    },
    { config: paymentConfig, facilitatorClient: mockFacilitator },
  );
  const challenge = decodePaymentRequiredHeader(await paymentHeaderFor(handler, "/api/recommendations"));
  const paymentSignature = encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: challenge.accepts[0],
    payload: {},
  });

  const response = await handler(nextRequest("/api/recommendations", {
    method: "POST",
    headers: { "PAYMENT-SIGNATURE": paymentSignature },
    body: "{}",
  }));
  assert.equal(response.status, 402);
  assert.equal(executions, 0);
  assert.deepEqual(mockFacilitator.calls, ["verify"]);
});

test("missing seller address fails paid production routes safely instead of making them free", async () => {
  const previous = saveEnvironment();
  try {
    clearEnvironment();
    const response = await recommendationsPost(request("/api/recommendations", { address: "0xagentcompany" }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-request-id")?.length, 36);
    assert.deepEqual(await response.json(), {
      error: {
        code: "PAYMENT_NOT_CONFIGURED",
        message: "AGENTLEDGER_PAY_TO_ADDRESS must be a valid public X Layer EVM receiving address before paid endpoints can be used.",
        retryable: false,
      },
    });
  } finally {
    restoreEnvironment(previous);
  }
});

test("free, demo and specialist routes do not invoke x402", async () => {
  const previous = saveEnvironment();
  try {
    clearEnvironment();
    const health = await healthGet(new Request("http://localhost/api/health"));
    const companyHealth = await companyHealthPost(request("/api/company-health", { address: "0xagentcompany" }));
    const demoRecommendations = await demoRecommendationsPost(request("/api/demo/recommendations", { address: "0xagentcompany" }));
    const policyGuard = await evaluateActionPost(request("/api/evaluate-action", {
      entity: "0xagentcompany",
      action: { type: "capital_allocation", amount: 1, strategy: "demo" },
      state: { currentStrategyAllocation: 0, totalCapital: 100, dailyLossUsed: 0 },
    }));
    assert.equal(health.status, 200);
    assert.notEqual(companyHealth.status, 402);
    assert.equal(demoRecommendations.status, 200);
    assert.equal(policyGuard.status, 503);
    assert.equal((await demoRecommendations.json()).dataSource, "demo");
  } finally {
    restoreEnvironment(previous);
  }
});
