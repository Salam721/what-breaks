import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

interface StoredAccessCode {
  salt: string;
  hash: string;
  claimedAt: string;
}

function getEnvAccessCode(): string {
  return (process.env.ACCESS_CODE ?? "").trim();
}

function readStoredAccessCode(): StoredAccessCode | null {
  try {
    if (!fs.existsSync(config.accessCodeFile)) return null;
    const raw = fs.readFileSync(config.accessCodeFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredAccessCode>;
    if (
      typeof parsed.salt === "string" &&
      typeof parsed.hash === "string" &&
      parsed.salt.length > 0 &&
      parsed.hash.length > 0
    ) {
      return {
        salt: parsed.salt,
        hash: parsed.hash,
        claimedAt: String(parsed.claimedAt ?? ""),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function isAccessCodeConfigured(): boolean {
  return getEnvAccessCode().length > 0 || readStoredAccessCode() !== null;
}

export function getAuthMode(): "env" | "claimed" | "unconfigured" {
  if (getEnvAccessCode().length > 0) return "env";
  if (readStoredAccessCode() !== null) return "claimed";
  return "unconfigured";
}

export function claimInitialAccessCode(code: string): {
  ok: true;
} | {
  ok: false;
  error: string;
  status: number;
} {
  if (getEnvAccessCode().length > 0) {
    return {
      ok: false,
      status: 409,
      error: "Access code is already configured by the server environment.",
    };
  }
  if (readStoredAccessCode() !== null) {
    return {
      ok: false,
      status: 409,
      error: "Access code has already been claimed.",
    };
  }
  const trimmed = code.trim();
  if (trimmed.length < 4 || trimmed.length > 128) {
    return {
      ok: false,
      status: 400,
      error: "Access code must be between 4 and 128 characters.",
    };
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(trimmed, salt, 64).toString("hex");
  fs.mkdirSync(path.dirname(config.accessCodeFile), { recursive: true });
  const payload: StoredAccessCode = {
    salt,
    hash: derived,
    claimedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(config.accessCodeFile, JSON.stringify(payload, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    return { ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return {
        ok: false,
        status: 409,
        error: "Access code has already been claimed.",
      };
    }
    throw err;
  }
}

export function verifyAccessCode(submitted: unknown): boolean {
  if (typeof submitted !== "string") return false;
  const candidate = submitted.trim();
  if (candidate.length === 0) return false;

  const envCode = getEnvAccessCode();
  if (envCode.length > 0) {
    const a = crypto.createHash("sha256").update(candidate, "utf8").digest();
    const b = crypto.createHash("sha256").update(envCode, "utf8").digest();
    return crypto.timingSafeEqual(a, b);
  }

  const stored = readStoredAccessCode();
  if (!stored) return false;

  const candidateHash = crypto.scryptSync(candidate, stored.salt, 64);
  const expectedHash = Buffer.from(stored.hash, "hex");
  if (candidateHash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}
