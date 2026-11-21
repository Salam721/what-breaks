import { MODELS, getDecisionsClient, withRetryOnce, wrapUntrusted } from "../models/gemini.ts";

export interface EvalPrItem {
  id: string;
  url: string;
  split: "tune" | "heldout";
  note: string;
}

export interface GroundTruthLabel {
  brokenFlows: Array<{
    flowName: string;
    evidence: string;
  }>;
}

export interface SystemMetrics {
  truePositives: number;
  falseNegatives: number;
  falseAlarms: number;
  unverifiedCount: number;
  recall: number | null;
}

export async function flowsMatch(
  predictedDesc: string,
  labeledFlowName: string
): Promise<boolean> {
  const decisionsAi = getDecisionsClient();
  const res = await withRetryOnce(
    () =>
      decisionsAi.decisions.create({
        model: MODELS.decision,
        input: [
          {
            type: "text",
            text: `Predicted breakage:\n${wrapUntrusted(predictedDesc)}\n\nGround-truth broken flow:\n${wrapUntrusted(labeledFlowName)}\n`,
          },
        ],
        questions: {
          same_flow: {
            type: "noul",
            instructions:
              "Do these two descriptions refer to the same user-visible or API flow breakage?",
            criteria: {
              true_description:
                "Both descriptions refer to the same underlying functional flow, API behavior, or regression.",
              false_description:
                "They describe different flows or unrelated behaviors.",
            },
          },
        },
      }),
    "eval.flowsMatch"
  );

  const ans = res.answers?.same_flow;
  return Boolean(ans && ans.type === "noul" && ans.noul >= 0.5);
}

export function formatEvalComparisonTable(summary: {
  split: string;
  prCount: number;
  tool: SystemMetrics;
  baseline: SystemMetrics;
  carbonRecall: number | null;
  argonRecall: number | null;
}): string {
  const fmtPct = (v: number | null) =>
    v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;

  return [
    `=== Evaluation Comparison (${summary.split}, ${summary.prCount} PRs) ===`,
    `Metric               | What Breaks Tool | Carbon Baseline`,
    `---------------------|------------------|----------------`,
    `Recall (real breaks) | ${fmtPct(summary.tool.recall).padEnd(16)} | ${fmtPct(summary.baseline.recall)}`,
    `False Alarms         | ${String(summary.tool.falseAlarms).padEnd(16)} | ${String(summary.baseline.falseAlarms)}`,
    `Unverified           | ${String(summary.tool.unverifiedCount).padEnd(16)} | 0`,
    `Carbon-only Recall   | ${fmtPct(summary.carbonRecall).padEnd(16)} | -`,
    `Argon-only Recall    | ${fmtPct(summary.argonRecall).padEnd(16)} | -`,
  ].join("\n");
}
