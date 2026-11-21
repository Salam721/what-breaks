import type {
  Evidence,
  Flow,
  Judge,
  NodeVisualState,
  Prediction,
  PrRef,
  Report,
  RunEvent,
  Scored,
  Triage,
  Verdict,
} from "../../shared/types.ts";

export interface RunUiState {
  runId: string | null;
  mode: "idle" | "live" | "replay";
  recordingName: string | null;
  status: "idle" | "running" | "completed" | "failed";
  pr: PrRef | null;
  changedFiles: string[];
  triage: Triage | null;
  singleAnalyzer: boolean;
  completedAnalyzers: string[];
  flows: Flow[];
  predictions: Prediction[];
  scored: Record<string, Scored>;
  evidences: Record<string, Evidence[]>;
  judges: Record<string, Judge[]>;
  verdicts: Record<string, Verdict>;
  verifyingIds: string[];
  verifierErrors: Record<string, string>;
  report: Report | null;
  manifestSha256: string | null;
  events: RunEvent[];
  error: string | null;
}

export const initialRunUiState: RunUiState = {
  runId: null,
  mode: "idle",
  recordingName: null,
  status: "idle",
  pr: null,
  changedFiles: [],
  triage: null,
  singleAnalyzer: false,
  completedAnalyzers: [],
  flows: [],
  predictions: [],
  scored: {},
  evidences: {},
  judges: {},
  verdicts: {},
  verifyingIds: [],
  verifierErrors: {},
  report: null,
  manifestSha256: null,
  events: [],
  error: null,
};

export function createStartState(
  runId: string,
  mode: "live" | "replay",
  pr: PrRef | null = null,
  recordingName: string | null = null
): RunUiState {
  return {
    ...initialRunUiState,
    runId,
    mode,
    recordingName,
    status: "running",
    pr,
  };
}

export function applyEvent(state: RunUiState, event: RunEvent): RunUiState {
  if (state.events.some((e) => e.seq === event.seq)) {
    return state;
  }

  const nextEvents = [...state.events, event].sort((a, b) => a.seq - b.seq);
  const data = event.data ?? {};

  switch (event.type) {
    case "run.started": {
      return {
        ...state,
        runId: event.runId,
        status: "running",
        pr: (data.pr as PrRef) ?? state.pr,
        changedFiles: (data.changedFiles as string[]) ?? state.changedFiles,
        events: nextEvents,
      };
    }

    case "triage.done": {
      return {
        ...state,
        triage: (data.triage as Triage) ?? state.triage,
        events: nextEvents,
      };
    }

    case "analysis.started": {
      return {
        ...state,
        events: nextEvents,
      };
    }

    case "analysis.done": {
      const model = typeof data.model === "string" ? data.model : "";
      const completed =
        model && !state.completedAnalyzers.includes(model)
          ? [...state.completedAnalyzers, model]
          : state.completedAnalyzers;
      return {
        ...state,
        completedAnalyzers: completed,
        events: nextEvents,
      };
    }

    case "predictions.merged": {
      return {
        ...state,
        flows: (data.flows as Flow[]) ?? state.flows,
        predictions: (data.predictions as Prediction[]) ?? state.predictions,
        singleAnalyzer: Boolean(data.singleAnalyzer),
        events: nextEvents,
      };
    }

    case "predictions.scored": {
      const scoredList = (data.scored as Scored[]) ?? [];
      const nextScored = { ...state.scored };
      for (const s of scoredList) {
        nextScored[s.id] = s;
      }
      return {
        ...state,
        scored: nextScored,
        events: nextEvents,
      };
    }

    case "verifier.started": {
      const pid = String(data.predictionId ?? "");
      const verifyingIds =
        pid && !state.verifyingIds.includes(pid)
          ? [...state.verifyingIds, pid]
          : state.verifyingIds;
      return {
        ...state,
        verifyingIds,
        events: nextEvents,
      };
    }

    case "verifier.done": {
      const pid = String(data.predictionId ?? "");
      const ev = data.evidence as Evidence | undefined;
      const nextEvidences = { ...state.evidences };
      if (pid && ev) {
        const list = nextEvidences[pid] ?? [];
        nextEvidences[pid] = [...list, ev];
      }
      return {
        ...state,
        evidences: nextEvidences,
        verifyingIds: state.verifyingIds.filter((id) => id !== pid),
        events: nextEvents,
      };
    }

    case "verifier.failed": {
      const pid = String(data.predictionId ?? "");
      const reason = String(data.reason ?? "verifier failed");
      return {
        ...state,
        verifyingIds: state.verifyingIds.filter((id) => id !== pid),
        verifierErrors: pid
          ? { ...state.verifierErrors, [pid]: reason }
          : state.verifierErrors,
        events: nextEvents,
      };
    }

    case "judge.done": {
      const j = data.judge as Judge | undefined;
      const nextJudges = { ...state.judges };
      if (j) {
        const list = nextJudges[j.predictionId] ?? [];
        nextJudges[j.predictionId] = [...list, j];
      }
      return {
        ...state,
        judges: nextJudges,
        events: nextEvents,
      };
    }

    case "verdict.set": {
      const v = data.verdict as Verdict | undefined;
      const nextVerdicts = { ...state.verdicts };
      if (v) {
        nextVerdicts[v.predictionId] = v;
      }
      return {
        ...state,
        verdicts: nextVerdicts,
        verifyingIds: v
          ? state.verifyingIds.filter((id) => id !== v.predictionId)
          : state.verifyingIds,
        events: nextEvents,
      };
    }

    case "report.ready": {
      const report = (data.report as Report) ?? null;
      const nextVerdicts = { ...state.verdicts };
      if (report) {
        for (const v of report.verdicts) {
          nextVerdicts[v.predictionId] = v;
        }
      }
      return {
        ...state,
        status: "completed",
        report,
        verdicts: nextVerdicts,
        manifestSha256: report?.manifestSha256 ?? state.manifestSha256,
        verifyingIds: [],
        events: nextEvents,
      };
    }

    case "run.failed": {
      return {
        ...state,
        status: "failed",
        error: String(data.error ?? "Run failed"),
        verifyingIds: [],
        events: nextEvents,
      };
    }

    default:
      return {
        ...state,
        events: nextEvents,
      };
  }
}

export function deriveNodeState(
  state: RunUiState,
  predictionId: string
): NodeVisualState {
  const verdict = state.verdicts[predictionId];
  if (verdict) {
    return verdict.status;
  }
  if (state.verifyingIds.includes(predictionId)) {
    return "verifying";
  }
  return "predicted";
}

export function getScoreboardCounts(state: RunUiState): {
  confirmed: number;
  false_alarm: number;
  unverified: number;
  low_risk: number;
  pending: number;
} {
  let confirmed = 0;
  let false_alarm = 0;
  let unverified = 0;
  let low_risk = 0;
  let pending = 0;

  for (const pred of state.predictions) {
    const v = state.verdicts[pred.id];
    if (!v) {
      pending += 1;
    } else {
      if (v.status === "confirmed") confirmed += 1;
      else if (v.status === "false_alarm") false_alarm += 1;
      else if (v.status === "unverified") unverified += 1;
      else if (v.status === "low_risk") low_risk += 1;
    }
  }

  return { confirmed, false_alarm, unverified, low_risk, pending };
}
