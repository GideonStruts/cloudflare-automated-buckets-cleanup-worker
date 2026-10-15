import assert from "node:assert/strict";
import test from "node:test";

import { runCleanup } from "../src/cleanup.ts";
import type { Env } from "../src/env.ts";
import type { ObjectStore } from "../src/r2.ts";
import type { ListedObject } from "../src/s3xml.ts";

const ENV: Env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  RETENTION_DAYS: "7",
  DRY_RUN: "false",
};

const NOW = new Date("2026-10-15T00:00:00.000Z");

const OBJECTS: ListedObject[] = [
  { key: "postgres/app-2026-09-01.sql.gz", lastModified: "2026-09-01T00:00:00.000Z" },
  { key: "postgres/app-2026-10-01.sql.gz", lastModified: "2026-10-01T00:00:00.000Z" },
  { key: "postgres/billing-2026-08-01.sql.gz", lastModified: "2026-08-01T00:00:00.000Z" },
  { key: "assets/logo.png", lastModified: "2020-01-01T00:00:00.000Z" },
];

function store(deleted: string[]): ObjectStore {
  return {
    async listBuckets() {
      return ["db-backups"];
    },
    async listObjects() {
      return OBJECTS;
    },
    async deleteObjects(_jurisdiction, _bucket, keys) {
      deleted.push(...keys);
      return { deleted: keys.length, errors: [] };
    },
  };
}

test("batch delete skips the newest backup even when it is older than 7 days", async () => {
  const deleted: string[] = [];
  const summary = await runCleanup(ENV, { store: store(deleted), now: NOW });

  assert.deepEqual(deleted, ["postgres/app-2026-09-01.sql.gz"]);
  assert.equal(summary.backupsSeen, 3);
  assert.equal(summary.expired, 1);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.retainedLatest, 2);
  assert.equal(summary.dryRun, false);
});

test("dry run does not call delete", async () => {
  let deleted = false;
  const summary = await runCleanup(
    { ...ENV, DRY_RUN: "true" },
    {
      now: NOW,
      store: {
        async listBuckets() {
          return ["db-backups"];
        },
        async listObjects() {
          return OBJECTS;
        },
        async deleteObjects() {
          deleted = true;
          return { deleted: 0, errors: [] };
        },
      },
    },
  );

  assert.equal(deleted, false);
  assert.equal(summary.expired, 1);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.dryRun, true);
});

test("a delete error fails the run after the other keys were attempted", async () => {
  await assert.rejects(
    () =>
      runCleanup(ENV, {
        now: NOW,
        store: {
          async listBuckets() {
            return ["db-backups"];
          },
          async listObjects() {
            return OBJECTS;
          },
          async deleteObjects() {
            return { deleted: 0, errors: ["postgres/app-2026-09-01.sql.gz (InternalError: retry)"] };
          },
        },
      }),
    /failure/,
  );
});
