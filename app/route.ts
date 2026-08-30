import { APP_NAME, APP_VERSION, SUPPORTED_ASSETS } from "../lib/types";
import { handleApiRequest } from "../lib/http";
import { getMarketplacePaymentMetadata } from "../lib/x402";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const payment = getMarketplacePaymentMetadata();
  return handleApiRequest(request, "/", async () => Response.json({
    name: APP_NAME,
    tagline: "The financial control plane for autonomous agents.",
    description: "Convert caller-supplied financial state and policy into machine-readable recommendations and capital decisions for autonomous agents.",
    version: APP_VERSION,
    status: "online",
    capabilities: [
      "financial health analysis",
      "caller-supplied financial state",
      "stablecoin cash flow analysis",
      "budget monitoring",
      "provider concentration analysis",
      "prioritized financial recommendations",
      "programmable financial policy",
      "pre-spend approval",
      "capital allocation guard",
      "generic action evaluation",
      "optional OKX wallet-history adapter",
    ],
    supportedAssets: SUPPORTED_ASSETS,
    marketplaceServices: {
      financialHealth: {
        endpoint: "POST /api/company-health",
        pricing: "free",
        payment: "none",
        preferredInput: "caller-supplied financial state",
        walletAdapter: "optional",
      },
      recommendations: {
        endpoint: "POST /api/recommendations",
        pricing: payment.recommendationsPricing,
        payment: "x402",
        network: payment.network,
        preferredInput: "caller-supplied financial state and optional policy",
      },
      policyGuard: {
        endpoint: "POST /api/evaluate-action",
        pricing: payment.policyGuardPricing,
        payment: "x402",
        network: payment.network,
        preferredInput: "caller-supplied financial state and policy",
      },
    },
    endpoints: {
      companyHealth: "POST /api/company-health",
      recommendations: "POST /api/recommendations",
      evaluateAction: "POST /api/evaluate-action",
      canISpend: "POST /api/can-i-spend",
      canIAllocate: "POST /api/can-i-allocate",
      demoCompanyHealth: "POST /api/demo/company-health",
      demoRecommendations: "POST /api/demo/recommendations",
      demoEvaluateAction: "POST /api/demo/evaluate-action",
      demoCanISpend: "POST /api/demo/can-i-spend",
      demoCanIAllocate: "POST /api/demo/can-i-allocate",
      health: "GET /api/health",
      openapi: "GET /openapi.json",
    },
  }));
}
