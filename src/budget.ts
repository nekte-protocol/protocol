/**
 * NEKTE Token Budget
 *
 * Resolves which detail level to use based on the token budget.
 * The budget is a first-class citizen in every NEKTE message.
 */

import type { DetailLevel, MultiLevelResult, TokenBudget } from './types.js';

/** Default budgets when none is specified */
export const DEFAULT_BUDGETS: Record<DetailLevel, TokenBudget> = {
  minimal: { max_tokens: 50, detail_level: 'minimal' },
  compact: { max_tokens: 500, detail_level: 'compact' },
  full: { max_tokens: 4096, detail_level: 'full' },
};

/**
 * Rough token estimation for a JSON value.
 * ~4 characters per token is a reasonable approximation.
 */
export function estimateTokens(value: unknown): number {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(json.length / 4);
}

/**
 * Resolve which detail level to return based on budget.
 * Falls back to a less detailed level if the requested one exceeds the budget.
 */
export function resolveBudget<TMin, TCom, TFul>(
  result: MultiLevelResult<TMin, TCom, TFul>,
  budget?: TokenBudget,
): { data: TMin | TCom | TFul; level: DetailLevel } {
  const requested = budget?.detail_level ?? 'compact';
  const maxTokens = budget?.max_tokens ?? DEFAULT_BUDGETS.compact.max_tokens;

  // Priority order based on requested level
  const levels: DetailLevel[] =
    requested === 'full'
      ? ['full', 'compact', 'minimal']
      : requested === 'compact'
        ? ['compact', 'minimal']
        : ['minimal'];

  for (const level of levels) {
    const data = result[level];
    if (data !== undefined) {
      const estimated = estimateTokens(data);
      if (estimated <= maxTokens) {
        return { data, level };
      }
    }
  }

  // Last resort: return minimal even if it exceeds budget
  if (result.minimal !== undefined) {
    return { data: result.minimal, level: 'minimal' };
  }

  // Fallback: return whatever is available
  if (result.compact !== undefined) {
    return { data: result.compact, level: 'compact' };
  }

  return { data: result.full as TFul, level: 'full' };
}

/**
 * Create a token budget with sensible defaults.
 */
export function createBudget(overrides?: Partial<TokenBudget>): TokenBudget {
  const maxTokens = overrides?.max_tokens ?? 500;
  return {
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 500,
    detail_level: overrides?.detail_level ?? 'compact',
  };
}
