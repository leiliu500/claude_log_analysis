// S3 helpers for the generic-log and email-alert analyzers.
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const client = new S3Client({});

/** List object keys under a prefix, newest first, capped at `max`. */
export async function listObjects(
  bucket: string,
  prefix: string,
  max = 50,
): Promise<Array<{ key: string; lastModified?: Date; size?: number }>> {
  const out: Array<{ key: string; lastModified?: Date; size?: number }> = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: Math.min(1000, max - out.length),
      }),
    );
    for (const o of res.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified, size: o.Size });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token && out.length < max);

  out.sort(
    (a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0),
  );
  return out.slice(0, max);
}

/** Read an object as UTF-8 text, truncated to `maxBytes` to bound model input. */
export async function getObjectText(
  bucket: string,
  key: string,
  maxBytes = 256 * 1024,
): Promise<string> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body;
  if (!body) return "";
  const text = await body.transformToString("utf-8");
  return text.length > maxBytes ? text.slice(0, maxBytes) + "\n…[truncated]" : text;
}
