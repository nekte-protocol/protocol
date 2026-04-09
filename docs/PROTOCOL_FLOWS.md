# NEKTE Protocol Flows

Visual diagrams of the core protocol interactions.

## 1. Progressive Discovery (L0 -> L1 -> L2)

```mermaid
sequenceDiagram
    participant A as Agent A (Client)
    participant B as Agent B (Server)

    Note over A,B: L0 — Catalog (~8 tok/cap)
    A->>B: nekte.discover { level: 0 }
    B-->>A: { caps: [{ id, cat, h }, ...] }

    Note over A: Agent decides it needs more info on "sentiment"

    Note over A,B: L1 — Summary (~40 tok/cap)
    A->>B: nekte.discover { level: 1, filter: { id: "sentiment" } }
    B-->>A: { caps: [{ id, cat, h, desc, cost }] }

    Note over A: Agent decides to invoke — requests full schema

    Note over A,B: L2 — Full Schema (~120 tok/cap)
    A->>B: nekte.discover { level: 2, filter: { id: "sentiment" } }
    B-->>A: { caps: [{ id, cat, h, desc, input, output, examples }] }
```

## 2. Zero-Schema Invocation

```mermaid
sequenceDiagram
    participant A as Agent A (Client)
    participant B as Agent B (Server)

    Note over A,B: First invocation (includes version hash)
    A->>B: nekte.invoke { cap: "sentiment", h: "a1b2c3d4", in: {...} }
    Note over B: Hash matches → execute directly
    B-->>A: { out: {...}, resolved_level: "compact" }

    Note over A: Client caches hash "a1b2c3d4"

    Note over A,B: Second invocation (zero-schema — 0 extra tokens)
    A->>B: nekte.invoke { cap: "sentiment", h: "a1b2c3d4", in: {...} }
    B-->>A: { out: {...} }

    Note over A,B: Schema changed → VERSION_MISMATCH
    A->>B: nekte.invoke { cap: "sentiment", h: "a1b2c3d4", in: {...} }
    B-->>A: error: VERSION_MISMATCH { current_hash: "e5f6g7h8", schema: {...} }
    Note over A: Client updates cache, retries
    A->>B: nekte.invoke { cap: "sentiment", in: {...} }
    B-->>A: { out: {...} }
```

## 3. Task Delegation with Streaming (SSE)

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant W as Worker Agent
    participant TR as TaskRegistry

    O->>W: nekte.delegate { task, context }
    W->>TR: register(task) → TaskEntry + AbortSignal
    TR-->>W: entry { status: "pending" }
    W->>TR: transition("accepted")
    W->>TR: transition("running")

    loop Processing
        W-->>O: SSE: progress { processed, total }
    end

    W-->>O: SSE: partial { preliminary_score: 0.72 }
    W-->>O: SSE: complete { task_id, out, meta }
    W->>TR: transition("completed")
```

## 4. Task Cancellation

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant TR as TaskRegistry

    C->>S: nekte.delegate { task: { id: "t-001" } }
    S->>TR: register → AbortSignal
    S-->>C: SSE: progress { 1/100 }
    S-->>C: SSE: progress { 2/100 }

    Note over C: User wants to cancel

    C->>S: nekte.task.cancel { task_id: "t-001", reason: "user requested" }
    S->>TR: cancel("t-001") → abortController.abort()
    TR-->>S: { status: "cancelled", previous_status: "running" }
    S-->>C: { task_id, status: "cancelled", previous_status: "running" }

    Note over S: Handler detects signal.aborted, stops work
    S-->>C: SSE: cancelled { task_id, reason, previous_status }
```

## 5. Task Suspend + Resume

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant TR as TaskRegistry

    C->>S: nekte.delegate { task: { id: "t-002" } }
    S->>TR: register + transition(running)
    S-->>C: SSE: progress { 50/100 }

    Note over S: Handler saves checkpoint
    S->>TR: saveCheckpoint({ batch: 50, partial_results: [...] })
    S->>TR: transition("suspended")
    S-->>C: SSE: suspended { task_id, checkpoint_available: true }

    Note over C: Later...

    C->>S: nekte.task.resume { task_id: "t-002" }
    S->>TR: resume("t-002") → transition("running")
    S-->>C: { status: "running", previous_status: "suspended" }

    Note over S: Handler resumes from checkpoint
    S-->>C: SSE: resumed { task_id, from_checkpoint: true }
    S-->>C: SSE: progress { 51/100 }
    S-->>C: SSE: complete { task_id, out }
```

## 6. Task Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> accepted
    pending --> cancelled
    pending --> failed
    accepted --> running
    accepted --> cancelled
    accepted --> failed
    running --> completed
    running --> failed
    running --> cancelled
    running --> suspended
    suspended --> running : resume
    suspended --> cancelled
    suspended --> failed
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

## 7. gRPC Transport Flow

```mermaid
sequenceDiagram
    participant C as gRPC Client
    participant GT as GrpcTransport
    participant NS as NekteServer
    participant TR as TaskRegistry

    Note over C,GT: Unary RPC
    C->>GT: Discover(proto request)
    GT->>GT: fromProtoDiscoverRequest()
    GT->>NS: handleRequest(NekteRequest)
    NS-->>GT: NekteResponse
    GT->>GT: toProtoDiscoverResponse()
    GT-->>C: proto response

    Note over C,GT: Server-Streaming RPC (Delegate)
    C->>GT: Delegate(proto request)
    GT->>GT: fromProtoDelegateRequest()
    GT->>TR: register(task) → AbortSignal
    GT->>NS: delegateHandler(task, GrpcDelegateStream, ctx, signal)

    loop Streaming
        NS-->>GT: stream.progress()
        GT->>GT: toProtoDelegateEvent()
        GT-->>C: DelegateEvent (proto)
    end

    NS-->>GT: stream.complete()
    GT-->>C: DelegateEvent:complete
    GT->>TR: transition("completed")
```

## 8. MCP Bridge Flow

```mermaid
sequenceDiagram
    participant A as Agent
    participant BR as NEKTE Bridge
    participant MCP as MCP Server

    Note over BR,MCP: Startup: bridge connects to MCP
    BR->>MCP: initialize + tools/list
    MCP-->>BR: [tool1, tool2, tool3, ...]
    Note over BR: Build catalog, compute hashes

    Note over A,BR: Agent discovers via NEKTE
    A->>BR: nekte.discover { level: 0 }
    BR-->>A: { caps: [{ id, cat, h }, ...] }
    Note right of BR: From cache — ~24 tokens

    Note over A,BR: Agent invokes via NEKTE
    A->>BR: nekte.invoke { cap: "tool1", h: "abc123", in: {...}, budget: { max_tokens: 50 } }
    BR->>MCP: tools/call { name: "tool1", arguments: {...} }
    MCP-->>BR: { content: [{ type: "text", text: "..." }] }
    Note over BR: Compress result according to budget
    BR-->>A: { out: { text: "..." }, resolved_level: "minimal" }
```

## 9. Token Budget Resolution

```mermaid
flowchart TD
    A[Handler produces result] --> B{Budget detail_level?}
    B -->|full| C[Try full representation]
    B -->|compact| D[Try compact representation]
    B -->|minimal| E[Return minimal]

    C --> F{Fits in max_tokens?}
    F -->|yes| G[Return full]
    F -->|no| D

    D --> H{Fits in max_tokens?}
    H -->|yes| I[Return compact]
    H -->|no| E

    style G fill:#00ff88,color:#000
    style I fill:#ffee00,color:#000
    style E fill:#ff00aa,color:#fff
```

## 10. Transport Architecture (Hexagonal)

```mermaid
flowchart LR
    subgraph Domain
        NS[NekteServer]
        TR[TaskRegistry]
        CR[CapabilityRegistry]
    end

    subgraph Adapters
        HTTP[HTTP/SSE Adapter]
        GRPC[gRPC Adapter]
        WS[WebSocket Adapter]
    end

    subgraph Client
        NC[NekteClient]
        TP[Transport Port]
        HT[HttpTransport]
        GCT[GrpcTransport]
    end

    HTTP --> NS
    GRPC --> NS
    WS --> NS
    NS --> TR
    NS --> CR

    NC --> TP
    TP -.-> HT
    TP -.-> GCT
    HT --> HTTP
    GCT --> GRPC
```

## 11. Wire Format Options

```mermaid
flowchart LR
    A[NEKTE Message] --> B{Transport}
    B --> C[HTTP POST JSON]
    B --> D[HTTP POST MessagePack]
    B --> E[gRPC Protobuf]
    B --> F[WebSocket JSON]
    B --> G[WebSocket MessagePack]
    B --> H[stdio JSON-RPC]

    style C fill:#0a0f1e,stroke:#00f5ff,color:#00f5ff
    style D fill:#0a0f1e,stroke:#ff00aa,color:#ff00aa
    style E fill:#0a0f1e,stroke:#00ff88,color:#00ff88
    style F fill:#0a0f1e,stroke:#00f5ff,color:#00f5ff
    style G fill:#0a0f1e,stroke:#ff00aa,color:#ff00aa
    style H fill:#0a0f1e,stroke:#ffee00,color:#ffee00
```
