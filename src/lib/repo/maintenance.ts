import type { Db } from "@/lib/db/client";
import { purgeDeletedConversations } from "./conversations";

const INTERVAL_MS = 60 * 60 * 1000;
const shared = globalThis as typeof globalThis & {
  zeusHistoryCleanup?: ReturnType<typeof setInterval>;
};

/** Catch up at startup, then clean hourly while this single-process app is running. */
export function startHistoryCleanup(db: Db) {
  if (shared.zeusHistoryCleanup) return;
  purgeDeletedConversations(db);
  shared.zeusHistoryCleanup = setInterval(() => {
    try {
      purgeDeletedConversations(db);
    } catch {
      console.error(JSON.stringify({ event: "history_cleanup_failed" }));
    }
  }, INTERVAL_MS);
  shared.zeusHistoryCleanup.unref();
}
