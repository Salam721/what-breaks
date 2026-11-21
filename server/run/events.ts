import type { Response } from "express";
import fs from "node:fs";
import path from "node:path";
import type { RunEvent, RunEventType } from "../../shared/types.ts";
import { RunEventSchema } from "../../shared/types.ts";
import { config } from "../config.ts";

export class RunEventBus {
  readonly runId: string;
  private seq = 0;
  private events: RunEvent[] = [];
  private listeners = new Set<(ev: RunEvent) => void>();
  private readonly logPath: string;

  constructor(runId: string) {
    this.runId = runId;
    const runDir = path.resolve(config.runsDir, runId);
    if (!runDir.startsWith(config.runsDir + path.sep)) {
      throw new Error("Invalid runId for event log");
    }
    fs.mkdirSync(runDir, { recursive: true });
    this.logPath = path.join(runDir, "events.jsonl");
  }

  emit(type: RunEventType, data: Record<string, unknown> = {}): RunEvent {
    this.seq += 1;
    const ev = RunEventSchema.parse({
      runId: this.runId,
      seq: this.seq,
      ts: new Date().toISOString(),
      type,
      data,
    });
    this.events.push(ev);
    fs.appendFileSync(this.logPath, JSON.stringify(ev) + "\n", "utf8");
    for (const listener of this.listeners) {
      try {
        listener(ev);
      } catch {
        // Listener errors must not break event emission
      }
    }
    return ev;
  }

  getEventsSince(afterSeq = 0): RunEvent[] {
    return this.events.filter((e) => e.seq > afterSeq);
  }

  getAllEvents(): RunEvent[] {
    return [...this.events];
  }

  getLogPath(): string {
    return this.logPath;
  }

  subscribe(listener: (ev: RunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function attachSseStream(
  bus: RunEventBus,
  res: Response,
  lastEventIdHeader?: string
): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const parsedLastId = lastEventIdHeader
    ? Number.parseInt(lastEventIdHeader, 10)
    : 0;
  const afterSeq = Number.isFinite(parsedLastId) && parsedLastId > 0 ? parsedLastId : 0;

  const sendEvent = (ev: RunEvent) => {
    res.write(`id: ${ev.seq}\n`);
    res.write(`event: ${ev.type}\n`);
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };

  for (const ev of bus.getEventsSince(afterSeq)) {
    sendEvent(ev);
  }

  const unsubscribe = bus.subscribe((ev) => {
    if (ev.seq > afterSeq) {
      sendEvent(ev);
    }
  });

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15_000);

  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
