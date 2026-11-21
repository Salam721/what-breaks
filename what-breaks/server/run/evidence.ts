import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  Evidence,
  EvidenceFile,
  EvidenceManifest,
} from "../../shared/types.ts";
import { EvidenceManifestSchema } from "../../shared/types.ts";
import { config } from "../config.ts";

export function sha256Buffer(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return sha256Buffer(data);
}

export function getRunEvidenceDir(runId: string): string {
  const dir = path.resolve(config.runsDir, runId, "evidence");
  if (!dir.startsWith(config.runsDir + path.sep)) {
    throw new Error("Invalid run evidence directory");
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveConfinedEvidencePath(
  runId: string,
  relPath: string
): string {
  const base = getRunEvidenceDir(runId);
  const cleanRel = relPath.replace(/^\/+/, "");
  const resolved = path.resolve(base, cleanRel);
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error("Path escapes evidence directory");
  }
  return resolved;
}

export function writeEvidenceFile(
  runId: string,
  predictionId: string,
  attempt: number,
  filename: string,
  kind: "screenshot" | "log",
  content: Buffer | string
): EvidenceFile {
  const safeName = path.basename(filename);
  const relPath = `${predictionId}-${attempt}/${safeName}`;
  const fullPath = resolveConfinedEvidencePath(runId, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  fs.writeFileSync(fullPath, buf);
  return {
    path: relPath,
    kind,
    sha256: sha256Buffer(buf),
  };
}

export function buildEvidenceManifest(
  runId: string,
  headSha: string,
  evidences: Evidence[]
): EvidenceManifest {
  const entries = evidences.flatMap((ev) =>
    ev.files.map((f) => ({
      predictionId: ev.predictionId,
      attempt: ev.attempt,
      path: f.path,
      kind: f.kind,
      sha256: f.sha256,
    }))
  );

  entries.sort((a, b) => a.path.localeCompare(b.path));

  const createdAt = new Date().toISOString();
  const canonicalPayload = JSON.stringify({
    runId,
    headSha,
    files: entries,
  });
  const manifestSha256 = sha256Buffer(canonicalPayload);

  return EvidenceManifestSchema.parse({
    runId,
    headSha,
    createdAt,
    files: entries,
    manifestSha256,
  });
}
