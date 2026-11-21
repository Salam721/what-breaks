import { z } from "zod";

export const PrRefSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    number: z.number().int().positive(),
    headSha: z.string().regex(/^[0-9a-fA-F]{40}$/),
    baseSha: z.string().regex(/^[0-9a-fA-F]{40}$/),
    title: z.string(),
    url: z.string().url(),
  })
  .strict();

export type PrRef = z.infer<typeof PrRefSchema>;

export const FlowKindSchema = z.enum(["page", "endpoint", "table", "flow"]);
export type FlowKind = z.infer<typeof FlowKindSchema>;

export const FlowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: FlowKindSchema,
    touches: z.array(z.string()),
  })
  .strict();

export type Flow = z.infer<typeof FlowSchema>;

export const CiteSchema = z
  .object({
    file: z.string().min(1),
    lines: z.string().optional(),
  })
  .strict();

export type Cite = z.infer<typeof CiteSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const AnalyzerModelSchema = z.enum(["carbon", "argon"]);
export type AnalyzerModel = z.infer<typeof AnalyzerModelSchema>;

export const PredictionSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    flowId: z.string().min(1),
    risk: RiskLevelSchema,
    hypothesis: z.string().min(1),
    cites: z.array(CiteSchema),
    howToVerify: z.string().min(1),
    foundBy: z.array(AnalyzerModelSchema).min(1),
  })
  .strict();

export type Prediction = z.infer<typeof PredictionSchema>;

export const RawAnalyzerPredictionSchema = z
  .object({
    id: z.string().min(1),
    flowId: z.string().min(1),
    risk: RiskLevelSchema,
    hypothesis: z.string().min(1),
    cites: z.array(CiteSchema),
    howToVerify: z.string().min(1),
  })
  .strict();

export type RawAnalyzerPrediction = z.infer<typeof RawAnalyzerPredictionSchema>;

export const RawAnalysisResponseSchema = z
  .object({
    flows: z.array(FlowSchema),
    predictions: z.array(RawAnalyzerPredictionSchema),
  })
  .strict();

export type RawAnalysisResponse = z.infer<typeof RawAnalysisResponseSchema>;

export const AnalysisSchema = z
  .object({
    model: AnalyzerModelSchema,
    flows: z.array(FlowSchema),
    predictions: z.array(PredictionSchema),
  })
  .strict();

export type Analysis = z.infer<typeof AnalysisSchema>;

export const TriageSchema = z
  .object({
    files: z.array(z.string()),
    areas: z.array(z.string()),
  })
  .strict();

export type Triage = z.infer<typeof TriageSchema>;

export const ScoredSchema = PredictionSchema.extend({
  pBreak: z.number().min(0.01).max(0.99),
  risky: z.boolean(),
}).strict();

export type Scored = z.infer<typeof ScoredSchema>;

export const EvidenceFileSchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum(["screenshot", "log"]),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type EvidenceFile = z.infer<typeof EvidenceFileSchema>;

export const EvidenceSchema = z
  .object({
    predictionId: z.string().min(1),
    attempt: z.number().int().min(1).max(2),
    files: z.array(EvidenceFileSchema),
    startedApp: z.boolean(),
    note: z.string().optional(),
  })
  .strict();

export type Evidence = z.infer<typeof EvidenceSchema>;

export const JudgeSchema = z
  .object({
    predictionId: z.string().min(1),
    pYes: z.number().min(0.01).max(0.99),
    confidence: z.number().min(0.5).max(0.99),
    attempt: z.number().int().min(1).max(2),
  })
  .strict();

export type Judge = z.infer<typeof JudgeSchema>;

export const VerdictStatusSchema = z.enum([
  "confirmed",
  "false_alarm",
  "unverified",
  "low_risk",
]);

export type VerdictStatus = z.infer<typeof VerdictStatusSchema>;

export const VerdictSchema = z
  .object({
    predictionId: z.string().min(1),
    status: VerdictStatusSchema,
    reason: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "unverified" && (!val.reason || val.reason.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "reason is required when verdict status is unverified",
      });
    }
  });

export type Verdict = z.infer<typeof VerdictSchema>;

export const ReportSchema = z
  .object({
    pr: PrRefSchema,
    singleAnalyzer: z.boolean(),
    summary: z.string(),
    verdicts: z.array(VerdictSchema),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type Report = z.infer<typeof ReportSchema>;

export const EvidenceManifestEntrySchema = z
  .object({
    predictionId: z.string(),
    attempt: z.number().int().min(1).max(2),
    path: z.string(),
    kind: z.enum(["screenshot", "log"]),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const EvidenceManifestSchema = z
  .object({
    runId: z.string(),
    headSha: z.string().regex(/^[0-9a-fA-F]{40}$/),
    createdAt: z.string(),
    files: z.array(EvidenceManifestEntrySchema),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;

export const RunEventTypeSchema = z.enum([
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
]);

export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventSchema = z
  .object({
    runId: z.string(),
    seq: z.number().int().positive(),
    ts: z.string(),
    type: RunEventTypeSchema,
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export type RunEvent = z.infer<typeof RunEventSchema>;

export type NodeVisualState =
  | "predicted"
  | "verifying"
  | "confirmed"
  | "false_alarm"
  | "unverified"
  | "low_risk";

export interface PrContext {
  pr: PrRef;
  prBody: string;
  cloneUrl: string;
  diff: string;
  baseDir: string;
  headDir: string;
  changedFiles: string[];
}
