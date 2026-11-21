import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { MODELS, collectInteractionText, getAiClient } from "../server/models/gemini.ts";
import { sha256Buffer } from "../server/run/evidence.ts";

async function main(): Promise<void> {
  const ai = getAiClient();
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
        "Clone https://github.com/tastejs/todomvc.git (shallow depth=1).",
        "Start a simple HTTP static server serving examples/vanillajs (or any working example) on localhost.",
        "Use headless Chromium via Playwright in the shell to open the page, add a todo item 'Verify agent browser', take a screenshot at evidence/screenshot.png, and write logs to evidence/run.log.",
        "Confirm both evidence/screenshot.png and evidence/run.log exist in the workspace root.",
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

  for (const file of ["evidence/screenshot.png", "evidence/run.log"]) {
    try {
      const raw = await ai.environments.files.download({
        environment: interaction.environment_id,
        path: file,
      });
      const buf = Buffer.from(raw);
      const outPath = path.join(outDir, path.basename(file));
      fs.writeFileSync(outPath, buf);
      console.log(`[SAVED] ${outPath} (${buf.length} bytes) sha256=${sha256Buffer(buf)}`);
    } catch (err) {
      console.error(`[MISS] Could not download ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Smoke agent failed:", err);
  process.exit(1);
});
