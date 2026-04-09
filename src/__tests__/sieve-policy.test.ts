import { describe, it, expect } from 'vitest';
import { SievePolicy } from '../cache/sieve-policy.js';

describe('SievePolicy', () => {
  // -----------------------------------------------------------------
  // Basic FIFO behavior (no accesses)
  // -----------------------------------------------------------------

  it('evicts unvisited entries in FIFO order', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');
    sieve.insert('c');

    expect(sieve.evict()).toBe('a');
    expect(sieve.evict()).toBe('b');
    expect(sieve.evict()).toBe('c');
    expect(sieve.size).toBe(0);
  });

  it('returns undefined on evict from empty policy', () => {
    const sieve = new SievePolicy<string>();
    expect(sieve.evict()).toBeUndefined();
  });

  // -----------------------------------------------------------------
  // Second-chance (visited bit)
  // -----------------------------------------------------------------

  it('gives second chance to visited entries', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');
    sieve.insert('c');

    sieve.access('a');

    // 'a' visited → skip, evict 'b' (unvisited)
    expect(sieve.evict()).toBe('b');
  });

  it('clears visited bit on second-chance pass', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');

    sieve.access('a');
    sieve.access('b');

    // Both visited → clear 'a' visited, clear 'b' visited, wrap, evict 'a'
    expect(sieve.evict()).toBe('a');
    // 'b' now has visited=false (was cleared), so it gets evicted next
    expect(sieve.evict()).toBe('b');
  });

  it('evicts when ALL entries are visited (guaranteed termination)', () => {
    const sieve = new SievePolicy<string>();
    for (let i = 0; i < 100; i++) {
      sieve.insert(`key-${i}`);
      sieve.access(`key-${i}`);
    }

    // All 100 entries are visited. Evict must still terminate and return a key.
    const evicted = sieve.evict();
    expect(evicted).toBeDefined();
    expect(sieve.size).toBe(99);
  });

  // -----------------------------------------------------------------
  // Scan resistance (the core SIEVE property)
  // -----------------------------------------------------------------

  it('scan resistance: bulk inserts dont pollute hot set', () => {
    const sieve = new SievePolicy<string>();

    // Hot set — accessed
    sieve.insert('hot1');
    sieve.insert('hot2');
    sieve.access('hot1');
    sieve.access('hot2');

    // Bulk scan — 10 entries, never accessed
    for (let i = 0; i < 10; i++) {
      sieve.insert(`scan-${i}`);
    }

    // Evict all 10 scan entries
    const evicted: string[] = [];
    for (let i = 0; i < 10; i++) {
      evicted.push(sieve.evict()!);
    }

    expect(evicted.every((k) => k.startsWith('scan-'))).toBe(true);
    expect(sieve.has('hot1')).toBe(true);
    expect(sieve.has('hot2')).toBe(true);
  });

  it('scan resistance holds with interleaved accesses', () => {
    const sieve = new SievePolicy<string>();

    sieve.insert('hot');
    sieve.access('hot');

    // Interleave: insert cold, access hot, insert cold, access hot...
    for (let i = 0; i < 5; i++) {
      sieve.insert(`cold-${i}`);
      sieve.access('hot');
    }

    // Evict 5 times — all colds should go before hot
    for (let i = 0; i < 5; i++) {
      const evicted = sieve.evict()!;
      expect(evicted).toMatch(/^cold-/);
    }
    expect(sieve.has('hot')).toBe(true);
  });

  // -----------------------------------------------------------------
  // Insert (duplicate handling)
  // -----------------------------------------------------------------

  it('re-insert of existing key acts as access (no duplicate node)', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');

    sieve.insert('a'); // should mark visited, not add duplicate
    expect(sieve.size).toBe(2);

    // 'a' is visited → evict 'b' first
    expect(sieve.evict()).toBe('b');
  });

  // -----------------------------------------------------------------
  // Delete (edge cases)
  // -----------------------------------------------------------------

  it('delete removes entry correctly', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');
    sieve.insert('c');

    sieve.delete('b');
    expect(sieve.size).toBe(2);
    expect(sieve.has('b')).toBe(false);

    expect(sieve.evict()).toBe('a');
    expect(sieve.evict()).toBe('c');
  });

  it('delete of head node', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');
    sieve.insert('c');

    sieve.delete('a'); // head
    expect(sieve.size).toBe(2);
    expect(sieve.evict()).toBe('b');
    expect(sieve.evict()).toBe('c');
  });

  it('delete of tail node', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');
    sieve.insert('c');

    sieve.delete('c'); // tail
    expect(sieve.size).toBe(2);
    expect(sieve.evict()).toBe('a');
    expect(sieve.evict()).toBe('b');
  });

  it('delete of only node', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('only');
    sieve.delete('only');

    expect(sieve.size).toBe(0);
    expect(sieve.evict()).toBeUndefined();
  });

  it('delete of node that hand points to', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');
    sieve.insert('c');

    // Evict 'a' so hand advances to 'b'
    sieve.access('a'); // visit 'a'
    // hand starts at head ('a'), 'a' is visited → clear, advance to 'b'
    // 'b' is unvisited → evict 'b', hand now at 'c'... actually let's be more precise.
    // After evicting 'a' would be wrong since 'a' is visited. Actually:
    // hand at 'a' (visited) → clear visited, advance to 'b' (unvisited) → evict 'b'
    sieve.evict(); // evicts 'b'

    // Now delete 'c' which might be where hand points
    sieve.delete('c');
    expect(sieve.size).toBe(1);
    expect(sieve.has('a')).toBe(true);

    // Should still be able to evict the remaining entry
    expect(sieve.evict()).toBe('a');
  });

  it('delete of non-existent key is a no-op', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.delete('nonexistent'); // should not throw
    expect(sieve.size).toBe(1);
  });

  // -----------------------------------------------------------------
  // Clear
  // -----------------------------------------------------------------

  it('clear resets all state', () => {
    const sieve = new SievePolicy<string>();
    sieve.insert('a');
    sieve.insert('b');
    sieve.access('a');

    sieve.clear();
    expect(sieve.size).toBe(0);
    expect(sieve.has('a')).toBe(false);
    expect(sieve.evict()).toBeUndefined();

    // Should work normally after clear
    sieve.insert('x');
    expect(sieve.size).toBe(1);
    expect(sieve.evict()).toBe('x');
  });

  // -----------------------------------------------------------------
  // Access of non-existent key
  // -----------------------------------------------------------------

  it('access of non-existent key is a no-op', () => {
    const sieve = new SievePolicy<string>();
    sieve.access('ghost'); // should not throw
    expect(sieve.size).toBe(0);
  });

  // -----------------------------------------------------------------
  // Stress / large scale
  // -----------------------------------------------------------------

  it('handles 1000 inserts + evictions without corruption', () => {
    const sieve = new SievePolicy<number>();

    // Insert 1000 entries
    for (let i = 0; i < 1000; i++) {
      sieve.insert(i);
    }
    expect(sieve.size).toBe(1000);

    // Access every 10th entry
    for (let i = 0; i < 1000; i += 10) {
      sieve.access(i);
    }

    // Evict 900 entries
    for (let i = 0; i < 900; i++) {
      const key = sieve.evict();
      expect(key).toBeDefined();
    }
    expect(sieve.size).toBe(100);

    // The remaining should be mostly the accessed ones
    const remaining = new Set<number>();
    for (let i = 0; i < 100; i++) {
      remaining.add(sieve.evict()!);
    }
    expect(sieve.size).toBe(0);
  });

  it('rapid insert-evict cycles dont leak memory', () => {
    const sieve = new SievePolicy<string>();

    for (let i = 0; i < 10_000; i++) {
      sieve.insert(`key-${i}`);
      if (sieve.size > 10) {
        sieve.evict();
      }
    }

    // Should not have accumulated beyond max
    expect(sieve.size).toBeLessThanOrEqual(11);
  });

  // -----------------------------------------------------------------
  // Numeric keys (non-string generic)
  // -----------------------------------------------------------------

  it('works with numeric keys', () => {
    const sieve = new SievePolicy<number>();
    sieve.insert(1);
    sieve.insert(2);
    sieve.insert(3);
    sieve.access(2);

    expect(sieve.evict()).toBe(1);
    expect(sieve.evict()).toBe(3);
    expect(sieve.evict()).toBe(2);
  });
});
