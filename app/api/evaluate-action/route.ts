import { evaluateAction } from "../../../lib/evaluate-action";
import { readJsonBody, validationError } from "../../../lib/http";
import { evaluateActionSchema } from "../../../lib/validation";
import { handlePaidRequest } from "../../../lib/x402";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function evaluateActionHandler(nextRequest: NextRequest): Promise<NextResponse> {
  const parsed = evaluateActionSchema.safeParse(await readJsonBody(nextRequest));
  if (!parsed.success) {
    throw validationError(parsed);
  }

  return NextResponse.json(await evaluateAction(parsed.data, "okx"));
}

export async function POST(request: Request): Promise<Response> {
  return handlePaidRequest(request, "/api/evaluate-action", "policyGuard", evaluateActionHandler);
}
