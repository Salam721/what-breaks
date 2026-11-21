import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  MODELS,
  collectInteractionText,
  getAiClient,
  getDecisionsClient,
} from "../server/models/gemini.ts";

async function main(): Promise<void> {
  const ai = getAiClient();
  const decisionsAi = getDecisionsClient();

  console.log("=== Smoke Test: Models (Hydrogen, Carbon, Argon) ===");
  for (const [label, model] of [
    ["Hydrogen", MODELS.triage],
    ["Carbon", MODELS.carbon],
    ["Argon", MODELS.argon],
  ] as const) {
    try {
      const interaction = await ai.interactions.create({
        model,
        input: "Reply with exactly one word: ready.",
      });
      console.log(`[PASS] ${label} (${model}):`, collectInteractionText(interaction).trim());
    } catch (err) {
      console.error(`[FAIL] ${label} (${model}):`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\n=== Smoke Test: Decisions API with image block ===");
  // Use a real PNG from the workspace or pass a minimal 1x1 PNG if none saved yet
  const smokeImgPath = path.resolve(process.cwd(), "data/smoke/screenshot.png");
  let imgB64: string;
  if (fs.existsSync(smokeImgPath)) {
    imgB64 = fs.readFileSync(smokeImgPath).toString("base64");
  } else {
    // 1x1 transparent PNG bytes as fallback if smoke-agent hasn't run yet
    imgB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }

  const decisionRes = await decisionsAi.decisions.create({
    model: MODELS.decision,
    input: [
      { type: "text", text: "Claim: The page displays a fatal 500 error banner.\n" },
      {
        type: "image",
        data: imgB64,
        mime_type: "image/png",
        resolution: "low",
      },
    ],
    questions: {
      shows_error: {
        type: "noul",
        instructions: "Does the screenshot show a fatal 500 error banner?",
      },
    },
  });

  const ans = decisionRes.answers?.shows_error;
  console.log("[PASS] Decisions API:", ans);
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
