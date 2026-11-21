import { Type } from "@google/genai";
import type { Analysis, AnalyzerModel, PrContext, Triage } from "../../shared/types.ts";
import {
  AnalysisSchema,
  RawAnalysisResponseSchema,
} from "../../shared/types.ts";
import {
  MODELS,
  UNTRUSTED_SYSTEM_PREAMBLE,
  collectInteractionText,
  extractJsonFromText,
  getAiClient,
  withRetryOnce,
  wrapUntrusted,
} from "../models/gemini.ts";
import { gatherReadOnlyFiles, listRepoFiles } from "./repoContext.ts";

export async function analyze(
  model: AnalyzerModel,
  ctx: PrContext,
  triageResult: Triage
): Promise<Analysis> {
  const ai = getAiClient();
  const modelId = model === "carbon" ? MODELS.carbon : MODELS.argon;

  const repoFiles = listRepoFiles(ctx.headDir, 300);
  const candidateFiles = Array.from(
    new Set([...ctx.changedFiles, ...triageResult.files])
  );
  const fileSnippets = gatherReadOnlyFiles(ctx.headDir, candidateFiles, 75_000);

  const filesText = fileSnippets
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
    .join("\n\n");

  const prompt = [
    "You are a senior software quality and regression analyst with read-only access.",
    "Given this pull request and repository files, build a graph of affected flows (pages, endpoints, tables, user flows) and ranked predictions of which user flows could break if this PR ships.",
    "Rules:",
    "- Use stable slug flow IDs (lowercase alphanumeric + hyphens, e.g. 'checkout-submit').",
    "- Each prediction must reference an existing flowId from `flows`, include a concrete `hypothesis`, `cites` with real file paths from the repository, and actionable `howToVerify` browser/app steps.",
    "- Only output JSON matching the schema with zero extra fields.",
    "",
    `Repository: ${ctx.pr.owner}/${ctx.pr.repo} PR #${ctx.pr.number}`,
    `Triaged areas: ${triageResult.areas.join(", ") || "general"}`,
    "",
    "PR Title:",
    wrapUntrusted(ctx.pr.title),
    "",
    "PR Description:",
    wrapUntrusted(ctx.prBody || "(none)"),
    "",
    "PR Diff:",
    wrapUntrusted(ctx.diff.slice(0, 70_000)),
    "",
    "Repository file tree:",
    wrapUntrusted(repoFiles.join("\n")),
    "",
    "Relevant repository files (at PR head):",
    wrapUntrusted(filesText),
  ].join("\n");

  return withRetryOnce(async () => {
    const interaction = await ai.interactions.create({
      model: modelId,
      system_instruction: `${UNTRUSTED_SYSTEM_PREAMBLE}\nReturn strictly valid JSON with only the requested fields.`,
      input: prompt,
      response_format: {
        type: Type.OBJECT,
        properties: {
          flows: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                kind: {
                  type: Type.STRING,
                  enum: ["page", "endpoint", "table", "flow"],
                },
                touches: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ["id", "name", "kind", "touches"],
            },
          },
          predictions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                flowId: { type: Type.STRING },
                risk: {
                  type: Type.STRING,
                  enum: ["low", "medium", "high"],
                },
                hypothesis: { type: Type.STRING },
                cites: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      file: { type: Type.STRING },
                      lines: { type: Type.STRING },
                    },
                    required: ["file"],
                  },
                },
                howToVerify: { type: Type.STRING },
              },
              required: [
                "id",
                "flowId",
                "risk",
                "hypothesis",
                "cites",
                "howToVerify",
              ],
            },
          },
        },
        required: ["flows", "predictions"],
      },
    });

    const text = collectInteractionText(interaction);
    const rawParsed = RawAnalysisResponseSchema.parse(extractJsonFromText(text));

    // Normalize flowId references and assign clean IDs matching [A-Za-z0-9_-]{1,64}
    const flowMap = new Map<string, string>();
    const normalizedFlows = rawParsed.flows.map((f, idx) => {
      const slug =
        f.id
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "") || `flow-${idx + 1}`;
      flowMap.set(f.id, slug);
      return {
        id: slug,
        name: f.name,
        kind: f.kind,
        touches: f.touches,
      };
    });

    const normalizedPredictions = rawParsed.predictions.map((p, idx) => {
      const mappedFlowId =
        flowMap.get(p.flowId) ??
        (p.flowId
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "") ||
          normalizedFlows[0]?.id ||
          `flow-${idx + 1}`);

      if (!normalizedFlows.some((f) => f.id === mappedFlowId)) {
        normalizedFlows.push({
          id: mappedFlowId,
          name: p.flowId,
          kind: "flow",
          touches: p.cites.map((c) => c.file),
        });
      }

      const cleanId = `${model}_${idx + 1}`.slice(0, 64);
      return {
        id: cleanId,
        flowId: mappedFlowId,
        risk: p.risk,
        hypothesis: p.hypothesis,
        cites: p.cites,
        howToVerify: p.howToVerify,
        foundBy: [model],
      };
    });

    return AnalysisSchema.parse({
      model,
      flows: normalizedFlows,
      predictions: normalizedPredictions,
    });
  }, `analyze(${model})`);
}
