/**
 * Semantic Filter Strategy — Embedding-based Adapter
 *
 * Uses cosine similarity on embeddings to rank capabilities.
 * Requires an EmbeddingProvider (user-supplied).
 */

import type {
  CapabilityFilterStrategy,
  EmbeddingProvider,
  Embedding,
  FilterableCapability,
  FilteredCapability,
  FilterOptions,
} from '../filtering.js';
import { cosineSimilarity } from './cosine.js';

export interface SemanticStrategyConfig {
  provider: EmbeddingProvider;
  /** Default top_k when not specified in filter call. Default: 10 */
  topKDefault?: number;
  /** Default threshold when not specified. Default: 0.3 */
  thresholdDefault?: number;
}

export class SemanticFilterStrategy implements CapabilityFilterStrategy {
  private provider: EmbeddingProvider;
  private topKDefault: number;
  private thresholdDefault: number;
  private embeddings = new Map<string, Embedding>();

  constructor(config: SemanticStrategyConfig) {
    this.provider = config.provider;
    this.topKDefault = config.topKDefault ?? 10;
    this.thresholdDefault = config.thresholdDefault ?? 0.3;
  }

  /**
   * Precompute embeddings for all capabilities.
   * Call this after registering capabilities (server) or building catalog (bridge).
   */
  async precompute(capabilities: FilterableCapability[]): Promise<void> {
    const toEmbed = capabilities.filter((c) => !this.embeddings.has(c.id));
    if (toEmbed.length === 0) return;

    const texts = toEmbed.map((c) => `${c.id}: ${c.description}`);
    const vectors = await this.provider.embed(texts);

    for (let i = 0; i < toEmbed.length; i++) {
      this.embeddings.set(toEmbed[i].id, vectors[i]);
    }
  }

  async filter(
    capabilities: FilterableCapability[],
    query: string,
    options?: FilterOptions,
  ): Promise<FilteredCapability[]> {
    let caps = capabilities;

    if (options?.category) {
      caps = caps.filter((c) => c.category === options.category);
    }

    // Ensure embeddings exist
    await this.precompute(caps);

    // Embed the query
    const [queryEmbedding] = await this.provider.embed([query]);

    // Score each capability
    const scored = caps.map((cap) => {
      const capEmbedding = this.embeddings.get(cap.id);
      if (!capEmbedding) return { id: cap.id, score: 0 };

      // Cosine similarity returns [-1, 1], normalize to [0, 1]
      const raw = cosineSimilarity(queryEmbedding, capEmbedding);
      const score = (raw + 1) / 2;

      return { id: cap.id, score };
    });

    const threshold = options?.threshold ?? this.thresholdDefault;
    const topK = options?.top_k ?? this.topKDefault;

    return scored
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
