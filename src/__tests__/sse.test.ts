import { describe, it, expect } from 'vitest';
import { encodeSseEvent, parseSseEvent, parseSseStream } from '../sse.js';
import type { SseEvent } from '../sse.js';

describe('encodeSseEvent', () => {
  it('encodes a progress event', () => {
    const encoded = encodeSseEvent({
      event: 'progress',
      data: { processed: 50, total: 500 },
    });
    expect(encoded).toBe('event: progress\ndata: {"processed":50,"total":500}\n\n');
  });

  it('encodes a complete event', () => {
    const encoded = encodeSseEvent({
      event: 'complete',
      data: {
        task_id: 'task-001',
        status: 'completed',
        out: { minimal: 'done', compact: { ok: true } },
      },
    });
    expect(encoded).toContain('event: complete');
    expect(encoded).toContain('"task_id":"task-001"');
    expect(encoded.endsWith('\n\n')).toBe(true);
  });
});

describe('parseSseEvent', () => {
  it('parses a progress event', () => {
    const event = parseSseEvent('event: progress\ndata: {"processed":100,"total":500}');
    expect(event).toEqual({
      event: 'progress',
      data: { processed: 100, total: 500 },
    });
  });

  it('parses an error event', () => {
    const event = parseSseEvent('event: error\ndata: {"code":-32007,"message":"TASK_FAILED"}');
    expect(event?.event).toBe('error');
    expect(event?.data).toEqual({ code: -32007, message: 'TASK_FAILED' });
  });

  it('returns null for incomplete blocks', () => {
    expect(parseSseEvent('')).toBeNull();
    expect(parseSseEvent('event: progress')).toBeNull();
    expect(parseSseEvent('data: {}')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSseEvent('event: progress\ndata: not-json')).toBeNull();
  });
});

describe('parseSseStream', () => {
  it('parses multiple events from a stream', () => {
    const stream = [
      'event: progress\ndata: {"processed":50,"total":100}',
      'event: progress\ndata: {"processed":100,"total":100}',
      'event: complete\ndata: {"task_id":"t1","status":"completed","out":{"minimal":"done"}}',
    ].join('\n\n');

    const events = parseSseStream(stream);
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe('progress');
    expect(events[1].event).toBe('progress');
    expect(events[2].event).toBe('complete');
  });

  it('handles empty stream', () => {
    expect(parseSseStream('')).toHaveLength(0);
  });
});

describe('roundtrip', () => {
  it('encode → parse roundtrips correctly', () => {
    const original: SseEvent = {
      event: 'partial',
      data: { out: { score: 0.75 }, resolved_level: 'compact' },
    };
    const encoded = encodeSseEvent(original);
    const parsed = parseSseEvent(encoded.trim());
    expect(parsed).toEqual(original);
  });
});
