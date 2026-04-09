/**
 * NEKTE Filtering — Ports (Hexagonal Architecture)
 *
 * Defines the contracts for capability filtering strategies.
 * The domain logic (how to rank capabilities) is decoupled from
 * the infrastructure (where embeddings come from).
 */

// ---------------------------------------------------------------------------
// Value Objects
// ---------------------------------------------------------------------------

/** A single embedding vector */
export type Embedding = Float32Array | number[];

/** A capability with enough context for filtering */
export interface FilterableCapability {
  id: string;
  category: string;
  description: string;
  /** Pre-computed embedding, if available */
  embedding?: Embedding;
}

/** A filtered result with relevance score */
export interface FilteredCapability {
  id: string;
  /** 0.0 to 1.0, where 1.0 is most relevant */
  score: number;
}

/** Options for filtering */
export interface FilterOptions {
  /** Max results to return */
  top_k?: number;
  /** Minimum relevance score (0.0-1.0) */
  threshold?: number;
  /** Filter by category before scoring */
  category?: string;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * Port: computes embeddings for text.
 * Users implement this with their preferred provider (OpenAI, Voyage, local model, etc.)
 */
export interface EmbeddingProvider {
  /** Compute embeddings for one or more texts */
  embed(texts: string[]): Promise<Embedding[]>;
  /** Embedding dimensionality */
  dimensions(): number;
}

/**
 * Port: filters capabilities given a query.
 * Strategies implement this to define ranking behavior.
 */
export interface CapabilityFilterStrategy {
  /** Filter and rank capabilities by relevance to query */
  filter(
    capabilities: FilterableCapability[],
    query: string,
    options?: FilterOptions,
  ): Promise<FilteredCapability[]>;

  /** Optional: precompute embeddings for a set of capabilities */
  precompute?(capabilities: FilterableCapability[]): Promise<void>;
}
