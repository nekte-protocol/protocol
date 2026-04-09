/**
 * NEKTE Protocol Guide — Single source of truth for agent onboarding text.
 *
 * All agent-facing protocol guidance comes from this file:
 *   - AgentCard.instructions  → PROTOCOL_GUIDE_COMPACT (~150 tokens)
 *   - GET /api/protocol-guide → PROTOCOL_GUIDE_FULL    (~400 tokens)
 *   - nekte.introspect        → PROTOCOL_GUIDE_SECTIONS[topic]
 *
 * IMPORTANT: When the protocol evolves, update these constants.
 * They are the contract between the server and AI agents consuming this API.
 */

/** Topic keys for nekte.introspect */
export type IntrospectTopic = 'budget' | 'discovery' | 'errors' | 'tasks' | 'all';

/**
 * Compact protocol guide (~150 tokens).
 * Embedded in every AgentCard at /.well-known/nekte.json.
 * Designed to fit in a tight context budget while covering all critical patterns.
 */
export const PROTOCOL_GUIDE_COMPACT = `\
NEKTE: progressive discovery + budget-aware responses.
1. Discover: POST nekte.discover {level:0} → IDs; level:1 → descriptions; level:2 → full schemas.
2. Invoke: POST nekte.invoke {cap, in, budget:{max_tokens, detail_level:"minimal"|"compact"|"full"}}.
3. Cache version hash (h) — reuse on next invoke to skip schema re-transmission.
4. Check resolved_level in response — if lower than requested, retry with higher budget.
5. On error -32001 (VERSION_MISMATCH): updated schema is in error.data, re-cache and retry.
6. Ask for help: POST nekte.introspect {topic:"budget"|"discovery"|"errors"|"tasks"|"all"}.`.trim();

/**
 * Per-topic guides for nekte.introspect.
 * Each section is self-contained so agents can request only what they need.
 */
export const PROTOCOL_GUIDE_SECTIONS: Record<Exclude<IntrospectTopic, 'all'>, string> = {
  discovery: `\
## Progressive Discovery (L0 → L2)

POST nekte.discover {level:0}
→ [{id, cat, h}] — capability IDs + categories + version hashes (~8 tok/cap)

POST nekte.discover {level:1}
→ [{id, cat, h, desc, cost?, agent_hint?}] — descriptions + usage hints (~40 tok/cap)

POST nekte.discover {level:2}
→ [{...L1, input, output, examples?}] — full JSON Schemas (~120 tok/cap)

Filtering: add filter:{category?, query?, top_k?, threshold?} to narrow results.

Pattern: L0 → identify candidates → L1 for descriptions → L2 only when needed.`.trim(),

  budget: `\
## Token Budget

Specify budget in every invoke/delegate:
  {max_tokens: N, detail_level: "minimal"|"compact"|"full"}

Detail levels:
  minimal → ~4 tokens (first-line answer)
  compact → ~50-200 tokens (structured summary)
  full    → complete response (up to max_tokens)

Response always includes resolved_level. If resolved_level is lower than
requested (budget too small), retry with higher max_tokens.
Server always returns something — falls back to minimal if needed.`.trim(),

  errors: `\
## Error Codes

-32001 VERSION_MISMATCH         Schema changed. error.data.schema has updated L2. Re-cache and retry.
-32002 CAPABILITY_NOT_FOUND     Capability ID unknown. Re-discover.
-32003 BUDGET_EXCEEDED          Response too large. Retry with higher max_tokens.
-32004 CONTEXT_EXPIRED          Context TTL elapsed. Re-share context.
-32005 CONTEXT_PERMISSION_DENIED Permission denied on context operation.
-32006 TASK_TIMEOUT             Task exceeded timeout_ms.
-32007 TASK_FAILED              Task execution failed.
-32008 VERIFICATION_FAILED      Result verification failed.
-32009 TASK_NOT_FOUND           Task ID not in registry.
-32010 TASK_NOT_CANCELLABLE     Task is in a terminal state.
-32011 TASK_NOT_RESUMABLE       Task is not suspended.`.trim(),

  tasks: `\
## Task Lifecycle

Delegate a long-running task (SSE streaming):
POST nekte.delegate {task:{id, desc, timeout_ms, budget}, context?}
→ SSE stream:
  {event:"progress", data:{task_id, processed, total}}
  {event:"partial",  data:{out:{...}, resolved_level}}
  {event:"complete", data:{task_id, status:"completed", out:{minimal,compact,full}}}
  {event:"cancelled"|"failed"|"suspended", data:{...}}

State machine:
  pending → accepted → running → completed
                    ↘ suspended ↔ running (resume)
  (any non-terminal) → cancelled | failed

Control:
POST nekte.task.cancel {task_id, reason?} → {task_id, status, previous_status}
POST nekte.task.resume {task_id, budget?} → {task_id, status, previous_status}
POST nekte.task.status {task_id}          → {task_id, status, progress?, checkpoint_available}`.trim(),
};

/**
 * Full protocol guide (~400 tokens).
 * Served at GET /api/protocol-guide.
 * Designed to be injected into an LLM system prompt during agent setup.
 */
export const PROTOCOL_GUIDE_FULL = `\
# NEKTE Protocol Quick Reference

${PROTOCOL_GUIDE_SECTIONS.discovery}

## Invocation

POST nekte.invoke {cap:"name", in:{...}, budget:{max_tokens:500, detail_level:"compact"}}
→ {out:{...}, resolved_level:"compact", meta:{ms:N}}

Zero-schema: cache hash (h) from first invoke, reuse on subsequent calls.
POST nekte.invoke {cap:"name", h:"a1b2c3d4", in:{...}, budget:{...}}

${PROTOCOL_GUIDE_SECTIONS.budget}

${PROTOCOL_GUIDE_SECTIONS.tasks}

${PROTOCOL_GUIDE_SECTIONS.errors}

## Introspect (ask for help mid-session)
POST nekte.introspect {topic:"budget"|"discovery"|"errors"|"tasks"|"all"}
→ {guide:"..."}`.trim();
