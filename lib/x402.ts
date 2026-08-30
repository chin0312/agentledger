import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import type { Network } from "@okxweb3/x402-core/types";
import { x402ResourceServer, type FacilitatorClient, type RouteConfig } from "@okxweb3/x402-core/server";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { withX402 } from "@okxweb3/x402-next";
import { NextRequest, NextResponse } from "next/server";

import { getRuntimeConfig, hasLiveDataConfigured } from "./config";
import { handleApiRequest, AppError } from "./http";

export const X402_NETWORK = "eip155:196" as Network;
export const DEFAULT_RECOMMENDATIONS_PRICE_USD = 0.01;
export const DEFAULT_POLICY_GUARD_PRICE_USD = 0.02;

export type PaidService = "recommendations" | "policyGuard";

export type X402PaymentConfig = {
  network: Network;
  payToAddress: string;
  recommendationsPrice: string;
  policyGuardPrice: string;
};

type ResolvedX402PaymentConfig = X402PaymentConfig & {
  facilitator: {
    apiKey: string;
    secretKey: string;
    passphrase: string;
  };
};

export type PaymentConfigurationStatus = {
  x402Configured: boolean;
  payToConfigured: boolean;
  network: Network;
  recommendationsPriceUsd: number;
  policyGuardPriceUsd: number;
};

export class PaymentConfigurationError extends AppError {
  constructor(message: string) {
    super("PAYMENT_NOT_CONFIGURED", message, 503, false);
    this.name = "PaymentConfigurationError";
  }
}

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DECIMAL_PRICE_PATTERN = /^\d+(?:\.\d{1,6})?$/;

function isValidEvmAddress(value: string): boolean {
  return EVM_ADDRESS_PATTERN.test(value);
}

function readPrice(value: string | undefined, fallback: number): { amount: number; formatted: string; valid: boolean } {
  const raw = value?.trim();
  if (!raw) {
    return { amount: fallback, formatted: `$${fallback.toFixed(2)}`, valid: true };
  }

  if (!DECIMAL_PRICE_PATTERN.test(raw)) {
    return { amount: fallback, formatted: `$${fallback.toFixed(2)}`, valid: false };
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return { amount: fallback, formatted: `$${fallback.toFixed(2)}`, valid: false };
  }

  return { amount, formatted: `$${amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`, valid: true };
}

function readPayToAddress(): { value: string; valid: boolean } {
  const value = process.env.AGENTLEDGER_PAY_TO_ADDRESS?.trim() ?? "";
  return { value, valid: isValidEvmAddress(value) };
}

function readPublicPaymentConfig(): {
  payToConfigured: boolean;
  prices: { recommendations: ReturnType<typeof readPrice>; policyGuard: ReturnType<typeof readPrice> };
} {
  const prices = {
    recommendations: readPrice(process.env.AGENTLEDGER_RECOMMENDATIONS_PRICE_USD, DEFAULT_RECOMMENDATIONS_PRICE_USD),
    policyGuard: readPrice(process.env.AGENTLEDGER_POLICY_GUARD_PRICE_USD, DEFAULT_POLICY_GUARD_PRICE_USD),
  };

  return {
    payToConfigured: readPayToAddress().valid,
    prices,
  };
}

export function getPaymentConfigurationStatus(): PaymentConfigurationStatus {
  const publicConfig = readPublicPaymentConfig();
  const runtime = getRuntimeConfig();

  return {
    x402Configured:
      publicConfig.payToConfigured &&
      publicConfig.prices.recommendations.valid &&
      publicConfig.prices.policyGuard.valid &&
      hasLiveDataConfigured(runtime),
    payToConfigured: publicConfig.payToConfigured,
    network: X402_NETWORK,
    recommendationsPriceUsd: publicConfig.prices.recommendations.amount,
    policyGuardPriceUsd: publicConfig.prices.policyGuard.amount,
  };
}

export function getMarketplacePaymentMetadata(): {
  network: Network;
  recommendationsPricing: string;
  policyGuardPricing: string;
} {
  const status = getPaymentConfigurationStatus();
  return {
    network: status.network,
    recommendationsPricing: `${status.recommendationsPriceUsd} USDT/use`,
    policyGuardPricing: `${status.policyGuardPriceUsd} USDT/use`,
  };
}

function getResolvedPaymentConfig(): ResolvedX402PaymentConfig {
  const runtime = getRuntimeConfig();
  const address = readPayToAddress();
  const prices = readPublicPaymentConfig().prices;

  if (!address.valid) {
    throw new PaymentConfigurationError(
      "AGENTLEDGER_PAY_TO_ADDRESS must be a valid public X Layer EVM receiving address before paid endpoints can be used.",
    );
  }

  if (!prices.recommendations.valid || !prices.policyGuard.valid) {
    throw new PaymentConfigurationError(
      "AGENTLEDGER payment prices must be positive decimal USD amounts with at most six decimal places.",
    );
  }

  if (!hasLiveDataConfigured(runtime)) {
    throw new PaymentConfigurationError(
      "OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE are required for x402 facilitator access.",
    );
  }

  return {
    network: X402_NETWORK,
    payToAddress: address.value,
    recommendationsPrice: prices.recommendations.formatted,
    policyGuardPrice: prices.policyGuard.formatted,
    facilitator: {
      apiKey: runtime.apiKey,
      secretKey: runtime.secretKey,
      passphrase: runtime.passphrase,
    },
  };
}

function getPrice(config: X402PaymentConfig, service: PaidService): string {
  return service === "recommendations" ? config.recommendationsPrice : config.policyGuardPrice;
}

function getDescription(service: PaidService): string {
  return service === "recommendations"
    ? "Prioritized financial recommendations for autonomous companies."
    : "Evaluate a proposed autonomous financial action against caller-supplied policy before capital moves.";
}

function buildRouteConfig(config: X402PaymentConfig, service: PaidService): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: config.network,
      payTo: config.payToAddress,
      price: getPrice(config, service),
      maxTimeoutSeconds: 300,
    },
    description: getDescription(service),
    mimeType: "application/json",
  };
}

export function createX402Handler(
  service: PaidService,
  routeHandler: (request: NextRequest) => Promise<NextResponse>,
  options: {
    config?: X402PaymentConfig;
    facilitatorClient?: FacilitatorClient;
  } = {},
): (request: NextRequest) => Promise<NextResponse> {
  const resolved = options.config ?? getResolvedPaymentConfig();
  const facilitatorClient = options.facilitatorClient ?? new OKXFacilitatorClient(getResolvedPaymentConfig().facilitator);
  const server = new x402ResourceServer(facilitatorClient).register(resolved.network, new ExactEvmScheme());

  return withX402(routeHandler, buildRouteConfig(resolved, service), server);
}

const cachedHandlers = new Map<PaidService, {
  key: string;
  handler: (request: NextRequest) => Promise<NextResponse>;
}>();

function getCacheKey(config: ResolvedX402PaymentConfig, service: PaidService): string {
  return [
    service,
    config.network,
    config.payToAddress,
    config.recommendationsPrice,
    config.policyGuardPrice,
    "facilitator-configured",
  ].join("|");
}

function getCachedX402Handler(
  service: PaidService,
  routeHandler: (request: NextRequest) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  const config = getResolvedPaymentConfig();
  const key = getCacheKey(config, service);
  const cached = cachedHandlers.get(service);
  if (cached?.key === key) {
    return cached.handler;
  }

  const handler = createX402Handler(service, routeHandler, {
    config,
    facilitatorClient: new OKXFacilitatorClient(config.facilitator),
  });
  cachedHandlers.set(service, { key, handler });
  return handler;
}

function asNextRequest(request: Request): NextRequest {
  return "nextUrl" in request ? (request as NextRequest) : new NextRequest(request);
}

export function handlePaidRequest(
  request: Request,
  endpoint: string,
  service: PaidService,
  routeHandler: (request: NextRequest) => Promise<NextResponse>,
): Promise<Response> {
  return handleApiRequest(request, endpoint, async () => getCachedX402Handler(service, routeHandler)(asNextRequest(request)));
}
