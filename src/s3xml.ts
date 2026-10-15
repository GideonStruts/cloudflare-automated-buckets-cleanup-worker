export interface ListedObject {
  key: string;
  lastModified: string;
}

export interface ListObjectsPage {
  objects: ListedObject[];
  nextToken?: string;
}

export interface BucketPage {
  names: string[];
  nextToken?: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function innerText(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : undefined;
}

function decodeS3Value(raw: string, urlEncoded: boolean): string {
  const text = decodeXml(raw);
  if (!urlEncoded) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function nextToken(xml: string, sentToken: string | undefined, urlEncoded: boolean): string | undefined {
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const raw =
    innerText(xml, "NextContinuationToken") ??
    innerText(xml, "NextToken") ??
    (truncated ? innerText(xml, "ContinuationToken") : undefined);
  if (!raw) return undefined;
  const token = decodeS3Value(raw, urlEncoded);
  return token.length > 0 && token !== sentToken ? token : undefined;
}

export function parseBuckets(xml: string, sentToken?: string): BucketPage {
  const names: string[] = [];
  for (const match of xml.matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g)) {
    const name = innerText(match[1], "Name");
    if (name) names.push(decodeXml(name));
  }
  return { names, nextToken: nextToken(xml, sentToken, false) };
}

export function parseListObjects(xml: string, sentToken?: string): ListObjectsPage {
  const urlEncoded = /<EncodingType>\s*url\s*<\/EncodingType>/i.test(xml);
  const objects: ListedObject[] = [];

  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = innerText(match[1], "Key");
    const lastModified = innerText(match[1], "LastModified");
    if (!key || !lastModified) continue;
    objects.push({
      key: decodeS3Value(key, urlEncoded),
      lastModified: decodeXml(lastModified),
    });
  }

  return { objects, nextToken: nextToken(xml, sentToken, urlEncoded) };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildDeleteXml(keys: readonly string[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?><Delete>`;
  for (const key of keys) {
    xml += `<Object><Key>${escapeXml(key)}</Key></Object>`;
  }
  xml += `</Delete>`;
  return xml;
}

export function parseDeleteResult(xml: string): { deleted: number; errors: string[] } {
  const deleted = [...xml.matchAll(/<Deleted\b/g)].length;
  const errors: string[] = [];
  for (const match of xml.matchAll(/<Error>([\s\S]*?)<\/Error>/g)) {
    const key = decodeXml(innerText(match[1], "Key") ?? "");
    const code = decodeXml(innerText(match[1], "Code") ?? "Error");
    const message = decodeXml(innerText(match[1], "Message") ?? "");
    errors.push(`${key} (${code}: ${message})`);
  }
  return { deleted, errors };
}
