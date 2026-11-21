import test from "node:test";
import assert from "node:assert/strict";
import type { RunEvent } from "../../shared/types.ts";
import {
  applyEvent,
  createStartState,
  deriveNodeState,
  getScoreboardCounts,
} from "./reducer.ts";

test("applyEvent transitions node states and ignores duplicate seq on SSE reconnect", () => {
  const pr = {
    owner: "tastejs",
    repo: "todomvc",
    number: 2257,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    title: "Fix label association",
    url: "https://github.com/tastejs/todomvc/pull/2257",
  };

  let state = createStartState("run-1", "live", pr);

  const ev1: RunEvent = {
    runId: "run-1",
    seq: 1,
    ts: "2026-11-21T12:00:00Z",
    type: "predictions.merged",
    data: {
      singleAnalyzer: false,
      flows: [
        { id: "todo-edit", name: "Edit Todo", kind: "flow", touches: ["src/App.tsx"] },
      ],
      predictions: [
        {
          id: "p_1",
          flowId: "todo-edit",
          risk: "high",
          hypothesis: "Double click does not focus input",
          cites: [{ file: "src/App.tsx" }],
          howToVerify: "Double click a todo",
          foundBy: ["carbon", "argon"],
        },
      ],
    },
  };

  state = applyEvent(state, ev1);
  assert.equal(deriveNodeState(state, "p_1"), "predicted");

  // Duplicate seq is ignored
  state = applyEvent(state, ev1);
  assert.equal(state.events.length, 1);

  state = applyEvent(state, {
    runId: "run-1",
    seq: 2,
    ts: "2026-11-21T12:00:02Z",
    type: "verifier.started",
    data: { predictionId: "p_1", attempt: 1 },
  });
  assert.equal(deriveNodeState(state, "p_1"), "verifying");

  state = applyEvent(state, {
    runId: "run-1",
    seq: 3,
    ts: "2026-11-21T12:00:10Z",
    type: "verdict.set",
    data: { verdict: { predictionId: "p_1", status: "false_alarm" } },
  });
  assert.equal(deriveNodeState(state, "p_1"), "false_alarm");

  const counts = getScoreboardCounts(state);
  assert.equal(counts.false_alarm, 1);
  assert.equal(counts.confirmed, 0);
});
