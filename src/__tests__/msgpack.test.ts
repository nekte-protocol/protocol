import { describe, it, expect } from 'vitest';
import {
  packMessage,
  unpackMessage,
  compareSizes,
  isMsgPackRequest,
  MSGPACK_CONTENT_TYPE,
} from '../msgpack.js';

describe('packMessage / unpackMessage', () => {
  it('roundtrips a NEKTE discover request', () => {
    const msg = {
      jsonrpc: '2.0',
      method: 'nekte.discover',
      id: 1,
      params: { level: 0 },
    };
    const packed = packMessage(msg);
    expect(packed).toBeInstanceOf(Uint8Array);
    expect(packed.byteLength).toBeGreaterThan(0);

    const unpacked = unpackMessage(packed);
    expect(unpacked).toEqual(msg);
  });

  it('roundtrips a complex invoke result', () => {
    const msg = {
      jsonrpc: '2.0',
      id: 42,
      result: {
        out: { label: 'positive', score: 0.92 },
        resolved_level: 'compact',
        meta: { ms: 15 },
      },
    };
    expect(unpackMessage(packMessage(msg))).toEqual(msg);
  });

  it('is smaller than JSON', () => {
    const msg = {
      jsonrpc: '2.0',
      method: 'nekte.discover',
      id: 1,
      params: {
        level: 0,
        filter: { category: 'nlp', query: 'sentiment' },
      },
    };
    const packed = packMessage(msg);
    const jsonSize = Buffer.byteLength(JSON.stringify(msg));
    expect(packed.byteLength).toBeLessThan(jsonSize);
  });
});

describe('compareSizes', () => {
  it('returns size comparison with savings percentage', () => {
    const msg = {
      jsonrpc: '2.0',
      method: 'nekte.invoke',
      id: 5,
      params: { cap: 'sentiment', h: 'a1b2c3d4', in: { text: 'Hello world' } },
    };
    const result = compareSizes(msg);
    expect(result.json_bytes).toBeGreaterThan(0);
    expect(result.msgpack_bytes).toBeGreaterThan(0);
    expect(result.msgpack_bytes).toBeLessThan(result.json_bytes);
    expect(result.savings_pct).toBeGreaterThan(0);
  });
});

describe('isMsgPackRequest', () => {
  it('detects msgpack content type', () => {
    expect(isMsgPackRequest(MSGPACK_CONTENT_TYPE)).toBe(true);
    expect(isMsgPackRequest('application/x-msgpack')).toBe(true);
    expect(isMsgPackRequest('application/json')).toBe(false);
    expect(isMsgPackRequest(undefined)).toBe(false);
  });
});
