/**
 * NEKTE Version Hashing
 *
 * Computes stable hashes for capability schemas.
 * Used for zero-schema invocation: if the hash matches,
 * the client can invoke without re-loading the schema.
 *
 * Hash is computed over the canonical JSON of input + output schemas.
 * Changes to descriptions, examples, or metadata do NOT change the hash —
 * only structural changes to the contract (input/output types) do.
 */

import { createHash } from 'node:crypto';

/**
 * Canonicalize a JSON value for stable hashing.
 * Objects have their keys sorted recursively.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
    .join(',');

  return '{' + sorted + '}';
}

/**
 * Compute a version hash for a capability's contract.
 * Only input and output schemas affect the hash.
 *
 * @returns 16-character hex hash (64 bits — collision-resistant for version comparison)
 */
export function computeVersionHash(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): string {
  const canonical = canonicalize({ input, output });
  const full = createHash('sha256').update(canonical).digest('hex');
  // 16 chars = 64 bits — collision-resistant for version comparison
  return full.slice(0, 16);
}

/**
 * Verify a version hash matches the current schema.
 */
export function verifyVersionHash(
  hash: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): boolean {
  return computeVersionHash(input, output) === hash;
}

/**
 * Compute a content hash for result verification.
 * Used by nekte.verify to prove result integrity.
 */
export function computeContentHash(data: unknown): string {
  const canonical = canonicalize(data);
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}
