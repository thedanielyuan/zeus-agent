import { z } from "zod";
import { EFFORT_LEVELS } from "@/lib/providers/types";

/** Stable client IDs let Retry recover even if the first response never arrived. */
export const TurnBody = z.strictObject({
  conversationId: z.ulid(),
  userMessageId: z.ulid(),
  action: z.enum(["send", "retry"]).default("send"),
  content: z.string().trim().min(1).max(1_000_000),
  modelId: z.string().min(1),
  system: z.string().max(100_000).optional(),
  effort: z.enum(EFFORT_LEVELS).default("high"),
  maxOutputTokens: z.number().int().min(1).optional(),
});

export type TurnInput = z.infer<typeof TurnBody>;
