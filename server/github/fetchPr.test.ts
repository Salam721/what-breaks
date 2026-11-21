import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  extractTarGzBuffer,
  parsePrUrl,
  estimateTokens,
  parseChangedFilesFromDiff,
  PrFetchError,
} from "./fetchPr.ts";

function buildTarEntry(name: string, content: string, typeflag = "0"): Buffer {
  const header = Buffer.alloc(512, 0);
  Buffer.from(name, "utf8").copy(header, 0, 0, 100);
  Buffer.from("0000644\0", "ascii").copy(header, 100);
  Buffer.from("0000000\0", "ascii").copy(header, 108);
  Buffer.from("0000000\0", "ascii").copy(header, 116);
  const data = Buffer.from(content, "utf8");
  const sizeOctal = data.length.toString(8).padStart(11, "0") + "\0";
  Buffer.from(sizeOctal, "ascii").copy(header, 124);
  Buffer.from("00000000000\0", "ascii").copy(header, 136);
  Buffer.from("        ", "ascii").copy(header, 148);
  header[156] = typeflag.charCodeAt(0);
  Buffer.from("ustar\0", "ascii").copy(header, 257);
  Buffer.from("00", "ascii").copy(header, 263);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ", "ascii").copy(header, 148);

  const paddedLen = Math.ceil(data.length / 512) * 512;
  const body = Buffer.alloc(paddedLen, 0);
  data.copy(body, 0);
  return Buffer.concat([header, body]);
}

test("parsePrUrl accepts valid GitHub PR URLs and canonicalizes", () => {
  const parsed = parsePrUrl("https://github.com/expressjs/express/pull/5931/files");
  assert.equal(parsed.owner, "expressjs");
  assert.equal(parsed.repo, "express");
  assert.equal(parsed.number, 5931);
  assert.equal(parsed.canonicalUrl, "https://github.com/expressjs/express/pull/5931");
});

test("parsePrUrl rejects non-GitHub or non-PR URLs", () => {
  assert.throws(() => parsePrUrl("not-a-url"), PrFetchError);
  assert.throws(() => parsePrUrl("https://gitlab.com/a/b/merge_requests/1"), PrFetchError);
  assert.throws(() => parsePrUrl("https://github.com/expressjs/express/issues/10"), PrFetchError);
  assert.throws(() => parsePrUrl("http://github.com/expressjs/express/pull/10"), PrFetchError);
});

test("estimateTokens and parseChangedFilesFromDiff work deterministically", () => {
  assert.ok(estimateTokens("x".repeat(320)) >= 100);
  const diff = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ a/src/app.ts",
    "diff --git a/README.md b/README.md",
  ].join("\n");
  assert.deepEqual(parseChangedFilesFromDiff(diff), ["src/app.ts", "README.md"]);
});

test("extractTarGzBuffer extracts GitHub archive safely without external binaries", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-tar-test-"));
  try {
    const paxHeader = buildTarEntry("pax_global_header", "52 comment=abc123\n", "g");
    const goodFile = buildTarEntry("owner-repo-123/src/index.ts", "export const ok = true;\n");
    const badTraversal = buildTarEntry("owner-repo-123/../../evil.txt", "nope");
    const endBlocks = Buffer.alloc(1024, 0);
    const gz = zlib.gzipSync(Buffer.concat([paxHeader, goodFile, badTraversal, endBlocks]));

    const count = extractTarGzBuffer(gz, tmpDir, true);
    assert.equal(count, 1);
    assert.equal(fs.readFileSync(path.join(tmpDir, "src/index.ts"), "utf8"), "export const ok = true;\n");
    assert.equal(fs.existsSync(path.join(tmpDir, "pax_global_header")), false);
    assert.equal(fs.existsSync(path.resolve(tmpDir, "../evil.txt")), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
