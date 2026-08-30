import { getRuntimeConfig, hasLiveDataConfigured } from "../../../lib/config";
import { handleApiRequest } from "../../../lib/http";
import { APP_NAME, APP_VERSION } from "../../../lib/types";
import { getPaymentConfigurationStatus } from "../../../lib/x402";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  const payment = getPaymentConfigurationStatus();
  return handleApiRequest(request, "/api/health", async () => Response.json({
      status: "ok",
      service: APP_NAME,
      version: APP_VERSION,
      coreEngineAvailable: true,
      okxWalletAdapterConfigured: hasLiveDataConfigured(getRuntimeConfig()),
      liveDataConfigured: hasLiveDataConfigured(getRuntimeConfig()),
      demoEndpointsAvailable: true,
      policyEngine: true,
      x402Configured: payment.x402Configured,
      payToConfigured: payment.payToConfigured,
    }));
}
