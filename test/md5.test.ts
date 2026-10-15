import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { contentMd5 } from "../src/md5.ts";

test("content-md5 matches node crypto", () => {
  const samples = ["", "abc", "The quick brown fox jumps over the lazy dog", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(1000), "héllo 🌍"];
  for (const sample of samples) {
    assert.equal(contentMd5(sample), createHash("md5").update(sample).digest("base64"));
  }
});
