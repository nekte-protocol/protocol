# NEKTE Cache Architecture — Computer Architecture-Inspired

> Aplicando 40 anos de investigacion en cache de CPUs al problema de coordinacion entre agentes — pero solo lo que realmente tiene sentido a esta escala.

---

## Diagnostico del estado actual

```text
CapabilityCache
  └─ InMemoryCacheStore (Map<string, Entry>)
       ├─ Eviction: FIFO por cachedAt (NO es LRU — cachedAt nunca se actualiza en acceso)
       ├─ Eviction scan: O(n) sobre todas las entries para encontrar la mas vieja
       ├─ TTL fijo: 5 minutos, sin jitter
       ├─ Capacidad: 1000 entries
       ├─ Sin stale-while-revalidate
       ├─ Sin negative caching
       ├─ Sin request coalescing
       └─ Sin consideracion de token cost por nivel (L0=8tok, L1=40tok, L2=120tok)
```

**Escala real**: 5-50 agentes x 10-200 capabilities = 50-10,000 capabilities posibles, cap de 1000 entries. Cada entry ~200-2000 bytes. Memoria total del cache: <2MB.

---

## Lo que descartamos (y por que)

La primera version de este documento proponia 6 tecnicas de CPU cache. Tras investigar a fondo, 3 resultan ser **over-engineering** para la escala actual:

### ARC (Adaptive Replacement Cache) → Reemplazado por SIEVE

ARC mantiene 4 listas y un parametro auto-ajustable. Tiene sentido para caches de millones de entries donde el working set cambia impredeciblemente. Con 1000 entries, la auto-adaptacion no tiene espacio para expresarse. Ademas, la implementacion es ~200 LOC con edge cases sutiles.

**SIEVE** (NSDI 2024) logra 90% del beneficio de ARC con ~30 LOC: un FIFO con un puntero "hand" y un bit "visited" por entry. Reduce miss ratio 21% vs FIFO, hasta 63% mejor que ARC en algunos workloads.

### Resolution TLB → Descartado

En hardware, un TLB evita page table walks de 100+ ciclos. En software, el "underlying lookup" ya es `Map.get()` en O(1) ~50ns. Poner un `Map.get()` delante de otro `Map.get()` no aporta nada medible. La unica excepcion seria un backing store remoto (Redis), donde un Map in-process si ahorraria un round-trip de red — pero eso es read-through caching estandar, no un TLB.

### Bloom Filter para routing → Reemplazado por Map<capId, Set<agentId>>

Con 100-1000 capabilities, un `Set<string>` de IDs ocupa ~64KB. Un Bloom filter ahorra ~63KB pero introduce false positives y no puede decirte CUAL agente tiene la capability. Un `Map<string, Set<string>>` es O(1), exacto, soporta borrado, y usa memoria trivial a esta escala. Los Bloom/Cuckoo/Xor filters solo serian relevantes con 100K+ capabilities.

### Markov Prefetching → Descartado (por ahora)

El cold-start problem es devastador: necesitas cientos de invocaciones para construir probabilidades utiles, pero la mayoria de sesiones NEKTE terminan antes. Ademas, el comportamiento de agentes LLM es no-estacionario (cambia con el input del usuario), rompiendo la asuncion de Markov. El "prefetch" es un network call especulativo — el penalty por misprediction es alto.

**Alternativa futura**: Si NEKTE adopta plan caching (ver seccion "Futuro"), las transiciones de workflow serian la base para prediccion, no invocaciones individuales.

---

## Lo que SI implementamos (7 mejoras priorizadas)

Todas justificadas, medibles, y con esfuerzo proporcional al impacto.

---

### 1. Fix: Eviction O(1) + LRU real

**Severidad**: Bug. La eviction actual dice "LRU" pero es FIFO (`cachedAt` nunca se actualiza). Ademas el scan es O(n).

**Que hacemos**: Usar el orden de insercion de `Map` de JavaScript (que es FIFO por spec) y re-insertar en `get()` para convertirlo en LRU real. Eviction = `map.keys().next().value` → O(1).

**Area de mejora**: Correctitud + rendimiento de eviction.

### Arquitectura hexagonal

```text
Capa:       Infrastructure (adapter)
Archivo:    packages/client/src/cache-store.ts
Cambio:     Modificar InMemoryCacheStore (no nuevo archivo)
Port:       CacheStore (sin cambios)
```

### Tareas

```text
1. [ ] Modificar InMemoryCacheStore.get():
       - Re-insertar entry en el Map (delete + set) para actualizar recency
       - Esto convierte FIFO en LRU usando el orden nativo de Map

2. [ ] Modificar InMemoryCacheStore.set() eviction:
       - Reemplazar O(n) scan con: this.entries.keys().next().value
       - Delete esa key → O(1) eviction

3. [ ] Tests: verificar que entries accedidas recientemente sobreviven eviction
```

---

### 2. Stale-While-Revalidate

**Problema**: Cuando un TTL expira, el siguiente request bloquea hasta completar un `nekte.discover` fresco. Esto genera latency spikes periodicos cada 5 minutos.

**Que hacemos**: Servir la entry stale inmediatamente y disparar un refresh en background. El 99% de capability schemas NO cambian en 5 minutos — la entry stale es correcta casi siempre.

**Area de mejora**: Eliminacion de latency spikes por TTL expiration.

```text
get(key):
  entry = store.get(key)
  if entry exists:
    if fresh (within TTL):
      return entry                    ← normal hit
    if stale (past TTL, within grace period):
      triggerBackgroundRefresh(key)    ← fire-and-forget
      return entry                    ← serve stale, 0 latency
    if expired (past grace period):
      delete entry
      return undefined                ← force re-discover
```

### Arquitectura hexagonal

```text
Capa:       Domain (policy) + Application (client integration)
Port:       RevalidationStrategy (interfaz — permite custom refresh logic)
Adapter:    BackgroundRevalidator implements RevalidationStrategy
Domain:     Stale-grace-expired state logic (pura)
Integra:    CapabilityCache.get() usa la politica para decidir
```

### Tareas

```text
1. [ ] Definir interfaz RevalidationStrategy en packages/client/src/cache.ts
       - shouldRevalidate(entry: CacheStoreEntry): 'fresh' | 'stale' | 'expired'
       - gracePeriodMs configurable (default: TTL * 2 = 10 min total)

2. [ ] Implementar BackgroundRevalidator
       - Mantiene Set<string> de keys "in-flight" (evita refresh duplicados)
       - Metodo revalidate(key, refreshFn): void (fire-and-forget)
       - refreshFn es () => Promise<void> inyectado por el client

3. [ ] Integrar en CapabilityCache
       - get() retorna entry stale + trigger revalidation
       - Nuevo campo en CacheConfig: enableStaleWhileRevalidate (default: true)

4. [ ] Integrar en NekteClient
       - Proveer refreshFn que ejecuta discover() para el capability

5. [ ] Tests: verificar que stale entries se sirven sin bloqueo,
       que refresh solo se dispara una vez por key, que entries
       expired (past grace) fuerzan re-discover
```

---

### 3. TTL Jitter (Cache Stampede Prevention)

**Problema**: Con TTL fijo de 300,000ms, si N capabilities se cachean al mismo tiempo (e.g., tras un `catalog()`), todas expiran simultaneamente → N discovers concurrentes → stampede.

**Que hacemos**: Agregar +/-10% jitter al TTL en cada `set()`. Trivial, 1 linea.

**Area de mejora**: Prevencion de thundering herd en shared caches.

### Arquitectura hexagonal

```text
Capa:       Infrastructure (adapter detail)
Archivo:    packages/client/src/cache-store.ts
Cambio:     1 linea en set()
```

### Tareas

```text
1. [ ] Modificar InMemoryCacheStore.set() o CapabilityCache.set():
       - ttlMs = baseTtl * (0.9 + Math.random() * 0.2)
       - Configurable: jitterFactor en CacheConfig (default: 0.1)

2. [ ] Test: verificar que TTLs de entries cacheadas en el mismo
       momento divergen por al menos 5%
```

---

### 4. Token-Cost-Weighted Eviction (GDSF simplificado)

**Problema**: El cache trata L0 (8 tok para re-fetch), L1 (40 tok), y L2 (120 tok) entries con la misma prioridad. Evictar un L2 schema que costo 120 tokens descubrir es 15x mas caro que evictar un L0 catalog entry.

**Que hacemos**: Ponderar la prioridad de eviction por el costo en tokens de re-descubrir. Esto es lo que GreedyDual-Size-Frequency (GDSF) hace, simplificado para NEKTE:

```text
priority(entry) = access_count * token_cost_to_refetch

Evictar la entry con menor priority.
```

**Area de mejora**: El diferenciador core de NEKTE. Ningun otro protocolo (MCP, A2A) tiene eviction consciente de token cost.

```text
Ejemplo:

  Entry A: L0 catalog, accedido 1 vez    → priority = 1 * 8   = 8
  Entry B: L2 schema, accedido 3 veces   → priority = 3 * 120 = 360
  Entry C: L1 summary, accedido 10 veces → priority = 10 * 40 = 400

  Eviction order: A (8) → B (360) → C (400)

  Sin GDSF: evictaria por LRU/FIFO sin considerar que B costo
  15x mas tokens que A para traer al cache.
```

### Arquitectura hexagonal

```text
Capa:       Domain (policy, logica pura)
Port:       EvictionPolicy (interfaz)
Adapters:   FIFOPolicy, LRUPolicy, GDSFPolicy
Domain:     TokenCost value object — mapea DiscoveryLevel → token cost
Integra:    CacheStore usa EvictionPolicy para decidir que evictar
```

### Tareas

```text
1. [ ] Definir TokenCost en packages/core/src/cache/token-cost.ts
       - Constantes: L0_COST = 8, L1_COST = 40, L2_COST = 120
       - Funcion: tokenCostForLevel(level: DiscoveryLevel): number

2. [ ] Extender CacheStoreEntry con metadata
       - accessCount: number (default 1, incrementar en get())
       - tokenCost: number (set en CapabilityCache.set() segun level)

3. [ ] Definir interfaz EvictionPolicy en packages/client/src/cache-store.ts
       - evict(entries: Iterable<[string, CacheStoreEntry]>): string (key a evictar)

4. [ ] Implementar GDSFPolicy
       - priority = accessCount * tokenCost
       - Evicta entry con menor priority
       - O(n) scan aceptable para n=1000

5. [ ] Integrar en InMemoryCacheStore
       - evictionPolicy configurable en constructor
       - Default: GDSFPolicy

6. [ ] Tests: verificar que L2 schemas accedidos frecuentemente
       sobreviven sobre L0 entries raramente accedidas
```

---

### 5. SIEVE Eviction Policy

**Problema**: LRU (incluso corregido) no es scan-resistant. Un `catalog()` que trae 200 L0 entries desplaza todo el hot set.

**Que hacemos**: SIEVE (NSDI 2024) — el sucesor moderno de LRU. Un FIFO con un "hand" pointer y un bit "visited" por entry:

```text
SIEVE Algorithm:

  Insert: agregar al HEAD del FIFO, visited = false
  Access: marcar visited = true (sin mover)
  Evict:
    while hand.visited:
      hand.visited = false    ← dar segunda oportunidad
      hand = hand.next
    evict hand                ← no fue re-accedido, out
    hand = hand.next
```

**Area de mejora**: Scan resistance. Un `catalog()` de 200 entries no contamina el cache porque entran con `visited=false` y se evictan inmediatamente si no se re-acceden. 21% mejor hit rate que FIFO, comparable a ARC.

### Arquitectura hexagonal

```text
Capa:       Domain (logica pura, zero I/O)
Archivo:    packages/core/src/cache/sieve-policy.ts
Port:       EvictionPolicy (misma interfaz que GDSF)
Adapter:    SievePolicy implements EvictionPolicy
```

### Tareas

```text
1. [ ] Crear packages/core/src/cache/sieve-policy.ts
       - Doubly-linked list (o array circular) con hand pointer
       - Cada nodo: { key, visited: boolean }
       - insert(key): agregar al head, visited = false
       - access(key): visited = true
       - evict(): avanzar hand buscando visited=false, retornar key
       - ~30-40 LOC

2. [ ] Crear SieveGDSFPolicy (composicion)
       - SIEVE para scan resistance + GDSF weighting para token cost
       - En eviction: SIEVE selecciona candidatos → GDSF elige entre ellos
       - O: usar SIEVE como filtro de admision + GDSF como main policy

3. [ ] Integrar como opcion en CacheConfig
       - evictionPolicy: 'lru' | 'sieve' | 'gdsf' | 'sieve-gdsf'
       - Default: 'sieve-gdsf' (mejor de ambos mundos)

4. [ ] Benchmark comparativo: FIFO vs LRU vs SIEVE vs GDSF vs SIEVE+GDSF
       con traces sinteticos de agent workflows
```

---

### 6. Negative Caching

**Problema**: Cuando un agente NO tiene una capability, el `discover()` retorna lista vacia. Sin negative caching, cada intento de invocar esa capability inexistente genera un round-trip de discovery.

**Que hacemos**: Cachear resultados negativos con TTL corto (60s).

**Area de mejora**: Reducir discoveries desperdiciados en routing multi-agente.

```text
discover({ filter: { id: "nonexistent" } })
  → result.caps = []
  → cache.setNegative("agentX:nonexistent", ttl=60s)

Siguiente intento (dentro de 60s):
  → cache.isNegative("agentX:nonexistent") === true
  → skip discover, retornar vacio directamente
```

### Arquitectura hexagonal

```text
Capa:       Application (client integration)
Archivo:    packages/client/src/cache.ts
Cambio:     Set<string> de "known negatives" con TTL corto
Port:       CacheStore (sin cambios — negatives son solo keys sin data)
```

### Tareas

```text
1. [ ] Agregar Set negatives + Map negativeTtls a CapabilityCache
       - setNegative(agentId, capId, ttlMs = 60_000)
       - isNegative(agentId, capId): boolean (con TTL check)

2. [ ] Integrar en NekteClient.invoke()
       - Antes de rpc: if cache.isNegative → throw CAPABILITY_NOT_FOUND
       - En VERSION_MISMATCH: clear negative (el cap existe)
       - En CAPABILITY_NOT_FOUND error: setNegative

3. [ ] Tests: verificar que negatives expiran, que se limpian
       cuando la capability aparece
```

---

### 7. Request Coalescing (Shared Cache)

**Problema**: Si 5 clients comparten un `SharedInMemoryCache` y el entry para "sentiment" expira, los 5 disparan `discover()` concurrentemente. 4 de esos discovers son redundantes.

**Que hacemos**: Si un refresh esta in-flight para key K, los requests subsiguientes esperan el resultado del primero en vez de duplicar.

**Area de mejora**: Eliminar thundering herd en shared caches.

```text
client1.discover("sentiment")  → cache miss → START refresh
client2.discover("sentiment")  → cache miss → WAIT for client1's refresh
client3.discover("sentiment")  → cache miss → WAIT for client1's refresh

refresh completes → resolve para client1, client2, client3
```

### Arquitectura hexagonal

```text
Capa:       Infrastructure (adapter)
Archivo:    packages/client/src/shared-cache.ts
Cambio:     RequestCoalescer wraps el refresh path
Port:       SharedCache (sin cambios en interfaz)
```

### Tareas

```text
1. [ ] Crear RequestCoalescer en packages/client/src/request-coalescer.ts
       - Map<string, Promise<T>> de in-flight requests
       - coalesce(key, fn: () => Promise<T>): Promise<T>
       - Si key ya tiene promise in-flight, retornar la misma
       - Si no, ejecutar fn(), guardar promise, limpiar al resolver

2. [ ] Integrar en CapabilityCache o NekteClient
       - Wrappear discover() calls con coalescer
       - Key: `${agentId}:${capId}:${level}`

3. [ ] Tests: verificar que N discovers concurrentes para la misma
       key solo generan 1 request de red
```

---

## Dependencias e implementacion paralela

```text
Independientes (paralelizables):
  ├── [1] Fix O(1) eviction + LRU real
  ├── [3] TTL jitter
  ├── [6] Negative caching
  └── [7] Request coalescing

Secuenciales:
  [1] Fix LRU → [5] SIEVE → [4] GDSF → [5+4] SIEVE-GDSF (composicion)
  [2] Stale-while-revalidate (independiente pero integra con refresh path)
```

---

## Metricas de exito

| Metrica | Actual | Objetivo | Como medir |
|---------|--------|----------|------------|
| Eviction scan | O(n) | O(1) | Profiling |
| Cache hit rate | ~60% (FIFO) | >85% (SIEVE+GDSF) | hits / (hits + misses) |
| P99 latency spikes | TTL expiry = blocking | 0 (stale-while-revalidate) | Timer en get() |
| Stampede on TTL expiry | N concurrent discovers | 1 (coalesced) | Counter de discovers |
| Token waste on eviction | Uniform (no cost awareness) | Minimize high-cost evictions | Sum(tokenCost) de evicted entries |
| Wasted discovers (negative) | Unbounded | 0 after first miss | Counter de negative hits |

---

## Horizonte futuro (no implementar ahora, vigilar)

### Agentic Plan Caching (NeurIPS 2025)

Cachear templates de workflows completos (no solo schemas individuales). Si un agente ejecuta `tokenize → embed → classify` 10 veces, cachear el plan entero como template reutilizable. Resultados publicados: -50% costo, -27% latencia.

**Cuando**: Cuando NEKTE tenga workflow orchestration (v0.4+).

### Workflow-Aware Eviction (KVFlow, 2025)

Usa un "Agent Step Graph" para anticipar que entries se necesitan en el siguiente paso del workflow. Logra 1.83-2.19x speedup. Es esencialmente Markov prefetching que funciona porque explota estructura de workflow, no estadisticas ciegas.

**Cuando**: Cuando los workflows de NEKTE sean lo suficientemente estables y repetitivos para construir grafos.

### Bloom/Cuckoo/Xor Filters para routing

Relevante cuando NEKTE escale a 100K+ capabilities o miles de agentes. Para la escala actual (<10K capabilities), un `Map<string, Set<string>>` es superior.

### MESI Coherence formal

Con 5-50 agentes, la invalidacion pub-sub actual es suficiente. MESI formal tiene sentido cuando haya cientos de agentes compartiendo cache con updates frecuentes.

---

## Resumen: de CPU cache a NEKTE cache

| Tecnica CPU | Adaptacion NEKTE | Estado |
|-------------|-----------------|--------|
| FIFO → LRU (Map reorder) | Fix eviction O(1) + recency real | Implementar |
| SIEVE (NSDI 2024) | Scan resistance sin complejidad ARC | Implementar |
| GreedyDual-Size-Frequency | Token-cost-weighted eviction (unico en NEKTE) | Implementar |
| Stale-while-revalidate (HTTP) | Servir stale + background refresh | Implementar |
| TTL jitter (distributed systems) | +/-10% randomizacion | Implementar |
| Negative caching (DNS) | Cachear "capability no existe" | Implementar |
| Request coalescing (thundering herd) | 1 refresh por N requests | Implementar |
| ARC / W-TinyLFU | Descartado — SIEVE es suficiente | Descartado |
| Resolution TLB | Descartado — Map.get() ya es O(1) | Descartado |
| Bloom filters | Descartado — Map<cap, Set<agent>> es mejor a esta escala | Futuro |
| Markov prefetching | Descartado — cold start + no-estacionariedad | Futuro |
| MESI coherence | Descartado — pub-sub actual es suficiente | Futuro |
