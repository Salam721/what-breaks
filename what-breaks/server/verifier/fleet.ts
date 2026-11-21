import pLimit from "p-limit";
import type { PrContext, Scored } from "../../shared/types.ts";
import { config } from "../config.ts";
import { runVerifier, type VerifierResult } from "./agent.ts";

export async function runVerifierFleet(
  predictions: Scored[],
  ctx: PrContext,
  runId: string,
  onStart: (prediction: Scored, attempt: 1 | 2) => void,
  onResult: (
    prediction: Scored,
    attempt: 1 | 2,
    result: VerifierResult
  ) => Promise<void>
): Promise<void> {
  const limit = pLimit(config.maxConcurrentVerifiers);
  const capped = predictions.slice(0, config.maxVerifiersPerRun);

  await Promise.allSettled(
    capped.map((prediction) =>
      limit(async () => {
        try {
          onStart(prediction, 1);
          const result = await runVerifier(prediction, ctx, {
            runId,
            attempt: 1,
            timeoutMs: config.verifierTimeoutMs,
          });
          await onResult(prediction, 1, result);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          await onResult(prediction, 1, { ok: false, reason });
        }
      })
    )
  );
}
