import { getDb } from "@/lib/db/client";
import { historyResponse, readJsonBody } from "@/lib/http";
import { getSettings, updateSettings } from "@/lib/repo/settings";
import { SettingsPatch } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return historyResponse(request, false, () =>
    Response.json(getSettings(getDb())),
  );
}
export function PATCH(request: Request) {
  return historyResponse(request, true, async () =>
    Response.json(
      updateSettings(getDb(), SettingsPatch.parse(await readJsonBody(request))),
    ),
  );
}
