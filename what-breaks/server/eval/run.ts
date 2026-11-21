import fs from "node:fs";
import path from "node:path";
import type { Prediction, Report, Scored } from "../../shared/types.ts";
import { fetchPr } from "../github/fetchPr.ts";
import { RunEventBus } from "../run/events.ts";
import { executeRun } from "../run/orchestrator.ts";
import { runCarbonBaseline, type BaselineResult } from "./baseline.ts";
import {
  flowsMatch,
  formatEvalComparisonTable,
  type EvalPrItem,
  type GroundTruthLabel,
} from "./score.ts";

interface PrEvalOutcome {
  id: string;
  url: string;
  split: "tune" | "heldout";
  headSha: string;
  labeledCount: number;
  tool: {
    tp: number;
    fn: number;
    falseAlarms: number;
    unverified: number;
    carbonTp: number;
    argonTp: number;
  };
  baseline: {
    tp: number;
    fn: number;
    falseAlarms: number;
  };
}

async function main(): Promise<void> {
  const prsPath = path.resolve(process.cwd(), "eval/prs.json");
  const labelsPath = path.resolve(process.cwd(), "eval/labels.json");
  const resultsDir = path.resolve(process.cwd(), "eval/results");
  fs.mkdirSync(resultsDir, { recursive: true });

  const prs = JSON.parse(fs.readFileSync(prsPath, "utf8")) as EvalPrItem[];
  const labels = JSON.parse(
    fs.readFileSync(labelsPath, "utf8")
  ) as Record<string, GroundTruthLabel>;

  const outcomes: PrEvalOutcome[] = [];

  for (const item of prs) {
    const label = labels[item.id] ?? { brokenFlows: [] };
    console.log(`\n[eval] Running ${item.id} (${item.split}): ${item.url}`);
    const runId = `eval-${item.id}-${Date.now()}`;
    const ctx = await fetchPr(item.url, runId);
    const bus = new RunEventBus(runId);

    const [report, baseline] = await Promise.all([
      executeRun(runId, ctx, bus),
      runCarbonBaseline(ctx),
    ]);

    const events = bus.getAllEvents();
    const mergedEv = events.find((e) => e.type === "predictions.merged");
    const scoredEv = events.find((e) => e.type === "predictions.scored");
    const predictions: Prediction[] =
      (mergedEv?.data?.predictions as Prediction[] | undefined) ?? [];
    const scored: Scored[] =
      (scoredEv?.data?.scored as Scored[] | undefined) ?? [];

    const toolFlagged = getToolPositivePredictions(report, predictions, scored);

    let toolTp = 0;
    let carbonTp = 0;
    let argonTp = 0;
    for (const gt of label.brokenFlows) {
      let matchedAny = false;
      let matchedCarbon = false;
      let matchedArgon = false;
      for (const pred of toolFlagged) {
        if (await flowsMatch(`${pred.flowId}: ${pred.hypothesis}`, gt.flowName)) {
          matchedAny = true;
          if (pred.foundBy.includes("carbon")) matchedCarbon = true;
          if (pred.foundBy.includes("argon")) matchedArgon = true;
        }
      }
      if (matchedAny) toolTp += 1;
      if (matchedCarbon) carbonTp += 1;
      if (matchedArgon) argonTp += 1;
    }

    const toolFalseAlarms =
      report?.verdicts.filter((v) => v.status === "false_alarm").length ?? 0;
    const toolUnverified =
      report?.verdicts.filter((v) => v.status === "unverified").length ?? 0;

    let baselineTp = 0;
    const matchedBaselineIndices = new Set<number>();
    for (const gt of label.brokenFlows) {
      for (let i = 0; i < baseline.predictions.length; i++) {
        const bp = baseline.predictions[i];
        if (
          await flowsMatch(`${bp.flowName}: ${bp.hypothesis}`, gt.flowName)
        ) {
          baselineTp += 1;
          matchedBaselineIndices.add(i);
          break;
        }
      }
    }
    const baselineFalseAlarms =
      baseline.predictions.length - matchedBaselineIndices.size;

    const outcome: PrEvalOutcome = {
      id: item.id,
      url: item.url,
      split: item.split,
      headSha: ctx.pr.headSha,
      labeledCount: label.brokenFlows.length,
      tool: {
        tp: toolTp,
        fn: label.brokenFlows.length - toolTp,
        falseAlarms: toolFalseAlarms,
        unverified: toolUnverified,
        carbonTp,
        argonTp,
      },
      baseline: {
        tp: baselineTp,
        fn: label.brokenFlows.length - baselineTp,
        falseAlarms: baselineFalseAlarms,
      },
    };
    outcomes.push(outcome);

    fs.writeFileSync(
      path.join(resultsDir, `${item.id}.json`),
      JSON.stringify({ outcome, report, baseline }, null, 2),
      "utf8"
    );
  }

  const heldout = outcomes.filter((o) => o.split === "heldout");
  const totalGt = heldout.reduce((acc, o) => acc + o.labeledCount, 0);
  const sumToolTp = heldout.reduce((acc, o) => acc + o.tool.tp, 0);
  const sumBaseTp = heldout.reduce((acc, o) => acc + o.baseline.tp, 0);
  const sumCarbonTp = heldout.reduce((acc, o) => acc + o.tool.carbonTp, 0);
  const sumArgonTp = heldout.reduce((acc, o) => acc + o.tool.argonTp, 0);

  const summary = {
    split: "heldout",
    generatedAt: new Date().toISOString(),
    prCount: heldout.length,
    tool: {
      truePositives: sumToolTp,
      falseNegatives: totalGt - sumToolTp,
      falseAlarms: heldout.reduce((acc, o) => acc + o.tool.falseAlarms, 0),
      unverifiedCount: heldout.reduce((acc, o) => acc + o.tool.unverified, 0),
      recall: totalGt > 0 ? sumToolTp / totalGt : null,
    },
    baseline: {
      truePositives: sumBaseTp,
      falseNegatives: totalGt - sumBaseTp,
      falseAlarms: heldout.reduce((acc, o) => acc + o.baseline.falseAlarms, 0),
      unverifiedCount: 0,
      recall: totalGt > 0 ? sumBaseTp / totalGt : null,
    },
    carbonRecall: totalGt > 0 ? sumCarbonTp / totalGt : null,
    argonRecall: totalGt > 0 ? sumArgonTp / totalGt : null,
    outcomes,
  };

  fs.writeFileSync(
    path.join(resultsDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log("\n" + formatEvalComparisonTable(summary));
}

function getToolPositivePredictions(
  report: Report | null,
  predictions: Prediction[],
  scored: Scored[]
): Prediction[] {
  if (!report) return [];
  const confirmedIds = new Set(
    report.verdicts
      .filter((v) => v.status === "confirmed")
      .map((v) => v.predictionId)
  );
  const source = scored.length > 0 ? scored : predictions;
  return source.filter((p) => confirmedIds.has(p.id));
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
