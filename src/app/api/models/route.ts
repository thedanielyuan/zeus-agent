import { DEFAULT_MODEL_ID, MODELS, toPublicModel } from "@/lib/models/registry";
import { isVendorAvailable } from "@/lib/providers/availability";

export const dynamic = "force-dynamic";

/** GET /api/models — the registry's public fields plus credential availability. */
export async function GET(): Promise<Response> {
  return Response.json({
    defaultModelId: DEFAULT_MODEL_ID,
    models: MODELS.map((m) => toPublicModel(m, isVendorAvailable(m.vendor))),
  });
}
