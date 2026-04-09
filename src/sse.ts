/**
 * NEKTE SSE (Server-Sent Events) Types
 *
 * Defines the event types for streaming responses.
 * Used by `nekte.delegate` and any long-running operation
 * where the server streams progress back to the client.
 *
 * Wire format follows the SSE spec (text/event-stream):
 *
 *   event: progress
 *   data: {"processed":50,"total":500}
 *
 *   event: partial
 *   data: {"preliminary_score":0.72}
 *
 *   event: complete
 *   data: {"task_id":"t-001","status":"completed","out":{...}}
 *
 *   event: error
 *   data: {"code":-32007,"message":"TASK_FAILED"}
 */

import type { DetailLevel, MultiLevelResult, TaskStatus } from './types.js';

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

/** Progress update — how far along the task is */
export interface SseProgressEvent {
  event: 'progress';
  data: {
    processed: number;
    total: number;
    message?: string;
  };
}

/** Partial result — early/preliminary data before completion */
export interface SsePartialEvent {
  event: 'partial';
  data: {
    out: Record<string, unknown>;
    resolved_level?: DetailLevel;
  };
}

/** Task completed successfully */
export interface SseCompleteEvent {
  event: 'complete';
  data: {
    task_id: string;
    status: 'completed';
    out: MultiLevelResult;
    meta?: {
      ms?: number;
      tokens_used?: number;
    };
  };
}

/** Task failed */
export interface SseErrorEvent {
  event: 'error';
  data: {
    task_id?: string;
    code: number;
    message: string;
  };
}

/** Task was cancelled */
export interface SseCancelledEvent {
  event: 'cancelled';
  data: {
    task_id: string;
    reason?: string;
    previous_status: TaskStatus;
  };
}

/** Task was suspended (checkpoint saved, can resume) */
export interface SseSuspendedEvent {
  event: 'suspended';
  data: {
    task_id: string;
    checkpoint_available: boolean;
  };
}

/** Task was resumed from suspension */
export interface SseResumedEvent {
  event: 'resumed';
  data: {
    task_id: string;
    from_checkpoint: boolean;
  };
}

/** Task status changed (generic lifecycle event) */
export interface SseStatusChangeEvent {
  event: 'status_change';
  data: {
    task_id: string;
    from: TaskStatus;
    to: TaskStatus;
    reason?: string;
  };
}

export type SseEvent =
  | SseProgressEvent
  | SsePartialEvent
  | SseCompleteEvent
  | SseErrorEvent
  | SseCancelledEvent
  | SseSuspendedEvent
  | SseResumedEvent
  | SseStatusChangeEvent;

// ---------------------------------------------------------------------------
// SSE Encoding / Decoding
// ---------------------------------------------------------------------------

/**
 * Encode a NEKTE SSE event to the text/event-stream format.
 */
export function encodeSseEvent(event: SseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Parse a single SSE event block from text/event-stream format.
 * Returns null if the block is incomplete or a comment.
 */
export function parseSseEvent(block: string): SseEvent | null {
  let eventType: string | undefined;
  let dataStr: string | undefined;

  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      dataStr = line.slice(6);
    }
  }

  if (!eventType || !dataStr) return null;

  try {
    const data = JSON.parse(dataStr);
    return { event: eventType, data } as SseEvent;
  } catch {
    return null;
  }
}

/**
 * Parse a full SSE stream text into an array of events.
 * Handles the double-newline separator between events.
 */
export function parseSseStream(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((block) => parseSseEvent(block.trim()))
    .filter((e): e is SseEvent => e !== null);
}

/** Content-Type header for SSE responses */
export const SSE_CONTENT_TYPE = 'text/event-stream';
