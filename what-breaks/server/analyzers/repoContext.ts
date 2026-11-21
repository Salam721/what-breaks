import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".venv",
  "venv",
]);

export function listRepoFiles(rootDir: string, maxFiles = 350): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(path.relative(rootDir, fullPath));
      }
    }
  }
  walk(rootDir);
  return results;
}

export function readConfinedFile(
  rootDir: string,
  relPath: string,
  maxBytes = 18_000
): string | null {
  const base = path.resolve(rootDir);
  const resolved = path.resolve(base, relPath);
  if (!resolved.startsWith(base + path.sep)) {
    return null;
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 250_000) return null;
    const raw = fs.readFileSync(resolved, "utf8");
    return raw.length > maxBytes ? raw.slice(0, maxBytes) + "\n...[truncated]" : raw;
  } catch {
    return null;
  }
}

export function gatherReadOnlyFiles(
  rootDir: string,
  candidatePaths: string[],
  maxTotalChars = 80_000
): Array<{ path: string; content: string }> {
  const seen = new Set<string>();
  const collected: Array<{ path: string; content: string }> = [];
  let totalChars = 0;

  const priorityFiles = [
    ...candidatePaths,
    "package.json",
    "README.md",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
  ];

  for (const rel of priorityFiles) {
    const clean = rel.replace(/^\/+/, "");
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    const content = readConfinedFile(rootDir, clean);
    if (content === null) continue;
    if (totalChars + content.length > maxTotalChars) break;
    collected.push({ path: clean, content });
    totalChars += content.length;
  }

  return collected;
}
