import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceManifest, sha256Buffer } from "./evidence.ts";

test("manifest hash changes when any evidence file hash changes", () => {
  const headSha = "a".repeat(40);
  const m1 = buildEvidenceManifest("run-1", headSha, [
    {
      predictionId: "p_1",
      attempt: 1,
      startedApp: true,
      files: [
        {
          path: "p_1-1/screenshot.png",
          kind: "screenshot",
          sha256: sha256Buffer("img-bytes-1"),
        },
        {
          path: "p_1-1/run.log",
          kind: "log",
          sha256: sha256Buffer("log-1"),
        },
      ],
    },
  ]);

  const m2 = buildEvidenceManifest("run-1", headSha, [
    {
      predictionId: "p_1",
      attempt: 1,
      startedApp: true,
      files: [
        {
          path: "p_1-1/screenshot.png",
          kind: "screenshot",
          sha256: sha256Buffer("img-bytes-2"),
        },
        {
          path: "p_1-1/run.log",
          kind: "log",
          sha256: sha256Buffer("log-1"),
        },
      ],
    },
  ]);

  assert.notEqual(m1.manifestSha256, m2.manifestSha256);
  assert.equal(m1.manifestSha256.length, 64);
});
