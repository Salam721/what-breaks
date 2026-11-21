import { Type } from "@google/genai";
import type { PrContext, Triage } from "../../shared/types.ts";
import { TriageSchema } from "../../shared/types.ts";
import {
  MODELS,
  UNTRUSTED_SYSTEM_PREAMBLE,
  collectInteractionText,
  extractJsonFromText,
  getAiClient,
  withRetryOnce,
  wrapUntrusted,
} from "../models/gemini.ts";
import { listRepoFiles } from "./repoContext.ts";

export async function triage(ctx: PrContext): Promise<Triage> {
  const ai = getAiClient();
  const repoFiles = listRepoFiles(ctx.headDir, 350);

  const prompt = [
    "You are performing read-only triage on a public GitHub pull request.",
    "Identify which repository files and user-facing areas are relevant to analyze what user flows this PR might break.",
    "Return JSON matching the schema with only `files` (existing repo paths worth reading) and `areas` (short subsystem or flow names).",
    "",
    `Repository: ${ctx.pr.owner}/${ctx.pr.repo} PR #${ctx.pr.number}`,
    `Head SHA: ${ctx.pr.headSha}`,
    "",
    "Repository file tree:",
    wrapUntrusted(repoFiles.join("\n")),
    "",
    "PR Title:",
    wrapUntrusted(ctx.pr.title),
    "",
    "PR Description:",
    wrapUntrusted(ctx.prBody || "(none)"),
    "",
    "Changed files in diff:",
    wrapUntrusted(ctx.changedFiles.join("\n")),
    "",
    "PR Diff (first 40,000 chars):",
    wrapUntrusted(ctx.diff.slice(0, 40_000)),
  ].join("\n");

  return withRetryOnce(async () => {
    const interaction = await ai.interactions.create({
      model: MODELS.triage,
      system_instruction: `${UNTRUSTED_SYSTEM_PREAMBLE}\nYou have read-only access and must return strict JSON matching the schema.`,
      input: prompt,
      response_format: {
        type: Type.OBJECT,
        properties: {
          files: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Repo file paths to inspect closely",
          },
          areas: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Affected product areas or user flows",
          },
        },
        required: ["files", "areas"],
      },
    });

    const text = collectInteractionText(interaction);
    const parsed = extractJsonFromText(text);
    return TriageSchema.parse(parsed);
  }, "triage");
}
