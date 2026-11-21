import type { Judge, Verdict } from "../../shared/types.ts";
import { VerdictSchema } from "../../shared/types.ts";
import { config } from "../config.ts";

/**
 * Pure server-side verdict decision rule.
 * No model prose enters this function: only numeric judge output and retry flag.
 */
export function decideVerdict(
  judgeResult: Judge,
  hadRetry: boolean,
  minConfidence = config.judgeMinConfidence
): Verdict | "retry" {
  if (judgeResult.confidence < minConfidence) {
    if (hadRetry) {
      return VerdictSchema.parse({
        predictionId: judgeResult.predictionId,
        status: "unverified",
        reason: "judge unsure after re-run",
      });
    }
    return "retry";
  }

  return VerdictSchema.parse({
    predictionId: judgeResult.predictionId,
    status: judgeResult.pYes >= 0.5 ? "confirmed" : "false_alarm",
  });
}
