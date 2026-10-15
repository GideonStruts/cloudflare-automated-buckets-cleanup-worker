import type { Env } from "./env.ts";

export const DEFAULT_BACKUP_SUFFIXES = [
  ".sql",
  ".sql.gz",
  ".sql.bz2",
  ".sql.xz",
  ".sql.zip",
  ".sql.zst",
  ".dump",
  ".dump.gz",
  ".dump.bz2",
  ".backup",
  ".bak",
  ".rdb",
] as const;

const SUPPORTED_JURISDICTIONS = new Set(["default", "eu", "fedramp"]);

export interface CleanupConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  retentionDays: number;
  dryRun: boolean;
  jurisdictions: string[];
  suffixes: string[];
  /** Null scans every bucket returned by ListBuckets. */
  buckets: string[] | null;
}

export function readConfig(env: Env): CleanupConfig {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID", env.CLOUDFLARE_ACCOUNT_ID);
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID should be the 32-character account id, not the R2 endpoint URL.",
    );
  }

  const jurisdictions = parseList(env.JURISDICTIONS, ["default"]).map((item) => item.toLowerCase());
  for (const jurisdiction of jurisdictions) {
    if (!SUPPORTED_JURISDICTIONS.has(jurisdiction)) {
      throw new Error(
        `Unsupported JURISDICTIONS value "${jurisdiction}". Use default, eu, or fedramp.`,
      );
    }
  }

  return {
    accountId,
    accessKeyId: required("R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY", env.R2_SECRET_ACCESS_KEY),
    retentionDays: parseRetentionDays(env.RETENTION_DAYS),
    dryRun: parseBool("DRY_RUN", env.DRY_RUN, false),
    jurisdictions,
    suffixes: parseList(env.BACKUP_SUFFIXES, [...DEFAULT_BACKUP_SUFFIXES]).map((suffix) =>
      normalizeSuffix(suffix.toLowerCase()),
    ),
    buckets: env.BUCKETS?.trim() ? parseList(env.BUCKETS, []) : null,
  };
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new Error(`Missing ${name}.`);
  return trimmed;
}

function parseRetentionDays(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 7;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("RETENTION_DAYS must be a whole number of days, 0 or greater.");
  }
  return parsed;
}

function parseBool(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${name} must be true or false.`);
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === "") return fallback;
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
}

function normalizeSuffix(suffix: string): string {
  return suffix.startsWith(".") ? suffix : `.${suffix}`;
}
