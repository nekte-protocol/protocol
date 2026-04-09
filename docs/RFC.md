# RFC: NEKTE Protocol — Token-Efficient Agent-to-Agent Coordination

**RFC Number:** 0001  
**Title:** NEKTE Protocol Specification  
**Authors:** BaronTech Labs  
**Status:** Draft  
**Created:** 2026-04-06  
**Version:** 0.3  

---

## Abstract

This RFC proposes **NEKTE** (from Greek *nektos* — joined, linked), an open agent-to-agent communication protocol that treats **token efficiency as a first-class architectural constraint**. NEKTE introduces progressive capability discovery, zero-schema invocation via version hashing, and semantic result compression to achieve 89–99%+ token savings over existing protocols (MCP, A2A) while maintaining full expressiveness for complex multi-agent workflows.

---

## 1. Motivation

### 1.1 The Token Tax Problem

Current agent communication protocols impose an unsustainable "token tax" on every interaction:

- **MCP** serializes all tool schemas into every conversation turn. With 30 tools, ~3,600 tokens/turn are consumed by definitions alone. At enterprise scale (100+ tools), **72% of the context window is burned before the model sees the first user message**.
- **A2A** (Google/Linux Foundation) solves agent-to-agent coordination but inherits the same verbose schema pattern via JSON and full Agent Cards.
- **Every token wasted on protocol overhead is a token stolen from reasoning.** Protocol efficiency is not an optimization — it is a precondition for system intelligence.

### 1.2 Quantified Impact

| Scenario | MCP native | NEKTE | Savings |
|----------|-----------|-------|---------|
| 5 tools × 5 turns | 3,025 tok | 345 tok | **-89%** |
| 15 tools × 10 turns | 18,150 tok | 730 tok | **-96%** |
| 30 tools × 15 turns | 54,450 tok | 1,155 tok | **-98%** |
| 50 tools × 20 turns | 121,000 tok | 1,620 tok | **-99%** |
| 100 tools × 25 turns | 302,500 tok | 2,325 tok | **-99%** |
| 200 tools × 30 turns | 726,000 tok | 3,430 tok | **~100%** |

**Enterprise cost projection:** 50 tools × 20 turns × 1,000 conversations/day = **~$10,744/month savings**.

### 1.3 Competitive Landscape

| Feature | MCP | A2A | RTK | NEKTE |
|---------|-----|-----|-----|-------|
| Focus | Agent-to-Tool | Agent-to-Agent | CLI output | Agent-to-Agent (efficient) |
| Discovery | Eager (all upfront) | Full Agent Card | N/A | Progressive L0/L1/L2 |
| Zero-schema invocation | No | No | N/A | Yes (version hash) |
| Native token budget | No | No | N/A | Yes (first-class) |
| Result compression | No | No | Yes (CLI) | Yes (minimal/compact/full) |
| Context permissions | No | Limited | N/A | Envelopes with TTL |
| Verification | No | No | N/A | Native primitive |
| Task lifecycle | No | Cancel/resume (polling) | N/A | Cancel/suspend/resume (push) |
| gRPC transport | No | Yes | N/A | Yes (native) |
| MCP compatibility | N/A | N/A | N/A | @nekte/bridge (drop-in proxy) |

---

## 2. Design Principles

### 2.1 Token Budget as First-Class Citizen

Every NEKTE message includes a `budget` field. The receiving agent **MUST** respect this budget, adapting response granularity accordingly.

```jsonc
{
  "budget": {
    "max_tokens": 500,
    "detail_level": "compact"  // "minimal" | "compact" | "full"
  }
}
```

### 2.2 Lazy Discovery (Progressive Resolution)

No agent loads full schemas by default. Discovery occurs at three resolution levels; the consumer decides how much it needs:

| Level | Content | Estimated Cost |
|-------|---------|----------------|
| **L0 — Catalog** | Names + categories + version hashes | ~8 tokens/capability |
| **L1 — Summary** | Description + main inputs/outputs + cost hints | ~40 tokens/capability |
| **L2 — Full Schema** | Typed JSON Schema with examples | ~120 tokens/capability |

### 2.3 Zero-Schema Invocation

If an agent already knows a capability (from a prior interaction), it invokes using a **version hash**. The receiver validates the hash — if it matches, execution proceeds without re-sending the schema. On hash mismatch, the updated schema is returned inline (no extra round-trip).

### 2.4 Semantic Result Compression

The same result exposes multiple representations. The protocol resolves the appropriate level based on the caller's budget:

```jsonc
{
  "result": {
    "minimal": "positive 0.87",                                          // ~4 tokens
    "compact": { "sentiment": "positive", "score": 0.87 },              // ~12 tokens
    "full": { "sentiment": "positive", "score": 0.87, "explanation": "..." } // ~200 tokens
  },
  "resolved_level": "compact"
}
```

### 2.5 Transport Agnostic, Format Opinionated

- **Envelope:** JSON-RPC 2.0 (ecosystem compatible)
- **High-performance wire format:** gRPC with Protobuf (proto definitions in `@nekte/core/proto/`)
- **Compact fields** by default, expanded only at `detail_level: "full"`
- **No schemas on the wire** unless explicitly requested
- **Optional binary codec:** MessagePack (~30% smaller than JSON)

### 2.6 Hexagonal Architecture

Implementation follows Ports & Adapters with DDD:

```
Domain Layer (pure)          → Types, schemas, state machines, budget resolution
Ports (interfaces)           → Transport, DelegateHandler, GrpcWritableStream, CacheStore
Adapters (infrastructure)    → HTTP/SSE, gRPC, WebSocket, stdio
DDD Aggregates               → TaskEntry (root), TaskRegistry, CapabilityRegistry
```

---

## 3. Protocol Primitives

NEKTE defines **eight primitives**, each designed to minimize token overhead in the common case.

### 3.1 `nekte.discover` — Progressive Discovery

Replaces MCP's eager tool listing and A2A's full Agent Card pattern.

```jsonc
// Request
{
  "jsonrpc": "2.0",
  "method": "nekte.discover",
  "id": 1,
  "params": {
    "level": 0,                    // 0=catalog, 1=summary, 2=full
    "filter": { "category": "nlp" } // optional
  }
}

// Response (L0)
{
  "result": {
    "agent": "nlp-worker",
    "v": "1.2.0",
    "caps": [
      { "id": "sentiment", "cat": "nlp", "h": "a1b2c3d4" },
      { "id": "summarize", "cat": "nlp", "h": "e5f6g7h8" }
    ]
  }
}
// ~16 tokens for 2 capabilities
```

### 3.2 `nekte.invoke` — Zero-Schema Invocation

```jsonc
{
  "method": "nekte.invoke",
  "params": {
    "capability": "sentiment",
    "version_hash": "a1b2c3d4",
    "input": { "text": "This product is amazing" },
    "budget": { "max_tokens": 100, "detail_level": "compact" }
  }
}
```

On hash match → execute immediately (0 extra tokens).  
On hash mismatch → return updated schema inline + execute.

### 3.3 `nekte.delegate` — Task Delegation with Streaming

Long-running tasks are delegated and streamed via SSE or gRPC server-streaming:

```jsonc
// Request
{
  "method": "nekte.delegate",
  "params": {
    "capability": "deep-analysis",
    "input": { "corpus": "..." },
    "budget": { "max_tokens": 2000, "detail_level": "full" }
  }
}
```

**Stream events (SSE / gRPC):**

```
event: progress    → { "taskId": "t1", "pct": 25, "msg": "Parsing..." }
event: partial     → { "taskId": "t1", "chunk": { "section": "intro", "text": "..." } }
event: complete    → { "taskId": "t1", "result": { "minimal": "...", "compact": {...}, "full": {...} } }
```

Additional lifecycle events: `cancelled`, `suspended`, `resumed`.

### 3.4 `nekte.context` — Context Envelopes

Passes context between agents with explicit permissions and TTL:

```jsonc
{
  "method": "nekte.context",
  "params": {
    "envelope": {
      "id": "ctx-001",
      "data": { "user_preferences": { "lang": "es" } },
      "permissions": { "forward": true, "persist": false, "derive": true },
      "ttl_s": 3600,
      "compression": "none",
      "budget_hint": { "max_tokens": 200, "detail_level": "compact" }
    }
  }
}
```

### 3.5 `nekte.verify` — Result Verification

Verifies result integrity with hash proofs, sampling, and source tracking:

```jsonc
{
  "method": "nekte.verify",
  "params": {
    "task_id": "t1",
    "strategy": "hash",       // "hash" | "sample" | "full"
    "expected_hash": "abc123"
  }
}
```

### 3.6 `nekte.task.cancel` — Cancel Task

Sends a cooperative cancellation signal (AbortSignal) to a running or suspended task:

```jsonc
{ "method": "nekte.task.cancel", "params": { "task_id": "t1", "reason": "user_abort" } }
```

### 3.7 `nekte.task.resume` — Resume Task

Resumes a suspended task from its last checkpoint:

```jsonc
{ "method": "nekte.task.resume", "params": { "task_id": "t1", "checkpoint": { "step": 3 } } }
```

### 3.8 `nekte.task.status` — Query Task State

```jsonc
{ "method": "nekte.task.status", "params": { "task_id": "t1" } }
// Response: { "state": "running", "progress": 0.65, "updated_at": "..." }
```

---

## 4. Task Lifecycle State Machine

```
pending ──→ accepted ──→ running ──→ completed
                           │
                           ├──→ suspended ──→ running (resume)
                           │
                           └──→ failed
         (any non-terminal) ──→ cancelled
```

**Valid transitions:**

| From | To | Trigger |
|------|----|---------|
| `pending` | `accepted` | Server accepts task |
| `accepted` | `running` | Handler begins execution |
| `running` | `completed` | Handler finishes successfully |
| `running` | `suspended` | Handler yields checkpoint |
| `running` | `failed` | Handler throws / unrecoverable error |
| `suspended` | `running` | `nekte.task.resume` |
| Any non-terminal | `cancelled` | `nekte.task.cancel` |

**Handler contract:**

```typescript
type DelegateHandler = (
  task: TaskEntry,
  stream: StreamWriter,
  context: HandlerContext,  // .signal is REQUIRED (AbortSignal)
  signal: AbortSignal
) => Promise<void>;
```

---

## 5. Transport Layer

### 5.1 Supported Transports

| Transport | Use Case | Streaming | Protocol |
|-----------|----------|-----------|----------|
| **HTTP/SSE** | Default, broad compatibility | Server-Sent Events | JSON-RPC over HTTP |
| **gRPC** | High-throughput, polyglot | Server-streaming | Protobuf (`nekte.proto`) |
| **WebSocket** | Low-latency bidirectional | Full-duplex | JSON-RPC over WS |
| **stdio** | MCP server subprocesses | Pipe-based | JSON-RPC over stdin/stdout |

### 5.2 gRPC Service Definition

```protobuf
service Nekte {
  rpc Discover(DiscoverRequest)   returns (DiscoverResponse);
  rpc Invoke(InvokeRequest)       returns (InvokeResponse);
  rpc Delegate(DelegateRequest)   returns (stream DelegateEvent);  // server-streaming
  rpc Context(ContextRequest)     returns (ContextResponse);
  rpc Verify(VerifyRequest)       returns (VerifyResponse);
  rpc TaskCancel(TaskCancelRequest) returns (TaskLifecycleResponse);
  rpc TaskResume(TaskResumeRequest) returns (TaskLifecycleResponse);
  rpc TaskStatus(TaskStatusRequest) returns (TaskStatusResponse);
}
```

### 5.3 Authentication

Pluggable auth via the `AuthHandler` port:

- **Bearer token** — `Authorization: Bearer <token>`
- **API key** — `X-API-Key: <key>`
- **Custom** — Implement `AuthHandler` interface

---

## 6. Caching Architecture

NEKTE employs a CPU-inspired caching strategy optimized for token cost:

### 6.1 SIEVE Eviction (NSDI 2024)

Scan-resistant, O(1) amortized eviction. Outperforms LRU for discovery workloads where agents periodically scan the full catalog without displacing frequently-used entries.

### 6.2 GDSF Token-Cost Weighting

Greedy Dual-Size Frequency prioritizes entries by token cost: an L2 schema (~120 tokens) survives eviction over an L0 catalog entry (~8 tokens), because re-fetching L2 is 15× more expensive.

### 6.3 Stale-While-Revalidate

Serve stale cache entries immediately while refreshing in the background. Zero-latency cache hits, eventual consistency.

### 6.4 Additional Mechanisms

- **Negative caching** — Remember "capability doesn't exist" to avoid repeated misses
- **TTL jitter** — Randomize expiry to prevent cache stampedes
- **Request coalescing** — N concurrent refreshes for the same key → 1 network call

---

## 7. MCP Bridge

The `@nekte/bridge` package provides a **drop-in proxy** that translates MCP → NEKTE, enabling 90%+ token savings with **zero backend changes**:

```bash
nekte-bridge --mcp-url http://localhost:3000/mcp --name github --port 3100
```

**How it works:**

1. Connects to an existing MCP server (HTTP or stdio)
2. Converts MCP tool definitions to NEKTE capabilities
3. Applies progressive discovery, version hashing, and result compression
4. Exposes a NEKTE endpoint that agents consume

**Bridge metrics:** Request counts, cache hit rates, token savings, latency percentiles — available via `/health` endpoint.

---

## 8. SDK Architecture

### 8.1 TypeScript SDK (Reference Implementation)

**Monorepo:** 5 packages with strict dependency ordering.

```
@nekte/core     → Protocol types, schemas, hashing, codec, state machine, gRPC types
@nekte/client   → Transport port, HTTP/gRPC adapters, discovery cache, streaming
@nekte/server   → Capability/task registries, HTTP/WS/gRPC transports, auth
@nekte/bridge   → MCP→NEKTE proxy with cache, hashing, compression, metrics
@nekte/cli      → CLI: discover, invoke, health, card, bench
```

**Dependency graph:** `core ← client ← cli` | `core ← server ← bridge`

### 8.2 Python SDK

**Architecture:** Mirrors TypeScript with 4 explicit layers.

```
domain/        → Pure logic, zero I/O (Pydantic models, budget, hashing, SIEVE cache)
ports/         → Interfaces (Protocol classes, zero I/O)
application/   → Orchestration (NekteClient, CapabilityCache, TaskRegistry)
adapters/      → I/O implementations (httpx, grpcio, starlette)
```

**Dependencies:** httpx, pydantic ≥2.7, anyio ≥4.4. Optional: grpcio, starlette/uvicorn.

---

## 9. Security Considerations

### 9.1 Authentication & Authorization

- Transport-level auth (bearer, API key) before any primitive is processed
- Pluggable `AuthHandler` allows integration with existing identity providers

### 9.2 Context Permissions

Context envelopes carry explicit permission flags:
- `forward` — Can the context be passed to downstream agents?
- `persist` — Can the context be stored beyond the interaction?
- `derive` — Can new contexts be created from this one?

### 9.3 TTL Enforcement

All context envelopes have a `ttl_s` field. Expired contexts **MUST** be rejected.

### 9.4 Version Hash Integrity

Version hashes prevent stale invocations. A hash mismatch forces schema refresh, preventing execution against an outdated contract.

---

## 10. Wire Format

### 10.1 JSON-RPC 2.0

Default envelope format. All primitives are JSON-RPC methods with `nekte.*` namespace.

### 10.2 MessagePack (Optional)

Binary codec providing ~30% size reduction over JSON. Negotiated via `Accept` header or gRPC content type.

### 10.3 Protobuf (gRPC)

Full proto definitions in `@nekte/core/proto/nekte.proto`. Used for gRPC transport with native server-streaming for `Delegate`.

---

## 11. Versioning & Compatibility

- **Protocol version:** Included in discovery responses (`v` field)
- **Capability versioning:** Version hashes derived from schema content (content-addressable)
- **SDK versioning:** Follows semver; changesets for npm publishing
- **Backward compatibility:** Hash mismatch triggers inline schema refresh (graceful degradation)

---

## 12. Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **v0.2** | Spec + TS SDK + MCP Bridge + gRPC + Task Lifecycle | ✅ Complete |
| **v0.3** | Context/verify full impl + docs site + Python SDK | 🔄 In Progress |
| **v0.4** | Advanced verification + public benchmarks | 📋 Planned |
| **v1.0** | Stable spec + Python/Go SDKs + agent registry | 📋 Planned |

---

## 13. Open Questions

1. **Agent Registry:** Should NEKTE define a standard registry for agent discovery beyond direct URLs? (Planned for v1.0)
2. **Multi-hop delegation:** How should token budgets propagate across chains of delegated tasks?
3. **Batch invocation:** Should NEKTE support batching multiple `nekte.invoke` calls in a single request?
4. **Capability negotiation:** Should agents negotiate capabilities bidirectionally (mutual discovery)?
5. **Observability standard:** Should tracing/metrics be a protocol-level concern or left to implementations?

---

## 14. References

- [NEKTE Protocol Specification v0.2](./SPEC.md)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
- [Agent-to-Agent Protocol (A2A)](https://github.com/google/A2A)
- [SIEVE Eviction Algorithm (NSDI 2024)](https://www.usenix.org/conference/nsdi24/presentation/zhang-yazhuo)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)

---

## Appendix A: Quick Start

### Server

```typescript
import { createServer, createCapabilityRegistry } from '@nekte/server';

const registry = createCapabilityRegistry();
registry.register({
  id: 'sentiment',
  category: 'nlp',
  description: 'Analyzes text sentiment',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  outputSchema: { type: 'object', properties: { label: { type: 'string' }, score: { type: 'number' } } },
  handler: async (input) => ({
    minimal: `positive 0.92`,
    compact: { label: 'positive', score: 0.92 },
    full: { label: 'positive', score: 0.92, explanation: 'Strong positive indicators...' }
  })
});

const server = createServer({ registry, port: 4001 });
await server.start();
```

### Client

```typescript
import { NekteClient, createHttpTransport } from '@nekte/client';

const client = new NekteClient({ transport: createHttpTransport('http://localhost:4001') });

// Progressive discovery
const catalog = await client.discover({ level: 0 });           // L0: ~8 tok/cap
const details = await client.discover({ level: 1, filter: { category: 'nlp' } }); // L1

// Zero-schema invocation (uses cached version hash)
const result = await client.invoke('sentiment', {
  input: { text: 'This is great!' },
  budget: { max_tokens: 100, detail_level: 'compact' }
});

// Streaming delegation with cancellation
const stream = await client.delegate('deep-analysis', { input: { corpus: '...' } });
for await (const event of stream.events) {
  if (event.type === 'progress') console.log(`${event.pct}%`);
  if (event.type === 'complete') console.log(event.result);
}
// stream.cancel() — cooperative cancellation via AbortSignal
```

### Python Client

```python
from nekte import NekteClient, HttpTransport, InMemoryCacheStore, CapabilityCache

async with NekteClient(
    "http://localhost:4001",
    transport=HttpTransport("http://localhost:4001"),
    cache=CapabilityCache(store=InMemoryCacheStore()),
) as client:
    catalog = await client.catalog()
    result = await client.invoke("sentiment", input={"text": "Great!"})
    print(result.out)
```

---

*This RFC is a living document. Feedback and contributions are welcome at [github.com/nekte-protocol/nekte](https://github.com/nekte-protocol/nekte).*
