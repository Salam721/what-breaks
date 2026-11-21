import type { Prediction, Scored } from "../../shared/types.ts";
import { ScoredSchema } from "../../shared/types.ts";
import { config } from "../config.ts";
import {
  MODELS,
  getDecisionsClient,
  isSafetyBlockError,
  withRetryOnce,
  wrapUntrusted,
} from "../models/gemini.ts";

export interface ScoreResult {
  scored: Scored[];
  failed: Array<{ prediction: Prediction; reason: string }>;
}

export function selectRiskyPredictions(
  scored: Scored[],
  maxVerifiers = config.maxVerifiersPerRun
): {
  toVerify: Scored[];
  notFlagged: Scored[];
} {
  const riskySorted = scored
    .filter((p) => p.risky)
    .sort((a, b) => b.pBreak - a.pBreak);

  const toVerify = riskySorted.slice(0, maxVerifiers);
  const toVerifyIds = new Set(toVerify.map((p) => p.id));

  const notFlagged = scored.filter((p) => !toVerifyIds.has(p.id));
  return { toVerify, notFlagged };
}

export async function scorePredictions(
  preds: Prediction[],
  diff: string,
  threshold = config.riskThreshold
): Promise<ScoreResult> {
  if (preds.length === 0) {
    return { scored: [], failed: [] };
  }

  const decisionsAi = getDecisionsClient();

  const compactPreds = preds.map((p) => ({
    id: p.id,
    flowId: p.flowId,
    risk: p.risk,
    hypothesis: p.hypothesis,
    cites: p.cites,
  }));

  const questions: Record<
    string,
    {
      type: "noul";
      instructions: string;
      criteria: { true_description: string; false_description: string };
    }
  > = {};

  for (const p of preds) {
    const key = `p_${p.id.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
    questions[key] = {
      type: "noul",
      instructions: `Would this PR break the user flow '${p.flowId}' as described in prediction ${p.id}: ${p.hypothesis}?`,
      criteria: {
        true_description:
          "The diff introduces a concrete bug, regression, crash, broken route, schema mismatch, or error affecting this user flow.",
        false_description:
          "The diff does not break this flow or the concern is speculative/unrelated to the code changed.",
      },
    };
  }

  try {
    const result = await withRetryOnce(async () => {
      return await decisionsAi.decisions.create({
        model: MODELS.decision,
        input: [
          { type: "text", text: `PR Diff:\n${wrapUntrusted(diff)}\n` },
          {
            type: "text",
            text: `Predicted flow breakages:\n${JSON.stringify(compactPreds)}\n`,
          },
        ],
        questions,
      });
    }, "decisions.score");

    if (!result.answers) {
      const reason =
        "Decisions API returned no answers (possibly blocked by safety filter).";
      return {
        scored: [],
        failed: preds.map((prediction) => ({ prediction, reason })),
      };
    }

    const scored: Scored[] = [];
    const failed: Array<{ prediction: Prediction; reason: string }> = [];

    for (const p of preds) {
      const key = `p_${p.id.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
      const ans = result.answers[key];
      if (ans && ans.type === "noul" && typeof ans.noul === "number") {
        const pBreak = Math.min(0.99, Math.max(0.01, ans.noul));
        scored.push(
          ScoredSchema.parse({
            ...p,
            pBreak,
            risky: pBreak >= threshold,
          })
        );
      } else {
        failed.push({
          prediction: p,
          reason: "Decisions API omitted score for this prediction",
        });
      }
    }

    return { scored, failed };
  } catch (err) {
    const reason = isSafetyBlockError(err)
      ? "blocked by safety filter"
      : err instanceof Error
        ? err.message
        : "Decisions API scoring failed";
    return {
      scored: [],
      failed: preds.map((prediction) => ({ prediction, reason })),
    };
  }
}
