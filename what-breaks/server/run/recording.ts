import fs from "node:fs";
import path from "node:path";
import type { Report, RunEvent } from "../../shared/types.ts";
import { RunEventSchema } from "../../shared/types.ts";
import { config } from "../config.ts";

export interface RecordingSummary {
  name: string;
  prTitle?: string;
  prUrl?: string;
  headSha?: string;
  eventCount: number;
  createdAt?: string;
}

export function saveRealRunRecording(
  runId: string,
  name: string,
  report: Report | null
): string {
  const safeName = name.replace(/[^A-Za-z0-9_.-]/g, "-");
  const targetDir = path.resolve(config.recordingsDir, safeName);
  if (!targetDir.startsWith(config.recordingsDir + path.sep)) {
    throw new Error("Invalid recording directory");
  }
  const sourceDir = path.resolve(config.runsDir, runId);
  fs.mkdirSync(targetDir, { recursive: true });

  const eventsSrc = path.join(sourceDir, "events.jsonl");
  if (fs.existsSync(eventsSrc)) {
    fs.copyFileSync(eventsSrc, path.join(targetDir, "events.jsonl"));
  }

  const evidenceSrc = path.join(sourceDir, "evidence");
  if (fs.existsSync(evidenceSrc)) {
    fs.cpSync(evidenceSrc, path.join(targetDir, "evidence"), {
      recursive: true,
      force: true,
    });
  }

  if (report) {
    fs.writeFileSync(
      path.join(targetDir, "report.json"),
      JSON.stringify(report, null, 2),
      "utf8"
    );
  }

  return targetDir;
}

export function listRecordings(): RecordingSummary[] {
  if (!fs.existsSync(config.recordingsDir)) {
    return [];
  }

  const entries = fs.readdirSync(config.recordingsDir, { withFileTypes: true });
  const summaries: RecordingSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(config.recordingsDir, entry.name);
    const eventsFile = path.join(dir, "events.jsonl");
    if (!fs.existsSync(eventsFile)) continue;

    const events = loadRecordingEvents(entry.name);
    const reportPath = path.join(dir, "report.json");
    let prTitle: string | undefined;
    let prUrl: string | undefined;
    let headSha: string | undefined;
    if (fs.existsSync(reportPath)) {
      try {
        const rep = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Report;
        prTitle = rep.pr?.title;
        prUrl = rep.pr?.url;
        headSha = rep.pr?.headSha;
      } catch {
        // Ignore invalid report metadata
      }
    }

    summaries.push({
      name: entry.name,
      prTitle,
      prUrl,
      headSha,
      eventCount: events.length,
      createdAt: events[0]?.ts,
    });
  }

  return summaries;
}

export function loadRecordingEvents(name: string): RunEvent[] {
  const safeName = path.basename(name);
  const eventsFile = path.resolve(config.recordingsDir, safeName, "events.jsonl");
  if (!eventsFile.startsWith(config.recordingsDir + path.sep)) {
    throw new Error("Invalid recording name");
  }
  if (!fs.existsSync(eventsFile)) {
    throw new Error(`Recording '${safeName}' not found`);
  }

  const lines = fs
    .readFileSync(eventsFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => RunEventSchema.parse(JSON.parse(line)));
}

export function resolveRecordingEvidencePath(
  name: string,
  relPath: string
): string {
  const safeName = path.basename(name);
  const evidenceRoot = path.resolve(config.recordingsDir, safeName, "evidence");
  const resolved = path.resolve(evidenceRoot, relPath.replace(/^\/+/, ""));
  if (!resolved.startsWith(evidenceRoot + path.sep)) {
    throw new Error("Path escapes recording evidence directory");
  }
  return resolved;
}
