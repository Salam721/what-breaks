import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import type {
  Analysis,
  Evidence,
  Judge,
  PrContext,
  Report,
  Scored,
  Triage,
  Verdict,
} from "../../shared/types.ts";
import { VerdictSchema } from "../../shared/types.ts";
import { analyze } from "../analyzers/analyze.ts";
import { merge } from "../analyzers/merge.ts";
import { scorePredictions, selectRiskyPredictions } from "../analyzers/score.ts";
import { triage } from "../analyzers/triage.ts";
import { config } from "../config.ts";
import { withRetryOnce } from "../models/gemini.ts";
import { JudgeError, judgeEvidence } from "../judge/judge.ts";
import { reconcile } from "../judge/reconcile.ts";
import { decideVerdict } from "../judge/verdict.ts";
import { runVerifier } from "../verifier/agent.ts";
import { RunEventBus } from "./events.ts";
import { saveRealRunRecording } from "./recording.ts";

export interface RunState {
  runId: string;
  bus: RunEventBus;
  status: "running" | "completed" | "failed";
  report: Report | null;
  error?: string;
}

export async function executeRun(
  runId: string,
  ctx: PrContext,
  bus: RunEventBus
): Promise<Report | null> {
  const runStartMs = Date.now();
  const runDeadlineMs = runStartMs + config.runTimeoutMs;

  const remainingRunMs = () => Math.max(0, runDeadlineMs - Date.now());
  const isTimedOut = () => Date.now() >= runDeadlineMs;

  bus.emit("run.started", {
    pr: ctx.pr,
    changedFiles: ctx.changedFiles,
  });

  // 1. Triage (Hydrogen) — retry once, fall back to changedFiles on second failure
  let triageResult: Triage;
  try {
    triageResult = await triage(ctx);
  } catch {
    triageResult = {
      files: ctx.changedFiles,
      areas: ["changed-files"],
    };
  }
  bus.emit("triage.done", { triage: triageResult });

  // 2. Parallel Analysis (Carbon + Argon)
  bus.emit("analysis.started", { models: ["carbon", "argon"] });
  const [carbonRes, argonRes] = await Promise.allSettled([
    analyze("carbon", ctx, triageResult),
    analyze("argon", ctx, triageResult),
  ]);

  const analyses: Analysis[] = [];
  const analyzerErrors: string[] = [];

  if (carbonRes.status === "fulfilled") {
    analyses.push(carbonRes.value);
    bus.emit("analysis.done", { model: "carbon", analysis: carbonRes.value });
  } else {
    const errMsg =
      carbonRes.reason instanceof Error
        ? carbonRes.reason.message
        : String(carbonRes.reason);
    analyzerErrors.push(`carbon: ${errMsg}`);
  }

  if (argonRes.status === "fulfilled") {
    analyses.push(argonRes.value);
    bus.emit("analysis.done", { model: "argon", analysis: argonRes.value });
  } else {
    const errMsg =
      argonRes.reason instanceof Error
        ? argonRes.reason.message
        : String(argonRes.reason);
    analyzerErrors.push(`argon: ${errMsg}`);
  }

  if (analyses.length === 0) {
    const message = `Both analyzers failed (${analyzerErrors.join("; ")})`;
    bus.emit("run.failed", { error: message });
    return null;
  }

  const singleAnalyzer = analyses.length === 1;

  // 3. Merge by flow
  const merged = merge(analyses);
  bus.emit("predictions.merged", {
    flows: merged.flows,
    predictions: merged.predictions,
    singleAnalyzer,
  });

  if (merged.predictions.length === 0) {
    const { report, manifest } = await reconcile({
      runId,
      pr: ctx.pr,
      singleAnalyzer,
      scored: [],
      evidences: [],
      verdicts: [],
    });
    persistReportArtifacts(runId, report, manifest);
    bus.emit("report.ready", { report, manifest });
    return report;
  }

  // 4. Score predictions (Decisions API single request)
  const scoreResult = await scorePredictions(merged.predictions, ctx.diff);
  const scoredAll: Scored[] = [
    ...scoreResult.scored,
    ...scoreResult.failed.map((f) => ({
      ...f.prediction,
      pBreak: 0.5,
      risky: false,
    })),
  ];

  bus.emit("predictions.scored", {
    scored: scoreResult.scored,
    failed: scoreResult.failed.map((f) => ({
      predictionId: f.prediction.id,
      reason: f.reason,
    })),
    threshold: config.riskThreshold,
  });

  const verdictsByPredId = new Map<string, Verdict>();
  const evidences: Evidence[] = [];

  // Any scoring failures become unverified with exact reason (never dropped)
  for (const failedItem of scoreResult.failed) {
    const v = VerdictSchema.parse({
      predictionId: failedItem.prediction.id,
      status: "unverified",
      reason: failedItem.reason,
    });
    verdictsByPredId.set(v.predictionId, v);
    bus.emit("verdict.set", { verdict: v });
  }

  // Partition successfully scored predictions: top 10 risky vs low_risk
  const { toVerify, notFlagged } = selectRiskyPredictions(
    scoreResult.scored,
    config.maxVerifiersPerRun
  );

  for (const low of notFlagged) {
    const v = VerdictSchema.parse({
      predictionId: low.id,
      status: "low_risk",
    });
    verdictsByPredId.set(v.predictionId, v);
    bus.emit("verdict.set", { verdict: v });
  }

  // 5. Parallel Verifier Fleet + Independent Judging (max 6 concurrent, max 10 per run)
  const limit = pLimit(config.maxConcurrentVerifiers);

  await Promise.allSettled(
    toVerify.map((prediction) =>
      limit(async () => {
        if (isTimedOut()) {
          const v = VerdictSchema.parse({
            predictionId: prediction.id,
            status: "unverified",
            reason: "run timed out",
          });
          verdictsByPredId.set(v.predictionId, v);
          bus.emit("verdict.set", { verdict: v });
          return;
        }

        const verifyOneAttempt = async (
          attempt: 1 | 2
        ): Promise<{ ok: true; evidence: Evidence } | { ok: false; reason: string }> => {
          const timeoutMs = Math.min(config.verifierTimeoutMs, remainingRunMs());
          if (timeoutMs < 5_000) {
            return { ok: false, reason: "run timed out" };
          }
          bus.emit("verifier.started", {
            predictionId: prediction.id,
            flowId: prediction.flowId,
            attempt,
          });
          const res = await runVerifier(prediction, ctx, {
            runId,
            attempt,
            timeoutMs,
          });
          if (res.ok) {
            evidences.push(res.evidence);
            bus.emit("verifier.done", {
              predictionId: prediction.id,
              attempt,
              evidence: res.evidence,
            });
          } else {
            bus.emit("verifier.failed", {
              predictionId: prediction.id,
              attempt,
              reason: res.reason,
            });
          }
          return res;
        };

        try {
          // Attempt 1 (retry verifier once on failure per R12)
          let verRes = await verifyOneAttempt(1);
          let usedRetry = false;

          if (!verRes.ok && !isTimedOut()) {
            usedRetry = true;
            verRes = await verifyOneAttempt(2);
          }

          if (!verRes.ok) {
            const v = VerdictSchema.parse({
              predictionId: prediction.id,
              status: "unverified",
              reason: verRes.reason,
            });
            verdictsByPredId.set(v.predictionId, v);
            bus.emit("verdict.set", { verdict: v });
            return;
          }

          // Judge Attempt 1
          let judgeRes: Judge = await judgeEvidence(
            prediction,
            verRes.evidence,
            runId
          );
          bus.emit("judge.done", { judge: judgeRes });

          let decision = decideVerdict(
            judgeRes,
            usedRetry,
            config.judgeMinConfidence
          );

          // If confidence < 0.7 and haven't used attempt 2 yet, re-run verifier once & re-judge (R7)
          if (decision === "retry" && !isTimedOut()) {
            const verRes2 = await verifyOneAttempt(2);
            if (!verRes2.ok) {
              const v = VerdictSchema.parse({
                predictionId: prediction.id,
                status: "unverified",
                reason: verRes2.reason,
              });
              verdictsByPredId.set(v.predictionId, v);
              bus.emit("verdict.set", { verdict: v });
              return;
            }
            judgeRes = await judgeEvidence(prediction, verRes2.evidence, runId);
            bus.emit("judge.done", { judge: judgeRes });
            decision = decideVerdict(judgeRes, true, config.judgeMinConfidence);
          }

          if (decision === "retry") {
            const v = VerdictSchema.parse({
              predictionId: prediction.id,
              status: "unverified",
              reason: "run timed out before judge retry",
            });
            verdictsByPredId.set(v.predictionId, v);
            bus.emit("verdict.set", { verdict: v });
            return;
          }

          verdictsByPredId.set(decision.predictionId, decision);
          bus.emit("verdict.set", { verdict: decision });
        } catch (err) {
          const reason =
            err instanceof JudgeError
              ? err.message
              : err instanceof Error
                ? err.message
                : "verification failed";
          const v = VerdictSchema.parse({
            predictionId: prediction.id,
            status: "unverified",
            reason,
          });
          verdictsByPredId.set(v.predictionId, v);
          bus.emit("verdict.set", { verdict: v });
        }
      })
    )
  );

  // Guarantee no flow/prediction is ever dropped silently (R12)
  for (const pred of merged.predictions) {
    if (!verdictsByPredId.has(pred.id)) {
      const v = VerdictSchema.parse({
        predictionId: pred.id,
        status: "unverified",
        reason: isTimedOut() ? "run timed out" : "incomplete verification",
      });
      verdictsByPredId.set(v.predictionId, v);
      bus.emit("verdict.set", { verdict: v });
    }
  }

  const orderedVerdicts = merged.predictions.map(
    (p) => verdictsByPredId.get(p.id)!
  );

  // 6. Reconcile report & manifest
  const { report, manifest } = await withRetryOnce(
    () =>
      reconcile({
        runId,
        pr: ctx.pr,
        singleAnalyzer,
        scored: scoredAll,
        evidences,
        verdicts: orderedVerdicts,
      }),
    "reconcile"
  );

  persistReportArtifacts(runId, report, manifest);

  if (config.recordRuns) {
    const recName = `${ctx.pr.owner}-${ctx.pr.repo}-pr-${ctx.pr.number}-${ctx.pr.headSha.slice(0, 7)}`;
    saveRealRunRecording(runId, recName, report);
  }

  bus.emit("report.ready", { report, manifest });
  return report;
}

function persistReportArtifacts(
  runId: string,
  report: Report,
  manifest: unknown
): void {
  const runDir = path.resolve(config.runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}
