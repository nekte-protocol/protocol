import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../filtering/cosine.js';
import { KeywordFilterStrategy } from '../filtering/keyword-strategy.js';
import { SemanticFilterStrategy } from '../filtering/semantic-strategy.js';
import { HybridFilterStrategy } from '../filtering/hybrid-strategy.js';
import type { EmbeddingProvider, FilterableCapability } from '../filtering.js';

const CAPS: FilterableCapability[] = [
  { id: 'sentiment', category: 'nlp', description: 'Analyze text sentiment and emotion' },
  { id: 'translate', category: 'nlp', description: 'Translate text between languages' },
  { id: 'summarize', category: 'nlp', description: 'Summarize long documents into key points' },
  { id: 'resize-image', category: 'media', description: 'Resize and crop images' },
  { id: 'get-weather', category: 'data', description: 'Get current weather for a city' },
];

// Mock embedding provider: simple bag-of-words vector
const mockProvider: EmbeddingProvider = {
  async embed(texts: string[]) {
    const vocab = [
      'sentiment',
      'text',
      'analyze',
      'translate',
      'language',
      'summarize',
      'document',
      'image',
      'weather',
      'city',
    ];
    return texts.map((t) => {
      const lower = t.toLowerCase();
      return vocab.map((w) => (lower.includes(w) ? 1 : 0));
    });
  },
  dimensions() {
    return 10;
  },
};

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 1])).toThrow('mismatch');
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe('KeywordFilterStrategy', () => {
  const strategy = new KeywordFilterStrategy();

  it('finds exact id match with highest score', async () => {
    const results = await strategy.filter(CAPS, 'sentiment');
    expect(results[0].id).toBe('sentiment');
    expect(results[0].score).toBe(1.0);
  });

  it('finds substring matches in description', async () => {
    const results = await strategy.filter(CAPS, 'language');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('translate');
  });

  it('respects top_k', async () => {
    const results = await strategy.filter(CAPS, 'text', { top_k: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('respects threshold', async () => {
    const results = await strategy.filter(CAPS, 'xyz-nonexistent', { threshold: 0.5 });
    expect(results.length).toBe(0);
  });

  it('filters by category', async () => {
    const results = await strategy.filter(CAPS, 'text', { category: 'nlp' });
    expect(results.every((r) => CAPS.find((c) => c.id === r.id)?.category === 'nlp')).toBe(true);
  });
});

describe('SemanticFilterStrategy', () => {
  const strategy = new SemanticFilterStrategy({ provider: mockProvider });

  it('ranks semantically relevant results higher', async () => {
    const results = await strategy.filter(CAPS, 'analyze text sentiment', {
      top_k: 3,
      threshold: 0,
    });
    expect(results.length).toBeGreaterThan(0);
    // sentiment should rank high because it shares "sentiment", "text", "analyze" words
    expect(results[0].id).toBe('sentiment');
  });

  it('respects top_k', async () => {
    const results = await strategy.filter(CAPS, 'text', { top_k: 2, threshold: 0 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('HybridFilterStrategy', () => {
  const strategy = new HybridFilterStrategy({
    provider: mockProvider,
    keywordWeight: 0.4,
    semanticWeight: 0.6,
  });

  it('combines keyword and semantic scores', async () => {
    const results = await strategy.filter(CAPS, 'sentiment', { top_k: 3, threshold: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('sentiment'); // both keyword (exact match) and semantic agree
  });

  it('boosts keyword exact matches', async () => {
    const results = await strategy.filter(CAPS, 'translate', { top_k: 5, threshold: 0 });
    // translate should be #1 due to exact keyword match boosting
    expect(results[0].id).toBe('translate');
  });
});
