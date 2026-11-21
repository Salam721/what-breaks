import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { config } from "./server/config.ts";
import {
  claimInitialAccessCode,
  getAuthMode,
  isAccessCodeConfigured,
  verifyAccessCode,
} from "./server/auth.ts";
import { fetchPr, PrFetchError } from "./server/github/fetchPr.ts";
import { attachSseStream, RunEventBus } from "./server/run/events.ts";
import { resolveConfinedEvidencePath } from "./server/run/evidence.ts";
import { executeRun, type RunState } from "./server/run/orchestrator.ts";
import {
  listRecordings,
  loadRecordingEvents,
  resolveRecordingEvidencePath,
} from "./server/run/recording.ts";

const activeRuns = new Map<string, RunState>();

async function startServer(): Promise<void> {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  // Health check (R15 / T4)
  app.get("/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // Auth status & first-run claim when ACCESS_CODE env is not yet set
  app.get("/api/auth/status", (_req, res) => {
    res.json({
      configured: isAccessCodeConfigured(),
      mode: getAuthMode(),
    });
  });

  app.post("/api/auth/setup", (req, res) => {
    const code = typeof req.body?.accessCode === "string" ? req.body.accessCode : "";
    const result = claimInitialAccessCode(code);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true, mode: getAuthMode() });
  });

  // Start a PR verification run (R1, R11)
  app.post("/api/runs", async (req, res) => {
    const prUrl = typeof req.body?.prUrl === "string" ? req.body.prUrl.trim() : "";
    const accessCode =
      typeof req.body?.accessCode === "string" ? req.body.accessCode : "";

    if (!isAccessCodeConfigured()) {
      res.status(403).json({
        error:
          "Server access code is not configured yet. Set an access code first.",
      });
      return;
    }

    if (!verifyAccessCode(accessCode)) {
      res.status(401).json({
        error: "Missing or invalid access code.",
      });
      return;
    }

    if (!prUrl) {
      res.status(400).json({
        error: "Please enter a public GitHub PR URL.",
      });
      return;
    }

    const runId = crypto.randomUUID();
    try {
      const ctx = await fetchPr(prUrl, runId);
      const bus = new RunEventBus(runId);
      const state: RunState = {
        runId,
        bus,
        status: "running",
        report: null,
      };
      activeRuns.set(runId, state);

      // Kick off orchestrator asynchronously; progress streams over SSE
      executeRun(runId, ctx, bus)
        .then((report) => {
          state.report = report;
          state.status = report ? "completed" : "failed";
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          state.status = "failed";
          state.error = message;
          bus.emit("run.failed", { error: message });
        });

      res.status(201).json({
        runId,
        pr: ctx.pr,
      });
    } catch (err) {
      // Clean up any partial workspace if PR validation/fetch failed
      const partialDir = path.resolve(config.runsDir, runId);
      if (partialDir.startsWith(config.runsDir + path.sep)) {
        fs.rmSync(partialDir, { recursive: true, force: true });
      }
      if (err instanceof PrFetchError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to inspect PR.";
      res.status(500).json({ error: message });
    }
  });

  // Run snapshot (for direct fetch or recovery)
  app.get("/api/runs/:id", (req, res) => {
    const run = activeRuns.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    res.json({
      runId: run.runId,
      status: run.status,
      report: run.report,
      error: run.error,
      events: run.bus.getAllEvents(),
    });
  });

  // SSE stream with Last-Event-ID replay and 15s heartbeat (R10)
  app.get("/api/runs/:id/events", (req, res) => {
    const run = activeRuns.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    const lastEventId = req.header("Last-Event-ID") ?? undefined;
    attachSseStream(run.bus, res, lastEventId);
  });

  // Confined evidence file serving for active runs
  app.get("/api/runs/:id/evidence/*", (req, res) => {
    try {
      const rel = String((req.params as Record<string, string>)[0] ?? "");
      const filePath = resolveConfinedEvidencePath(req.params.id, rel);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "Evidence file not found." });
        return;
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.sendFile(filePath);
    } catch {
      res.status(400).json({ error: "Invalid evidence path." });
    }
  });

  // Replay endpoints (real recordings only, R14)
  app.get("/api/recordings", (_req, res) => {
    res.json({ recordings: listRecordings() });
  });

  app.get("/api/recordings/:name", (req, res) => {
    try {
      const events = loadRecordingEvents(req.params.name);
      res.json({ name: req.params.name, events });
    } catch {
      res.status(404).json({ error: "Recording not found." });
    }
  });

  app.get("/api/recordings/:name/evidence/*", (req, res) => {
    try {
      const rel = String((req.params as Record<string, string>)[0] ?? "");
      const filePath = resolveRecordingEvidencePath(req.params.name, rel);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "Recorded evidence file not found." });
        return;
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.sendFile(filePath);
    } catch {
      res.status(400).json({ error: "Invalid recorded evidence path." });
    }
  });

  // Evaluation benchmark data (real PRs, pre-written labels, and real eval results if run)
  app.get("/api/eval", (_req, res) => {
    const prsPath = path.resolve(config.rootDir, "eval/prs.json");
    const labelsPath = path.resolve(config.rootDir, "eval/labels.json");
    const summaryPath = path.resolve(config.rootDir, "eval/results/summary.json");

    const prs = fs.existsSync(prsPath)
      ? JSON.parse(fs.readFileSync(prsPath, "utf8"))
      : [];
    const labels = fs.existsSync(labelsPath)
      ? JSON.parse(fs.readFileSync(labelsPath, "utf8"))
      : {};
    const summary = fs.existsSync(summaryPath)
      ? JSON.parse(fs.readFileSync(summaryPath, "utf8"))
      : null;

    res.json({ prs, labels, summary });
  });

  app.get("/what-breaks.tar.gz", (_req, res) => {
    const archivePath = path.resolve(config.rootDir, "public/what-breaks.tar.gz");
    if (!fs.existsSync(archivePath)) {
      res.status(404).json({ error: "Export archive not found." });
      return;
    }
    res.download(archivePath, "what-breaks.tar.gz");
  });

  if (process.env.NODE_ENV === "production") {
    const distDir = path.resolve(config.rootDir, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
