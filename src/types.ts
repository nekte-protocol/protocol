/**
 * NEKTE Protocol Types v0.2
 *
 * Token-efficient agent-to-agent coordination protocol.
 * Every type is designed to minimize serialization overhead.
 */

// ---------------------------------------------------------------------------
// Token Budget — first-class citizen in every NEKTE message
// ---------------------------------------------------------------------------

export type DetailLevel = 'minimal' | 'compact' | 'full';

export interface TokenBudget {
  /** Maximum tokens available for the response */
  max_tokens: number;
  /** Desired detail level — receiver MUST respect this */
  detail_level: DetailLevel;
}

// ---------------------------------------------------------------------------
// Discovery levels — progressive, never eager
// ---------------------------------------------------------------------------

export type DiscoveryLevel = 0 | 1 | 2;

/** L0: Catalog entry — ~8 tokens per capability */
export interface CapabilityRef {
  /** Short capability identifier */
  id: string;
  /** Category for filtering */
  cat: string;
  /** Version hash — enables zero-schema invocation */
  h: string;
}

/** L1: Summary — ~40 tokens per capability */
export interface CapabilitySummary extends CapabilityRef {
  /** Human-readable description with input/output hints */
  desc: string;
  /** Performance hints */
  cost?: {
    avg_ms?: number;
    avg_tokens?: number;
  };
  /** Agent-facing use-case hint. E.g. "Use when you need X. Typical input: Y." */
  agent_hint?: string;
}

/** L2: Full schema — ~120 tokens per capability */
export interface CapabilitySchema extends CapabilitySummary {
  /** JSON Schema for input validation */
  input: Record<string, unknown>;
  /** JSON Schema for output structure */
  output: Record<string, unknown>;
  /** Example input/output pairs */
  examples?: Array<{
    in: Record<string, unknown>;
    out: Record<string, unknown>;
  }>;
}

export type Capability = CapabilityRef | CapabilitySummary | CapabilitySchema;

// ---------------------------------------------------------------------------
// Agent Card — ultra-compact by default (~50 tokens)
// ---------------------------------------------------------------------------

export interface AgentCard {
  /** Protocol version */
  nekte: string;
  /** Agent identifier */
  agent: string;
  /** NEKTE endpoint URL */
  endpoint: string;
  /** List of capability IDs (just names, details via discover) */
  caps: string[];
  /** Auth method */
  auth?: 'bearer' | 'apikey' | 'none';
  /** Whether this agent respects token budgets */
  budget_support?: boolean;
  /** Compact protocol guide (~150 tokens). Inject into agent system prompt. */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Context Envelopes — shared context with permissions
// ---------------------------------------------------------------------------

export type ContextCompression = 'none' | 'semantic' | 'reference';

export interface ContextPermissions {
  /** Can the receiver forward this context to other agents? */
  forward: boolean;
  /** Can the receiver persist this beyond the current session? */
  persist: boolean;
  /** Can the receiver generate derived data from this? */
  derive: boolean;
}

export interface ContextEnvelope {
  /** Unique envelope identifier */
  id: string;
  /** The actual context data */
  data: Record<string, unknown>;
  /** Compression strategy */
  compression: ContextCompression;
  /** Access permissions */
  permissions: ContextPermissions;
  /** Time-to-live in seconds */
  ttl_s: number;
  /** Suggested tokens to represent this context */
  budget_hint?: number;
}

// ---------------------------------------------------------------------------
// Multi-level result — semantic compression
// ---------------------------------------------------------------------------

export interface MultiLevelResult<
  TMinimal = string,
  TCompact = Record<string, unknown>,
  TFull = Record<string, unknown>,
> {
  minimal?: TMinimal;
  compact?: TCompact;
  full?: TFull;
}

export interface InvokeResult {
  out: MultiLevelResult | Record<string, unknown>;
  /** Which detail level was resolved */
  resolved_level?: DetailLevel;
  meta?: {
    ms?: number;
    tokens_used?: number;
  };
}

// ---------------------------------------------------------------------------
// Verification — proof of result integrity
// ---------------------------------------------------------------------------

export interface VerificationProof {
  /** Hash of the output for integrity check */
  hash?: string;
  /** Number of samples included as evidence */
  samples?: number;
  /** Representative evidence items */
  evidence?: Array<Record<string, unknown>>;
  /** Source metadata */
  source?: {
    model?: string;
    processed?: number;
    errors?: number;
  };
}

// ---------------------------------------------------------------------------
// Task — delegation contract
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'pending'
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'suspended';

/** Terminal states — no further transitions allowed */
export type TerminalTaskStatus = 'completed' | 'failed' | 'cancelled';

/** Active states — task is in-flight and can be acted upon */
export type ActiveTaskStatus = 'pending' | 'accepted' | 'running' | 'suspended';

export interface Task {
  /** Unique task identifier */
  id: string;
  /** Human-readable description */
  desc: string;
  /** Timeout in milliseconds */
  timeout_ms: number;
  /** Token budget for the response */
  budget: TokenBudget;
}

export interface TaskResult {
  task_id: string;
  status: TaskStatus;
  out?: MultiLevelResult;
  proof?: VerificationProof;
  error?: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 envelope — wire format
// ---------------------------------------------------------------------------

export type NekteMethod =
  | 'nekte.discover'
  | 'nekte.invoke'
  | 'nekte.delegate'
  | 'nekte.context'
  | 'nekte.verify'
  | 'nekte.task.cancel'
  | 'nekte.task.resume'
  | 'nekte.task.status'
  | 'nekte.introspect';

export interface NekteRequest<P = unknown> {
  jsonrpc: '2.0';
  method: NekteMethod;
  id: string | number;
  params: P;
}

export interface NekteResponse<R = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: R;
  error?: NekteError;
}

export interface NekteError {
  code: number;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Method-specific params and results
// ---------------------------------------------------------------------------

export interface DiscoverParams {
  level: DiscoveryLevel;
  filter?: {
    category?: string;
    query?: string;
    id?: string;
    /** Max results to return (for ranked/semantic filtering) */
    top_k?: number;
    /** Minimum relevance score 0.0-1.0 (for ranked/semantic filtering) */
    threshold?: number;
  };
}

export interface DiscoverResult {
  agent: string;
  v?: string;
  caps: Capability[];
}

export interface InvokeParams {
  /** Capability ID */
  cap: string;
  /** Version hash for zero-schema invocation */
  h?: string;
  /** Input data */
  in: Record<string, unknown>;
  /** Token budget */
  budget?: TokenBudget;
}

export interface DelegateParams {
  task: Task;
  context?: ContextEnvelope;
}

export interface ContextParams {
  action: 'share' | 'request' | 'revoke';
  envelope: ContextEnvelope;
}

export interface VerifyParams {
  task_id: string;
  checks: Array<'hash' | 'sample' | 'source'>;
  budget?: TokenBudget;
}

// ---------------------------------------------------------------------------
// Task lifecycle params (cancel, resume, status)
// ---------------------------------------------------------------------------

/** Cancel a running or suspended task */
export interface TaskCancelParams {
  /** Task to cancel */
  task_id: string;
  /** Human-readable reason for cancellation */
  reason?: string;
}

/** Resume a previously suspended task */
export interface TaskResumeParams {
  /** Task to resume */
  task_id: string;
  /** Optional budget override for the resumed execution */
  budget?: TokenBudget;
}

// ---------------------------------------------------------------------------
// Introspect — agent onboarding
// ---------------------------------------------------------------------------

export type { IntrospectTopic } from './protocol-guide.js';

export interface IntrospectParams {
  /** Topic to query. Defaults to "all". */
  topic?: import('./protocol-guide.js').IntrospectTopic;
}

export interface IntrospectResult {
  guide: string;
}

// ---------------------------------------------------------------------------
// Task lifecycle params (cancel, resume, status)
// ---------------------------------------------------------------------------

/** Query current task state */
export interface TaskStatusParams {
  /** Task to query */
  task_id: string;
}

/** Response for task status queries */
export interface TaskStatusResult {
  task_id: string;
  status: TaskStatus;
  /** Current progress if available */
  progress?: { processed: number; total: number };
  /** Whether a checkpoint exists for resume */
  checkpoint_available: boolean;
  /** Timestamps for lifecycle auditing */
  created_at: number;
  updated_at: number;
}

/** Response for cancel/resume operations */
export interface TaskLifecycleResult {
  task_id: string;
  status: TaskStatus;
  /** Previous status before the transition */
  previous_status: TaskStatus;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const NEKTE_ERRORS = {
  VERSION_MISMATCH: -32001,
  CAPABILITY_NOT_FOUND: -32002,
  BUDGET_EXCEEDED: -32003,
  CONTEXT_EXPIRED: -32004,
  CONTEXT_PERMISSION_DENIED: -32005,
  TASK_TIMEOUT: -32006,
  TASK_FAILED: -32007,
  VERIFICATION_FAILED: -32008,
  TASK_NOT_FOUND: -32009,
  TASK_NOT_CANCELLABLE: -32010,
  TASK_NOT_RESUMABLE: -32011,
} as const;
