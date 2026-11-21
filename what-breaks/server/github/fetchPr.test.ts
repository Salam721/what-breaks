import test from "node:test";
import assert from "node:assert/strict";
import { parsePrUrl, estimateTokens, parseChangedFilesFromDiff, PrFetchError } from "./fetchPr.ts";

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
    "+++ b/src/app.ts",
    "diff --git a/README.md b/README.md",
  ].join("\n");
  assert.deepEqual(parseChangedFilesFromDiff(diff), ["src/app.ts", "README.md"]);
});
