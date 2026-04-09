/**
 * SIEVE Eviction Policy — Domain Logic (Pure)
 *
 * NSDI 2024: "SIEVE is Simpler than LRU"
 * A FIFO queue with a "hand" pointer and a visited bit per entry.
 * Scan-resistant: bulk inserts (e.g., catalog()) don't pollute the cache
 * because entries that aren't re-accessed get evicted on the first pass.
 *
 * Algorithm:
 *   Insert: add to tail, visited = false
 *   Access: set visited = true (no reordering)
 *   Evict:  advance hand; if visited, clear and skip; if not visited, evict
 */

interface SieveNode<K> {
  key: K;
  visited: boolean;
  prev: SieveNode<K> | null;
  next: SieveNode<K> | null;
}

export class SievePolicy<K> {
  private head: SieveNode<K> | null = null;
  private tail: SieveNode<K> | null = null;
  private hand: SieveNode<K> | null = null;
  private nodes = new Map<K, SieveNode<K>>();

  get size(): number {
    return this.nodes.size;
  }

  /** Record an access — mark visited (no reordering) */
  access(key: K): void {
    const node = this.nodes.get(key);
    if (node) node.visited = true;
  }

  /** Insert a new key at the tail */
  insert(key: K): void {
    if (this.nodes.has(key)) {
      this.access(key);
      return;
    }

    const node: SieveNode<K> = { key, visited: false, prev: this.tail, next: null };

    if (this.tail) {
      this.tail.next = node;
    } else {
      this.head = node;
    }
    this.tail = node;
    this.nodes.set(key, node);
  }

  /** Evict one entry using the SIEVE hand. Returns the evicted key, or undefined if empty. */
  evict(): K | undefined {
    if (this.nodes.size === 0) return undefined;

    // Initialize hand to tail if not set (paper: hand scans from tail toward head)
    if (!this.hand) this.hand = this.head;

    // Walk from hand, clearing visited bits until we find an unvisited node.
    // Limit iterations to 2× size to guarantee termination when all are visited.
    const maxIter = this.nodes.size * 2;
    for (let i = 0; i < maxIter && this.hand; i++) {
      if (!this.hand.visited) {
        const victim = this.hand;
        this.remove(victim); // remove() updates this.hand
        return victim.key;
      }
      // Give second chance: clear visited, advance
      this.hand.visited = false;
      this.hand = this.hand.next ?? this.head;
    }

    // All entries were visited and cleared — evict current hand position
    if (this.hand) {
      const victim = this.hand;
      this.remove(victim);
      return victim.key;
    }

    return undefined;
  }

  /** Remove a specific key from the policy */
  delete(key: K): void {
    const node = this.nodes.get(key);
    if (node) this.remove(node);
  }

  /** Clear all state */
  clear(): void {
    this.head = null;
    this.tail = null;
    this.hand = null;
    this.nodes.clear();
  }

  has(key: K): boolean {
    return this.nodes.has(key);
  }

  private remove(node: SieveNode<K>): void {
    // Update hand if it points to the removed node
    if (this.hand === node) {
      this.hand = node.next ?? this.head;
      if (this.hand === node) this.hand = null; // was the only node
    }

    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;

    node.prev = null;
    node.next = null;
    this.nodes.delete(node.key);
  }
}
