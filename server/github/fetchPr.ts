import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PrContext, PrRef } from "../../shared/types.ts";
import { PrRefSchema } from "../../shared/types.ts";
import { config } from "../config.ts";

const execFileAsync = promisify(execFile);

export interface ParsedPrUrl {
  owner: string;
  repo: string;
  number: number;
  canonicalUrl: string;
}

export class PrFetchError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "PrFetchError";
    this.statusCode = statusCode;
  }
}

export function parsePrUrl(rawUrl: string): ParsedPrUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new PrFetchError(
      "Please enter a valid GitHub PR URL (for example, https://github.com/owner/repo/pull/123).",
      400
    );
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new PrFetchError(
      "URL must be a public https://github.com/<owner>/<repo>/pull/<number> link.",
      400
    );
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 4 || segments[2] !== "pull") {
    throw new PrFetchError(
      "URL must point to a GitHub pull request (https://github.com/<owner>/<repo>/pull/<number>).",
      400
    );
  }

  const [owner, repo, , numberRaw] = segments;
  if (
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repo) ||
    !/^\d+$/.test(numberRaw)
  ) {
    throw new PrFetchError(
      "Invalid GitHub owner, repository, or pull request number.",
      400
    );
  }

  const number = Number.parseInt(numberRaw, 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new PrFetchError("Pull request number must be a positive integer.", 400);
  }

  return {
    owner,
    repo,
    number,
    canonicalUrl: `https://github.com/${owner}/${repo}/pull/${number}`,
  };
}

export function estimateTokens(text: string): number {
  // Conservative estimate: ~3.2 chars/token to protect the 262,144 Decisions API ceiling
  return Math.ceil(text.length / 3.2);
}

export function parseChangedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match && match[2]) {
        files.add(match[2]);
      }
    }
  }
  return Array.from(files);
}

interface GitHubPrApiPayload {
  number?: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  head?: {
    sha?: string;
  };
  base?: {
    sha?: string;
    repo?: {
      private?: boolean;
      clone_url?: string;
    };
  };
}

function githubHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "what-breaks-verifier/1.0",
  };
  const token = (process.env.GITHUB_TOKEN ?? "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJsonFromGitHub(url: string): Promise<GitHubPrApiPayload> {
  const res = await fetch(url, {
    headers: githubHeaders("application/vnd.github+json"),
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 404 || res.status === 401 || res.status === 403) {
    let message =
      "Repository or pull request not found or private. Only public GitHub PRs are supported.";
    if (res.status === 403) {
      const rateRemaining = res.headers.get("x-ratelimit-remaining");
      if (rateRemaining === "0") {
        message =
          "GitHub public API rate limit reached. Try again shortly or configure GITHUB_TOKEN.";
      }
    }
    throw new PrFetchError(message, 404);
  }

  if (!res.ok) {
    throw new PrFetchError(
      `GitHub API returned HTTP ${res.status} while reading PR metadata.`,
      502
    );
  }

  return (await res.json()) as GitHubPrApiPayload;
}

async function fetchDiffFromGitHub(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: githubHeaders("application/vnd.github.v3.diff"),
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new PrFetchError(
      "Could not fetch PR diff (repository may be private or not found).",
      404
    );
  }

  if (!res.ok) {
    throw new PrFetchError(
      `GitHub API returned HTTP ${res.status} while fetching PR diff.`,
      502
    );
  }

  return await res.text();
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

export async function fetchPr(
  rawUrl: string,
  runId = `check-${Date.now()}`
): Promise<PrContext> {
  const parsed = parsePrUrl(rawUrl);
  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`;

  const meta = await fetchJsonFromGitHub(apiUrl);
  if (meta.base?.repo?.private) {
    throw new PrFetchError(
      "Repository is private. Only public GitHub PRs are supported.",
      403
    );
  }

  const headSha = meta.head?.sha ?? "";
  const baseSha = meta.base?.sha ?? "";
  const cloneUrl =
    meta.base?.repo?.clone_url ??
    `https://github.com/${parsed.owner}/${parsed.repo}.git`;

  if (!/^[0-9a-fA-F]{40}$/.test(headSha) || !/^[0-9a-fA-F]{40}$/.test(baseSha)) {
    throw new PrFetchError(
      "GitHub PR metadata did not include valid base/head commit SHAs.",
      502
    );
  }

  const pr: PrRef = PrRefSchema.parse({
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    headSha,
    baseSha,
    title: meta.title ?? `PR #${parsed.number}`,
    url: meta.html_url ?? parsed.canonicalUrl,
  });

  const diff = await fetchDiffFromGitHub(apiUrl);
  const diffTokens = estimateTokens(diff);
  const decisionsLimit = 262_144;
  if (diffTokens > config.maxDiffTokens) {
    throw new PrFetchError(
      `PR diff is too large (~${diffTokens.toLocaleString()} estimated tokens) to fit within the Decisions API ${decisionsLimit.toLocaleString()}-token input limit alongside predictions.`,
      413
    );
  }

  const runRoot = path.resolve(config.runsDir, runId);
  if (!runRoot.startsWith(config.runsDir + path.sep)) {
    throw new PrFetchError("Invalid run workspace path.", 400);
  }
  const baseDir = path.resolve(runRoot, "repo-base");
  const headDir = path.resolve(runRoot, "repo-head");
  fs.mkdirSync(runRoot, { recursive: true });

  // Shallow clone base repo, then fetch baseSha and PR head into isolated directories
  await runGit([
    "clone",
    "--filter=blob:none",
    "--depth=1",
    cloneUrl,
    headDir,
  ]);
  await runGit(
    ["fetch", "--depth=1", "origin", `pull/${pr.number}/head:pr-head`],
    headDir
  );
  await runGit(["checkout", "pr-head"], headDir);

  // Verify the checked-out commit matches the pinned headSha when possible; if GitHub updated ref concurrently, fetch exact SHA
  const checkedOutSha = (await runGit(["rev-parse", "HEAD"], headDir)).trim();
  if (checkedOutSha !== pr.headSha) {
    try {
      await runGit(["fetch", "--depth=1", "origin", pr.headSha], headDir);
      await runGit(["checkout", pr.headSha], headDir);
    } catch {
      // Keep pr-head if GitHub doesn't expose unreferenced commit directly
    }
  }

  await runGit([
    "clone",
    "--filter=blob:none",
    "--depth=1",
    cloneUrl,
    baseDir,
  ]);
  try {
    await runGit(["fetch", "--depth=1", "origin", pr.baseSha], baseDir);
    await runGit(["checkout", pr.baseSha], baseDir);
  } catch {
    // Default branch checkout already serves as base fallback if exact baseSha isn't fetchable shallowly
  }

  const changedFiles = parseChangedFilesFromDiff(diff);

  return {
    pr,
    prBody: meta.body ?? "",
    cloneUrl,
    diff,
    baseDir,
    headDir,
    changedFiles,
  };
}
