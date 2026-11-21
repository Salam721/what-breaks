import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { MODELS, collectInteractionText, getAgentClient } from "../server/models/gemini.ts";
import { sha256Buffer } from "../server/run/evidence.ts";
import { downloadSandboxEvidenceFile } from "../server/verifier/agent.ts";

async function main(): Promise<void> {
  const ai = getAgentClient();
  const outDir = path.resolve(process.cwd(), "data/smoke");
  fs.mkdirSync(outDir, { recursive: true });

  const startedAt = Date.now();
  console.log("=== Smoke Test: Managed Agent Browser (antigravity-preview-09-2026) ===");

  const interaction = await ai.interactions.create(
    {
      agent: MODELS.agent,
      environment: "remote",
      agent_config: {
        type: "antigravity",
        model: MODELS.agentModel,
      },
      input: [
        "mkdir -p /workspace/evidence",
        "Clone https://github.com/tastejs/todomvc.git (shallow depth=1) into /workspace/todomvc.",
        "Start a simple HTTP static server serving examples/javascript-es5/dist (or any working example) on localhost.",
        "Use headless Chromium via Playwright in the shell to open the page, add a todo item 'Verify agent browser', take a screenshot at /workspace/evidence/screenshot.png, and write logs to /workspace/evidence/run.log.",
        "Confirm both /workspace/evidence/screenshot.png and /workspace/evidence/run.log exist.",
      ].join("\n"),
    },
    { timeout: 240_000 }
  );

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Agent completed in ${elapsedSec}s (env: ${interaction.environment_id})`);
  console.log("Agent summary:", collectInteractionText(interaction).slice(0, 600));

  if (!interaction.environment_id) {
    throw new Error("Agent returned no environment_id");
  }

  const listedPaths: string[] = [];
  for (const root of ["workspace", ""]) {
    try {
      const res = await ai.environments.files.list({
        environment: interaction.environment_id,
        path: root,
        recursive: true,
        api_version: "v1beta",
      });
      for (const f of res.files ?? []) {
        if (typeof f.path === "string" && f.path.length > 0) {
          listedPaths.push(f.path);
        }
      }
      if (listedPaths.length > 0) break;
    } catch {
      // Try next root
    }
  }
  console.log("Sandbox files sample:", listedPaths.filter((p) => p.includes("evidence")).slice(0, 10));

  for (const file of ["screenshot.png", "run.log"]) {
    const buf = await downloadSandboxEvidenceFile(
      ai,
      interaction.environment_id,
      listedPaths,
      file
    );
    if (buf) {
      const outPath = path.join(outDir, file);
      fs.writeFileSync(outPath, buf);
      console.log(`[SAVED] ${outPath} (${buf.length} bytes) sha256=${sha256Buffer(buf)}`);
    } else {
      console.error(`[MISS] Could not find or download ${file}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Smoke agent failed:", err);
  process.exit(1);
});
