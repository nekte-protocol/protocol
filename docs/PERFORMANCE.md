# NEKTE Performance Changelog

Living document tracking all performance decisions, optimizations, and benchmarks.
Every performance-related change must be documented here with rationale, affected files, and measured/expected impact.

---

## Table of Contents

- [Architectural Decisions (v0.2)](#architectural-decisions-v02)
- [Cache Architecture (v0.3)](#cache-architecture-v03)
- [Optimization Strategies Study](#optimization-strategies-study)
- [Runtime & Transport Optimizations (2026-04-08)](#runtime--transport-optimizations-2026-04-08)
- [Deploy Configuration](#deploy-configuration)
- [Template for Future Entries](#template-for-future-entries)

---

## Architectural Decisions (v0.2)

> Commit `40791df` — NEKTE Protocol v0.2

These are foundational design choices that define NEKTE's performance characteristics.

### Progressive Discovery (L0/L1/L2)

**Files:** `packages/core/src/types.ts`

Three-level capability discovery avoids eager schema loading:

| Level | Content | Token cost |
|-------|---------|------------|
| L0 (Catalog) | `id` + `category` + `version_hash` | ~8 tokens/cap |
| L1 (Summary) | + `description` + `cost` hints | ~40 tokens/cap |
| L2 (Full) | + JSON Schema + examples | ~120 tokens/cap |

**Impact:** 89-99% savings on schema transmission. With 30 tools: 3,600 tokens (MCP eager) vs <800 tokens (NEKTE L0+L1 on demand).

**Research basis:** Speakeasy (2025) measured that the "Two-Stage Pattern" (minimal listing + on-demand schema) achieves 96% token reduction. LLM tool-calling accuracy degrades at 20-25 simultaneously loaded tools (Opus 4: 49% to 74% improvement with lazy loading).

### Zero-Schema Invocation via Version Hashing

**Files:** `packages/core/src/hash.ts`

Stable 8-character SHA-256 hash over canonical JSON of `{input, output}` schemas. Only structural changes alter the hash — description/metadata changes are ignored.

**Flow:**
1. Client caches `capability.h` from discovery
2. On invoke, sends `params.h` instead of full schema
3. Server validates hash matches → executes immediately
4. On mismatch → returns `VERSION_MISMATCH` with updated schema inline (no extra RTT)

**Impact:** Eliminates all redundant schema fetches after first discovery.

### Token Budget as First-Class Citizen

**Files:** `packages/core/src/budget.ts`

Every NEKTE message carries a `TokenBudget { max_tokens, detail_level }`. The `resolveBudget()` function falls back to coarser levels when the requested level exceeds budget.

**Multi-level result pattern:** Every tool result exposes `MultiLevelResult<TMin, TCom, TFul>` with three representations. The budget resolver picks the best fit.

**Impact:** Zero "budget exceeded" errors. Respects caller's context window constraints.

### MessagePack Wire Codec

**Files:** `packages/core/src/msgpack.ts`

Optional binary format for high-throughput agent pipelines (NATS, batch processing). ~30% smaller than JSON on the wire.

Does NOT affect token counting — tokens are measured on semantic content, not wire encoding.

### Wire Format Field Compression

**Files:** `packages/core/src/codec.ts`

Replaces verbose field names with short aliases for compact/minimal responses:
`jsonrpc` → `j`, `method` → `m`, `params` → `p`, `version_hash` → `h`, etc.

**Impact:** Additional ~15-20% token savings on compact/minimal responses.

---

## Cache Architecture (v0.3)

> Commit `b1e738d` — Advanced cache architecture

Seven cache techniques introduced together in a single cohesive architecture.

### SIEVE Eviction Policy (NSDI 2024)

**Files:** `packages/core/src/cache/sieve-policy.ts`

Implements the algorithm from "SIEVE is Simpler than LRU" (NSDI 2024). Replaces LRU with FIFO queue + hand pointer + per-entry visited bit.

**Why SIEVE over LRU/ARC:**
- **Scan-resistant:** bulk L0 discovery responses (100+ entries) don't evict the hot set
- **O(1) access:** marking visited=true requires no list reordering (LRU needs move-to-front)
- **Simple:** ~30 LOC vs ARC's ~200 LOC, with 90% of ARC's benefit at 1000-entry scale

**Measured impact:** 21% better hit rate vs FIFO, comparable to ARC.

### Token-Cost-Weighted Eviction (GDSF)

**Files:** `packages/client/src/cache-store.ts` (lines 156-198), `packages/core/src/cache/token-cost.ts`

Greedy Dual-Size-Frequency simplified for token cost:
```
priority(entry) = accessCount × tokenCostToRefetch
```

Token costs per level: L0 = 8, L1 = 40, L2 = 120 tokens.

**Example:** An L2 entry accessed 3x has priority 360 vs an L0 entry accessed 1x at priority 8. Eviction protects expensive-to-refetch entries.

**Integration:** `evict()` checks GDSF priority of 3 SIEVE candidates, picks lowest.

### Stale-While-Revalidate

**Files:** `packages/client/src/cache.ts`

Three freshness states:
```
age <= TTL           → fresh (return immediately)
TTL < age <= grace   → stale (return + trigger background refresh)
grace < age          → expired (delete)
```

Grace period = `TTL × graceFactor` (default: 2, so total window = 3× TTL).

**Impact:** Eliminates P99 latency spikes on TTL expiry. 99% of schemas don't change within 5-10 minutes — serving stale is correct.

### TTL Jitter

**Files:** `packages/client/src/cache-store.ts`

±10% randomization on TTL prevents synchronized expiry stampedes when bulk entries are cached simultaneously.

### Negative Caching

**Files:** `packages/client/src/cache.ts`

Remembers "capability does NOT exist" with short TTL (default: 60s). Prevents repeated failed discovery calls in multi-agent routing scenarios.

### Request Coalescing (Thundering Herd Prevention)

**Files:** `packages/client/src/request-coalescer.ts`

If N concurrent requests hit the same stale cache entry, only 1 network call executes. Others await the same Promise.

**Impact:** 5 concurrent `discover()` calls → 1 actual network request.

### Bridge Result Compressor

**Files:** `packages/bridge/src/compressor.ts`

Converts verbose MCP tool results to multi-level NEKTE format:
- `buildMinimal()`: First non-empty line, capped at ~80 chars (~20 tokens)
- `buildCompact()`: Structured summary, flatten to depth 2, limit arrays to 3 items (~200 tokens)
- `buildFull()`: Complete MCP response

**Impact:** 40-90% result token reduction depending on budget.

---

## Optimization Strategies Study

> Commit `ae6852e` — Optimization strategies study and full benchmark report

Studied three advanced strategies for further token reduction:

| Strategy | Technique | Savings |
|----------|-----------|---------|
| History decay | Compress older turns: full → compact → minimal → reference | 15-25% additional |
| Sliding window | Last 4 turns full, older collapsed to 200-token summary | 20-30% additional |
| Delta encoding | Repeated tool calls send ~40% via structural dedup | 10-15% additional |
| Combined | All three applied together | 56-81% total (up from 42-69%) |

**Benchmark results:** `benchmarks/market-mcps/results/BENCHMARK_RESULTS.md`

---

## Runtime & Transport Optimizations (2026-04-08)

Applied based on codebase profiling + research from gRPC performance papers, Node.js GC benchmarks, SSE/WebSocket studies, and agent protocol research (Google A2A, Speakeasy, ACL 2025).

### 1. Fix O(n^2) String Concatenation in HTTP Body Parsing

**File:** `packages/server/src/http-transport.ts` — `readBody()`

**Before:** `body += chunk` creates a new string copy per chunk. For a 100KB payload, this causes ~500 intermediate string allocations.

**After:** Collect `Buffer[]` chunks, then `Buffer.concat().toString()` once — O(n) total.

**Expected impact:** Significant CPU/memory reduction under high request volume (>1000 RPS) or large payloads (>10KB).

### 2. Enable msgpackr Record Extension

**File:** `packages/core/src/msgpack.ts`

**Before:** Stateless `pack()`/`unpack()` calls.

**After:** Shared `Packr({ structures: [] })` instance. NEKTE messages have highly repetitive keys (`jsonrpc`, `method`, `id`, `params`). The record extension auto-detects repeated structures across calls.

**Expected impact:** 2-3x decode speedup + smaller binary payloads.

**Research basis:** [msgpackr benchmarks](https://github.com/kriszyp/msgpackr) show msgpackr with structures outperforms `JSON.stringify`/`JSON.parse` by 2-4x.

### 3. Cache Token Estimation in Budget Resolution

**File:** `packages/core/src/budget.ts` — `resolveBudget()`

**Before:** `estimateTokens()` called per detail level, each calling `JSON.stringify()`. Up to 3 stringify calls per response.

**After:** Cache estimation results in a local `Map<DetailLevel, number>`. Each level stringified at most once.

**Expected impact:** Eliminates 2/3 of JSON.stringify calls in budget resolution hot path. For 100KB responses: 1.2MB → 400KB temporary string allocation.

### 4. Semantic Filter Result Cache

**File:** `packages/server/src/server.ts` — `handleDiscover()`

**Before:** Every `nekte.discover` with a query re-runs the semantic filter strategy (potentially embedding calls) even for identical queries.

**After:** LRU cache (`Map<string, { caps, ts }>`) with 30s TTL and 100-entry max. Cache key includes query + top_k + threshold + category.

**Expected impact:** Eliminates redundant embedding/ML calls for repeated discovery patterns. Critical when semantic filtering involves external API calls.

### 5. Async Listener Emission in TaskRegistry

**File:** `packages/server/src/task-registry.ts` — `emit()`

**Before:** Listeners called synchronously in a `for` loop. A slow listener (e.g., DB persistence) blocks all state transitions.

**After:** Each listener invoked via `queueMicrotask()` — decoupled from the transition.

**Expected impact:** State transitions no longer blocked by listener latency. Task cancel/resume/complete operations become consistently fast regardless of observers.

### 6. Lazy Iterator for CapabilityRegistry

**File:** `packages/server/src/capability.ts`

**Before:** `all()` called `Array.from(map.values())` creating a full array copy on every discover/delegate call.

**After:** Added `values()` iterator and `size` getter. Updated server hot paths (`agentCard()`, `handleDelegate()`, `handleVerify()`) to use `size` checks and `values()` where full array isn't needed.

**Expected impact:** Eliminates unnecessary array allocations when only checking count or iterating once.

### 7. SSE Backpressure Handling

**File:** `packages/server/src/sse-stream.ts` — `send()`

**Before:** `res.write()` called unconditionally. If client stops consuming, Node.js buffers indefinitely.

**After:** Check `res.writableEnded` before writing. Monitor `res.write()` return value and listen for `drain` events when kernel buffer is full.

**Expected impact:** Prevents unbounded memory growth when SSE clients are slow or disconnected.

### 8. Context Store Cleanup Timer

**File:** `packages/server/src/server.ts`

**Before:** Context Maps (`contexts`, `contextTimestamps`) grew unbounded. Cleanup only happened on lazy TTL check during `request` action or explicit `revoke`.

**After:** Periodic timer (60s interval, `.unref()`'d) proactively removes expired contexts.

**Expected impact:** Prevents memory leak in long-running servers with many short-lived contexts.

### 9. Parallel MCP Server Connections in Bridge

**File:** `packages/bridge/src/bridge.ts` — `init()`

**Before:** Sequential `for...of` loop connecting to each MCP server one at a time.

**After:** `Promise.allSettled()` connects to all servers in parallel. Individual failures logged without blocking others.

**Expected impact:** Bridge startup time reduced from `sum(connection_times)` to `max(connection_times)`. With 5 MCP servers at ~200ms each: 1000ms → 200ms.

### 10. Incremental Signature Cache for MCP Schema Refresh

**File:** `packages/bridge/src/mcp-connector.ts`

**Before:** On every 5-minute refresh, `toolsSignature()` called `JSON.stringify()` on all tools for both old and new sets (2x full stringify).

**After:** Cache the computed signature per server on connect. On refresh, only stringify the new tools and compare against cached signature.

**Expected impact:** Halves the JSON.stringify work on schema refresh. With 1000 tools across servers, saves ~2MB of temporary string allocation per refresh cycle.

### 11. gRPC Keepalive Tuning

**File:** `packages/client/src/grpc-transport.ts`

Added channel options for long-lived delegate streams:
```
grpc.keepalive_time_ms: 20,000      (ping every 20s)
grpc.keepalive_timeout_ms: 5,000    (5s to respond)
grpc.keepalive_permit_without_calls: 1
grpc.http2.min_time_between_pings_ms: 10,000
```

**Expected impact:** Detects dead connections within 25s instead of relying on TCP timeouts (potentially minutes). Critical for long-running delegate streams that go idle between progress events.

**Research basis:** [gRPC Keepalive Guide](https://grpc.io/docs/guides/keepalive/)

---

## Deploy Configuration

### V8 GC Tuning

```bash
node --max-semi-space-size=64 server.js
```

Default semi-space is 16MB. Increasing to 64MB reduces GC pauses for servers with high short-lived allocation rates (TaskRegistry map operations, JSON parsing, budget resolution).

**Research basis:** [NearForm benchmarks](https://nearform.com/digital-community/optimising-node-js-applications-the-impact-of-max-semi-space-size-on-garbage-collection-efficiency/) measured 14.5 → 17.4 req/s (+20%) at 128MB. 64MB is the recommended balance for NEKTE's allocation profile.

### Future Transport Considerations

These are researched but not yet implemented:

| Technique | Expected Impact | Source |
|-----------|----------------|--------|
| `undici` with connection pooling | 3-5x faster than `fetch()` | [DEV.to analysis](https://dev.to/alex_aslam/why-undici-is-faster-than-nodejss-core-http-module-and-when-to-switch-1cjf) |
| zstd compression for gRPC | 12% latency reduction vs gzip | [DoorDash Engineering](https://doordash.engineering/2020/07/20/enabling-efficient-machine-learning-model-serving/) |
| Worker threads for hash/validation | Up to 70% reduction in CPU-bound work | [Plaid Engineering](https://plaid.com/blog/how-we-parallelized-our-node-service-by-30x/) |
| HTTP/2 for SSE multiplexing | Eliminates 6-connection-per-domain limit | HTTP/2 spec |
| Dynamic token budget allocation | Adjusts detail thresholds based on remaining context | [ACL 2025](https://aclanthology.org/2025.findings-acl.1274.pdf) |

---

## Template for Future Entries

When adding a performance optimization, document it using this format:

```markdown
### Title

**File:** `packages/pkg/src/file.ts` — `functionName()`

**Before:** What the code did and why it was suboptimal.

**After:** What changed and how the new approach works.

**Expected/Measured impact:** Quantitative improvement (latency, memory, throughput).

**Research basis:** (Optional) Link to paper, benchmark, or forum post that motivated the change.
```

Group related changes under a dated section header (e.g., `## Transport Optimizations (2026-05-15)`).
