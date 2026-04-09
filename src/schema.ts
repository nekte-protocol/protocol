/**
 * NEKTE Protocol Schemas — Zod validation
 *
 * These schemas validate wire-format messages.
 * They're also used to auto-generate version hashes for capabilities.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const DetailLevelSchema = z.enum(['minimal', 'compact', 'full']);

export const TokenBudgetSchema = z.object({
  max_tokens: z.number().int().positive(),
  detail_level: DetailLevelSchema,
});

export const DiscoveryLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export const CapabilityRefSchema = z.object({
  id: z.string().min(1).max(64),
  cat: z.string().min(1).max(32),
  h: z.string().min(1).max(64),
});

export const CapabilitySummarySchema = CapabilityRefSchema.extend({
  desc: z.string().max(256),
  cost: z
    .object({
      avg_ms: z.number().optional(),
      avg_tokens: z.number().optional(),
    })
    .optional(),
  agent_hint: z.string().max(512).optional(),
});

export const CapabilitySchemaSchema = CapabilitySummarySchema.extend({
  input: z.record(z.unknown()),
  output: z.record(z.unknown()),
  examples: z
    .array(
      z.object({
        in: z.record(z.unknown()),
        out: z.record(z.unknown()),
      }),
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

export const AgentCardSchema = z.object({
  nekte: z.string().default('0.2'),
  agent: z.string().min(1).max(128),
  endpoint: z.string().url(),
  caps: z.array(z.string()),
  auth: z.enum(['bearer', 'apikey', 'none']).optional(),
  budget_support: z.boolean().optional(),
  instructions: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const ContextPermissionsSchema = z.object({
  forward: z.boolean(),
  persist: z.boolean(),
  derive: z.boolean(),
});

export const ContextEnvelopeSchema = z.object({
  id: z.string(),
  data: z.record(z.unknown()),
  compression: z.enum(['none', 'semantic', 'reference']),
  permissions: ContextPermissionsSchema,
  ttl_s: z.number().positive(),
  budget_hint: z.number().positive().optional(),
});

// ---------------------------------------------------------------------------
// Method params
// ---------------------------------------------------------------------------

export const DiscoverParamsSchema = z.object({
  level: DiscoveryLevelSchema,
  filter: z
    .object({
      category: z.string().optional(),
      query: z.string().optional(),
      id: z.string().optional(),
    })
    .optional(),
});

export const InvokeParamsSchema = z.object({
  cap: z.string(),
  h: z.string().optional(),
  in: z.record(z.unknown()),
  budget: TokenBudgetSchema.optional(),
});

export const TaskSchema = z.object({
  id: z.string(),
  desc: z.string(),
  timeout_ms: z.number().positive(),
  budget: TokenBudgetSchema,
});

export const DelegateParamsSchema = z.object({
  task: TaskSchema,
  context: ContextEnvelopeSchema.optional(),
});

export const ContextParamsSchema = z.object({
  action: z.enum(['share', 'request', 'revoke']),
  envelope: ContextEnvelopeSchema,
});

export const VerifyParamsSchema = z.object({
  task_id: z.string(),
  checks: z.array(z.enum(['hash', 'sample', 'source'])),
  budget: TokenBudgetSchema.optional(),
});

// ---------------------------------------------------------------------------
// JSON-RPC envelope
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Task lifecycle params
// ---------------------------------------------------------------------------

export const TaskCancelParamsSchema = z.object({
  task_id: z.string().min(1),
  reason: z.string().optional(),
});

export const TaskResumeParamsSchema = z.object({
  task_id: z.string().min(1),
  budget: TokenBudgetSchema.optional(),
});

export const TaskStatusParamsSchema = z.object({
  task_id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// JSON-RPC envelope
// ---------------------------------------------------------------------------

export const IntrospectParamsSchema = z.object({
  topic: z
    .enum(['budget', 'discovery', 'errors', 'tasks', 'all'])
    .optional(),
});

export const NekteMethodSchema = z.enum([
  'nekte.discover',
  'nekte.invoke',
  'nekte.delegate',
  'nekte.context',
  'nekte.verify',
  'nekte.task.cancel',
  'nekte.task.resume',
  'nekte.task.status',
  'nekte.introspect',
]);

export const NekteRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: NekteMethodSchema,
  id: z.union([z.string(), z.number()]),
  params: z.unknown(),
});

export const NekteErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

export const NekteResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: NekteErrorSchema.optional(),
});
