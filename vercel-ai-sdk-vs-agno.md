# Why Vercel AI SDK, Not Agno

> Decision doc for Pool Agent V2's AI framework choice.

---

## The Decision

**Vercel AI SDK** is the framework for building Pool's hierarchical multi-agent system.

---

## Context

Pool is moving to **Convex** (TypeScript, serverless backend). The agent V2 needs: orchestrator → domain solvers → task workers, each with persistent memory, streaming responses, and deep integration with Pool's data (tiles, profiles, memory strength).

Two frameworks evaluated:
- **Vercel AI SDK** — TypeScript SDK for LLM streaming, tool calling, multi-step agents
- **Agno** — Python framework for multi-agent systems with built-in memory and delegation

---

## Why Vercel AI SDK Wins

### 1. Runs Inside Convex

Vercel AI SDK runs natively inside Convex actions. Agno cannot — it's a Python process that needs its own server, which defeats the entire purpose of moving to Convex.

```
Vercel AI SDK:  Convex action → AI SDK → Gemini → DB (all in one place)
Agno:           Convex action → HTTP → Python server → HTTP → Convex DB (round trip)
```

### 2. Same Language, Same Types

Pool is 100% TypeScript. Vercel AI SDK is TypeScript. Tool definitions, response types, solver interfaces — all share types with the rest of the codebase. Agno introduces Python as a second language with no type sharing.

### 3. Direct Database Access

Inside a Convex action, Vercel AI SDK code can read tiles, write agent memory, update solver status — all with direct `ctx.db` calls. Agno would need HTTP API calls back into Convex for every database operation.

### 4. Free Real-Time Status

Convex reactivity means solvers write status to a table and the client updates instantly. No SSE setup, no WebSocket plumbing. With Agno running externally, you'd need to build a webhook/polling bridge.

### 5. No Extra Infrastructure

| | Vercel AI SDK | Agno |
|---|---|---|
| Needs own server | No | Yes |
| Needs own deployment pipeline | No | Yes |
| Needs own monitoring | No | Yes |
| Needs own scaling config | No | Yes |

### 6. Convex Scheduled Functions Replace BullMQ

Price monitoring, memory decay crons, async worker tasks — all handled by Convex's built-in scheduler. Vercel AI SDK works with this natively. Agno would need its own job system.

---

## What Agno Does Better (And Why It Doesn't Matter)

Agno has **built-in multi-agent orchestration, delegation, and persistent memory**. With Vercel AI SDK, we build those ourselves.

This sounds like a big loss. It's not, because:

1. **Build time is ~3-4 weeks.** Maintaining a Python sidecar is permanent.
2. **Our agent architecture is custom.** Per-solver memory with decay, budget tracking, recursive spawning with depth limits, validation pipeline — Agno's built-in patterns don't map cleanly to this. We'd fight the framework.
3. **The hard parts are already solved.** Vercel AI SDK handles LLM streaming, tool calling, multi-step loops, and Gemini integration. What's left for us is orchestration logic — which is our product's core IP, not something to outsource to a framework.

---

## Summary

| Factor | Verdict |
|---|---|
| Runs inside Convex | AI SDK yes, Agno no |
| Language match | AI SDK yes, Agno no |
| Direct DB access | AI SDK yes, Agno no |
| Real-time status | AI SDK free, Agno manual |
| Extra infra needed | AI SDK none, Agno server + CI/CD |
| Multi-agent built-in | Agno yes, AI SDK no (we build it) |
| **Decision** | **Vercel AI SDK** |

The one thing Agno does better (built-in multi-agent) doesn't justify running a separate Python service alongside a TypeScript serverless backend. We build the orchestration layer once. We'd maintain the Python sidecar forever.

---

## Risk Solutions

Seven real risks with the multi-agent architecture and how to solve each one.

---

### 1. Cost Explosion

**The problem:** Every query can trigger orchestrator + solvers + workers = 10-20 LLM calls.

**The fix: Three-layer cost control**

**Layer A — Don't spawn when you don't need to.**
Most queries are simple. "What did I save today?" doesn't need 3 agents. The orchestrator classifies complexity first:

```
"what did I save today?"           → Level 0: Orchestrator answers directly (1 LLM call)
"find me pasta recipes"            → Level 1: One solver (3 LLM calls)
"plan Tokyo trip + track shoes"    → Level 2: Two solvers in parallel (6-8 LLM calls)
"full itinerary with flights..."   → Level 3: Solver + workers (10-15 LLM calls)
```

80% of queries should be Level 0 or 1. This alone cuts cost by 5-10x.

**Layer B — Token budget per query.**
Every query starts with a budget (e.g., 100K tokens). Every LLM call deducts from it. When budget runs low, agents wrap up with what they have instead of spawning more workers.

```typescript
const budget = new TokenBudget(100_000)

// Before any LLM call
if (!budget.canAfford(estimatedCost)) {
  return bestEffortResult()  // stop here, return what we have
}
```

**Layer C — Cheap models for cheap work.**
Not every call needs the same model:

| Task | Model | Why |
|---|---|---|
| Orchestrator routing | Flash | Just classifying intent, fast and cheap |
| Solver reasoning | Flash | Good enough for tool-calling loops |
| Worker subtasks | Flash | Simple, focused tasks |
| Final synthesis | Flash (or Pro for complex) | Only upgrade when the response is complex |
| Validation | No LLM (deterministic checks) | Schema + DB lookups, zero LLM cost |

---

### 2. Latency

**The problem:** User sends a query, then stares at a blank screen for 15 seconds while agents work.

**The fix: Stream everything, run in parallel.**

**Stream status updates in real time.** With Convex, this is free — write status to a table, client sees it instantly:

```
User sends query
  → "Understanding your request..." (instant)
  → "Found 2 things to work on: trip planning + shoe prices" (1s)
  → "Travel specialist is searching your saves..." (2s)
  → "Shopping specialist found 3 price sources..." (4s)
  → "Putting it all together..." (6s)
  → Final response streams in (7s)
```

The user never sees a blank screen. They see progress.

**Run solvers in parallel.** Travel Solver and Shopping Solver don't depend on each other. Run them at the same time using `Promise.all`:

```
Sequential: Travel (5s) → Shopping (4s) → Synthesize (2s) = 11s
Parallel:   Travel (5s) + Shopping (4s) → Synthesize (2s) = 7s
```

**Timeout workers aggressively.** Each worker gets 10 seconds max. If it doesn't finish, the solver uses partial results. A slow hotel search shouldn't block the entire response.

---

### 3. Orchestrator Misrouting

**The problem:** User says "I saved a cooking class in Tokyo" — is that cooking or travel? Orchestrator sends it to the wrong solver.

**The fix: Three safety nets.**

**Net 1 — Multi-domain routing.** The orchestrator can send a query to multiple solvers. "Cooking class in Tokyo" goes to both Travel and Cooking. Each solver checks if it's relevant and bows out if not.

```
Orchestrator: "This might be travel AND cooking. Sending to both."
Travel Solver: "Yes, this is a Tokyo activity. I'll add it to the itinerary."
Cooking Solver: "This is a cooking class, not a recipe. Not my domain. Returning empty."
```

**Net 2 — Solver self-check.** Every solver's first step is: "Is this actually my domain?" If not, it returns `{ relevant: false }` and the orchestrator tries another solver.

**Net 3 — User correction.** If the response is wrong, the user says "no, I meant recipes not travel." The orchestrator logs the misroute, re-routes, and over time learns the patterns. Store corrections in orchestrator memory.

---

### 4. Memory Bloat

**The problem:** A Travel Solver that's been active for 3 months has 500 facts, 200 conversation summaries. Loading all that into the prompt eats tokens and slows everything down.

**The fix: Hard limits + smart compression.**

**Hard limits per solver:**

| Memory type | Max items | What happens at limit |
|---|---|---|
| Facts | 50 | Oldest low-confidence fact archived |
| Conversation summaries | 20 | Oldest summaries merged into a single "history overview" |
| Entities (places, products) | 100 | Least-referenced entities archived |

**Compression on write.** Don't store raw conversations. After each interaction, the solver generates a 2-3 sentence summary. That's what gets stored, not the full transcript.

```
Raw conversation: 4,000 tokens
Compressed summary: 80 tokens (50x smaller)
```

**Relevance loading.** Don't load ALL memory into the prompt. Load the 10 most recent + 5 most relevant (by embedding similarity to the current query). Total memory context stays under 2,000 tokens always.

---

### 5. Circular Spawning

**The problem:** Travel Solver spawns a "Flight Finder" worker. Flight Finder decides it needs help and tries to spawn a Travel Solver. Infinite loop.

**The fix: Simple rules, enforced by code.**

```
Rule 1: Depth counter on every call.
  Orchestrator = depth 0
  Solver = depth 1
  Worker = depth 2
  Sub-worker = depth 3 (max)

Rule 2: Children can NEVER spawn parents.
  Workers cannot create solvers.
  Sub-workers cannot create workers.
  Spawning only goes DOWN, never UP or SIDEWAYS.

Rule 3: Hard depth limit = 3.
  At depth 3, spawning is disabled entirely.
  The function literally doesn't have the spawn tool.
```

```typescript
// Each agent receives its depth
function executeAgent(task, depth) {
  const tools = getToolsForDepth(depth)
  // depth 0-1: has spawn_worker tool
  // depth 2: has spawn_sub_worker tool
  // depth 3: NO spawn tools at all
}
```

This isn't something you "hope" works. You remove the spawn tool from the agent's toolkit at depth 3. It physically cannot spawn.

---

### 6. Stale Memory

**The problem:** Shopping Solver remembers "Nike Dunks are $98 on StockX" from 2 weeks ago. Price has changed. Solver presents outdated info as fact.

**The fix: TTL + timestamps + re-verify.**

**Every fact gets a TTL based on how fast it changes:**

| Fact type | TTL | Example |
|---|---|---|
| Prices | 24 hours | "Nike Dunks $98 on StockX" |
| Event dates | Until event passes | "Concert on April 5" |
| User preferences | 90 days | "Prefers boutique hotels" |
| Locations | 1 year | "Saved ramen shop in Shibuya" |
| Personal facts | Never expires | "Allergic to peanuts" |

**Expired facts don't get deleted — they get flagged.** When the solver loads memory and sees an expired price fact, it knows to re-check before presenting:

```
Solver loads memory:
  "Nike Dunks $98 on StockX" — saved Mar 26, TTL 24h — EXPIRED

Solver thinks:
  "I have an old price. Let me check current price before answering."
  → Spawns price checker worker
  → Gets fresh price: $105
  → Updates memory with new price + new TTL
  → Presents: "Nike Dunks are currently $105 on StockX (checked just now)"
```

**Always show "as of" dates.** Any fact from memory that could change gets a timestamp in the response: "Prices as of March 26" or "Checked just now."

---

### 7. Over-Spawning

**The problem:** User asks "how many tiles do I have?" and the orchestrator spawns a Knowledge Solver which spawns a Database Worker. Total overkill.

**The fix: Complexity classifier as the first step.**

Before doing anything, the orchestrator classifies the query:

```
SIMPLE (answer directly, zero spawning):
  • "How many tiles do I have?" → DB count
  • "What did I save today?" → DB query with date filter
  • "Show me my pools" → DB query
  • "Hi" / "Thanks" / "What can you do?" → Static response

MODERATE (one solver, no workers):
  • "Find me Italian recipes" → Cooking Solver searches tiles
  • "What's my music taste?" → Music Solver analyzes tiles

COMPLEX (solver + workers):
  • "Plan a Tokyo itinerary from my saves" → Travel Solver + workers
  • "Compare prices for all shoes I've saved" → Shopping Solver + workers

MULTI-DOMAIN (multiple solvers):
  • "Plan trip + track shoes" → Travel + Shopping in parallel
```

**The classifier is cheap.** It's one Gemini Flash call with a simple prompt: "Classify this query as SIMPLE, MODERATE, COMPLEX, or MULTI. Return the label and domains." Costs ~200 tokens. Saves thousands when it catches a simple query.

**Bias toward simplicity.** When in doubt, try the simpler approach first. If a solver can't answer without workers, it asks for permission to spawn them — rather than spawning by default.

---

## Risk Summary

| Risk | Solution | One-liner |
|---|---|---|
| Cost explosion | Complexity levels + token budget + cheap models | Don't spawn what you don't need |
| Latency | Stream status + parallel solvers + worker timeouts | User sees progress, never a blank screen |
| Misrouting | Multi-domain routing + solver self-check + user correction | Send to multiple, let them self-filter |
| Memory bloat | Hard limits + compression + relevance loading | 50 facts max, load only what's relevant |
| Circular spawning | Depth counter + downward-only spawning + tool removal | Physically impossible at depth 3 |
| Stale memory | TTL per fact type + re-verify expired + "as of" dates | Old prices get rechecked, not presented |
| Over-spawning | Complexity classifier as first step + bias toward simple | One cheap call saves expensive spawning |
