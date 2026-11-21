import type {
  Analysis,
  AnalyzerModel,
  Cite,
  Flow,
  Prediction,
  RiskLevel,
} from "../../shared/types.ts";

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mergeCites(a: Cite[], b: Cite[]): Cite[] {
  const seen = new Set<string>();
  const merged: Cite[] = [];
  for (const cite of [...a, ...b]) {
    const key = `${cite.file}::${cite.lines ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cite);
  }
  return merged;
}

export function merge(analyses: Analysis[]): {
  flows: Flow[];
  predictions: Prediction[];
} {
  const flowsBySlug = new Map<string, Flow>();
  const flowAliasToCanonical = new Map<string, string>();

  // First pass: merge flows by normalized ID or normalized name
  for (const analysis of analyses) {
    for (const flow of analysis.flows) {
      const idSlug = normalizeSlug(flow.id) || normalizeSlug(flow.name) || "flow";
      const nameSlug = normalizeSlug(flow.name);

      let canonicalId =
        flowAliasToCanonical.get(`${analysis.model}:${flow.id}`) ??
        (flowsBySlug.has(idSlug) ? idSlug : undefined) ??
        (nameSlug && flowsBySlug.has(nameSlug) ? nameSlug : undefined);

      if (!canonicalId) {
        // Also match if an existing flow has the exact same normalized name
        for (const [existingId, existingFlow] of flowsBySlug.entries()) {
          if (nameSlug && normalizeSlug(existingFlow.name) === nameSlug) {
            canonicalId = existingId;
            break;
          }
        }
      }

      if (!canonicalId) {
        canonicalId = idSlug;
        flowsBySlug.set(canonicalId, {
          id: canonicalId,
          name: flow.name,
          kind: flow.kind,
          touches: Array.from(new Set(flow.touches)),
        });
      } else {
        const existing = flowsBySlug.get(canonicalId)!;
        existing.touches = Array.from(
          new Set([...existing.touches, ...flow.touches])
        );
      }

      flowAliasToCanonical.set(`${analysis.model}:${flow.id}`, canonicalId);
    }
  }

  // Second pass: merge and de-duplicate predictions by canonical flowId
  const predsByFlowId = new Map<
    string,
    {
      flowId: string;
      risk: RiskLevel;
      hypotheses: string[];
      cites: Cite[];
      verifySteps: string[];
      foundBy: Set<AnalyzerModel>;
    }
  >();

  for (const analysis of analyses) {
    for (const pred of analysis.predictions) {
      const canonicalFlowId =
        flowAliasToCanonical.get(`${analysis.model}:${pred.flowId}`) ??
        normalizeSlug(pred.flowId);

      if (!flowsBySlug.has(canonicalFlowId)) {
        flowsBySlug.set(canonicalFlowId, {
          id: canonicalFlowId,
          name: pred.flowId,
          kind: "flow",
          touches: pred.cites.map((c) => c.file),
        });
      }

      const existing = predsByFlowId.get(canonicalFlowId);
      if (!existing) {
        predsByFlowId.set(canonicalFlowId, {
          flowId: canonicalFlowId,
          risk: pred.risk,
          hypotheses: [pred.hypothesis],
          cites: [...pred.cites],
          verifySteps: [pred.howToVerify],
          foundBy: new Set<AnalyzerModel>(pred.foundBy),
        });
      } else {
        if (RISK_ORDER[pred.risk] > RISK_ORDER[existing.risk]) {
          existing.risk = pred.risk;
        }
        if (!existing.hypotheses.includes(pred.hypothesis)) {
          existing.hypotheses.push(pred.hypothesis);
        }
        existing.cites = mergeCites(existing.cites, pred.cites);
        if (!existing.verifySteps.includes(pred.howToVerify)) {
          existing.verifySteps.push(pred.howToVerify);
        }
        for (const model of pred.foundBy) {
          existing.foundBy.add(model);
        }
      }
    }
  }

  const orderedEntries = Array.from(predsByFlowId.values()).sort((a, b) => {
    const byFoundCount = b.foundBy.size - a.foundBy.size;
    if (byFoundCount !== 0) return byFoundCount;
    return RISK_ORDER[b.risk] - RISK_ORDER[a.risk];
  });

  const predictions: Prediction[] = orderedEntries.map((entry, index) => ({
    id: `p_${index + 1}`,
    flowId: entry.flowId,
    risk: entry.risk,
    hypothesis: entry.hypotheses.join(" | "),
    cites: entry.cites,
    howToVerify: entry.verifySteps[0] ?? "",
    foundBy: Array.from(entry.foundBy),
  }));

  return {
    flows: Array.from(flowsBySlug.values()),
    predictions,
  };
}
