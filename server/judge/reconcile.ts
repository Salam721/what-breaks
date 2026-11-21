import type {
  Evidence,
  PrRef,
  Report,
  Scored,
  Verdict,
} from "../../shared/types.ts";
import { ReportSchema } from "../../shared/types.ts";
import {
  MODELS,
  UNTRUSTED_SYSTEM_PREAMBLE,
  collectInteractionText,
  getAiClient,
  withRetryOnce,
  wrapUntrusted,
} from "../models/gemini.ts";
import { buildEvidenceManifest } from "../run/evidence.ts";

export interface ReconcileArgs {
  runId: string;
  pr: PrRef;
  singleAnalyzer: boolean;
  scored: Scored[];
  evidences: Evidence[];
  verdicts: Verdict[];
}

export function buildScoreboardCounts(verdicts: Verdict[]): {
  confirmed: number;
  false_alarm: number;
  unverified: number;
  low_risk: number;
} {
  const counts = {
    confirmed: 0,
    false_alarm: 0,
    unverified: 0,
    low_risk: 0,
  };
  for (const v of verdicts) {
    counts[v.status] += 1;
  }
  return counts;
}

export async function reconcile(args: ReconcileArgs): Promise<{
  report: Report;
  manifest: ReturnType<typeof buildEvidenceManifest>;
}> {
  const manifest = buildEvidenceManifest(
    args.runId,
    args.pr.headSha,
    args.evidences
  );
  const counts = buildScoreboardCounts(args.verdicts);

  const fallbackSummary = [
    `Verification report for ${args.pr.owner}/${args.pr.repo}#${args.pr.number} (commit ${args.pr.headSha.slice(0, 7)}).`,
    `Scoreboard: ${counts.confirmed} confirmed break(s), ${counts.false_alarm} false alarm(s), ${counts.unverified} unverified, ${counts.low_risk} not flagged (low risk).`,
    args.singleAnalyzer
      ? "Note: Only one analyzer completed successfully (single-analyzer mode)."
      : "Analyzed by both Carbon and Argon in parallel.",
  ].join(" ");

  let summary = fallbackSummary;

  try {
    const ai = getAiClient();
    const verdictRows = args.verdicts.map((v) => {
      const pred = args.scored.find((s) => s.id === v.predictionId);
      return {
        predictionId: v.predictionId,
        flowId: pred?.flowId ?? "unknown",
        status: v.status,
        reason: v.reason,
        pBreak: pred?.pBreak,
        hypothesis: pred?.hypothesis,
      };
    });

    const prompt = [
      "Write a concise, factual 2-4 sentence summary of these server-verified pull request results.",
      "Do NOT alter or question the verdicts — they were set deterministically by server code.",
      "Explicitly mention confirmed breaks, false alarms, and any unverified items.",
      "",
      `PR: ${args.pr.owner}/${args.pr.repo}#${args.pr.number} (${args.pr.headSha})`,
      `Title: ${wrapUntrusted(args.pr.title)}`,
      `Single analyzer mode: ${args.singleAnalyzer}`,
      `Scoreboard counts: ${JSON.stringify(counts)}`,
      `Verdicts: ${wrapUntrusted(JSON.stringify(verdictRows))}`,
    ].join("\n");

    summary = await withRetryOnce(async () => {
      const interaction = await ai.interactions.create({
        model: MODELS.carbon,
        system_instruction: `${UNTRUSTED_SYSTEM_PREAMBLE}\nSummarize the server-set scoreboard clearly in plain prose.`,
        input: prompt,
      });
      const text = collectInteractionText(interaction).trim();
      return text || fallbackSummary;
    }, "reconcile(carbon)");
  } catch {
    // Keep factual fallbackSummary so report generation never fails
    summary = fallbackSummary;
  }

  const report = ReportSchema.parse({
    pr: args.pr,
    singleAnalyzer: args.singleAnalyzer,
    summary,
    verdicts: args.verdicts,
    manifestSha256: manifest.manifestSha256,
  });

  return { report, manifest };
}
