import test from "node:test";
import assert from "node:assert/strict";
import {
  PrRefSchema,
  AnalysisSchema,
  ScoredSchema,
  JudgeSchema,
  VerdictSchema,
  ReportSchema,
} from "./types.ts";

const validPr = {
  owner: "octocat",
  repo: "hello-world",
  number: 42,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  title: "Fix checkout button",
  url: "https://github.com/octocat/hello-world/pull/42",
};

test("PrRefSchema accepts valid object and rejects unknown fields", () => {
  assert.doesNotThrow(() => PrRefSchema.parse(validPr));
  assert.throws(() => PrRefSchema.parse({ ...validPr, extraField: "nope" }));
});

test("AnalysisSchema rejects unknown fields", () => {
  const validAnalysis = {
    model: "carbon",
    flows: [
      {
        id: "checkout",
        name: "Checkout Flow",
        kind: "flow",
        touches: ["src/checkout.ts"],
      },
    ],
    predictions: [
      {
        id: "p_1",
        flowId: "checkout",
        risk: "high",
        hypothesis: "Submitting order throws on missing token",
        cites: [{ file: "src/checkout.ts", lines: "12-18" }],
        howToVerify: "Open /checkout and submit the form",
        foundBy: ["carbon"],
      },
    ],
  };

  assert.doesNotThrow(() => AnalysisSchema.parse(validAnalysis));
  assert.throws(() => AnalysisSchema.parse({ ...validAnalysis, surprise: 123 }));
  assert.throws(() =>
    AnalysisSchema.parse({
      ...validAnalysis,
      predictions: [{ ...validAnalysis.predictions[0], extra: true }],
    })
  );
});

test("ScoredSchema and JudgeSchema reject out-of-range probabilities", () => {
  const basePred = {
    id: "p_1",
    flowId: "checkout",
    risk: "high",
    hypothesis: "Checkout fails",
    cites: [{ file: "src/checkout.ts" }],
    howToVerify: "Click buy",
    foundBy: ["argon"],
  };

  assert.doesNotThrow(() =>
    ScoredSchema.parse({ ...basePred, pBreak: 0.01, risky: false })
  );
  assert.doesNotThrow(() =>
    ScoredSchema.parse({ ...basePred, pBreak: 0.99, risky: true })
  );
  assert.throws(() =>
    ScoredSchema.parse({ ...basePred, pBreak: 0.0, risky: false })
  );
  assert.throws(() =>
    ScoredSchema.parse({ ...basePred, pBreak: 1.0, risky: true })
  );

  assert.doesNotThrow(() =>
    JudgeSchema.parse({ predictionId: "p_1", pYes: 0.72, confidence: 0.72, attempt: 1 })
  );
  assert.throws(() =>
    JudgeSchema.parse({ predictionId: "p_1", pYes: 0.72, confidence: 0.49, attempt: 1 })
  );
  assert.throws(() =>
    JudgeSchema.parse({ predictionId: "p_1", pYes: 1.01, confidence: 0.99, attempt: 1 })
  );
});

test("VerdictSchema requires reason when unverified", () => {
  assert.doesNotThrow(() =>
    VerdictSchema.parse({ predictionId: "p_1", status: "confirmed" })
  );
  assert.throws(() =>
    VerdictSchema.parse({ predictionId: "p_1", status: "unverified" })
  );
  assert.doesNotThrow(() =>
    VerdictSchema.parse({
      predictionId: "p_1",
      status: "unverified",
      reason: "needs a database",
    })
  );
});

test("ReportSchema validates strict structure", () => {
  const validReport = {
    pr: validPr,
    singleAnalyzer: false,
    summary: "One flow confirmed broken.",
    verdicts: [{ predictionId: "p_1", status: "confirmed" }],
    manifestSha256: "f".repeat(64),
  };
  assert.doesNotThrow(() => ReportSchema.parse(validReport));
  assert.throws(() => ReportSchema.parse({ ...validReport, extra: "x" }));
});
