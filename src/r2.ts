import { AwsClient } from "aws4fetch";

import { contentMd5 } from "./md5.ts";
import {
  buildDeleteXml,
  parseBuckets,
  parseDeleteResult,
  parseListObjects,
  type ListedObject,
} from "./s3xml.ts";

const DELETE_BATCH_SIZE = 1000;
const MAX_PAGES = 100_000;

export interface ObjectStore {
  listBuckets(jurisdiction: string): Promise<string[]>;
  listObjects(jurisdiction: string, bucket: string): Promise<ListedObject[]>;
  deleteObjects(
    jurisdiction: string,
    bucket: string,
    keys: readonly string[],
  ): Promise<{ deleted: number; errors: string[] }>;
}

export class R2Account implements ObjectStore {
  private readonly client: AwsClient;
  private readonly accountId: string;

  constructor(accountId: string, accessKeyId: string, secretAccessKey: string) {
    this.accountId = accountId;
    this.client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  async listBuckets(jurisdiction: string): Promise<string[]> {
    const names: string[] = [];
    let token: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(this.endpoint(jurisdiction));
      if (token) url.searchParams.set("continuation-token", token);
      const xml = await this.request(url, `List buckets (${jurisdiction})`);
      const parsed = parseBuckets(xml, token);
      names.push(...parsed.names);
      if (!parsed.nextToken) return [...new Set(names)];
      token = parsed.nextToken;
    }

    throw new Error(`Stopped listing buckets in ${jurisdiction} after ${MAX_PAGES} pages.`);
  }

  async listObjects(jurisdiction: string, bucket: string): Promise<ListedObject[]> {
    const objects: ListedObject[] = [];
    let token: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`/${encodeURIComponent(bucket)}`, `${this.endpoint(jurisdiction)}/`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("max-keys", "1000");
      url.searchParams.set("encoding-type", "url");
      if (token) url.searchParams.set("continuation-token", token);
      const xml = await this.request(url, `List objects (${jurisdiction}/${bucket})`);
      const parsed = parseListObjects(xml, token);
      objects.push(...parsed.objects);
      if (!parsed.nextToken) return objects;
      token = parsed.nextToken;
    }

    throw new Error(`Stopped listing ${jurisdiction}/${bucket} after ${MAX_PAGES} pages.`);
  }

  async deleteObjects(
    jurisdiction: string,
    bucket: string,
    keys: readonly string[],
  ): Promise<{ deleted: number; errors: string[] }> {
    let deleted = 0;
    const errors: string[] = [];

    for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
      const batch = keys.slice(offset, offset + DELETE_BATCH_SIZE);
      const body = buildDeleteXml(batch);
      const url = new URL(`/${encodeURIComponent(bucket)}`, `${this.endpoint(jurisdiction)}/`);
      url.search = "?delete";

      try {
        const xml = await this.request(url, `Delete objects (${jurisdiction}/${bucket})`, {
          method: "POST",
          headers: {
            "content-type": "application/xml",
            "content-md5": contentMd5(body),
          },
          body,
        });
        const parsed = parseDeleteResult(xml);
        if (parsed.errors.length === 0) deleted += batch.length;
        else {
          deleted += parsed.deleted;
          errors.push(...parsed.errors);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return { deleted, errors };
  }

  private endpoint(jurisdiction: string): string {
    if (jurisdiction === "default") return `https://${this.accountId}.r2.cloudflarestorage.com`;
    return `https://${this.accountId}.${jurisdiction}.r2.cloudflarestorage.com`;
  }

  private async request(url: URL, action: string, init?: RequestInit): Promise<string> {
    const response = await this.client.fetch(url.toString(), init);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${action} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return text;
  }
}
