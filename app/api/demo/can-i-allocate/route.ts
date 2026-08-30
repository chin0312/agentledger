import { buildAllocationDecision } from "../../../../lib/allocation";
import { handleApiRequest, readJsonBody, validationError } from "../../../../lib/http";
import { canIAllocateSchema } from "../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleApiRequest(request, "/api/demo/can-i-allocate", async () => {
    const parsed = canIAllocateSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw validationError(parsed);
    }

    return Response.json({
      ...buildAllocationDecision(parsed.data, "demo"),
    });
  });
}
