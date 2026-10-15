import { readConfig } from "./config.ts";
import type { Env } from "./env.ts";
import { R2Account, type ObjectStore } from "./r2.ts";
import { isBackupKey, planRetention, type BackupObject } from "./retention.ts";
import type { ListedObject } from "./s3xml.ts";

export interface CleanupSummary {
  bucketsScanned: number;
  backupsSeen: number;
  kept: number;
  expired: number;
  deleted: number;
  retainedLatest: number;
  dryRun: boolean;
  retentionDays: number;
}

export async function runCleanup(
  env: Env,
  options: { store?: ObjectStore; now?: Date } = {},
): Promise<CleanupSummary> {
  const config = readConfig(env);
  const now = options.now ?? new Date();
  const store =
    options.store ?? new R2Account(config.accountId, config.accessKeyId, config.secretAccessKey);
  const failures: string[] = [];
  const backups: BackupObject[] = [];
  const listedBuckets = new Set<string>();
  let listedAny = false;
  let bucketsScanned = 0;

  for (const jurisdiction of config.jurisdictions) {
    let names: string[];
    try {
      names = await store.listBuckets(jurisdiction);
      listedAny = true;
    } catch (error) {
      failures.push(`list buckets (${jurisdiction}): ${errorMessage(error)}`);
      continue;
    }

    for (const name of names) listedBuckets.add(name);
    const selected = config.buckets ? names.filter((name) => config.buckets?.includes(name)) : names;
    log("buckets_listed", { jurisdiction, buckets: selected });

    for (const bucket of selected) {
      bucketsScanned++;
      try {
        const objects = await store.listObjects(jurisdiction, bucket);
        backups.push(...backupObjects(jurisdiction, bucket, objects, config.suffixes));
      } catch (error) {
        failures.push(`list objects (${jurisdiction}/${bucket}): ${errorMessage(error)}`);
      }
    }
  }

  if (config.buckets && listedAny) {
    for (const bucket of config.buckets) {
      if (!listedBuckets.has(bucket)) {
        failures.push(
          `bucket "${bucket}" was not found in ${config.jurisdictions.join(", ")}`,
        );
      }
    }
  }

  const plan = planRetention(backups, now, config.retentionDays, config.suffixes);

  for (const object of plan.retainedLatest) {
    log("latest_backup_retained", {
      jurisdiction: object.jurisdiction,
      bucket: object.bucket,
      key: object.key,
      lastModified: object.lastModified.toISOString(),
      ageDays: ageDays(object.lastModified, now),
    });
  }

  for (const object of plan.remove) {
    log(config.dryRun ? "expired_backup_would_delete" : "expired_backup_delete", {
      jurisdiction: object.jurisdiction,
      bucket: object.bucket,
      key: object.key,
      lastModified: object.lastModified.toISOString(),
    });
  }

  let deleted = 0;
  if (!config.dryRun) {
    for (const group of groupByBucket(plan.remove)) {
      const result = await store.deleteObjects(group.jurisdiction, group.bucket, group.keys);
      deleted += result.deleted;
      if (result.errors.length > 0) {
        log("delete_failed", {
          jurisdiction: group.jurisdiction,
          bucket: group.bucket,
          errors: result.errors,
        });
        failures.push(
          `delete ${group.jurisdiction}/${group.bucket}: ${result.errors.length} error(s)`,
        );
      }
    }
  }

  const summary: CleanupSummary = {
    bucketsScanned,
    backupsSeen: backups.length,
    kept: plan.keep.length,
    expired: plan.remove.length,
    deleted,
    retainedLatest: plan.retainedLatest.length,
    dryRun: config.dryRun,
    retentionDays: config.retentionDays,
  };
  log("cleanup_complete", { ...summary, failures });

  if (failures.length > 0) {
    throw new Error(
      `Backup cleanup finished with ${failures.length} failure(s): ${failures.join("; ")}`,
    );
  }

  return summary;
}

function backupObjects(
  jurisdiction: string,
  bucket: string,
  objects: readonly ListedObject[],
  suffixes: readonly string[],
): BackupObject[] {
  const backups: BackupObject[] = [];
  for (const object of objects) {
    if (!isBackupKey(object.key, suffixes)) continue;
    const lastModified = new Date(object.lastModified);
    if (Number.isNaN(lastModified.getTime())) {
      log("skip_unparsed_timestamp", {
        jurisdiction,
        bucket,
        key: object.key,
        lastModified: object.lastModified,
      });
      continue;
    }
    backups.push({ jurisdiction, bucket, key: object.key, lastModified });
  }
  return backups;
}

function groupByBucket(objects: readonly BackupObject[]): {
  jurisdiction: string;
  bucket: string;
  keys: string[];
}[] {
  const groups = new Map<string, { jurisdiction: string; bucket: string; keys: string[] }>();
  for (const object of objects) {
    const id = `${object.jurisdiction}\0${object.bucket}`;
    const group = groups.get(id);
    if (group) group.keys.push(object.key);
    else groups.set(id, { jurisdiction: object.jurisdiction, bucket: object.bucket, keys: [object.key] });
  }
  for (const group of groups.values()) group.keys.sort();
  return [...groups.values()];
}

function ageDays(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}
