/**
 * Keyword Filter Strategy — Default Adapter
 *
 * Substring matching on id + description.
 * This is the existing behavior, extracted into a strategy.
 */

import type {
  CapabilityFilterStrategy,
  FilterableCapability,
  FilteredCapability,
  FilterOptions,
} from '../filtering.js';

export class KeywordFilterStrategy implements CapabilityFilterStrategy {
  async filter(
    capabilities: FilterableCapability[],
    query: string,
    options?: FilterOptions,
  ): Promise<FilteredCapability[]> {
    let caps = capabilities;

    // Category pre-filter
    if (options?.category) {
      caps = caps.filter((c) => c.category === options.category);
    }

    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);

    const scored = caps.map((cap) => {
      const idLower = cap.id.toLowerCase();
      const descLower = cap.description.toLowerCase();

      // Score: exact id match > id contains > desc contains > partial word match
      let score = 0;
      if (idLower === q) {
        score = 1.0;
      } else if (idLower.includes(q)) {
        score = 0.8;
      } else if (descLower.includes(q)) {
        score = 0.6;
      } else {
        // Partial: count how many query words match
        const matches = words.filter((w) => idLower.includes(w) || descLower.includes(w));
        score = words.length > 0 ? (matches.length / words.length) * 0.4 : 0;
      }

      return { id: cap.id, score };
    });

    const threshold = options?.threshold ?? 0;
    const filtered = scored.filter((r) => r.score > threshold).sort((a, b) => b.score - a.score);

    const topK = options?.top_k ?? filtered.length;
    return filtered.slice(0, topK);
  }
}
