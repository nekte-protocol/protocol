/**
 * NEKTE Codec — Multi-level result encoding
 *
 * Handles conversion between detail levels and
 * compact wire-format encoding of NEKTE messages.
 */

import type {
  Capability,
  CapabilityRef,
  CapabilitySchema,
  CapabilitySummary,
  DiscoveryLevel,
  MultiLevelResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Capability projection — strip to requested level
// ---------------------------------------------------------------------------

/**
 * Project a full capability schema down to the requested discovery level.
 * This is the core of progressive discovery: only send what's needed.
 */
export function projectCapability(cap: CapabilitySchema, level: DiscoveryLevel): Capability {
  switch (level) {
    case 0:
      return {
        id: cap.id,
        cat: cap.cat,
        h: cap.h,
      } satisfies CapabilityRef;

    case 1:
      return {
        id: cap.id,
        cat: cap.cat,
        h: cap.h,
        desc: cap.desc,
        cost: cap.cost,
        ...(cap.agent_hint !== undefined && { agent_hint: cap.agent_hint }),
      } satisfies CapabilitySummary;

    case 2:
      return cap;
  }
}

// ---------------------------------------------------------------------------
// Multi-level result builder
// ---------------------------------------------------------------------------

/**
 * Helper to build a multi-level result from a handler's output.
 * The handler provides a `compress` function that knows how to
 * generate each detail level.
 */
export function buildMultiLevelResult<T extends Record<string, unknown>>(
  full: T,
  options?: {
    /** Generate a minimal string representation */
    toMinimal?: (data: T) => string;
    /** Generate a compact representation */
    toCompact?: (data: T) => Record<string, unknown>;
  },
): MultiLevelResult<string, Record<string, unknown>, T> {
  return {
    minimal: options?.toMinimal?.(full),
    compact: options?.toCompact?.(full) ?? full,
    full,
  };
}

// ---------------------------------------------------------------------------
// Wire format compression
// ---------------------------------------------------------------------------

/**
 * Compact field names for wire format.
 * NEKTE uses short field names to minimize token overhead.
 */
const FIELD_MAP: Record<string, string> = {
  jsonrpc: 'j',
  method: 'm',
  params: 'p',
  result: 'r',
  error: 'e',
  capability: 'cap',
  version_hash: 'h',
  budget: 'b',
  max_tokens: 'mt',
  detail_level: 'dl',
};

const REVERSE_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([k, v]) => [v, k]),
);

/**
 * Compress a NEKTE message for wire transmission.
 * Replaces verbose field names with short aliases.
 *
 * Only used when `detail_level` is 'minimal' or 'compact'.
 * At 'full' detail, standard JSON field names are used for readability.
 */
export function compressMessage(
  msg: Record<string, unknown>,
  compact = true,
): Record<string, unknown> {
  if (!compact) return msg;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(msg)) {
    const newKey = FIELD_MAP[key] ?? key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[newKey] = compressMessage(value as Record<string, unknown>, compact);
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

/**
 * Decompress a NEKTE message from wire format.
 */
export function decompressMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(msg)) {
    const newKey = REVERSE_FIELD_MAP[key] ?? key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[newKey] = decompressMessage(value as Record<string, unknown>);
    } else {
      result[newKey] = value;
    }
  }
  return result;
}
