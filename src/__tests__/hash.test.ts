import { describe, it, expect } from 'vitest';
import { computeVersionHash, verifyVersionHash, computeContentHash } from '../hash.js';

describe('computeVersionHash', () => {
  const input = { type: 'object', properties: { text: { type: 'string' } } };
  const output = { type: 'object', properties: { score: { type: 'number' } } };

  it('returns 16-character hex string', () => {
    const hash = computeVersionHash(input, output);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    expect(computeVersionHash(input, output)).toBe(computeVersionHash(input, output));
  });

  it('is stable regardless of key order', () => {
    const input2 = { properties: { text: { type: 'string' } }, type: 'object' };
    expect(computeVersionHash(input, output)).toBe(computeVersionHash(input2, output));
  });

  it('changes when schema changes', () => {
    const input2 = { type: 'object', properties: { text: { type: 'number' } } };
    expect(computeVersionHash(input, output)).not.toBe(computeVersionHash(input2, output));
  });
});

describe('verifyVersionHash', () => {
  const input = { type: 'object', properties: { text: { type: 'string' } } };
  const output = { type: 'object', properties: { score: { type: 'number' } } };

  it('returns true for matching hash', () => {
    const hash = computeVersionHash(input, output);
    expect(verifyVersionHash(hash, input, output)).toBe(true);
  });

  it('returns false for stale hash', () => {
    expect(verifyVersionHash('deadbeef', input, output)).toBe(false);
  });
});

describe('computeContentHash', () => {
  it('returns sha256-prefixed hash', () => {
    const hash = computeContentHash({ result: 'ok' });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const data = { a: 1, b: [2, 3] };
    expect(computeContentHash(data)).toBe(computeContentHash(data));
  });

  it('is stable regardless of key order', () => {
    expect(computeContentHash({ a: 1, b: 2 })).toBe(computeContentHash({ b: 2, a: 1 }));
  });
});
