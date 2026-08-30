import { buildSpendDecision } from "../../../../lib/analysis";
import { loadCompanyHealth } from "../../../../lib/financial-service";
import { handleApiRequest, readJsonBody, validationError } from "../../../../lib/http";
import { APP_NAME, APP_VERSION } from "../../../../lib/types";
import { canISpendSchema } from "../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleApiRequest(request, "/api/demo/can-i-spend", async () => {
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
      "demo",
      "/api/demo/recommendations",
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
      dataSource: "demo",
      stateVerification: "demo",
      ...decision,
    });
  });
}
