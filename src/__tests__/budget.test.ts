import { describe, it, expect } from 'vitest';
import { estimateTokens, resolveBudget, createBudget, DEFAULT_BUDGETS } from '../budget.js';

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('handles objects', () => {
    const tokens = estimateTokens({ key: 'value' });
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('resolveBudget', () => {
  const result = {
    minimal: 'pos 0.9',
    compact: { sentiment: 'positive', score: 0.9 },
    full: {
      sentiment: 'positive',
      score: 0.9,
      explanation: 'Very positive text with detailed analysis...',
    },
  };

  it('returns requested level when within budget', () => {
    const resolved = resolveBudget(result, { max_tokens: 500, detail_level: 'compact' });
    expect(resolved.level).toBe('compact');
    expect(resolved.data).toEqual(result.compact);
  });

  it('falls back to less detailed level when over budget', () => {
    const resolved = resolveBudget(result, { max_tokens: 3, detail_level: 'full' });
    expect(resolved.level).toBe('minimal');
  });

  it('defaults to compact when no budget specified', () => {
    const resolved = resolveBudget(result);
    expect(resolved.level).toBe('compact');
  });

  it('returns minimal as last resort even if over budget', () => {
    const resolved = resolveBudget(result, { max_tokens: 1, detail_level: 'minimal' });
    expect(resolved.level).toBe('minimal');
    expect(resolved.data).toBe(result.minimal);
  });
});

describe('createBudget', () => {
  it('creates budget with defaults', () => {
    const budget = createBudget();
    expect(budget.max_tokens).toBe(500);
    expect(budget.detail_level).toBe('compact');
  });

  it('allows overrides', () => {
    const budget = createBudget({ max_tokens: 100, detail_level: 'minimal' });
    expect(budget.max_tokens).toBe(100);
    expect(budget.detail_level).toBe('minimal');
  });
});

describe('DEFAULT_BUDGETS', () => {
  it('has all three levels', () => {
    expect(DEFAULT_BUDGETS.minimal.max_tokens).toBe(50);
    expect(DEFAULT_BUDGETS.compact.max_tokens).toBe(500);
    expect(DEFAULT_BUDGETS.full.max_tokens).toBe(4096);
  });
});
