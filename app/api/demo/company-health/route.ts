import { loadCompanyHealth } from "../../../../lib/financial-service";
import { handleApiRequest, readJsonBody, validationError } from "../../../../lib/http";
import { companyHealthSchema } from "../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleApiRequest(request, "/api/demo/company-health", async () => {
    const parsed = companyHealthSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw validationError(parsed);
    }

    return Response.json(await loadCompanyHealth(parsed.data, "demo", "/api/demo/recommendations"));
  });
}
