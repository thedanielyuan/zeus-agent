import { Chat } from "@/components/chat/Chat";
import { DEFAULT_MODEL_ID, MODELS, toPublicModel } from "@/lib/models/registry";
import { isVendorAvailable } from "@/lib/providers/availability";

// Credential availability is read per request, never baked in at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  const models = MODELS.map((m) => toPublicModel(m, isVendorAvailable(m.vendor)));
  return <Chat models={models} defaultModelId={DEFAULT_MODEL_ID} />;
}
