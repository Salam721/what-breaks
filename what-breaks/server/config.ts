import "dotenv/config";
import path from "node:path";

function clampNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = raw !== undefined && raw !== "" ? Number(raw) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function positiveInt(
  raw: string | undefined,
  fallback: number,
  max: number
): number {
  const parsed = raw !== undefined && raw !== "" ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

const rootDir = process.cwd();
const dataDir = path.resolve(rootDir, "data");

export const config = {
  port: positiveInt(process.env.PORT, 3000, 65535),
  riskThreshold: clampNumber(process.env.RISK_THRESHOLD, 0.45, 0.01, 0.99),
  judgeMinConfidence: clampNumber(
    process.env.JUDGE_MIN_CONFIDENCE,
    0.7,
    0.5,
    0.99
  ),
  maxConcurrentVerifiers: positiveInt(
    process.env.MAX_CONCURRENT_VERIFIERS,
    6,
    6
  ),
  maxVerifiersPerRun: positiveInt(process.env.MAX_VERIFIERS_PER_RUN, 10, 10),
  verifierTimeoutMs: positiveInt(
    process.env.VERIFIER_TIMEOUT_MS,
    240_000,
    900_000
  ),
  runTimeoutMs: positiveInt(process.env.RUN_TIMEOUT_MS, 600_000, 1_800_000),
  maxDiffTokens: positiveInt(process.env.MAX_DIFF_TOKENS, 200_000, 240_000),
  recordRuns: process.env.RECORD === "1",
  rootDir,
  dataDir,
  runsDir: path.resolve(dataDir, "runs"),
  recordingsDir: path.resolve(dataDir, "recordings"),
  accessCodeFile: path.resolve(dataDir, "access-code.json"),
};
