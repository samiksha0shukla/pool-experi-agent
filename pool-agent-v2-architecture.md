# Pool Agent V2: Hierarchical Multi-Agent Architecture

> A complete feasibility analysis, architecture blueprint, and implementation guide for building a self-spawning, memory-persistent, hierarchical agent system for Pool — replacing basic search with a personal AI that plans trips, tracks prices, builds itineraries, and truly *knows* the user.

---

## Table of Contents

1. [The Vision](#1-the-vision)
2. [Is This Architecture Practical?](#2-is-this-architecture-practical)
3. [Core Concepts](#3-core-concepts)
4. [System Architecture](#4-system-architecture)
5. [The Orchestrator (Main Agent)](#5-the-orchestrator-main-agent)
6. [Subagent Lifecycle](#6-subagent-lifecycle)
7. [Memory System Design](#7-memory-system-design)
8. [Validation Layer](#8-validation-layer)
9. [Recursive Subagent Spawning](#9-recursive-subagent-spawning)
10. [Real-World Query Walkthrough](#10-real-world-query-walkthrough)
11. [Risks, Limitations & Mitigations](#11-risks-limitations--mitigations)
12. [Tech Stack & Implementation](#12-tech-stack--implementation)
13. [Cost Analysis](#13-cost-analysis)
14. [What Exists Today vs What Needs Building](#14-what-exists-today-vs-what-needs-building)
15. [Verdict](#15-verdict)

---

## 1. The Vision

Today, Pool's search is: *"type a keyword → get matching tiles."*

The vision is: **a personal AI that actually understands what the user has saved, why they saved it, and can act on it.**

| Today (Search) | Tomorrow (Agent V2) |
|---|---|
| "pasta recipes" → list of tiles | "Plan me a dinner party for 6 using the recipes I've saved" → curated menu + shopping list + Instacart links |
| "Tokyo" → tiles mentioning Tokyo | "I'm going to Tokyo next month — build me an itinerary from everything I've saved" → day-by-day plan with restaurants, attractions, hotel suggestions, budget |
| "Nike shoes" → tile of a screenshot | "Track the price of those Nike Dunks I saved and tell me when they drop below $120" → monitoring agent that pings the user |
| "concerts" → list of event tiles | "What concerts are coming up that I haven't bought tickets for?" → filtered events + ticket links + calendar integration |

This isn't search. This is a **personal agent that spawns specialized workers to get things done.**

---

## 2. Is This Architecture Practical?

### The Honest Assessment

| Question | Answer |
|---|---|
| **Is it practical?** | Yes — this is how Claude Code, OpenAI's deep research, Devin, and open-source frameworks like AutoGen/CrewAI work. Hierarchical agent spawning is a proven pattern. |
| **Is it usable?** | Yes — if the orchestrator is smart about WHEN to spawn vs handle directly. Not every query needs subagents. "What did I save yesterday?" should not spawn 3 agents. |
| **Is it executable?** | Yes — with Gemini 2.0 Flash's tool calling + structured outputs, you can build this today. The hard part isn't the agent loop, it's the memory system and cost control. |
| **Will it solve real problems?** | Yes — the key insight is that Pool has CONTEXT no other AI has. The user's actual saves, interests, patterns. A generic ChatGPT can plan a Tokyo trip. Pool's agent can plan a Tokyo trip based on the 47 Tokyo-related screenshots the user actually saved. |
| **Who has done this before?** | Claude Code (Anthropic), Devin (Cognition), AutoGen (Microsoft), CrewAI, MetaGPT, OpenAI Swarm, ChatGPT deep research. You're not inventing a new paradigm — you're applying a proven one to a personal memory domain. |

### What makes this hard (and solvable)

| Challenge | Difficulty | Why it's solvable |
|---|---|---|
| Orchestrator routing accuracy | Medium | Gemini is good at classification. Start with explicit categories, evolve to semantic routing. |
| Subagent memory persistence | Hard | Redis + Postgres. Each agent gets a memory namespace. Solved pattern (MemGPT, Letta). |
| Recursive spawning depth control | Medium | Hard cap at depth 3. Circuit breaker pattern. |
| Cost explosion from multi-agent calls | Hard | Use cheap models for routing, expensive for reasoning. Cache aggressively. Budget caps per query. |
| Validation without hallucination | Medium | Structural validation (JSON schema) + source grounding (cite tiles or URLs). |
| Latency for real-time queries | Hard | Streaming responses. Show "Spawned Travel Planner..." status updates. Parallel subagent execution. |

---

## 3. Core Concepts

### The Agent Hierarchy

```
User Query
    │
    ▼
┌──────────────────────────────────────────────────┐
│                  ORCHESTRATOR                     │
│          (The Main Agent / The Brain)             │
│                                                   │
│  Responsibilities:                                │
│  • Understand the query intent                    │
│  • Check if an existing subagent has context      │
│  • Spawn or route to the right subagent           │
│  • Collect and validate results                   │
│  • Synthesize final response                      │
│                                                   │
│  Does NOT: Solve the problem itself               │
└───────┬──────────┬──────────┬────────────────────┘
        │          │          │
        ▼          ▼          ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Solver  │ │ Solver  │ │ Solver  │    ← Domain Subagents
   │ Travel  │ │ Shopping│ │ Cooking │       (one per domain)
   │         │ │         │ │         │
   │ Memory: │ │ Memory: │ │ Memory: │    ← Each has its own
   │ trips,  │ │ prices, │ │ recipes,│       persistent memory
   │ places, │ │ brands, │ │ prefs,  │
   │ hotels  │ │ sizes   │ │ diets   │
   └────┬────┘ └─────────┘ └────┬────┘
        │                       │
        ▼                       ▼
   ┌─────────┐            ┌─────────┐
   │ Sub-sub │            │ Sub-sub │     ← Task Workers
   │ Flight  │            │ Recipe  │        (spawned by subagents
   │ Finder  │            │ Parser  │         to break down work)
   └─────────┘            └─────────┘
```

### Key Principles

1. **Orchestrator never solves — it delegates.** It's a manager, not a worker.
2. **Subagents are domain experts with memory.** Travel Solver remembers every trip-related interaction.
3. **Sub-subagents are task workers.** They solve one piece of a problem and die. No persistent memory.
4. **Same domain query → same subagent.** "Tokyo trip" today and "Tokyo hotels" next week both go to Travel Solver, which remembers the context.
5. **Validation before synthesis.** Every subagent result passes through a validation gate before the orchestrator uses it.

---

## 4. System Architecture

### Full System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                               │
│                    (iOS App / Web / Admin)                            │
│                                                                      │
│  "Plan me a Tokyo trip using my saved places and find               │
│   the best price for the Nike Dunks I screenshotted"                │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        API GATEWAY                                   │
│                   POST /v2/agent/chat                                 │
│                                                                      │
│  • Auth (JWT / API Key)                                              │
│  • Rate limiting                                                     │
│  • Stream setup (SSE or WebSocket)                                   │
│  • Budget allocation per query                                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                      ┌─────────────────┐                             │
│                      │   ORCHESTRATOR   │                            │
│                      │                  │                            │
│                      │  • Intent Parse  │                            │
│                      │  • Agent Router  │                            │
│                      │  • Result Merger │                            │
│                      │  • Stream Ctrl   │                            │
│                      └───────┬─────────┘                             │
│                              │                                       │
│              ┌───────────────┼───────────────┐                       │
│              │               │               │                       │
│              ▼               ▼               ▼                       │
│     ┌──────────────┐ ┌────────────┐ ┌──────────────┐                │
│     │   TRAVEL     │ │  SHOPPING  │ │   COOKING    │  ...more       │
│     │   SOLVER     │ │  SOLVER    │ │   SOLVER     │                │
│     │              │ │            │ │              │                │
│     │  Tools:      │ │  Tools:    │ │  Tools:      │                │
│     │  • search    │ │  • search  │ │  • search    │                │
│     │  • web_fetch │ │  • web     │ │  • parse     │                │
│     │  • maps_api  │ │  • price   │ │  • nutrition │                │
│     │  • calendar  │ │  • track   │ │  • convert   │                │
│     │              │ │            │ │              │                │
│     │  Memory:     │ │  Memory:   │ │  Memory:     │                │
│     │  [isolated]  │ │  [isolated]│ │  [isolated]  │                │
│     └──────┬───────┘ └─────┬──────┘ └──────────────┘                │
│            │               │                                         │
│            ▼               ▼                                         │
│     ┌────────────┐  ┌───────────┐                                    │
│     │  Flight    │  │  Price    │    ← Sub-subagents                 │
│     │  Searcher  │  │  Tracker  │       (ephemeral task workers)     │
│     └────────────┘  └───────────┘                                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                    VALIDATION LAYER                          │     │
│  │                                                              │     │
│  │  • Source Grounding: Does the result cite real tiles/URLs?   │     │
│  │  • Schema Check: Does output match expected structure?       │     │
│  │  • Hallucination Detector: Are facts verifiable?            │     │
│  │  • Confidence Scoring: How sure is the subagent?            │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │                     SHARED SERVICES                          │     │
│  │                                                              │     │
│  │  Memory Store │ Tool Registry │ Budget Tracker │ Event Bus   │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow for a Multi-Intent Query

```
User: "Plan me a Tokyo trip from my saves AND track the price of those Nike Dunks"

Step 1 — ORCHESTRATOR parses intent:
    → Intent A: "Plan Tokyo trip from saved tiles" → domain: TRAVEL
    → Intent B: "Track Nike Dunks price"          → domain: SHOPPING

Step 2 — ORCHESTRATOR checks Agent Registry:
    → Travel Solver exists? YES (user asked about Tokyo last week)
       → Route to existing Travel Solver (has memory of previous Tokyo queries)
    → Shopping Solver exists? NO
       → Spawn new Shopping Solver

Step 3 — PARALLEL EXECUTION:
    Travel Solver ──→ searches tiles for Tokyo saves
                  ──→ spawns sub-subagent: Itinerary Builder
                  ──→ spawns sub-subagent: Hotel Researcher (web search)
                  ──→ collects results
                  ──→ returns structured itinerary

    Shopping Solver ──→ searches tiles for Nike Dunks screenshot
                   ──→ extracts product info (model, size, color)
                   ──→ spawns sub-subagent: Price Checker (web scrape)
                   ──→ sets up price monitoring job
                   ──→ returns current prices + tracking confirmation

Step 4 — VALIDATION:
    Travel result  → grounded? ✅ (cites 12 tiles) → schema valid? ✅ → pass
    Shopping result → grounded? ✅ (cites 1 tile + 3 URLs) → schema valid? ✅ → pass

Step 5 — ORCHESTRATOR merges:
    → Synthesizes: "Here's your Tokyo itinerary + I'm now tracking those Dunks"
    → Streams to user with cited sources
    → Updates both solvers' memory with this interaction
```

---

## 5. The Orchestrator (Main Agent)

The orchestrator is the brain. It NEVER solves problems directly. Its only job is to understand, route, validate, and synthesize.

### Orchestrator System Prompt (Conceptual)

```
You are the Pool Orchestrator. You manage a team of specialized AI solvers.

YOUR RESPONSIBILITIES:
1. Parse the user's query into one or more intents
2. For each intent, determine the domain (travel, shopping, cooking, music, general)
3. Check if a solver already exists for that domain (check agent registry)
4. Route to existing solver OR spawn a new one
5. Collect results from all solvers
6. Validate results (are they grounded? do they cite real data?)
7. Synthesize a unified response

YOU NEVER:
- Answer domain questions yourself
- Make up facts
- Skip validation
- Spawn more than 5 solvers per query

TOOLS AVAILABLE:
- parse_intents(query) → [{intent, domain, priority}]
- check_solver_exists(domain, user_id) → solver_id | null
- spawn_solver(domain, user_id, initial_context) → solver_id
- route_to_solver(solver_id, task) → result
- validate_result(result, source_tiles) → {valid, issues}
- synthesize(results[]) → final_response
```

### Intent Parsing

The orchestrator's first job is decomposing a query:

```
Input:  "Plan a Tokyo trip and track those Nike shoes"

Output: [
  {
    intent: "Plan a Tokyo trip using saved screenshots",
    domain: "travel",
    priority: 1,
    requires_tiles: true,
    requires_web: true
  },
  {
    intent: "Track price of Nike shoes from saved screenshot",
    domain: "shopping",
    priority: 2,
    requires_tiles: true,
    requires_web: true,
    requires_monitoring: true
  }
]
```

### Agent Registry

The orchestrator maintains a registry of active solvers per user:

```
agent_registry (Postgres table):
┌────────────┬───────────┬──────────┬─────────────────┬──────────────────┐
│ solver_id  │ user_id   │ domain   │ created_at      │ last_active      │
├────────────┼───────────┼──────────┼─────────────────┼──────────────────┤
│ slv_abc123 │ usr_001   │ travel   │ 2026-03-20      │ 2026-03-26       │
│ slv_def456 │ usr_001   │ shopping │ 2026-03-26      │ 2026-03-26       │
│ slv_ghi789 │ usr_001   │ cooking  │ 2026-03-15      │ 2026-03-22       │
│ slv_jkl012 │ usr_002   │ travel   │ 2026-03-25      │ 2026-03-25       │
└────────────┴───────────┴──────────┴─────────────────┴──────────────────┘
```

### Routing Logic

```
function routeIntent(intent, userId):
    domain = classifyDomain(intent)

    // Check for existing solver with relevant memory
    existingSolver = agentRegistry.find(userId, domain)

    if existingSolver AND existingSolver.lastActive > 7_DAYS_AGO:
        // Reuse — this solver remembers past context
        return routeToSolver(existingSolver.id, intent)

    if existingSolver AND existingSolver.lastActive <= 7_DAYS_AGO:
        // Solver exists but stale — reactivate with memory recap
        recap = loadMemoryRecap(existingSolver.id)
        return routeToSolver(existingSolver.id, intent, recap)

    // No solver exists — spawn new one
    newSolver = spawnSolver(domain, userId)
    agentRegistry.register(newSolver)
    return routeToSolver(newSolver.id, intent)
```

---

## 6. Subagent Lifecycle

### States

```
                    ┌──────────┐
       spawn()      │          │
    ───────────────►│  ACTIVE  │◄─────── route_to() reactivates
                    │          │
                    └────┬─────┘
                         │
                    solve(task)
                         │
                    ┌────▼─────┐
                    │ WORKING  │──── can spawn sub-subagents here
                    │          │
                    └────┬─────┘
                         │
                    return result
                         │
                    ┌────▼─────┐
                    │   IDLE   │──── memory persisted, agent sleeping
                    │          │     (costs nothing while idle)
                    └────┬─────┘
                         │
              no activity for 30 days
                         │
                    ┌────▼─────┐
                    │ ARCHIVED │──── memory compressed & stored
                    │          │     agent can be resurrected
                    └──────────┘
```

### Solver Definition (Travel Example)

```
TravelSolver:
  domain: "travel"

  system_prompt: |
    You are the Travel Solver for Pool. You help users plan trips,
    find destinations, build itineraries, and manage travel-related
    screenshots.

    You have access to the user's saved travel screenshots (tiles)
    and can search the web for current information.

    MEMORY: You remember all past travel conversations with this user.
    Before starting, check your memory for relevant context.

    You CAN spawn sub-subagents for:
    - Flight search (complex multi-leg searches)
    - Hotel comparison (price + review aggregation)
    - Itinerary building (day-by-day planning)
    - Local recommendations (restaurants, attractions)

    You CANNOT:
    - Book anything (present options, user books)
    - Access other domains (shopping, cooking)
    - Exceed 3 sub-subagent spawns per task

  tools:
    - search_user_tiles(query, filters)    # Search user's saved screenshots
    - get_tile_details(tile_id)            # Get full tile metadata
    - web_search(query)                    # Search the internet
    - web_fetch(url)                       # Fetch a webpage
    - maps_lookup(place)                   # Google Maps / Places API
    - spawn_worker(task, tools_subset)     # Spawn a sub-subagent
    - read_memory(key?)                    # Read from persistent memory
    - write_memory(key, value)             # Write to persistent memory
    - calendar_check(date_range)           # Check user's calendar

  memory_namespace: "solver:{solver_id}"
  max_rounds: 12
  max_sub_spawns: 3
  model: "gemini-2.0-flash"
```

### All Solver Domains

| Domain | Triggers On | Specialized Tools | Sub-subagents It Can Spawn |
|--------|------------|-------------------|---------------------------|
| **Travel** | trips, flights, hotels, destinations, itineraries | maps_lookup, calendar_check, web_search | Flight Searcher, Hotel Comparer, Itinerary Builder |
| **Shopping** | products, prices, brands, deals, tracking | price_lookup, web_scrape, set_price_alert | Price Tracker, Product Comparer, Deal Finder |
| **Cooking** | recipes, ingredients, meal planning, dietary | recipe_parse, nutrition_lookup, unit_convert | Recipe Formatter, Meal Planner, Shopping List Builder |
| **Music** | songs, artists, playlists, concerts | music_search, odesli_lookup, spotify_api | Playlist Builder, Concert Finder |
| **Events** | concerts, meetups, conferences, deadlines | calendar_api, ticket_search, reminder_set | Ticket Finder, Schedule Optimizer |
| **Knowledge** | articles, notes, learning, research | web_search, summarize, cite_sources | Deep Researcher, Fact Checker |
| **General** | anything that doesn't fit above | search_tiles, web_search | (none — handles directly) |

---

## 7. Memory System Design

This is the hardest and most critical part. Each solver needs isolated, persistent, evolving memory.

### Memory Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY STORE                               │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              ORCHESTRATOR MEMORY                     │     │
│  │                                                      │     │
│  │  • Agent registry (which solvers exist)              │     │
│  │  • User preferences (response style, verbosity)      │     │
│  │  • Cross-domain patterns ("user is planning Tokyo    │     │
│  │    trip AND tracking shoes for the trip")             │     │
│  │  • Query history → solver mapping                    │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ TRAVEL       │  │ SHOPPING     │  │ COOKING      │       │
│  │ SOLVER       │  │ SOLVER       │  │ SOLVER       │  ...  │
│  │ MEMORY       │  │ MEMORY       │  │ MEMORY       │       │
│  │              │  │              │  │              │       │
│  │ Facts:       │  │ Facts:       │  │ Facts:       │       │
│  │ • Going to   │  │ • Tracks     │  │ • Vegetarian │       │
│  │   Tokyo in   │  │   Nike Dunk  │  │   on weekdays│       │
│  │   April      │  │   Low Retro  │  │ • Allergic   │       │
│  │ • Prefers    │  │ • Size 10    │  │   to peanuts │       │
│  │   boutique   │  │ • Budget:    │  │ • Cooks for  │       │
│  │   hotels     │  │   under $120 │  │   2 people   │       │
│  │ • Has 12     │  │ • Watching   │  │              │       │
│  │   Tokyo      │  │   3 items    │  │ Convos:      │       │
│  │   saves      │  │              │  │ • [Mar 15]   │       │
│  │              │  │ Convos:      │  │   Meal plan  │       │
│  │ Convos:      │  │ • [Mar 26]   │  │   for week   │       │
│  │ • [Mar 20]   │  │   Started    │  │              │       │
│  │   "Plan      │  │   tracking   │  │              │       │
│  │   Tokyo"     │  │   Dunks      │  │              │       │
│  │ • [Mar 26]   │  │              │  │              │       │
│  │   "Add       │  │              │  │              │       │
│  │   hotels"    │  │              │  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                               │
│  NOTE: Sub-subagent workers do NOT get persistent memory.     │
│  They receive context from their parent solver and return     │
│  results. Their work is ephemeral.                            │
└─────────────────────────────────────────────────────────────┘
```

### Memory Schema (Postgres)

```sql
-- Each solver's memory entries
CREATE TABLE agent_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solver_id       UUID NOT NULL REFERENCES agent_registry(id),
    user_id         UUID NOT NULL REFERENCES profiles(id),
    memory_type     TEXT NOT NULL,  -- 'fact', 'preference', 'conversation_summary', 'entity'
    key             TEXT NOT NULL,  -- e.g., "destination", "budget", "dietary_restriction"
    value           JSONB NOT NULL, -- structured memory content
    confidence      FLOAT DEFAULT 1.0,  -- how sure are we (decays if contradicted)
    source          TEXT,           -- what query/tile produced this memory
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,    -- optional TTL for transient facts

    UNIQUE(solver_id, key)          -- one value per key per solver
);

-- Index for fast solver memory loading
CREATE INDEX idx_agent_memory_solver ON agent_memory(solver_id, memory_type);

-- Conversation history per solver (compressed summaries, not full transcripts)
CREATE TABLE agent_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solver_id       UUID NOT NULL REFERENCES agent_registry(id),
    user_id         UUID NOT NULL,
    query           TEXT NOT NULL,
    summary         TEXT NOT NULL,       -- LLM-generated summary of what happened
    tiles_referenced UUID[],             -- which tiles were discussed
    tools_used      TEXT[],              -- which tools were called
    outcome         TEXT,                -- 'resolved', 'partial', 'failed'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### Memory Operations

```
READ MEMORY (at solver activation):
    1. Load all agent_memory rows for this solver_id
    2. Load last 5 conversation summaries
    3. Inject into solver's system prompt as context
    4. Total context: ~2000 tokens (compressed)

WRITE MEMORY (during/after solving):
    Solver decides what to remember via write_memory tool:

    write_memory("destination", {
        place: "Tokyo",
        dates: "April 15-22, 2026",
        source: "user query on Mar 26"
    })

    write_memory("hotel_preference", {
        style: "boutique",
        budget: "under $200/night",
        source: "inferred from saved tiles showing small Japanese ryokans"
    })

CONVERSATION SUMMARY (after each interaction):
    LLM generates a 2-3 sentence summary:
    "User asked to plan a Tokyo trip for April. Found 12 relevant tiles
     including 3 restaurants, 2 temples, and 1 hotel. Built a 7-day
     itinerary. User wants to add flight search next time."

MEMORY DECAY:
    • Facts not referenced in 60 days → confidence *= 0.5
    • Confidence < 0.2 → archived (not deleted, but not loaded)
    • Contradicted facts → old fact archived, new fact stored
```

### How Memory Creates Continuity

```
DAY 1:
  User: "I'm thinking about going to Tokyo"
  → Orchestrator spawns Travel Solver (slv_abc)
  → Travel Solver searches tiles, finds 12 Tokyo saves
  → Saves memory: {destination: Tokyo, stage: "exploring", tiles: 12}
  → Response: "I found 12 Tokyo-related saves! Here's what you've collected..."

DAY 4:
  User: "Find me hotels near Shibuya"
  → Orchestrator routes to existing Travel Solver (slv_abc)
  → Travel Solver loads memory: knows about Tokyo trip, 12 tiles
  → Searches web for Shibuya hotels
  → Saves memory: {hotel_area: "Shibuya", stage: "planning"}
  → Response: "Since you're planning that Tokyo trip, here are hotels near Shibuya..."

DAY 7:
  User: "What's my Tokyo plan looking like?"
  → Routes to Travel Solver (slv_abc)
  → Loads memory: destination, hotel_area, all conversation summaries
  → Synthesizes everything into current state
  → Response: "Here's where we are with Tokyo: 12 saved places,
     Shibuya hotel shortlist, still need flights and day-by-day itinerary..."
```

---

## 8. Validation Layer

Every result from a subagent goes through validation before the orchestrator uses it.

### Validation Pipeline

```
Subagent Result
       │
       ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  SCHEMA CHECK    │────►│  SOURCE GROUND   │────►│  CONFIDENCE      │
│                  │     │                  │     │  SCORING         │
│  Does output     │     │  Are cited tiles │     │                  │
│  match expected  │     │  real? Do URLs   │     │  How confident   │
│  structure?      │     │  resolve? Are    │     │  is the result?  │
│                  │     │  facts from      │     │  (based on       │
│  ✓ or retry(1)  │     │  actual data?    │     │  source count,   │
│                  │     │                  │     │  web verification)│
│                  │     │  ✓ or flag       │     │                  │
└──────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                           │
                                                           ▼
                                                  ┌──────────────────┐
                                                  │  VERDICT         │
                                                  │                  │
                                                  │  ✅ PASS → use   │
                                                  │  ⚠️ PARTIAL →    │
                                                  │     use + caveat │
                                                  │  ❌ FAIL →       │
                                                  │     retry or     │
                                                  │     report error │
                                                  └──────────────────┘
```

### Validation Rules

| Check | What It Does | Failure Action |
|-------|-------------|----------------|
| **Schema** | Output matches expected JSON shape | Retry once with stricter prompt |
| **Tile Grounding** | Referenced tile_ids exist in DB for this user | Strip invalid references, flag if >50% invalid |
| **URL Validation** | URLs are real (HEAD request) | Remove dead URLs, note "could not verify" |
| **Fact Consistency** | No contradiction with solver's own memory | Flag contradiction, let orchestrator decide |
| **Confidence Threshold** | Solver self-reports confidence > 0.6 | Add caveat: "I'm not fully sure about..." |
| **Hallucination Heuristic** | Specific claims (prices, dates, facts) have a cited source | Downgrade ungrounded claims to suggestions |

### Why a Separate Validation Layer (Not Just "Check Your Work")

Telling an LLM to "validate your own output" is like asking a student to grade their own exam. It doesn't work reliably. The validation layer is a **separate** LLM call (or deterministic checks) that evaluates the output with fresh eyes:

```
Deterministic checks (fast, cheap, reliable):
  • JSON schema validation
  • Tile ID existence check (DB query)
  • URL HEAD requests
  • Date sanity (not in the past for future events)

LLM-based checks (when needed):
  • "Given these source tiles, does this itinerary make sense?"
  • "Does this price claim match the data from the web scrape?"

  Uses a DIFFERENT system prompt than the solver:
  "You are a fact-checker. Your job is to find errors, not to be helpful."
```

---

## 9. Recursive Subagent Spawning

### The Two Levels of Spawning

```
LEVEL 1 — Orchestrator → Solver (DOMAIN ROUTING)
  Purpose: Route different domains to specialized agents
  Persistent: YES (solver stays alive with memory)
  Max spawns: 5 per query (one per domain)

LEVEL 2 — Solver → Worker (TASK DECOMPOSITION)
  Purpose: Break a complex task into parallel subtasks
  Persistent: NO (worker dies after returning result)
  Max spawns: 3 per solver per task

LEVEL 3 — Worker → Sub-worker (RARE, GUARDED)
  Purpose: Only when a subtask is itself complex
  Persistent: NO
  Max spawns: 1 (hard limit)
  Requires: Solver approval
```

### Example: Travel Solver Decomposes a Task

```
Travel Solver receives: "Build me a 7-day Tokyo itinerary"

Travel Solver thinks:
  "This requires multiple parallel research tasks. I'll spawn workers."

  spawn_worker("research_restaurants", {
    task: "Find the best restaurants near these saved locations",
    tiles: [tile_1, tile_5, tile_8],
    tools: [web_search, maps_lookup]
  }) → Worker A

  spawn_worker("research_activities", {
    task: "Find activities and attractions near these saved temples/spots",
    tiles: [tile_2, tile_3, tile_11],
    tools: [web_search, maps_lookup]
  }) → Worker B

  spawn_worker("optimize_schedule", {
    task: "Given these locations, find the optimal day-by-day route",
    locations: [...all saved locations...],
    tools: [maps_lookup]  // for distance/transit calculations
  }) → Worker C

  // Workers execute IN PARALLEL
  // Results come back to Travel Solver
  // Travel Solver synthesizes into final itinerary
```

### Depth Control (Circuit Breaker)

```
MAX_DEPTH = 3  (Orchestrator=0, Solver=1, Worker=2, Sub-worker=3)

Every agent call carries a depth counter:

  orchestrate(query, depth=0)
    → solver.solve(task, depth=1)
        → worker.execute(subtask, depth=2)
            → sub_worker.execute(sub_subtask, depth=3)
                → CANNOT SPAWN (depth limit reached)

Budget tracking:
  Each query starts with a TOKEN_BUDGET (e.g., 100,000 tokens)
  Every LLM call deducts from the budget
  When budget < 10,000 → no more spawning allowed
  When budget = 0 → force return best-effort result
```

---

## 10. Real-World Query Walkthrough

### Query: "I saved some shoes last week — find me the best price and also plan a weekend getaway using the places I've been saving"

```
┌──────────────────────────────────────────────────────────────────┐
│ STEP 1: ORCHESTRATOR PARSES INTENTS                              │
│                                                                   │
│ parse_intents("shoes price + weekend getaway from saves")         │
│ → [                                                               │
│     { intent: "find best price for saved shoes",                  │
│       domain: "shopping", priority: 1 },                          │
│     { intent: "plan weekend getaway from saved places",           │
│       domain: "travel", priority: 1 }                             │
│   ]                                                               │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 2: ORCHESTRATOR CHECKS REGISTRY                             │
│                                                                   │
│ Shopping Solver: EXISTS (slv_def456, last active today)           │
│   → Memory has: Nike Dunk Low Retro, Size 10, budget < $120      │
│                                                                   │
│ Travel Solver: EXISTS (slv_abc123, last active 6 days ago)        │
│   → Memory has: Tokyo trip planning, Shibuya hotels               │
│                                                                   │
│ Decision: Route to BOTH existing solvers in parallel              │
└──────────────┬──────────────────────┬────────────────────────────┘
               │                      │
     ┌─────────▼──────────┐  ┌───────▼────────────┐
     │ SHOPPING SOLVER     │  │ TRAVEL SOLVER       │
     │                     │  │                     │
     │ Loads memory:       │  │ Loads memory:       │
     │ • Nike Dunks, $120  │  │ • Tokyo, Shibuya    │
     │ • Size 10           │  │ • 12 saved tiles    │
     │                     │  │                     │
     │ "User asked about   │  │ "User wants WEEKEND │
     │ shoes — checking if │  │ not Tokyo (that's   │
     │ this is the Dunks   │  │ a week trip). Let   │
     │ or something new"   │  │ me search for       │
     │                     │  │ weekend-suitable     │
     │ → search_tiles(     │  │ saves"              │
     │   "shoes", last 7d) │  │                     │
     │                     │  │ → search_tiles(      │
     │ Found: 2 tiles      │  │   "getaway weekend  │
     │ • Nike Dunk (known) │  │    trip nature")     │
     │ • New Balance 550   │  │                     │
     │                     │  │ Found: 8 tiles      │
     │ "TWO products now.  │  │ • 3 Napa Valley     │
     │ Spawning price      │  │ • 2 Big Sur         │
     │ checkers."          │  │ • 3 Monterey        │
     │                     │  │                     │
     │ spawn_worker(       │  │ spawn_worker(        │
     │  "price_nike_dunk") │  │  "plan_napa_weekend")│
     │                     │  │                     │
     │ spawn_worker(       │  │ spawn_worker(        │
     │  "price_nb_550")    │  │  "plan_bigsur_wknd") │
     │                     │  │                     │
     │ Workers return:     │  │ Workers return:      │
     │ • Dunks: $109 Nike, │  │ • Napa: wine tour +  │
     │   $98 StockX,       │  │   2 restaurants from │
     │   $115 GOAT         │  │   saves, ~$400       │
     │ • NB 550: $89 NB,   │  │ • Big Sur: camping + │
     │   $95 Foot Locker   │  │   highway drive,     │
     │                     │  │   ~$250              │
     │ Saves to memory:    │  │                     │
     │ • New Balance 550   │  │ Saves to memory:     │
     │   added to tracking │  │ • Weekend getaway    │
     │                     │  │   options explored   │
     │ Returns result      │  │                     │
     │ with confidence 0.9 │  │ Returns result       │
     │                     │  │ with confidence 0.85 │
     └─────────┬───────────┘  └───────┬─────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 3: VALIDATION                                                │
│                                                                   │
│ Shopping result:                                                  │
│  ✅ Schema valid (prices, URLs, tile references)                  │
│  ✅ Tiles exist (verified 2 tile IDs)                             │
│  ⚠️ Prices from web — add "prices as of Mar 26" caveat           │
│  → PASS with caveat                                               │
│                                                                   │
│ Travel result:                                                    │
│  ✅ Schema valid (itinerary structure, locations)                  │
│  ✅ Tiles exist (verified 8 tile IDs)                             │
│  ✅ Locations verified via maps_lookup                             │
│  → PASS                                                           │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ STEP 4: ORCHESTRATOR SYNTHESIZES                                  │
│                                                                   │
│ "I found 2 pairs of shoes from your recent saves and             │
│  3 weekend getaway options from your saved places:                │
│                                                                   │
│  👟 SHOES                                                         │
│  ┌─────────────────────────────────────────────┐                  │
│  │ Nike Dunk Low Retro — best price: $98 StockX│                  │
│  │ New Balance 550 — best price: $89 NB.com    │                  │
│  │ (prices as of Mar 26)                        │                  │
│  └─────────────────────────────────────────────┘                  │
│                                                                   │
│  🏖️ WEEKEND GETAWAYS (from your saves)                            │
│  1. Napa Valley — wine tour + 2 restaurants you saved (~$400)     │
│  2. Big Sur — Pacific Coast Highway + camping (~$250)             │
│  3. Monterey — aquarium + seafood spots you saved (~$300)         │
│                                                                   │
│  Want me to track prices on both shoes? Or flesh out              │
│  one of the getaway options into a full plan?"                    │
│                                                                   │
│  Sources: [tile_1] [tile_2] [tile_5] ... [tile_10]               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 11. Risks, Limitations & Mitigations

### Critical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Cost explosion** — Multi-agent = multiple LLM calls per query | 🔴 High | Token budget per query. Cheap model (Flash) for routing + workers. Expensive model only for final synthesis. Cache aggressively. |
| **Latency** — User waits while 3 agents + 6 workers execute | 🔴 High | Stream status updates ("Searching prices... Found 3 options... Building plan..."). Parallel execution. 15-second timeout per worker. |
| **Orchestrator misrouting** — Sends cooking query to travel solver | 🟡 Medium | Start with explicit domain keywords. Log misroutes. Fallback to General Solver. Let user correct ("no, I meant..."). |
| **Memory bloat** — Solver memories grow unbounded | 🟡 Medium | Memory limits per solver (50 facts, 20 conversation summaries). Compression on write. Archival after 60 days inactivity. |
| **Circular spawning** — Agent A spawns B which tries to spawn A | 🟡 Medium | Depth counter. No upward spawning. Workers cannot spawn solvers. |
| **Stale memory** — Solver remembers outdated prices/dates | 🟡 Medium | TTL on fact memories. "Price as of date" annotations. Re-verify before presenting. |
| **Over-spawning** — Simple query triggers full agent tree | 🟢 Low | Orchestrator classifies query complexity first. Simple queries → direct answer, no spawning. |

### When NOT to Spawn Subagents

Not every query needs the full machinery. The orchestrator should classify:

```
COMPLEXITY LEVELS:

Level 0 — DIRECT ANSWER (no spawning):
  "What did I save yesterday?" → Direct tile search, orchestrator answers
  "How many tiles do I have?" → DB count, orchestrator answers

Level 1 — SINGLE SOLVER (one domain):
  "Find me recipes for tonight" → Route to Cooking Solver only
  "Track those shoes" → Route to Shopping Solver only

Level 2 — MULTI SOLVER (multiple domains):
  "Plan Tokyo trip and track shoes" → Travel + Shopping in parallel

Level 3 — DEEP SOLVE (solver + workers):
  "Build a complete 7-day Tokyo itinerary with flights, hotels,
   restaurants from my saves, and daily schedule" → Travel Solver + 3 workers
```

### Failure Modes & Recovery

```
WORKER TIMEOUT (15 seconds):
  → Worker killed, solver uses partial results
  → Solver notes: "I couldn't fully research hotels — here's what I found so far"

SOLVER FAILURE:
  → Orchestrator catches error
  → Falls back to General Solver with the original task
  → Notes: "My travel specialist hit an issue. Here's what I can tell you generally..."

VALIDATION FAILURE:
  → Retry once with stricter instructions
  → If still fails: return partial result with honest caveat
  → Never: make up data to fill the gap

BUDGET EXHAUSTED:
  → Stop spawning, work with what we have
  → Stream: "I've done as much research as I can for now. Here's the summary..."
```

---

## 12. Tech Stack & Implementation

### What You'd Build With

| Component | Technology | Why |
|-----------|-----------|-----|
| **Orchestrator LLM** | Gemini 2.0 Flash | Fast, good at tool calling, cheap for routing decisions |
| **Solver LLM** | Gemini 2.0 Flash (default) / Gemini 2.5 Pro (complex) | Flash for most solvers; Pro for deep research tasks |
| **Worker LLM** | Gemini 2.0 Flash | Workers need speed, not depth |
| **Validation** | 80% deterministic + 20% Gemini Flash | Minimize LLM calls for validation |
| **Memory Store** | Postgres (existing Supabase) | Structured, queryable, already in stack |
| **Memory Cache** | Redis (existing) | Fast solver memory loading |
| **Agent Registry** | Postgres table | Persistent across restarts |
| **Job Queue** | BullMQ (existing) | For async worker spawning |
| **Streaming** | SSE via Fastify | Real-time status updates to client |
| **Embeddings** | Voyage AI (existing) | For memory semantic search |
| **Web Search** | Bright Data SERP (existing) | For real-time price/info lookup |

### Key Implementation Files (New)

```
services/api/src/
  routes/v2/
    agent-chat.ts              # SSE endpoint for agent V2

services/worker/src/
  agent/
    orchestrator.ts            # Main orchestrator loop
    solver-registry.ts         # Manage solver lifecycle
    solver-base.ts             # Base class for all solvers
    validation.ts              # Validation pipeline
    budget-tracker.ts          # Token budget management

    solvers/
      travel-solver.ts         # Travel domain
      shopping-solver.ts       # Shopping domain
      cooking-solver.ts        # Cooking domain
      music-solver.ts          # Music domain
      events-solver.ts         # Events domain
      knowledge-solver.ts      # General knowledge
      general-solver.ts        # Fallback

    memory/
      agent-memory.ts          # Read/write agent memory
      memory-compression.ts    # Summarize old conversations
      memory-decay.ts          # Archive stale facts

packages/shared/prisma/
  migrations/
    20260327_agent_v2/
      migration.sql            # agent_registry, agent_memory, agent_conversations tables
```

### Pseudocode: Core Loop

```typescript
async function orchestrate(query: string, userId: string, stream: SSEStream) {
  const budget = new BudgetTracker(MAX_TOKENS_PER_QUERY)

  // Step 1: Parse intents
  stream.emit("status", "Understanding your request...")
  const intents = await parseIntents(query, budget)

  // Step 2: Route each intent to a solver
  const solverTasks = await Promise.all(
    intents.map(async (intent) => {
      const solverId = await findOrSpawnSolver(intent.domain, userId)
      stream.emit("status", `${intent.domain} specialist is working on it...`)
      return { solverId, intent }
    })
  )

  // Step 3: Execute solvers in parallel
  const results = await Promise.all(
    solverTasks.map(({ solverId, intent }) =>
      executeSolver(solverId, intent, userId, budget, stream)
    )
  )

  // Step 4: Validate each result
  stream.emit("status", "Verifying results...")
  const validated = await Promise.all(
    results.map(r => validateResult(r, userId))
  )

  // Step 5: Synthesize
  stream.emit("status", "Putting it all together...")
  const response = await synthesize(validated, query, budget)

  // Step 6: Update memories
  await Promise.all(
    solverTasks.map(({ solverId }, i) =>
      updateSolverMemory(solverId, intents[i], validated[i])
    )
  )

  stream.emit("response", response)
}
```

---

## 13. Cost Analysis

### Per-Query Cost Estimates (Gemini 2.0 Flash Pricing)

| Scenario | LLM Calls | ~Input Tokens | ~Output Tokens | Estimated Cost |
|----------|-----------|---------------|----------------|----------------|
| **Simple query** (Level 0, no spawn) | 1 | 2,000 | 500 | ~$0.0003 |
| **Single solver** (Level 1) | 3 (orchestrator + solver + validation) | 8,000 | 2,000 | ~$0.001 |
| **Multi solver** (Level 2, 2 domains) | 5-7 | 20,000 | 5,000 | ~$0.003 |
| **Deep solve** (Level 3, solver + 3 workers) | 8-12 | 40,000 | 10,000 | ~$0.006 |
| **Max complexity** (2 solvers, 6 workers, validation) | 15-20 | 80,000 | 20,000 | ~$0.012 |

**At 50 queries/user/day, worst case: ~$0.60/user/day, ~$18/user/month**
**At 50 queries/user/day, realistic mix: ~$0.10/user/day, ~$3/user/month**

### Cost Optimization Strategies

| Strategy | Savings | How |
|----------|---------|-----|
| **Level 0 fast-path** | 60-70% | Most queries are simple — don't spawn agents |
| **Solver memory cache** | 20-30% | Don't re-build context each time (Redis, 5min TTL) |
| **Worker result cache** | 10-20% | Same web searches in same session → cache |
| **Budget caps** | Safety net | Hard limit per query prevents runaway costs |
| **Batch validation** | 10% | Validate multiple results in one LLM call |

---

## 14. What Exists Today vs What Needs Building

### Already Built (Reusable)

| Component | Current State | Reusability for V2 |
|-----------|--------------|-------------------|
| Gemini SDK integration | ✅ Working | Direct reuse — same SDK, same tool calling pattern |
| Voyage embeddings | ✅ Working | Direct reuse for memory semantic search |
| Tile search (vector + FTS) | ✅ Working | Core tool for every solver |
| BullMQ job queue | ✅ Working | Reuse for async worker spawning |
| Redis caching | ✅ Working | Reuse for solver memory cache |
| Bright Data SERP | ✅ Working | Reuse for web search tools |
| Supabase Postgres | ✅ Working | Add new tables, same infra |
| SSE/streaming | ❌ Not yet | Needs building (Fastify supports it natively) |
| Admin UI (Next.js) | ✅ Working | Extend for agent monitoring dashboard |

### Needs Building (New)

| Component | Effort | Priority |
|-----------|--------|----------|
| Orchestrator agent loop | 2-3 days | P0 — the core |
| Intent parser | 1-2 days | P0 — orchestrator depends on it |
| Solver base class + lifecycle | 2-3 days | P0 |
| Agent registry (Postgres) | 1 day | P0 |
| Agent memory system | 3-4 days | P0 — the differentiator |
| Validation pipeline | 2-3 days | P0 |
| SSE streaming endpoint | 1-2 days | P0 — UX requirement |
| Worker spawning from solvers | 2 days | P1 |
| Budget tracker | 1 day | P1 |
| Memory decay/archival cron | 1 day | P1 |
| Travel solver + tools | 2-3 days | P1 (first domain) |
| Shopping solver + tools | 2-3 days | P1 |
| Cooking solver + tools | 2 days | P2 |
| Music solver + tools | 1-2 days | P2 (mostly exists) |
| Admin monitoring dashboard | 2 days | P2 |
| Memory compression | 1-2 days | P2 |

**Total estimated build: ~4-6 weeks for core system + 2 solver domains**

---

## 15. Verdict

### Is this architecture practical? **Yes.**

It's how the best AI products work today. Claude Code spawns subagents for complex tasks. ChatGPT's deep research spawns parallel researchers. Devin spawns planners, coders, and testers. This is the pattern.

### Is it usable? **Yes, with discipline.**

The key discipline: **don't over-spawn.** 80% of queries should be Level 0 or Level 1 (no spawn or single solver). The full multi-agent tree is for the 20% of queries that genuinely need it. If the orchestrator spawns 3 agents for "what did I save today?", the UX is terrible.

### Is it executable? **Yes, with your current stack.**

You already have: Gemini tool calling, BullMQ workers, Redis, Postgres, Voyage embeddings, SERP search. The new pieces are the orchestrator loop, solver lifecycle, and memory system — all implementable in TypeScript on your existing infra.

### Is it the right architecture for Pool? **It's the architecture Pool was built for.**

Pool's unique advantage: **you have the user's actual saves.** No other AI assistant knows that this user saved 12 Tokyo screenshots, prefers boutique hotels, tracks Nike Dunks in size 10, and cooks vegetarian on weekdays. This context makes the agent dramatically more useful than a generic AI.

The subagent memory system is what makes this feel *personal* — the Travel Solver that remembers your Tokyo planning across 5 conversations is what separates Pool from "ask ChatGPT with my screenshots pasted in."

### The one thing to get right: **The Orchestrator.**

Everything depends on the orchestrator's ability to:
1. Parse intents correctly
2. Route to the right solver
3. Know when NOT to spawn
4. Synthesize results cleanly

If the orchestrator is smart, the whole system works. If it's dumb, you just have expensive chaos.

**Start with the orchestrator + one solver (Travel). Prove the pattern. Then expand.**

---

*This architecture is designed for Pool by analyzing the existing codebase, infrastructure, and product direction. It builds on the current Gemini + BullMQ + Supabase stack and extends it with hierarchical agent management and persistent solver memory.*
