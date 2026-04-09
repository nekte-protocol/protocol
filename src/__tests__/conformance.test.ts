/**
 * Cross-SDK Conformance Tests
 *
 * These hash vectors are shared between TypeScript and Python SDKs.
 * If a vector fails here, the corresponding Python test MUST also
 * be updated — otherwise cross-SDK interoperability breaks.
 *
 * Source of truth: packages/core/src/__tests__/conformance/hash_vectors.json
 */

import { describe, it, expect } from 'vitest';
import { computeVersionHash } from '../hash.js';
import vectors from './conformance/hash_vectors.json';

describe('Cross-SDK Hash Conformance', () => {
  for (const vector of vectors) {
    it(`hash: ${vector.name}`, () => {
      const hash = computeVersionHash(
        vector.input as Record<string, unknown>,
        vector.output as Record<string, unknown>,
      );
      expect(hash).toBe(vector.expected_hash);
    });
  }
});
