/**
 * @nekte/core — NEKTE Protocol Foundation
 *
 * Token-efficient agent-to-agent coordination protocol.
 * This package provides types, schemas, hashing, budget resolution,
 * and codec utilities used by all other NEKTE packages.
 */

export * from './types.js';
export * from './schema.js';
export * from './hash.js';
export * from './budget.js';
export * from './codec.js';
export * from './logger.js';
export * from './msgpack.js';
export * from './sse.js';
export * from './task.js';
export * from './grpc-types.js';
export * from './cache/index.js';
export * from './filtering/index.js';
export * from './protocol-guide.js';

/** Protocol version */
export const NEKTE_VERSION = '0.2.0';

/** Well-known path for Agent Card discovery */
export const WELL_KNOWN_PATH = '/.well-known/nekte.json';

/** Path for the plain-text protocol guide (LLM system prompt injection) */
export const PROTOCOL_GUIDE_PATH = '/api/protocol-guide';
