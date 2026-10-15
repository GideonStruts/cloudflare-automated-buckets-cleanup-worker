# Automated bucket cleanups

Cloudflare Worker that runs every midnight UTC, finds database backup objects in R2, and deletes the ones that are past the retention window. The newest backup in each series is always kept, including when backups stop arriving and that newest file is already older than 7 days.

The schedule is `0 0 * * *`. Cloudflare cron triggers use UTC, so this is 00:00 UTC (03:00 in UTC+3). Change the expression in `wrangler.jsonc` if you want a different local midnight. For midnight in UTC+3, use `0 21 * * *`.

## Retention

An object is a backup when its name ends with a configured suffix (`.sql`, `.sql.gz`, `.dump`, `.backup`, `.bak`, `.rdb`, and the compressed variants in `wrangler.jsonc`). Other objects are left alone. Age comes from the R2 `LastModified` timestamp, which is when the object was uploaded.

Backups that belong to the same database are one series. The series is the bucket, plus the folder path, plus the file name, after dates and times have been removed. These are one series:

- `postgres/app-2026-10-01.sql.gz`
- `postgres/app-2026-10-14T030000.sql.gz`
- `2026/10/01/app.sql.gz` and `2026/10/08/app.sql.gz`
- `dumps/2026-10-01/app.sql` and `dumps/2026-10-02/app.sql`

These stay separate, so a new backup of one database cannot make another database's only copy eligible for deletion:

- a different folder or database name (`mysql/app-….sql.gz`, `postgres/billing-….sql.gz`)
- a different bucket
- a non-date folder such as `pg/16/` versus `pg/17/`

For each series the worker keeps:

- every backup newer than the retention window (7 days by default; a file uploaded exactly 7 days ago is kept)
- the newest backup, even when that file is older than 7 days

Everything else in the series that is older than 7 days is deleted. When two objects share the newest timestamp, both are kept. Deletion uses the S3 `DeleteObjects` call, in batches of up to 1000 keys.

Example on 15 October 2026, with a 7-day window:

| Object | Last modified | Result |
| --- | --- | --- |
| `postgres/app-2026-09-01.sql.gz` | 1 September | Deleted. A newer `app` backup exists. |
| `postgres/app-2026-10-01.sql.gz` | 1 October | Kept. Newest `app` backup, even though it is past 7 days. |
| `postgres/billing-2026-08-01.sql.gz` | 1 August | Kept. It is the only `billing` backup. |
| `assets/logo.png` | any | Kept. Not a backup file. |

`LastModified` decides which copy is newest. The dates in the path are only used to tell series apart. A file named with an old date but uploaded today is a new object.

Year folders (`2026/10/01`) and `YYYY-MM-DD` folders are treated as dates. A folder that is only a year, such as `2026`, is also treated as a date. Version folders such as `pg/16` are not.

## Setup

The worker lists every bucket through the R2 S3 API, so buckets created later are included without a new binding. Create an R2 API token with **Admin Read & Write** on all buckets (this includes listing buckets, listing objects, and deleting objects). Copy the Access Key ID, Secret Access Key, and Account ID from the token confirmation page.

```bash
npm install
npx wrangler login
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Put the same three values in `.dev.vars` for local runs. `.dev.vars.example` shows the names. `.dev.vars` is gitignored.

For a first look at the delete plan without deleting anything, set `DRY_RUN` to `"true"` in `wrangler.jsonc`, deploy, and read the logs. Set it back to `"false"` and deploy again when the plan looks right. A local dry run:

```bash
cp .dev.vars.example .dev.vars
# fill in the three secrets and set DRY_RUN=true
npm run dev
curl http://localhost:8787/cdn-cgi/local/scheduled
```

`wrangler dev` calls the live R2 API. It does not use a local copy of the buckets.

Deploy the cron worker with:

```bash
npm run deploy
```

Watch a midnight run, or a manual local trigger, with `npx wrangler tail`. Each kept latest file is logged as `latest_backup_retained`. Each deletion is logged as `expired_backup_delete`. A failed list or delete fails the cron invocation after the worker has finished the buckets it could. Deletes are idempotent, and the newest file in a series is never in the delete set.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RETENTION_DAYS` | `7` | Delete backups strictly older than this many days. |
| `DRY_RUN` | `false` | `true` logs the delete plan and does not call delete. |
| `JURISDICTIONS` | `default` | Comma-separated R2 jurisdictions: `default`, `eu`, `fedramp`. |
| `BUCKETS` | all buckets | Optional comma-separated allowlist. |
| `BACKUP_SUFFIXES` | see `wrangler.jsonc` | Comma-separated suffixes. Replaces the default list. |
| `CLOUDFLARE_ACCOUNT_ID` | secret | 32-character account id. |
| `R2_ACCESS_KEY_ID` | secret | R2 API token access key. |
| `R2_SECRET_ACCESS_KEY` | secret | R2 API token secret. |

`BUCKETS` and `BACKUP_SUFFIXES` are vars. Add them to `wrangler.jsonc` and redeploy. Non-default jurisdictions use a different endpoint (`<account id>.eu.r2.cloudflarestorage.com`). The token has to cover those jurisdictions too.

Live database files such as `.sqlite` and `.db` are not in the default suffix list. Add a suffix only when those names are real backup objects.

If a bucket has [object versioning](https://developers.cloudflare.com/r2/buckets/object-versioning/) enabled, this worker deletes the current object key. Noncurrent versions remain until a lifecycle rule removes them.

## Develop

```bash
npm test
npm run check
```
