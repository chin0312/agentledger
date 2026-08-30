import { buildSpendDecision } from "../../../lib/analysis";
import { loadCompanyHealth } from "../../../lib/financial-service";
import { handleApiRequest, readJsonBody, validationError } from "../../../lib/http";
import { canISpendSchema } from "../../../lib/validation";
import { APP_NAME, APP_VERSION } from "../../../lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleApiRequest(request, "/api/can-i-spend", async () => {
    const parsed = canISpendSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw validationError(parsed);
    }

    const input = parsed.data;
    const healthReport = await loadCompanyHealth(
      {
        address: input.address,
        days: input.days,
        monthlyBudget: input.monthlyBudget,
      },
      "okx",
      "/api/recommendations",
    );
    const decision = buildSpendDecision({
      report: healthReport,
      proposedSpend: input.proposedSpend,
      monthlyBudget: input.monthlyBudget,
      vendor: input.vendor,
    });

    return Response.json({
      service: APP_NAME,
      analysisVersion: APP_VERSION,
      dataSource: "okx",
      stateVerification: "okx_fetched",
      ...decision,
    });
  });
}
