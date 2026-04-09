import { describe, it, expect } from 'vitest';
import {
  projectCapability,
  buildMultiLevelResult,
  compressMessage,
  decompressMessage,
} from '../codec.js';
import type { CapabilitySchema } from '../types.js';

const fullCap: CapabilitySchema = {
  id: 'sentiment',
  cat: 'nlp',
  h: 'a1b2c3d4',
  desc: 'Analyze text sentiment',
  cost: { avg_ms: 200, avg_tokens: 50 },
  input: { type: 'object', properties: { text: { type: 'string' } } },
  output: { type: 'object', properties: { score: { type: 'number' } } },
};

describe('projectCapability', () => {
  it('L0 returns only id, cat, h', () => {
    const l0 = projectCapability(fullCap, 0);
    expect(l0).toEqual({ id: 'sentiment', cat: 'nlp', h: 'a1b2c3d4' });
    expect('desc' in l0).toBe(false);
    expect('input' in l0).toBe(false);
  });

  it('L1 includes desc and cost', () => {
    const l1 = projectCapability(fullCap, 1);
    expect(l1).toHaveProperty('desc');
    expect(l1).toHaveProperty('cost');
    expect('input' in l1).toBe(false);
  });

  it('L2 returns full schema', () => {
    const l2 = projectCapability(fullCap, 2);
    expect(l2).toEqual(fullCap);
  });
});

describe('buildMultiLevelResult', () => {
  it('builds result with all three levels', () => {
    const full = { sentiment: 'positive', score: 0.9 };
    const result = buildMultiLevelResult(full, {
      toMinimal: (d) => `${d.sentiment} ${d.score}`,
      toCompact: (d) => ({ s: d.sentiment, v: d.score }),
    });

    expect(result.minimal).toBe('positive 0.9');
    expect(result.compact).toEqual({ s: 'positive', v: 0.9 });
    expect(result.full).toEqual(full);
  });

  it('falls back to full for compact when no toCompact', () => {
    const full = { score: 0.5 };
    const result = buildMultiLevelResult(full);
    expect(result.compact).toEqual(full);
  });
});

describe('compressMessage / decompressMessage', () => {
  it('compresses known field names', () => {
    const msg = { jsonrpc: '2.0', method: 'nekte.discover', params: { level: 0 } };
    const compressed = compressMessage(msg);
    expect(compressed).toHaveProperty('j', '2.0');
    expect(compressed).toHaveProperty('m', 'nekte.discover');
    expect(compressed).toHaveProperty('p');
  });

  it('roundtrips correctly', () => {
    const msg = { jsonrpc: '2.0', method: 'nekte.invoke', params: { budget: { max_tokens: 50 } } };
    const result = decompressMessage(compressMessage(msg));
    expect(result).toEqual(msg);
  });

  it('passes through when compact=false', () => {
    const msg = { jsonrpc: '2.0', method: 'test' };
    expect(compressMessage(msg, false)).toEqual(msg);
  });
});
