import { CheckCircle2, ShieldAlert, AlertTriangle, XCircle } from "lucide-react";
import type { RunUiState } from "../state/reducer.ts";
import { getScoreboardCounts } from "../state/reducer.ts";

interface ScoreboardProps {
  state: RunUiState;
}

export function Scoreboard({ state }: ScoreboardProps) {
  const counts = getScoreboardCounts(state);

  return (
    <section
      id="scoreboard"
      aria-label="Verification Scoreboard"
      className="space-y-3"
    >
      {state.pr && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-medium text-slate-700">
                {state.pr.owner}/{state.pr.repo} #{state.pr.number}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums" title={state.pr.headSha}>
                SHA {state.pr.headSha.slice(0, 10)}
              </span>
              {state.mode === "replay" && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-blue-700">
                    Replay: {state.recordingName}
                  </span>
                </>
              )}
              {state.singleAnalyzer && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-amber-700">
                    Single-analyzer mode ({state.completedAnalyzers[0] ?? "partial"})
                  </span>
                </>
              )}
            </div>
            <h1 className="font-display text-lg font-semibold text-slate-900 truncate">
              {state.pr.title}
            </h1>
          </div>

          {state.manifestSha256 && (
            <div className="text-right">
              <div className="text-xs text-slate-500">Manifest SHA-256</div>
              <div
                className="font-mono text-xs text-slate-800 tabular-nums"
                title={state.manifestSha256}
              >
                {state.manifestSha256.slice(0, 16)}…
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>Confirmed Breaks</span>
            <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-red-700 tabular-nums">
            {counts.confirmed}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Judge confirmed failure
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>False Alarms</span>
            <ShieldAlert className="h-4 w-4 text-slate-700" aria-hidden="true" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {counts.false_alarm}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Predicted break, refuted by evidence
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>Unverified</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {counts.unverified}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            App unstartable, unsure, or timed out
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>Not Flagged</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {counts.low_risk}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            Low risk, not checked in browser
          </div>
        </div>
      </div>
    </section>
  );
}
