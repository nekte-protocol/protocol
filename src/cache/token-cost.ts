/**
 * Token Cost — Value Object
 *
 * Maps discovery levels to their re-fetch cost in tokens.
 * Used by GDSF eviction to prioritize expensive entries.
 */

import type { DiscoveryLevel } from '../types.js';

/** Approximate token cost to re-fetch at each discovery level */
export const TOKEN_COST: Readonly<Record<DiscoveryLevel, number>> = {
  0: 8, // L0 catalog: ~8 tokens per capability
  1: 40, // L1 summary: ~40 tokens per capability
  2: 120, // L2 full schema: ~120 tokens per capability
} as const;

/** Get the token cost for a discovery level */
export function tokenCostForLevel(level: DiscoveryLevel): number {
  return TOKEN_COST[level];
}
