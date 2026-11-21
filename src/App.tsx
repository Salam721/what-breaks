import { useCallback, useEffect, useRef, useState } from "react";
import type { PrRef, RunEvent } from "../shared/types.ts";
import { EvalPanel } from "./components/EvalPanel.tsx";
import { EvidenceDrawer } from "./components/EvidenceDrawer.tsx";
import { EventStreamPanel } from "./components/EventStreamPanel.tsx";
import { FlowGraph } from "./components/FlowGraph.tsx";
import { Scoreboard } from "./components/Scoreboard.tsx";
import { SubmitBar, type RecordingOption } from "./components/SubmitBar.tsx";
import { TopBar } from "./components/TopBar.tsx";
import {
  applyEvent,
  createStartState,
  initialRunUiState,
  type RunUiState,
} from "./state/reducer.ts";

export default function App() {
  const [activeSection, setActiveSection] = useState<"workspace" | "eval">(
    "workspace"
  );
  const [authConfigured, setAuthConfigured] = useState(true);
  const [authMode, setAuthMode] = useState<"env" | "claimed" | "unconfigured">(
    "env"
  );
  const [recordings, setRecordings] = useState<RecordingOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunUiState>(initialRunUiState);
  const [selectedPredictionId, setSelectedPredictionId] = useState<
    string | null
  >(null);
  const [sseStatus, setSseStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  const prInputRef = useRef<HTMLInputElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const replayTimersRef = useRef<number[]>([]);

  const clearReplayTimers = useCallback(() => {
    for (const id of replayTimersRef.current) {
      window.clearTimeout(id);
    }
    replayTimersRef.current = [];
  }, []);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setSseStatus("disconnected");
  }, []);

  const connectSse = useCallback(
    (runId: string) => {
      closeStream();
      setSseStatus("connecting");

      const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
      eventSourceRef.current = es;

      const handleEvent = (raw: MessageEvent) => {
        try {
          const parsed = JSON.parse(raw.data) as RunEvent;
          setRunState((prev) => applyEvent(prev, parsed));
          if (parsed.type === "report.ready" || parsed.type === "run.failed") {
            es.close();
            eventSourceRef.current = null;
            setSseStatus("disconnected");
          }
        } catch {
          // Ignore malformed frame
        }
      };

      const eventTypes = [
        "run.started",
        "triage.done",
        "analysis.started",
        "analysis.done",
        "predictions.merged",
        "predictions.scored",
        "verifier.started",
        "verifier.done",
        "verifier.failed",
        "judge.done",
        "verdict.set",
        "report.ready",
        "run.failed",
      ];

      es.onopen = () => setSseStatus("connected");
      for (const type of eventTypes) {
        es.addEventListener(type, handleEvent);
      }

      es.onerror = () => {
        setSseStatus("disconnected");
        // Recover state from snapshot on disconnect/error if run already moved forward
        fetch(`/api/runs/${encodeURIComponent(runId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((snap: { events?: RunEvent[] } | null) => {
            if (!snap?.events) return;
            setRunState((prev) => {
              let next = prev;
              for (const ev of snap.events ?? []) {
                next = applyEvent(next, ev);
              }
              return next;
            });
          })
          .catch(() => {});
      };
    },
    [closeStream]
  );

  const loadReplay = useCallback(
    async (name: string) => {
      clearReplayTimers();
      closeStream();
      setSubmitError(null);
      setSelectedPredictionId(null);

      try {
        const res = await fetch(`/api/recordings/${encodeURIComponent(name)}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setSubmitError(body.error ?? `Recording '${name}' not found.`);
          return;
        }
        const payload = (await res.json()) as { name: string; events: RunEvent[] };
        const events = payload.events ?? [];
        if (events.length === 0) {
          setSubmitError(`Recording '${name}' has no events.`);
          return;
        }

        const firstRunId = events[0].runId;
        setRunState(createStartState(firstRunId, "replay", null, name));

        // Feed events through the exact same applyEvent reducer with compressed real timing
        const baseTs = Date.parse(events[0].ts);
        let prevOffset = 0;
        events.forEach((ev, idx) => {
          const rawDelta = Number.isFinite(baseTs)
            ? Math.max(0, Date.parse(ev.ts) - baseTs)
            : idx * 250;
          const compressedDelay = Math.min(idx * 350, Math.round(rawDelta * 0.15));
          const delay = Math.max(prevOffset + (idx === 0 ? 0 : 120), compressedDelay);
          prevOffset = delay;
          const timerId = window.setTimeout(() => {
            setRunState((prev) => applyEvent(prev, ev));
          }, delay);
          replayTimersRef.current.push(timerId);
        });
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : "Failed to load replay."
        );
      }
    },
    [clearReplayTimers, closeStream]
  );

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d: { configured: boolean; mode: "env" | "claimed" | "unconfigured" }) => {
        setAuthConfigured(Boolean(d.configured));
        setAuthMode(d.mode);
      })
      .catch(() => {});

    fetch("/api/recordings")
      .then((r) => r.json())
      .then((d: { recordings?: RecordingOption[] }) => {
        setRecordings(d.recordings ?? []);
      })
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const replayName = params.get("replay");
    if (replayName) {
      loadReplay(replayName);
    }

    return () => {
      clearReplayTimers();
      closeStream();
    };
  }, [clearReplayTimers, closeStream, loadReplay]);

  const handleClaimAccessCode = async (code: string) => {
    const res = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: code }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      mode?: "env" | "claimed" | "unconfigured";
    };
    if (!res.ok) {
      throw new Error(body.error ?? "Could not set access code.");
    }
    setAuthConfigured(true);
    setAuthMode(body.mode ?? "claimed");
  };

  const handleSubmitPr = async (prUrl: string, accessCode: string) => {
    clearReplayTimers();
    closeStream();
    setIsSubmitting(true);
    setSubmitError(null);
    setSelectedPredictionId(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl, accessCode }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        runId?: string;
        pr?: PrRef;
        error?: string;
      };

      if (!res.ok || !body.runId) {
        setSubmitError(body.error ?? "Failed to start PR verification.");
        return;
      }

      setRunState(createStartState(body.runId, "live", body.pr ?? null));
      connectSse(body.runId);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Network error starting verification."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        onFocusSubmit={() => prInputRef.current?.focus()}
      />

      {activeSection === "eval" ? (
        <EvalPanel />
      ) : (
        <>
          <SubmitBar
            prInputRef={prInputRef}
            authConfigured={authConfigured}
            authMode={authMode}
            isSubmitting={isSubmitting}
            submitError={submitError}
            recordings={recordings}
            activeReplayName={
              runState.mode === "replay" ? runState.recordingName : null
            }
            onClaimAccessCode={handleClaimAccessCode}
            onSubmitPr={handleSubmitPr}
            onSelectReplay={(name) => {
              const url = new URL(window.location.href);
              url.searchParams.set("replay", name);
              window.history.replaceState({}, "", url.toString());
              loadReplay(name);
            }}
          />

          <main className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
            {runState.error && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {runState.error}
              </div>
            )}

            <Scoreboard state={runState} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <FlowGraph
                  state={runState}
                  selectedPredictionId={selectedPredictionId}
                  onSelectPrediction={setSelectedPredictionId}
                />
              </div>
              <div className="lg:col-span-4">
                <EventStreamPanel
                  state={runState}
                  sseStatus={sseStatus}
                  onReconnect={() => {
                    if (runState.runId) connectSse(runState.runId);
                  }}
                />
              </div>
            </div>
          </main>

          <EvidenceDrawer
            state={runState}
            predictionId={selectedPredictionId}
            onClose={() => setSelectedPredictionId(null)}
          />
        </>
      )}
    </div>
  );
}
