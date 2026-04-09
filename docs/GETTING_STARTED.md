# Getting Started with NEKTE

This guide walks you through building two agents that communicate via the NEKTE protocol, adding gRPC transport, task lifecycle management, and bridging MCP servers.

## Prerequisites

- Node.js 20+
- pnpm 9+

## 1. Create a NEKTE Server (Agent)

```typescript
// server.ts
import { z } from 'zod';
import { NekteServer } from '@nekte/server';

const server = new NekteServer({
  agent: 'weather-agent',
  version: '1.0.0',
});

// Register a capability with typed schemas
server.capability('get-weather', {
  inputSchema: z.object({
    city: z.string(),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  outputSchema: z.object({
    temp: z.number(),
    condition: z.string(),
  }),
  category: 'weather',
  description: 'Get current weather for a city',
  handler: async (input, ctx) => {
    // ctx.signal is always available for cooperative cancellation
    if (ctx.signal.aborted) throw new Error('Cancelled');
    return { temp: 22, condition: 'sunny' };
  },
  // Multi-level result compression
  toMinimal: (out) => `${out.temp}° ${out.condition}`,
  toCompact: (out) => ({ t: out.temp, c: out.condition }),
});

server.listen(4001);
```

Run it:

```bash
npx tsx server.ts
```

## 2. Create a NEKTE Client

```typescript
// client.ts
import { NekteClient } from '@nekte/client';

const client = new NekteClient('http://localhost:4001');

// Step 1: Discover what the agent can do (~8 tokens per capability)
const catalog = await client.catalog();
console.log('Capabilities:', catalog.caps.map(c => c.id));

// Step 2: Get details about a specific capability (~40 tokens)
const detail = await client.describe('get-weather');
console.log('Description:', (detail.caps[0] as any).desc);

// Step 3: Invoke with a token budget
const result = await client.invoke('get-weather', {
  input: { city: 'Madrid' },
  budget: { max_tokens: 50, detail_level: 'minimal' },
});
console.log('Result:', result.out);

// Step 4: Second invocation — zero-schema (0 extra tokens!)
const result2 = await client.invoke('get-weather', {
  input: { city: 'Tokyo' },
});
console.log('Result2:', result2.out);

// Clean up
await client.close();
```

Run it:

```bash
npx tsx client.ts
```

## 3. Streaming Delegation with Cancel

```typescript
// delegate.ts
import { NekteServer } from '@nekte/server';
import { NekteClient } from '@nekte/client';
import { z } from 'zod';

// --- Server ---
const server = new NekteServer({ agent: 'analysis-worker' });

server.capability('analyze', {
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ score: z.number() }),
  category: 'nlp',
  description: 'Analyze text',
  handler: async (input) => ({ score: 0.9 }),
});

// Register streaming delegate handler
// signal is required — always provided by the task registry
server.onDelegate(async (task, stream, context, signal) => {
  const total = 100;
  for (let i = 1; i <= total; i++) {
    // Cooperative cancellation — check signal in your loop
    if (signal.aborted) {
      stream.cancelled(task.id, 'running', 'Aborted by client');
      return;
    }

    stream.progress(i, total, `Processing batch ${i}`);
    await new Promise(r => setTimeout(r, 50));
  }

  stream.complete(task.id, {
    minimal: 'Analysis complete',
    compact: { batches: total, score: 0.85 },
  });
});

server.listen(4001);

// --- Client ---
const client = new NekteClient('http://localhost:4001');

// delegateStream returns a DelegateStream with events + cancel
const stream = client.delegateStream({
  id: 'task-001',
  desc: 'Analyze customer reviews',
  timeout_ms: 60_000,
});

for await (const event of stream.events) {
  switch (event.event) {
    case 'progress':
      console.log(`${event.data.processed}/${event.data.total}`);
      // Cancel after 50% progress
      if (event.data.processed >= 50) {
        await stream.cancel('User requested early stop');
      }
      break;
    case 'complete':
      console.log('Done:', event.data.out);
      break;
    case 'cancelled':
      console.log('Cancelled:', event.data.reason);
      break;
  }
}

// Query task status after completion
const status = await client.taskStatus('task-001');
console.log('Final status:', status.status, 'Checkpoint:', status.checkpoint_available);

await client.close();
```

## 4. gRPC Transport

For high-throughput, polyglot communication:

```typescript
// grpc-server.ts
import { NekteServer, createGrpcTransport } from '@nekte/server';

const server = new NekteServer({ agent: 'fast-agent' });
// ... register capabilities ...

// Serve on both HTTP and gRPC
server.listen(4001);
const grpc = await createGrpcTransport(server, { port: 4002 });

// gRPC uses the same task registry as HTTP
console.log('Active tasks:', server.tasks.active().length);
```

```typescript
// grpc-client.ts
import { NekteClient, createGrpcClientTransport } from '@nekte/client';

const transport = await createGrpcClientTransport({
  endpoint: 'localhost:4002',
});

// Same API — transport is pluggable
const client = new NekteClient('grpc://localhost:4002', { transport });
const catalog = await client.catalog();
const result = await client.invoke('sentiment', {
  input: { text: 'Great!' },
});

await client.close();
```

## 5. Bridge an MCP Server

If you have existing MCP servers, drop the bridge in front:

```bash
# Via CLI
npx nekte-bridge --mcp-url http://localhost:3000/mcp --name my-mcp --port 3100

# Or with a config file
npx nekte-bridge --config bridge.json
```

Example `bridge.json`:

```json
{
  "name": "my-bridge",
  "mcpServers": [
    {
      "name": "github",
      "url": "http://localhost:3000/mcp",
      "category": "dev"
    },
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "category": "fs"
    }
  ],
  "port": 3100
}
```

Now your NEKTE client talks to the bridge, which translates to MCP behind the scenes:

```typescript
const client = new NekteClient('http://localhost:3100');
const catalog = await client.catalog(); // All MCP tools as NEKTE capabilities
```

## 6. Add Authentication

```typescript
import { NekteServer, bearerAuth } from '@nekte/server';

const server = new NekteServer({
  agent: 'secure-agent',
  auth: 'bearer',
  authHandler: bearerAuth(['my-secret-token']),
});
```

Clients send the token:

```typescript
const client = new NekteClient('http://localhost:4001', {
  headers: { Authorization: 'Bearer my-secret-token' },
});
```

## 7. Use WebSocket Transport

For low-latency, bidirectional communication:

```typescript
import { NekteServer, createWsTransport } from '@nekte/server';

const server = new NekteServer({ agent: 'realtime-agent' });
// ... register capabilities ...

// HTTP for discovery + gRPC for throughput + WebSocket for latency
server.listen(4001);
const ws = createWsTransport(server, { port: 4002 });
```

## Key Concepts

| Concept | What it means |
|---------|--------------|
| **L0/L1/L2** | Discovery levels: catalog (8 tok) -> summary (40 tok) -> full schema (120 tok) |
| **Version hash** | 8-char hash of a capability's contract. If unchanged, skip schema reload |
| **Token budget** | `{ max_tokens, detail_level }` — the receiver adapts response granularity |
| **Multi-level result** | Same data in minimal/compact/full representations |
| **DelegateStream** | `{ events, cancel(), taskId }` — streaming with lifecycle control |
| **AbortSignal** | Every handler receives a signal for cooperative cancellation |
| **Transport** | Pluggable port — swap HTTP for gRPC without changing application code |

## Next Steps

- Read the [full protocol specification](./SPEC.md)
- Run `pnpm demo` to see the two-agent demo
- Run `pnpm benchmark` to see token savings numbers
- Check the [CONTRIBUTING guide](../CONTRIBUTING.md) to contribute
