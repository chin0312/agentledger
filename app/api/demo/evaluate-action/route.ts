import { evaluateAction } from "../../../../lib/evaluate-action";
import { handleApiRequest, readJsonBody, validationError } from "../../../../lib/http";
import { evaluateActionSchema } from "../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleApiRequest(request, "/api/demo/evaluate-action", async () => {
    const parsed = evaluateActionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw validationError(parsed);
    }

    return Response.json(await evaluateAction(parsed.data, "demo"));
  });
}
