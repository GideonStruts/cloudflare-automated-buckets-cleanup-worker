import assert from "node:assert/strict";
import test from "node:test";

import { buildDeleteXml, parseBuckets, parseDeleteResult, parseListObjects } from "../src/s3xml.ts";

test("parses bucket names without reading the owner display name", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult>
  <Owner><DisplayName>owner</DisplayName></Owner>
  <Buckets>
    <Bucket><Name>db-backups</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket>
    <Bucket><Name>archive</Name><CreationDate>2026-01-02T00:00:00.000Z</CreationDate></Bucket>
  </Buckets>
  <IsTruncated>false</IsTruncated>
</ListAllMyBucketsResult>`;

  assert.deepEqual(parseBuckets(xml).names, ["db-backups", "archive"]);
  assert.equal(parseBuckets(xml).nextToken, undefined);
});

test("follows a list-objects continuation token and decodes keys", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <EncodingType>url</EncodingType>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>abc%2Fdef</NextContinuationToken>
  <Contents>
    <Key>postgres/my%20db-2026-10-01.sql.gz</Key>
    <LastModified>2026-10-01T03:00:00.000Z</LastModified>
  </Contents>
  <Contents>
    <Key>assets/logo.png</Key>
    <LastModified> 2026-05-07T21:37:17.150Z</LastModified>
  </Contents>
</ListBucketResult>`;

  const page = parseListObjects(xml);
  assert.equal(page.objects[0]?.key, "postgres/my db-2026-10-01.sql.gz");
  assert.equal(page.objects[0]?.lastModified, "2026-10-01T03:00:00.000Z");
  assert.equal(page.objects[1]?.key, "assets/logo.png");
  assert.equal(page.nextToken, "abc/def");
});

test("decodes xml escapes when list encoding is not url", () => {
  const xml = `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>a&amp;b.sql</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`;
  assert.equal(parseListObjects(xml).objects[0]?.key, "a&b.sql");
});

test("builds a delete document and reads per-key errors", () => {
  const xml = buildDeleteXml(["a&b.sql", "plain.sql.gz"]);
  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?><Delete><Object><Key>a&amp;b.sql</Key></Object><Object><Key>plain.sql.gz</Key></Object></Delete>`,
  );

  const result = parseDeleteResult(
    `<DeleteResult><Deleted><Key>plain.sql.gz</Key></Deleted><Error><Key>a&amp;b.sql</Key><Code>InternalError</Code><Message>retry</Message></Error></DeleteResult>`,
  );
  assert.equal(result.deleted, 1);
  assert.deepEqual(result.errors, ["a&b.sql (InternalError: retry)"]);
});
