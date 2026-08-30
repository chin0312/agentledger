import { loadCompanyHealth } from "../../../lib/financial-service";
import { handleApiRequest, readJsonBody, validationError } from "../../../lib/http";
import { companyHealthSchema } from "../../../lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleApiRequest(request, "/api/company-health", async () => {
    const parsed = companyHealthSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw validationError(parsed);
    }

    const input = parsed.data;
    const dataSource = input.source === "provided_state" || input.financialState ? "provided_state" : "okx";
    return Response.json(await loadCompanyHealth(input, dataSource, "/api/recommendations"));
  });
}
