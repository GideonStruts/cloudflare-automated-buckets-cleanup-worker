import assert from "node:assert/strict";
import test from "node:test";

import { readConfig } from "../src/config.ts";
import type { Env } from "../src/env.ts";

const ENV: Env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
};

test("reads the retention defaults", () => {
  const config = readConfig(ENV);
  assert.equal(config.retentionDays, 7);
  assert.equal(config.dryRun, false);
  assert.deepEqual(config.jurisdictions, ["default"]);
  assert.equal(config.buckets, null);
  assert.ok(config.suffixes.includes(".sql.gz"));
});

test("parses overrides", () => {
  const config = readConfig({
    ...ENV,
    DRY_RUN: "true",
    RETENTION_DAYS: "14",
    JURISDICTIONS: "default, EU",
    BUCKETS: "db-backups, db-backups, archive",
    BACKUP_SUFFIXES: "sql, .DUMP.GZ",
  });
  assert.equal(config.dryRun, true);
  assert.equal(config.retentionDays, 14);
  assert.deepEqual(config.jurisdictions, ["default", "eu"]);
  assert.deepEqual(config.buckets, ["db-backups", "archive"]);
  assert.deepEqual(config.suffixes, [".sql", ".dump.gz"]);
});

test("rejects a url pasted as the account id", () => {
  assert.throws(
    () => readConfig({ ...ENV, CLOUDFLARE_ACCOUNT_ID: "https://example.r2.cloudflarestorage.com" }),
    /32-character account id/,
  );
});
