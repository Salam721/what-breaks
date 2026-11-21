import { RefreshCw } from "lucide-react";
import type { RunUiState } from "../state/reducer.ts";

interface EventStreamPanelProps {
  state: RunUiState;
  sseStatus: "disconnected" | "connecting" | "connected";
  onReconnect: () => void;
}

export function EventStreamPanel({
  state,
  sseStatus,
  onReconnect,
}: EventStreamPanelProps) {
  return (
    <aside className="flex flex-col gap-4">
      {/* Carbon Report Summary */}
      {state.report && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Report Summary
            </h2>
            <span className="text-xs text-slate-500">
              Carbon summary · Server verdicts
            </span>
          </div>
          <p className="text-sm leading-relaxed text-slate-700">
            {state.report.summary}
          </p>
        </div>
      )}

      {/* Live SSE Timeline */}
      <div className="flex min-h-[520px] flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Progress Log
            </h2>
            <p className="text-xs text-slate-500">
              {state.mode === "replay"
                ? "Replaying saved real run events"
                : sseStatus === "connected"
                  ? "Live Server-Sent Events stream"
                  : sseStatus === "connecting"
                    ? "Connecting to event stream..."
                    : "Stream idle"}
            </p>
          </div>

          {state.mode === "live" &&
            state.status === "running" &&
            sseStatus === "disconnected" && (
              <button
                type="button"
                onClick={onReconnect}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reconnect</span>
              </button>
            )}
        </div>

        <div className="flex-1 max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
          {state.events.length === 0 ? (
            <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center text-xs text-slate-500">
              Events appear here in real time once a PR check starts.
            </div>
          ) : (
            [...state.events].reverse().map((ev) => (
              <div key={ev.seq} className="px-4 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-800">
                    {ev.type}
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    #{ev.seq} · {new Date(ev.ts).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1 text-slate-600">
                  {formatEventDetail(ev)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function formatEventDetail(ev: {
  type: string;
  data: Record<string, unknown>;
}): string {
  const d = ev.data;
  switch (ev.type) {
    case "run.started":
      return `Pinned to head SHA ${String((d.pr as { headSha?: string })?.headSha ?? "").slice(0, 10)}`;
    case "triage.done": {
      const t = d.triage as { files?: string[]; areas?: string[] } | undefined;
      return `Focused on ${t?.files?.length ?? 0} files across ${t?.areas?.join(", ") || "repo"}`;
    }
    case "analysis.done":
      return `${String(d.model)} returned schema-valid flow predictions`;
    case "predictions.merged": {
      const preds = (d.predictions as unknown[]) ?? [];
      return `Merged into ${preds.length} flow prediction(s)${d.singleAnalyzer ? " (single-analyzer mode)" : ""}`;
    }
    case "predictions.scored": {
      const scored = (d.scored as Array<{ risky: boolean }>) ?? [];
      const riskyCount = scored.filter((s) => s.risky).length;
      return `Decisions API scored ${scored.length} prediction(s): ${riskyCount} flagged above threshold`;
    }
    case "verifier.started":
      return `Managed Agent verifying ${String(d.predictionId)} (attempt ${String(d.attempt)})`;
    case "verifier.done":
      return `Captured evidence for ${String(d.predictionId)} (attempt ${String(d.attempt)})`;
    case "verifier.failed":
      return `Verifier failed for ${String(d.predictionId)}: ${String(d.reason ?? "error")}`;
    case "judge.done": {
      const j = d.judge as { predictionId: string; pYes: number; confidence: number } | undefined;
      return j
        ? `Judge scored ${j.predictionId}: P(yes)=${j.pYes.toFixed(2)}, conf=${j.confidence.toFixed(2)}`
        : "Judge scored evidence";
    }
    case "verdict.set": {
      const v = d.verdict as { predictionId: string; status: string; reason?: string } | undefined;
      return v
        ? `${v.predictionId} -> ${v.status}${v.reason ? ` (${v.reason})` : ""}`
        : "Verdict set";
    }
    case "report.ready":
      return "Final report and SHA-256 evidence manifest ready";
    case "run.failed":
      return String(d.error ?? "Run failed");
    default:
      return ev.type;
  }
}
