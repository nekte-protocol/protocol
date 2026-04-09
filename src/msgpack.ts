/**
 * NEKTE MessagePack Codec
 *
 * Optional binary wire format for NEKTE messages.
 * ~30% smaller than JSON on the wire, with faster parse times.
 *
 * Use case: high-throughput agent pipelines where bandwidth
 * and parse latency matter (e.g., NATS transport, batch processing).
 *
 * This does NOT affect token counting — tokens are measured on
 * the semantic content, not the wire encoding. MessagePack only
 * optimizes the transport between agents/bridges.
 *
 * @example
 * ```ts
 * import { packMessage, unpackMessage } from '@nekte/core';
 *
 * const binary = packMessage({ jsonrpc: '2.0', method: 'nekte.discover', id: 1, params: { level: 0 } });
 * // → Uint8Array (compact binary)
 *
 * const msg = unpackMessage(binary);
 * // → { jsonrpc: '2.0', method: 'nekte.discover', id: 1, params: { level: 0 } }
 * ```
 */

import { Packr } from 'msgpackr';

/**
 * Shared Packr instance with `structures` enabled.
 * NEKTE messages have highly repetitive keys (jsonrpc, method, id, params).
 * The record extension auto-detects these and provides ~2-3x decode speedup
 * plus smaller payloads.
 */
/** Maximum allowed MessagePack payload size (10 MB) */
const MAX_UNPACK_SIZE = 10 * 1024 * 1024;

const packr = new Packr({ structures: [] });

/**
 * Encode a NEKTE message to MessagePack binary format.
 * Returns a Uint8Array suitable for sending over binary transports.
 */
export function packMessage(msg: Record<string, unknown>): Uint8Array {
  return packr.pack(msg);
}

/**
 * Decode a MessagePack binary message back to a NEKTE object.
 */
export function unpackMessage(data: Uint8Array | Buffer): Record<string, unknown> {
  if (data.byteLength > MAX_UNPACK_SIZE) {
    throw new Error(`MessagePack payload too large: ${data.byteLength} bytes (max ${MAX_UNPACK_SIZE})`);
  }
  return packr.unpack(data) as Record<string, unknown>;
}

/**
 * Content-Type header for MessagePack encoded NEKTE messages.
 */
export const MSGPACK_CONTENT_TYPE = 'application/x-msgpack';

/**
 * Check if a request/response should use MessagePack based on headers.
 */
export function isMsgPackRequest(contentType: string | undefined): boolean {
  return contentType?.includes('msgpack') ?? false;
}

/**
 * Measure the size difference between JSON and MessagePack for a message.
 * Useful for benchmarking.
 */
export function compareSizes(msg: Record<string, unknown>): {
  json_bytes: number;
  msgpack_bytes: number;
  savings_pct: number;
} {
  const jsonBytes = Buffer.byteLength(JSON.stringify(msg));
  const msgpackBytes = packr.pack(msg).byteLength;
  const savings = Math.round(((jsonBytes - msgpackBytes) / jsonBytes) * 100);

  return {
    json_bytes: jsonBytes,
    msgpack_bytes: msgpackBytes,
    savings_pct: savings,
  };
}
