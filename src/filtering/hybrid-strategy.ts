/**
 * Hybrid Filter Strategy — Weighted combination of keyword + semantic
 *
 * Best of both worlds: semantic understanding with keyword boosting
 * for exact matches. Configurable weights.
 */

import type {
  CapabilityFilterStrategy,
  FilterableCapability,
  FilteredCapability,
  FilterOptions,
} from '../filtering.js';
import { KeywordFilterStrategy } from './keyword-strategy.js';
import { SemanticFilterStrategy, type SemanticStrategyConfig } from './semantic-strategy.js';

export interface HybridStrategyConfig extends SemanticStrategyConfig {
  /** Weight for keyword score (0.0-1.0). Default: 0.3 */
  keywordWeight?: number;
  /** Weight for semantic score (0.0-1.0). Default: 0.7 */
  semanticWeight?: number;
}

export class HybridFilterStrategy implements CapabilityFilterStrategy {
  private keyword: KeywordFilterStrategy;
  private semantic: SemanticFilterStrategy;
  private keywordWeight: number;
  private semanticWeight: number;

  constructor(config: HybridStrategyConfig) {
    this.keyword = new KeywordFilterStrategy();
    this.semantic = new SemanticFilterStrategy(config);
    this.keywordWeight = config.keywordWeight ?? 0.3;
    this.semanticWeight = config.semanticWeight ?? 0.7;
  }

  async precompute(capabilities: FilterableCapability[]): Promise<void> {
    await this.semantic.precompute(capabilities);
  }

  async filter(
    capabilities: FilterableCapability[],
    query: string,
    options?: FilterOptions,
  ): Promise<FilteredCapability[]> {
    // Run both strategies
    const [keywordResults, semanticResults] = await Promise.all([
      this.keyword.filter(capabilities, query, { ...options, top_k: undefined, threshold: 0 }),
      this.semantic.filter(capabilities, query, { ...options, top_k: undefined, threshold: 0 }),
    ]);

    // Build score maps
    const keywordScores = new Map(keywordResults.map((r) => [r.id, r.score]));
    const semanticScores = new Map(semanticResults.map((r) => [r.id, r.score]));

    // Combine scores
    const allIds = new Set([...keywordScores.keys(), ...semanticScores.keys()]);
    const combined: FilteredCapability[] = [];

    for (const id of allIds) {
      const kw = keywordScores.get(id) ?? 0;
      const sm = semanticScores.get(id) ?? 0;
      const score = kw * this.keywordWeight + sm * this.semanticWeight;
      combined.push({ id, score });
    }

    const threshold = options?.threshold ?? 0.3;
    const topK = options?.top_k ?? 10;

    return combined
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
