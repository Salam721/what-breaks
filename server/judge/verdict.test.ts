import test from "node:test";
import assert from "node:assert/strict";
import type { Judge } from "../../shared/types.ts";
import { decideVerdict } from "./verdict.ts";

function makeJudge(pYes: number): Judge {
  return {
    predictionId: "p_1",
    pYes,
    confidence: Math.max(pYes, 1 - pYes),
    attempt: 1,
  };
}

test("decideVerdict handles confidence boundaries (0.29, 0.3, 0.69, 0.7, 0.99)", () => {
  // pYes = 0.29 => confidence = 0.71 >= 0.7 => false_alarm
  const v029 = decideVerdict(makeJudge(0.29), false, 0.7);
  assert.deepEqual(v029, { predictionId: "p_1", status: "false_alarm" });

  // pYes = 0.3 => confidence = 0.70 >= 0.7 => false_alarm (floating point: 1 - 0.3 = 0.7)
  const j030: Judge = { predictionId: "p_1", pYes: 0.3, confidence: 0.7, attempt: 1 };
  assert.deepEqual(decideVerdict(j030, false, 0.7), {
    predictionId: "p_1",
    status: "false_alarm",
  });

  // pYes = 0.69 => confidence = 0.69 < 0.7 => retry on attempt 1, unverified on attempt 2
  assert.equal(decideVerdict(makeJudge(0.69), false, 0.7), "retry");
  assert.deepEqual(decideVerdict(makeJudge(0.69), true, 0.7), {
    predictionId: "p_1",
    status: "unverified",
    reason: "judge unsure after re-run",
  });

  // pYes = 0.7 => confidence = 0.7 >= 0.7 => confirmed
  assert.deepEqual(decideVerdict(makeJudge(0.7), false, 0.7), {
    predictionId: "p_1",
    status: "confirmed",
  });

  // pYes = 0.99 => confidence = 0.99 >= 0.7 => confirmed
  assert.deepEqual(decideVerdict(makeJudge(0.99), false, 0.7), {
    predictionId: "p_1",
    status: "confirmed",
  });
});
