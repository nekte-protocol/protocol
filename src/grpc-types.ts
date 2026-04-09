/**
 * gRPC Type Converters — Infrastructure Port
 *
 * Bidirectional converters between NEKTE domain types and
 * gRPC proto message shapes. These form the anti-corruption
 * layer between the domain and the gRPC transport.
 *
 * Design: All converters are pure functions with strong input/output types.
 * JSON-carrying fields are serialized to/from Uint8Array (bytes in proto).
 */

import type {
  Capability,
  CapabilityRef,
  CapabilitySchema,
  CapabilitySummary,
  ContextEnvelope,
  DelegateParams,
  DetailLevel,
  DiscoverParams,
  DiscoverResult,
  DiscoveryLevel,
  InvokeParams,
  InvokeResult,
  MultiLevelResult,
  NekteMethod,
  Task,
  TaskCancelParams,
  TaskLifecycleResult,
  TaskResumeParams,
  TaskStatus,
  TaskStatusParams,
  TaskStatusResult,
  TokenBudget,
} from './types.js';
import type { SseEvent } from './sse.js';

// ---------------------------------------------------------------------------
// Proto message shapes (mirrors proto definitions without codegen dependency)
// ---------------------------------------------------------------------------

/** Proto TokenBudget message shape */
export interface ProtoTokenBudget {
  max_tokens: number;
  detail_level: string;
}

/** Proto CapabilityRef message shape */
export interface ProtoCapabilityRef {
  id: string;
  cat: string;
  h: string;
}

/** Proto CapabilitySummary message shape */
export interface ProtoCapabilitySummary extends ProtoCapabilityRef {
  desc: string;
  cost?: { avg_ms: number; avg_tokens: number };
}

/** Proto CapabilityFull message shape */
export interface ProtoCapabilityFull extends ProtoCapabilitySummary {
  input_schema: Uint8Array;
  output_schema: Uint8Array;
  examples?: Array<{ input: Uint8Array; output: Uint8Array }>;
}

/** Proto DiscoverRequest message shape */
export interface ProtoDiscoverRequest {
  level: number;
  filter?: {
    category?: string;
    query?: string;
    id?: string;
    top_k?: number;
    threshold?: number;
  };
}

/** Proto DiscoverResponse message shape */
export interface ProtoDiscoverResponse {
  agent: string;
  version?: string;
  refs: ProtoCapabilityRef[];
  summaries: ProtoCapabilitySummary[];
  schemas: ProtoCapabilityFull[];
}

/** Proto InvokeRequest message shape */
export interface ProtoInvokeRequest {
  cap: string;
  h?: string;
  input: Uint8Array;
  budget?: ProtoTokenBudget;
}

/** Proto InvokeResponse message shape */
export interface ProtoInvokeResponse {
  output: Uint8Array;
  resolved_level?: string;
  meta?: { ms: number; tokens_used: number };
  error?: {
    code: number;
    message: string;
    current_hash?: string;
    schema?: ProtoCapabilityFull;
  };
}

/** Proto Task message shape */
export interface ProtoTask {
  id: string;
  desc: string;
  timeout_ms: number;
  budget?: ProtoTokenBudget;
}

/** Proto DelegateRequest message shape */
export interface ProtoDelegateRequest {
  task: ProtoTask;
  context?: ProtoContextEnvelope;
}

/** Proto ContextEnvelope message shape */
export interface ProtoContextEnvelope {
  id: string;
  data: Uint8Array;
  compression: string;
  permissions: { forward: boolean; persist: boolean; derive: boolean };
  ttl_s: number;
  budget_hint?: number;
}

/** Proto DelegateEvent message shape */
export interface ProtoDelegateEvent {
  progress?: { processed: number; total: number; message?: string };
  partial?: { output: Uint8Array; resolved_level?: string };
  complete?: {
    task_id: string;
    output: { minimal?: string; compact?: Uint8Array; full?: Uint8Array };
    meta?: { ms: number; tokens_used: number };
  };
  error?: { task_id?: string; code: number; message: string };
  cancelled?: { task_id: string; reason?: string; previous_status: string };
  suspended?: { task_id: string; checkpoint_available: boolean };
  resumed?: { task_id: string; from_checkpoint: boolean };
  status_change?: {
    task_id: string;
    from_status: string;
    to_status: string;
    reason?: string;
  };
}

/** Proto TaskCancelRequest */
export interface ProtoTaskCancelRequest {
  task_id: string;
  reason?: string;
}

/** Proto TaskResumeRequest */
export interface ProtoTaskResumeRequest {
  task_id: string;
  budget?: ProtoTokenBudget;
}

/** Proto TaskStatusRequest */
export interface ProtoTaskStatusRequest {
  task_id: string;
}

/** Proto TaskLifecycleResponse */
export interface ProtoTaskLifecycleResponse {
  task_id: string;
  status: string;
  previous_status: string;
}

/** Proto TaskStatusResponse */
export interface ProtoTaskStatusResponse {
  task_id: string;
  status: string;
  progress_processed: number;
  progress_total: number;
  checkpoint_available: boolean;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encode a JSON-serializable value to Uint8Array (proto bytes) */
export function jsonToBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/** Decode Uint8Array (proto bytes) to a parsed JSON value */
export function bytesToJson<T = unknown>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

// ---------------------------------------------------------------------------
// Domain → Proto converters
// ---------------------------------------------------------------------------

export function toProtoTokenBudget(budget: TokenBudget): ProtoTokenBudget {
  return { max_tokens: budget.max_tokens, detail_level: budget.detail_level };
}

export function toProtoTask(task: Task): ProtoTask {
  return {
    id: task.id,
    desc: task.desc,
    timeout_ms: task.timeout_ms,
    budget: toProtoTokenBudget(task.budget),
  };
}

export function toProtoContextEnvelope(ctx: ContextEnvelope): ProtoContextEnvelope {
  return {
    id: ctx.id,
    data: jsonToBytes(ctx.data),
    compression: ctx.compression,
    permissions: ctx.permissions,
    ttl_s: ctx.ttl_s,
    budget_hint: ctx.budget_hint,
  };
}

export function toProtoDiscoverResponse(result: DiscoverResult): ProtoDiscoverResponse {
  const refs: ProtoCapabilityRef[] = [];
  const summaries: ProtoCapabilitySummary[] = [];
  const schemas: ProtoCapabilityFull[] = [];

  for (const cap of result.caps) {
    if ('input' in cap) {
      const full = cap as CapabilitySchema;
      schemas.push({
        id: full.id,
        cat: full.cat,
        h: full.h,
        desc: full.desc,
        cost: full.cost
          ? { avg_ms: full.cost.avg_ms ?? 0, avg_tokens: full.cost.avg_tokens ?? 0 }
          : undefined,
        input_schema: jsonToBytes(full.input),
        output_schema: jsonToBytes(full.output),
        examples: full.examples?.map((ex) => ({
          input: jsonToBytes(ex.in),
          output: jsonToBytes(ex.out),
        })),
      });
    } else if ('desc' in cap) {
      const summary = cap as CapabilitySummary;
      summaries.push({
        id: summary.id,
        cat: summary.cat,
        h: summary.h,
        desc: summary.desc,
        cost: summary.cost
          ? { avg_ms: summary.cost.avg_ms ?? 0, avg_tokens: summary.cost.avg_tokens ?? 0 }
          : undefined,
      });
    } else {
      refs.push({ id: cap.id, cat: cap.cat, h: cap.h });
    }
  }

  return { agent: result.agent, version: result.v, refs, summaries, schemas };
}

export function toProtoInvokeResponse(result: InvokeResult): ProtoInvokeResponse {
  return {
    output: jsonToBytes(result.out),
    resolved_level: result.resolved_level,
    meta: result.meta
      ? { ms: result.meta.ms ?? 0, tokens_used: result.meta.tokens_used ?? 0 }
      : undefined,
  };
}

/** Convert an SSE event to a proto DelegateEvent */
export function toProtoDelegateEvent(event: SseEvent): ProtoDelegateEvent {
  switch (event.event) {
    case 'progress':
      return { progress: event.data };
    case 'partial':
      return {
        partial: {
          output: jsonToBytes(event.data.out),
          resolved_level: event.data.resolved_level,
        },
      };
    case 'complete':
      return {
        complete: {
          task_id: event.data.task_id,
          output: {
            minimal: event.data.out.minimal as string | undefined,
            compact: event.data.out.compact ? jsonToBytes(event.data.out.compact) : undefined,
            full: event.data.out.full ? jsonToBytes(event.data.out.full) : undefined,
          },
          meta: event.data.meta
            ? { ms: event.data.meta.ms ?? 0, tokens_used: event.data.meta.tokens_used ?? 0 }
            : undefined,
        },
      };
    case 'error':
      return { error: event.data };
    case 'cancelled':
      return { cancelled: event.data };
    case 'suspended':
      return { suspended: event.data };
    case 'resumed':
      return { resumed: event.data };
    case 'status_change':
      return {
        status_change: {
          task_id: event.data.task_id,
          from_status: event.data.from,
          to_status: event.data.to,
          reason: event.data.reason,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Proto → Domain converters
// ---------------------------------------------------------------------------

export function fromProtoTokenBudget(proto: ProtoTokenBudget): TokenBudget {
  return {
    max_tokens: proto.max_tokens,
    detail_level: proto.detail_level as DetailLevel,
  };
}

export function fromProtoTask(proto: ProtoTask): Task {
  return {
    id: proto.id,
    desc: proto.desc,
    timeout_ms: proto.timeout_ms,
    budget: proto.budget
      ? fromProtoTokenBudget(proto.budget)
      : { max_tokens: 1000, detail_level: 'compact' },
  };
}

export function fromProtoContextEnvelope(proto: ProtoContextEnvelope): ContextEnvelope {
  return {
    id: proto.id,
    data: bytesToJson<Record<string, unknown>>(proto.data),
    compression: proto.compression as ContextEnvelope['compression'],
    permissions: proto.permissions,
    ttl_s: proto.ttl_s,
    budget_hint: proto.budget_hint,
  };
}

export function fromProtoDiscoverRequest(proto: ProtoDiscoverRequest): DiscoverParams {
  return {
    level: proto.level as DiscoveryLevel,
    filter: proto.filter
      ? {
          category: proto.filter.category || undefined,
          query: proto.filter.query || undefined,
          id: proto.filter.id || undefined,
          top_k: proto.filter.top_k || undefined,
          threshold: proto.filter.threshold || undefined,
        }
      : undefined,
  };
}

export function fromProtoInvokeRequest(proto: ProtoInvokeRequest): InvokeParams {
  return {
    cap: proto.cap,
    h: proto.h || undefined,
    in: bytesToJson<Record<string, unknown>>(proto.input),
    budget: proto.budget ? fromProtoTokenBudget(proto.budget) : undefined,
  };
}

export function fromProtoDelegateRequest(proto: ProtoDelegateRequest): DelegateParams {
  return {
    task: fromProtoTask(proto.task),
    context: proto.context ? fromProtoContextEnvelope(proto.context) : undefined,
  };
}

export function fromProtoTaskCancelRequest(proto: ProtoTaskCancelRequest): TaskCancelParams {
  return { task_id: proto.task_id, reason: proto.reason || undefined };
}

export function fromProtoTaskResumeRequest(proto: ProtoTaskResumeRequest): TaskResumeParams {
  return {
    task_id: proto.task_id,
    budget: proto.budget ? fromProtoTokenBudget(proto.budget) : undefined,
  };
}

export function fromProtoTaskStatusRequest(proto: ProtoTaskStatusRequest): TaskStatusParams {
  return { task_id: proto.task_id };
}

/** Convert a proto DelegateEvent to an SSE event */
export function fromProtoDelegateEvent(proto: ProtoDelegateEvent): SseEvent | undefined {
  if (proto.progress) {
    return { event: 'progress', data: proto.progress };
  }
  if (proto.partial) {
    return {
      event: 'partial',
      data: {
        out: bytesToJson<Record<string, unknown>>(proto.partial.output),
        resolved_level: proto.partial.resolved_level as DetailLevel | undefined,
      },
    };
  }
  if (proto.complete) {
    const c = proto.complete;
    return {
      event: 'complete',
      data: {
        task_id: c.task_id,
        status: 'completed',
        out: {
          minimal: c.output.minimal,
          compact: c.output.compact ? bytesToJson(c.output.compact) : undefined,
          full: c.output.full ? bytesToJson(c.output.full) : undefined,
        },
        meta: c.meta,
      },
    };
  }
  if (proto.error) {
    return { event: 'error', data: proto.error };
  }
  if (proto.cancelled) {
    return {
      event: 'cancelled',
      data: {
        task_id: proto.cancelled.task_id,
        reason: proto.cancelled.reason,
        previous_status: proto.cancelled.previous_status as TaskStatus,
      },
    };
  }
  if (proto.suspended) {
    return { event: 'suspended', data: proto.suspended };
  }
  if (proto.resumed) {
    return { event: 'resumed', data: proto.resumed };
  }
  if (proto.status_change) {
    return {
      event: 'status_change',
      data: {
        task_id: proto.status_change.task_id,
        from: proto.status_change.from_status as TaskStatus,
        to: proto.status_change.to_status as TaskStatus,
        reason: proto.status_change.reason,
      },
    };
  }
  return undefined;
}

export function fromProtoTaskLifecycleResponse(
  proto: ProtoTaskLifecycleResponse,
): TaskLifecycleResult {
  return {
    task_id: proto.task_id,
    status: proto.status as TaskStatus,
    previous_status: proto.previous_status as TaskStatus,
  };
}

export function fromProtoTaskStatusResponse(proto: ProtoTaskStatusResponse): TaskStatusResult {
  return {
    task_id: proto.task_id,
    status: proto.status as TaskStatus,
    progress:
      proto.progress_total > 0
        ? { processed: proto.progress_processed, total: proto.progress_total }
        : undefined,
    checkpoint_available: proto.checkpoint_available,
    created_at: proto.created_at,
    updated_at: proto.updated_at,
  };
}
