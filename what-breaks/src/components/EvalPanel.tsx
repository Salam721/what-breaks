import { useEffect, useState } from "react";
import { ExternalLink, FlaskConical } from "lucide-react";

interface EvalPr {
  id: string;
  url: string;
  split: "tune" | "heldout";
  note: string;
}

interface EvalLabel {
  brokenFlows: Array<{ flowName: string; evidence: string }>;
}

interface EvalSummary {
  split: string;
  generatedAt: string;
  prCount: number;
  tool: {
    truePositives: number;
    falseNegatives: number;
    falseAlarms: number;
    unverifiedCount: number;
    recall: number | null;
  };
  baseline: {
    truePositives: number;
    falseNegatives: number;
    falseAlarms: number;
    recall: number | null;
  };
  carbonRecall: number | null;
  argonRecall: number | null;
}

interface EvalResponse {
  prs: EvalPr[];
  labels: Record<string, EvalLabel>;
  summary: EvalSummary | null;
}

export function EvalPanel() {
  const [data, setData] = useState<EvalResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/eval")
      .then((res) => res.json())
      .then((json: EvalResponse) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1440px] px-6 py-8">
        <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

  const fmtPct = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
      <div className="space-y-1">
        <h1 className="font-display text-xl font-bold text-slate-900">
          Held-Out Evaluation vs. Carbon Baseline
        </h1>
        <p className="text-sm text-slate-600">
          Ground-truth breakage labels are authored from real GitHub reverts and fix commits
          before either system runs. Tuning PRs stay separate from the held-out evaluation split.
        </p>
      </div>

      {/* Real Comparison Table */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-blue-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Held-Out Split Comparison
            </h2>
          </div>
          {data?.summary && (
            <span className="font-mono text-xs text-slate-500">
              Generated {new Date(data.summary.generatedAt).toLocaleString()}
            </span>
          )}
        </div>

        {data?.summary ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <tr>
                  <th className="px-5 py-3">Metric</th>
                  <th className="px-5 py-3 text-right">What Breaks Tool</th>
                  <th className="px-5 py-3 text-right">Single-Call Carbon Baseline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-xs tabular-nums">
                <tr>
                  <td className="px-5 py-3 font-sans text-sm font-medium text-slate-900">
                    Recall of real breaks
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900">
                    {fmtPct(data.summary.tool.recall)}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {fmtPct(data.summary.baseline.recall)}
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-sans text-sm font-medium text-slate-900">
                    False alarms
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900">
                    {data.summary.tool.falseAlarms}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {data.summary.baseline.falseAlarms}
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-sans text-sm font-medium text-slate-900">
                    Unverified predictions
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {data.summary.tool.unverifiedCount}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400">0</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-sans text-sm font-medium text-slate-900">
                    Carbon analyzer recall
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {fmtPct(data.summary.carbonRecall)}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400">—</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-sans text-sm font-medium text-slate-900">
                    Argon analyzer recall
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700">
                    {fmtPct(data.summary.argonRecall)}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800">
              No saved evaluation run found yet.
            </p>
            <p className="text-xs text-slate-500">
              Run <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">npm run eval</code>{" "}
              with a valid <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">GEMINI_API_KEY</code>{" "}
              to execute real pipeline and baseline benchmarks across the dataset below.
            </p>
          </div>
        )}
      </section>

      {/* Real PR Dataset & Pre-Written Ground Truth */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Real Public PR Benchmark Set ({data?.prs.length ?? 0} PRs)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
              <tr>
                <th className="px-5 py-2.5">PR ID</th>
                <th className="px-5 py-2.5">Split</th>
                <th className="px-5 py-2.5">Ground-Truth Broken Flows</th>
                <th className="px-5 py-2.5">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {(data?.prs ?? []).map((pr) => {
                const label = data?.labels[pr.id];
                const broken = label?.brokenFlows ?? [];
                return (
                  <tr key={pr.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-mono font-medium text-slate-900">
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <span>{pr.id}</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-700">
                      {pr.split}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {broken.length === 0
                        ? "None (clean PR)"
                        : broken.map((b) => b.flowName).join("; ")}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{pr.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
