import { Type } from "@google/genai";
import { z } from "zod";
import type { PrContext } from "../../shared/types.ts";
import {
  MODELS,
  UNTRUSTED_SYSTEM_PREAMBLE,
  collectInteractionText,
  extractJsonFromText,
  getAiClient,
  withRetryOnce,
  wrapUntrusted,
} from "../models/gemini.ts";

export const BaselinePredictionSchema = z
  .object({
    flowName: z.string().min(1),
    hypothesis: z.string().min(1),
    risk: z.enum(["low", "medium", "high"]),
  })
  .strict();

export const BaselineResultSchema = z
  .object({
    prUrl: z.string().url(),
    headSha: z.string(),
    predictions: z.array(BaselinePredictionSchema),
  })
  .strict();

export type BaselineResult = z.infer<typeof BaselineResultSchema>;

/**
 * Baseline (R13): Single Carbon call given the same PR, asking which flows break.
 */
export async function runCarbonBaseline(ctx: PrContext): Promise<BaselineResult> {
  const ai = getAiClient();

  const prompt = [
    "You are reviewing a public GitHub pull request.",
    "Which user-visible or API flows will break if this PR ships? List only concrete likely breakages.",
    "",
    `Repository: ${ctx.pr.owner}/${ctx.pr.repo} PR #${ctx.pr.number}`,
    `Title: ${wrapUntrusted(ctx.pr.title)}`,
    `Description: ${wrapUntrusted(ctx.prBody || "(none)")}`,
    `Diff:\n${wrapUntrusted(ctx.diff.slice(0, 120_000))}`,
  ].join("\n");

  const predictions = await withRetryOnce(async () => {
    const interaction = await ai.interactions.create({
      model: MODELS.carbon,
      system_instruction: `${UNTRUSTED_SYSTEM_PREAMBLE}\nReturn strict JSON only.`,
      input: prompt,
      response_format: {
        type: Type.OBJECT,
        properties: {
          predictions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                flowName: { type: Type.STRING },
                hypothesis: { type: Type.STRING },
                risk: { type: Type.STRING, enum: ["low", "medium", "high"] },
              },
              required: ["flowName", "hypothesis", "risk"],
            },
          },
        },
        required: ["predictions"],
      },
    });

    const parsed = extractJsonFromText(collectInteractionText(interaction)) as {
      predictions?: unknown[];
    };
    return z.array(BaselinePredictionSchema).parse(parsed.predictions ?? []);
  }, "baseline(carbon)");

  return BaselineResultSchema.parse({
    prUrl: ctx.pr.url,
    headSha: ctx.pr.headSha,
    predictions,
  });
}
