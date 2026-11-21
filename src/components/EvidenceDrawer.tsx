import { useEffect, useState } from "react";
import { X, FileCode, ImageOff, Terminal } from "lucide-react";
import { deriveNodeState, type RunUiState } from "../state/reducer.ts";

interface EvidenceDrawerProps {
  state: RunUiState;
  predictionId: string | null;
  onClose: () => void;
}

export function EvidenceDrawer({
  state,
  predictionId,
  onClose,
}: EvidenceDrawerProps) {
  const [logContent, setLogContent] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const prediction = state.predictions.find((p) => p.id === predictionId);
  const flow = prediction
    ? state.flows.find((f) => f.id === prediction.flowId)
    : undefined;
  const scored = prediction ? state.scored[prediction.id] : undefined;
  const verdict = prediction ? state.verdicts[prediction.id] : undefined;
  const evidences = prediction ? state.evidences[prediction.id] ?? [] : [];
  const latestEvidence = evidences.at(-1);
  const judges = prediction ? state.judges[prediction.id] ?? [] : [];
  const latestJudge = judges.at(-1);
  const visualState = prediction ? deriveNodeState(state, prediction.id) : null;

  const basePath =
    state.mode === "replay" && state.recordingName
      ? `/api/recordings/${encodeURIComponent(state.recordingName)}/evidence`
      : state.runId
        ? `/api/runs/${encodeURIComponent(state.runId)}/evidence`
        : null;

  const screenshotFile = latestEvidence?.files.find(
    (f) => f.kind === "screenshot"
  );
  const logFile = latestEvidence?.files.find((f) => f.kind === "log");

  const screenshotUrl =
    basePath && screenshotFile ? `${basePath}/${screenshotFile.path}` : null;
  const logUrl = basePath && logFile ? `${basePath}/${logFile.path}` : null;

  useEffect(() => {
    setImgFailed(false);
    setLogContent(null);
    if (!logUrl) return;
    let cancelled = false;
    fetch(logUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("Missing log"))))
      .then((text) => {
        if (!cancelled) setLogContent(text);
      })
      .catch(() => {
        if (!cancelled) setLogContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [logUrl]);

  useEffect(() => {
    if (!predictionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [predictionId, onClose]);

  if (!prediction || !predictionId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
      <aside
        aria-label="Evidence Drawer"
        className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">{prediction.id}</span>
              <span aria-hidden="true">·</span>
              <span>{flow?.kind ?? "flow"}</span>
              <span aria-hidden="true">·</span>
              <span>Found by {prediction.foundBy.join(" + ")}</span>
            </div>
            <h2 className="mt-1 font-display text-base font-semibold text-slate-900">
              {flow?.name ?? prediction.flowId}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close evidence drawer"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Verdict & Judge Numbers */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600">
              <span>Server Verdict</span>
              {scored && (
                <span className="font-mono tabular-nums">
                  Risk P(break) = {(scored.pBreak * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {verdict
                ? verdict.status === "low_risk"
                  ? "Not flagged (low risk — not checked)"
                  : verdict.status.replace("_", " ")
                : visualState ?? "predicted"}
            </div>
            {verdict?.reason && (
              <p className="text-xs text-amber-800">Reason: {verdict.reason}</p>
            )}
            {latestJudge && (
              <div className="border-t border-slate-200 pt-2 text-xs text-slate-600 font-mono tabular-nums">
                Judge attempt #{latestJudge.attempt}: P(yes)=
                {latestJudge.pYes.toFixed(2)} · confidence=
                {latestJudge.confidence.toFixed(2)}
              </div>
            )}
          </div>

          {/* Claim */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">
              Predicted Breakage Claim
            </h3>
            <p className="text-sm leading-relaxed text-slate-800">
              {prediction.hypothesis}
            </p>
            <div className="text-xs text-slate-600">
              <span className="font-medium text-slate-700">Verification steps: </span>
              {prediction.howToVerify}
            </div>
            {prediction.cites.length > 0 && (
              <div className="pt-1 space-y-1">
                {prediction.cites.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 font-mono text-xs text-slate-600"
                  >
                    <FileCode className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    <span>
                      {c.file}
                      {c.lines ? `:${c.lines}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Screenshot Evidence */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700">
                Screenshot Evidence
              </h3>
              {screenshotFile && (
                <span
                  className="font-mono text-xs text-slate-500 tabular-nums"
                  title={screenshotFile.sha256}
                >
                  sha256:{screenshotFile.sha256.slice(0, 12)}
                </span>
              )}
            </div>

            {screenshotUrl && !imgFailed ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <img
                  src={screenshotUrl}
                  alt={`Screenshot evidence for ${flow?.name ?? prediction.flowId}`}
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full object-contain max-h-80"
                />
              </div>
            ) : (
              <div className="flex h-36 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                <ImageOff className="h-5 w-5 text-slate-400" aria-hidden="true" />
                <span>
                  {verdict?.status === "low_risk"
                    ? "Not run in browser (scored below risk threshold)."
                    : "No screenshot captured for this prediction."}
                </span>
              </div>
            )}
          </div>

          {/* Runtime Log */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Terminal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                <span>Captured Runtime Log</span>
              </h3>
              {logFile && (
                <span
                  className="font-mono text-xs text-slate-500 tabular-nums"
                  title={logFile.sha256}
                >
                  sha256:{logFile.sha256.slice(0, 12)}
                </span>
              )}
            </div>
            <pre className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs leading-relaxed text-slate-100 whitespace-pre-wrap">
              {logContent ??
                state.verifierErrors[prediction.id] ??
                "No runtime log recorded yet."}
            </pre>
          </div>

          {/* Verifier human-only note */}
          {latestEvidence?.note && (
            <div className="space-y-1 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-semibold text-slate-700">
                Verifier Note (human-only; excluded from Judge input)
              </h3>
              <p className="text-xs leading-relaxed text-slate-600">
                {latestEvidence.note}
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
