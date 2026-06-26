// Cached Secrets Manager reads. Lambda execution contexts are reused, so caching
// avoids a Secrets Manager call on every warm invocation.
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});
const cache = new Map<string, unknown>();

/** Fetch and JSON-parse a secret by ARN/name, caching the parsed value. */
export async function getJsonSecret<T = Record<string, string>>(
  secretId: string,
): Promise<T> {
  const cached = cache.get(secretId);
  if (cached !== undefined) return cached as T;

  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error(`Secret ${secretId} has no string value`);
  const parsed = JSON.parse(res.SecretString) as T;
  cache.set(secretId, parsed);
  return parsed;
}
