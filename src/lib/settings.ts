import { z } from "zod";
import { DEFAULT_MODEL_ID, getModel } from "@/lib/models/registry";
import { EFFORT_LEVELS } from "@/lib/providers/types";

export const ModelId = z
  .string()
  .refine((id) => !!getModel(id), "Unknown model.");
export const ConversationSettings = z.strictObject({
  modelId: ModelId,
  systemPrompt: z.string().max(100_000),
  effort: z.enum(EFFORT_LEVELS),
  maxOutputTokens: z.number().int().min(1),
});
export type ConversationSettings = z.infer<typeof ConversationSettings>;

export const GlobalSettings = z.strictObject({
  defaultModelId: ModelId,
  defaultSystemPrompt: z.string().max(100_000),
  defaultEffort: z.enum(EFFORT_LEVELS),
  theme: z.enum(["light", "dark"]),
  hideThinking: z.boolean(),
});
export type GlobalSettings = z.infer<typeof GlobalSettings>;

export const DEFAULT_SETTINGS: GlobalSettings = {
  defaultModelId: DEFAULT_MODEL_ID,
  defaultSystemPrompt: "",
  defaultEffort: "high",
  theme: "dark",
  hideThinking: false,
};

export const ConversationPatch = ConversationSettings.partial()
  .extend({
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const SettingsPatch = GlobalSettings.partial().refine(
  (value) => Object.keys(value).length > 0,
);

export function conversationDefaults(
  settings: GlobalSettings,
): ConversationSettings {
  return {
    modelId: settings.defaultModelId,
    systemPrompt: settings.defaultSystemPrompt,
    effort: settings.defaultEffort,
    maxOutputTokens: Math.min(
      64_000,
      getModel(settings.defaultModelId)!.maxOutputTokens,
    ),
  };
}
