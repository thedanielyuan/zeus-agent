import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_SETTINGS,
  GlobalSettings,
  SettingsPatch,
} from "@/lib/settings";

const KEY = "preferences";

export function getSettings(db: Db): GlobalSettings {
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
  if (!row) return { ...DEFAULT_SETTINGS };
  return GlobalSettings.parse({
    ...DEFAULT_SETTINGS,
    ...JSON.parse(row.value),
  });
}

export function updateSettings(
  db: Db,
  patch: Partial<GlobalSettings>,
): GlobalSettings {
  const changes = SettingsPatch.parse(patch);
  return db.transaction(
    (tx) => {
      const next = GlobalSettings.parse({ ...getSettings(tx), ...changes });
      tx.insert(settings)
        .values({ key: KEY, value: JSON.stringify(next) })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: JSON.stringify(next) },
        })
        .run();
      return next;
    },
    { behavior: "immediate" },
  );
}
