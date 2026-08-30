import { buildRecommendationsReport } from "../../../lib/recommendations";
import { loadCompanyHealth } from "../../../lib/financial-service";
import { readJsonBody, validationError } from "../../../lib/http";
import { companyHealthSchema } from "../../../lib/validation";
import { handlePaidRequest } from "../../../lib/x402";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function recommendationsHandler(nextRequest: NextRequest): Promise<NextResponse> {
  const parsed = companyHealthSchema.safeParse(await readJsonBody(nextRequest));
  if (!parsed.success) {
    throw validationError(parsed);
  }

  const dataSource = parsed.data.source === "provided_state" || parsed.data.financialState ? "provided_state" : "okx";
  const report = await loadCompanyHealth(parsed.data, dataSource, "/api/recommendations");
  return NextResponse.json(buildRecommendationsReport(report, report.generatedAt, parsed.data.policy));
}

export async function POST(request: Request): Promise<Response> {
  return handlePaidRequest(request, "/api/recommendations", "recommendations", recommendationsHandler);
}
