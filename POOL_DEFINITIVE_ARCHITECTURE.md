# Pool Agent — Definitive Architecture

> The unified, best-of-all-docs architecture for Pool's AI agent system.
> Synthesized from: pool-agent-v2-architecture.md, pool-tech.md, POOL_ARCHITECTURE.md, vercel-ai-sdk-vs-agno.md

---

## 1. What Pool Is

Pool is a screenshot app where an AI agent watches what you save, learns who you are, remembers like a human brain, and acts before you ask.

**The one-liner:** Your screenshots become a second brain that thinks, remembers, and acts.

```
Google Photos     = storage
Apple Photos      = storage + basic search
Pool              = storage + intelligence + memory + proactive action

Nobody else does this.
```

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            USER DEVICE                                   │
│   Screenshot → On-Device Triage → Upload → Pool App UI ← Notifications  │
└────────────────────────────┬──────────────────────────▲──────────────────┘
                             │                          │
                             ▼                          │
┌──────────────────────────────────────────────────────────────────────────┐
│                        CONVEX BACKEND                                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    INGESTION PIPELINE                            │    │
│  │                                                                  │    │
│  │  Screenshot → Vision LLM → Entity Extract → Intent Classify     │    │
│  │           → Embed (text + image) → Store → Profile Update       │    │
│  └──────────────────────────────┬──────────────────────────────────┘    │
│                                 │                                        │
│         ┌───────────────────────┼────────────────────────┐              │
│         ▼                       ▼                        ▼              │
│  ┌─────────────┐    ┌────────────────────┐    ┌──────────────────┐     │
│  │ USER PROFILE │    │   MEMORY SYSTEM    │    │ PROACTIVE BRAIN  │     │
│  │   BUILDER    │    │   (Brain-Like)     │    │                  │     │
│  │              │    │                    │    │ Pattern Detector │     │
│  │ • Identity   │    │ • Sensory (secs)   │    │ Intent Predictor │     │
│  │ • Interests  │    │ • Short-term (days)│    │ Action Planner   │     │
│  │ • Preferences│    │ • Long-term (perm) │    │ Timing Engine    │     │
│  │ • Routines   │    │ • Decay + Recall   │    │ Delivery Manager │     │
│  │ • Wishlist   │    │ • Clustering       │    │ Feedback Loop    │     │
│  └──────┬──────┘    └─────────┬──────────┘    └────────┬─────────┘     │
│         │                     │                        │                │
│         └─────────────────────┼────────────────────────┘                │
│                               ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              HIERARCHICAL MULTI-AGENT SYSTEM                    │    │
│  │                    (Vercel AI SDK)                               │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────┐                │    │
│  │  │              ORCHESTRATOR                    │                │    │
│  │  │  • Parse intents (multi-intent support)     │                │    │
│  │  │  • Route to solvers (existing or new)       │                │    │
│  │  │  • Complexity classification (Level 0-3)    │                │    │
│  │  │  • Validate + synthesize results            │                │    │
│  │  └──────┬──────────┬──────────┬────────────────┘                │    │
│  │         │          │          │                                  │    │
│  │         ▼          ▼          ▼                                  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │    │
│  │  │ TRAVEL   │ │ SHOPPING │ │ COOKING  │  + Music, Events,      │    │
│  │  │ SOLVER   │ │ SOLVER   │ │ SOLVER   │    Knowledge, General  │    │
│  │  │          │ │          │ │          │                         │    │
│  │  │ Memory:  │ │ Memory:  │ │ Memory:  │  ← Each solver has     │    │
│  │  │ isolated │ │ isolated │ │ isolated │    persistent memory    │    │
│  │  └────┬─────┘ └────┬─────┘ └──────────┘                        │    │
│  │       │            │                                             │    │
│  │       ▼            ▼                                             │    │
│  │  ┌──────────┐ ┌──────────┐                                      │    │
│  │  │ Workers  │ │ Workers  │  ← Ephemeral task executors          │    │
│  │  │ (Flight, │ │ (Price,  │     (no persistent memory)           │    │
│  │  │  Hotel)  │ │  Deal)   │                                      │    │
│  │  └──────────┘ └──────────┘                                      │    │
│  │                                                                  │    │
│  │  ┌──────────────────────────────────────┐                       │    │
│  │  │         VALIDATION LAYER             │                       │    │
│  │  │  • Schema check (deterministic)      │                       │    │
│  │  │  • Source grounding (tile IDs exist?) │                       │    │
│  │  │  • Hallucination detection           │                       │    │
│  │  │  • Confidence scoring                │                       │    │
│  │  └──────────────────────────────────────┘                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    SHARED SERVICES                               │    │
│  │  Agent Registry │ Budget Tracker │ Memory Store │ Tool Registry  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    ACTION EXECUTORS                              │    │
│  │  Calendar API │ Price Scraper │ Push Notifications │ Reminders  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack (Final Decision)

These are the resolved decisions from all docs, not a menu of options.

| Layer | Technology | Why (settled reasoning) |
|---|---|---|
| **Backend** | **Convex** (TypeScript, serverless) | Reactive real-time DB, scheduled functions replace BullMQ/crons, same language as frontend |
| **AI Framework** | **Vercel AI SDK** | Runs inside Convex actions natively, same types, direct DB access, no Python sidecar needed |
| **Primary LLM** | **Gemini 2.0 Flash** | Fast, cheap, good tool calling — used for orchestrator, solvers, workers |
| **Vision LLM** | **Gemini 2.0 Flash** (screenshot analysis) | Multimodal, handles OCR + scene understanding in one call |
| **Upgrade LLM** | **Gemini 2.5 Pro** | Only for complex synthesis (Level 3 queries, itinerary generation) |
| **Embeddings** | **Voyage AI** (text) + **CLIP** (image) | Voyage already in stack; CLIP for visual similarity |
| **Vector DB** | **Convex + pgvector** or **Qdrant** | Semantic search for memory recall and pool clustering |
| **Object Storage** | **Cloudflare R2** | Cheap, S3-compatible, no egress fees |
| **Mobile** | **React Native** or **Swift/Kotlin** | Cross-platform or native per platform decision |
| **Web Search** | **Bright Data SERP** | Already in stack, for real-time price/info lookup |
| **Notifications** | **Firebase Cloud Messaging** | Push alerts for proactive actions |
| **Auth** | **Clerk** or **Convex Auth** | Session management |

### What We Don't Need

| Dropped | Why |
|---|---|
| Neo4j / Knowledge Graph | Overkill — vector embeddings + Convex relational queries handle entity relationships. Knowledge graphs add infra complexity for marginal gain at this stage. |
| Agno (Python agent framework) | Can't run inside Convex. Would need a Python sidecar with its own server, deploy pipeline, monitoring. Not worth it. |
| Elasticsearch | Convex has built-in full-text search + vector search. |
| BullMQ / Redis | Convex scheduled functions replace job queues. Convex's built-in caching replaces Redis for most cases. |
| Separate OCR service | Gemini Flash handles OCR + vision understanding in a single multimodal call. No need for Apple Vision / Google Vision as a separate step. |

---

## 4. Ingestion Pipeline

Every screenshot goes through this pipeline on upload.

```
Screenshot (image)
    │
    ▼
[Stage 1] UPLOAD
    • Save image to Cloudflare R2 → get image_url
    • Return 202 Accepted immediately (async processing starts)
    │
    ▼
[Stage 2] VISION ANALYSIS (Gemini Flash, single multimodal call)
    Input:  raw image + system prompt
    Output: structured JSON
    {
      "description": "Concert ticket for Coldplay, Mumbai, Aug 15 2026",
      "category": "event_ticket",
      "entities": {
        "event": "Coldplay Concert",
        "location": "Mumbai",
        "date": "2026-08-15",
        "price": "₹4,500",
        "platform": "BookMyShow"
      },
      "ocr_text": "full extracted text from screenshot...",
      "intent": "planning_to_attend",
      "user_facts": [
        {"fact": "user_name", "value": "Samiksha", "evidence": "name on ticket", "confidence": 0.95}
      ],
      "actionable": true,
      "suggested_actions": ["add_calendar_event", "set_reminder"],
      "importance_score": 0.85
    }
    │
    ▼
[Stage 3] EMBEDDING GENERATION (parallel)
    • Text embedding (Voyage AI) — from description + ocr_text
    • Image embedding (CLIP) — from raw image
    • Combined vector via weighted late fusion (70% text, 30% image)
    │
    ▼
[Stage 4] PROFILE + MEMORY UPDATE
    • Feed user_facts into User Profile Builder (confidence-gated)
    • Score importance → assign memory tier (sensory/short-term/long-term)
    • Assign decay rate based on category
    • Link to related screenshots via embedding similarity
    │
    ▼
[Stage 5] POOL ASSIGNMENT
    • Find matching pool(s) via embedding similarity to cluster centroids
    • Similarity > 0.8 → add to existing pool
    • No match → hold; periodic clustering may form a new pool later
    │
    ▼
[Stage 6] PROACTIVE CHECK (event-driven)
    • Does this complete a pattern? (e.g., 3rd Bali screenshot → travel sequence)
    • Is there a deadline/urgency? (sale ends tomorrow)
    • Is this a product already being tracked? (add new price source)
    • If actionable → queue proactive action at appropriate tier
    │
    ▼
[Stage 7] NOTIFY CLIENT
    • Push analysis results via Convex reactivity (instant UI update)
    • If Tier 2+ proactive action triggered → show suggestion card
```

### Screenshot Categories

```
product_shopping      → triggers price tracking
event_ticket          → triggers calendar/reminder
travel_destination    → feeds itinerary planner
food_restaurant       → feeds taste profile
music_entertainment   → feeds music profile
conversation_chat     → extracts plans, promises, contacts
document_info         → extracts personal facts (IDs, bills, receipts)
social_media          → extracts interests
personal_photo        → extracts people, places
work_professional     → extracts work context
health_fitness        → feeds wellness tracking
finance               → feeds spending awareness
education             → feeds learning interests
meme_funny            → low importance, high decay
other                 → uncategorized
```

---

## 5. User Profile Builder

The profile is built incrementally from screenshot evidence only. Every fact must cite its source.

```
UserProfile:
  identity:
    name: "Samiksha" (confidence: 0.95, source: screenshot_42, evidence: "name on boarding pass")
    location: "Delhi, India" (confidence: 0.80, sources: [screenshot_12, screenshot_88])

  interests:                    # ranked by strength × recency
    - topic: "Bali travel"     (strength: 0.9, screenshots: 14, last_seen: "2026-03-20")
    - topic: "Coldplay"        (strength: 0.85, screenshots: 9, last_seen: "2026-03-22")
    - topic: "Nike Air Max"    (strength: 0.7, screenshots: 6, last_seen: "2026-03-18")

  wishlist:
    - item: "Nike Air Max 90"
      sources: ["Amazon", "Flipkart", "Nike.com"]
      price_history: [{date, price, source}...]
      lowest_seen: ₹7,499

  upcoming_events:
    - event: "Coldplay Concert", date: "2026-08-15", location: "Mumbai"

  taste_profile:
    cuisine: ["Japanese", "Italian"]
    music: ["Alternative Rock", "Indie"]
    travel_style: "adventure + luxury"
    budget_range: "mid-premium"

  routines:
    - name: "weekend_cooking", trigger: "Saturday", action: "surface saved recipes"
    - name: "fitness_tracking", trigger: "Monday", action: "show gym progress"

RULES:
  • NEVER assume a fact without screenshot evidence
  • confidence < 0.5 → store but never surface
  • conflicting facts → keep both, flag for user resolution
  • user corrections always override agent inference
  • personal info (passwords, private chats) → encrypt, never expose
```

---

## 6. Memory System (Brain-Like)

Three-tier memory modeled after human cognition. This is the core differentiator.

```
┌──────────────────────────────────────────────────────────┐
│                  MEMORY TIERS                             │
│                                                          │
│  ┌──────────────┐                                        │
│  │ SENSORY      │  Every screenshot enters here          │
│  │ MEMORY       │  Retained: seconds → minutes           │
│  │              │  Quick classification only              │
│  └──────┬───────┘                                        │
│         │ important? (score > 0.3)                       │
│         ▼                                                │
│  ┌──────────────┐                                        │
│  │ SHORT-TERM   │  Recent screenshots, full detail       │
│  │ MEMORY       │  Retained: days → weeks                │
│  │              │  Exponential decay applied              │
│  └──────┬───────┘                                        │
│         │ reinforced? (recalled, interacted, linked)     │
│         ▼                                                │
│  ┌──────────────┐                                        │
│  │ LONG-TERM    │  Consolidated knowledge                │
│  │ MEMORY       │  Retained: months → forever            │
│  │              │  "User loves Bali"                     │
│  │              │  "User tracks Nike shoes"              │
│  └──────────────┘                                        │
└──────────────────────────────────────────────────────────┘
```

### Memory Scoring

```typescript
function calculateMemoryStrength(screenshot: Screenshot): number {
  const baseImportance = screenshot.importanceScore  // 0-1 from analysis

  // Time decay (Ebbinghaus forgetting curve)
  const hoursSinceUpload = hoursBetween(now(), screenshot.uploadedAt)
  const timeFactor = Math.exp(-screenshot.decayRate * hoursSinceUpload)

  // Reinforcement (each recall/interaction strengthens)
  const recallBoost = Math.log(1 + screenshot.recallCount) * 0.2

  // Recency of last recall
  const recallRecency = screenshot.lastRecalledAt
    ? Math.exp(-0.01 * hoursBetween(now(), screenshot.lastRecalledAt))
    : 0

  // Connection strength (related screenshots)
  const connectionScore = screenshot.relatedScreenshots.length * 0.05

  return Math.min(
    baseImportance * timeFactor + recallBoost + recallRecency * 0.3 + connectionScore,
    1.0
  )
}

// Tier thresholds:
// strength > 0.7 → long_term
// strength > 0.3 → short_term
// strength ≤ 0.3 → fading (deprioritized, never deleted)
```

### What Triggers Reinforcement (Move to Long-Term)

- Multiple screenshots of same topic
- User interacts with the screenshot (opens, shares, acts on)
- Screenshot leads to a completed action
- Screenshot is recalled via search or agent query
- Agent references it in a proactive suggestion that user approves

### What Triggers Decay

- No reinforcement over time
- Low importance score
- Superseded by newer info (old price screenshot)
- Ephemeral category (memes, random social posts)

---

## 7. Hierarchical Multi-Agent System

### Why Multi-Agent (Not a Single LLM)

A single LLM call cannot: maintain per-domain memory across sessions, run parallel research tasks, enforce cost budgets, or validate its own output. The multi-agent hierarchy solves all four.

### Agent Hierarchy

```
User Query
    │
    ▼
ORCHESTRATOR (depth 0)
    │  • Parse multi-intent queries
    │  • Classify complexity (Level 0-3)
    │  • Route to correct solver(s)
    │  • Validate results
    │  • Synthesize final response
    │  • NEVER solves directly
    │
    ├─────────────────────────────┐
    ▼                             ▼
TRAVEL SOLVER (depth 1)     SHOPPING SOLVER (depth 1)     ...more
    │  • Has persistent memory   │  • Has persistent memory
    │  • Domain expert           │  • Domain expert
    │  • Can spawn workers       │  • Can spawn workers
    │                             │
    ├─────────┐                   ├─────────┐
    ▼         ▼                   ▼         ▼
Flight     Hotel              Price      Deal
Searcher   Comparer           Tracker    Finder
(depth 2)  (depth 2)          (depth 2)  (depth 2)
    │  • Ephemeral (dies after task)
    │  • No persistent memory
    │  • Receives context from parent solver
    │  • Max depth = 3 (hard limit, spawn tool removed at depth 3)
```

### Complexity Classification (The Cost Saver)

The orchestrator's first action is classifying query complexity. This single cheap LLM call prevents over-spawning.

```
Level 0 — DIRECT ANSWER (1 LLM call, no spawning):
  "What did I save today?" → DB query, orchestrator answers directly
  "How many screenshots?" → count query
  80% of queries should be here.

Level 1 — SINGLE SOLVER (3 LLM calls):
  "Find me pasta recipes" → route to Cooking Solver
  "Track those shoes" → route to Shopping Solver

Level 2 — MULTI SOLVER (5-7 LLM calls, parallel):
  "Plan Tokyo trip and track shoes" → Travel + Shopping in parallel

Level 3 — DEEP SOLVE (8-15 LLM calls, solver + workers):
  "Build complete 7-day Tokyo itinerary with flights, hotels, restaurants"
  → Travel Solver + Flight Searcher + Hotel Comparer + Restaurant Finder
```

### Solver Domains

| Domain | Triggers On | Specialized Tools | Workers It Can Spawn |
|--------|------------|-------------------|----------------------|
| **Travel** | trips, flights, hotels, destinations | maps_lookup, calendar, web_search | Flight Searcher, Hotel Comparer, Itinerary Builder |
| **Shopping** | products, prices, brands, deals | price_lookup, web_scrape, price_alert | Price Tracker, Product Comparer, Deal Finder |
| **Cooking** | recipes, ingredients, meal planning | recipe_parse, nutrition_lookup | Recipe Formatter, Meal Planner, Grocery List Builder |
| **Music** | songs, artists, playlists, concerts | music_search, spotify_api | Playlist Builder, Concert Finder |
| **Events** | concerts, meetups, deadlines | calendar_api, ticket_search, reminder | Ticket Finder, Schedule Optimizer |
| **Knowledge** | articles, notes, learning, research | web_search, summarize | Deep Researcher, Fact Checker |
| **General** | anything that doesn't fit above | search_tiles, web_search | (none — handles directly) |

### Agent Registry

Each user gets solvers that persist across conversations.

```typescript
// Convex table
agentRegistry: {
  solverId: string
  userId: string
  domain: string          // "travel", "shopping", etc.
  createdAt: number
  lastActiveAt: number
  status: "active" | "idle" | "archived"
}
```

**Routing logic:**
1. Solver exists + active in last 7 days → route to it (has memory context)
2. Solver exists + stale → reactivate with memory recap
3. No solver → spawn new one, register in registry

### Per-Solver Memory

Each solver gets its own isolated memory namespace. This creates the "it remembers me" experience.

```typescript
// Convex table
agentMemory: {
  solverId: string
  userId: string
  memoryType: "fact" | "preference" | "conversation_summary" | "entity"
  key: string               // e.g., "destination", "budget"
  value: any                // structured memory content
  confidence: number        // 0-1, decays if contradicted
  source: string            // which query/tile produced this
  expiresAt?: number        // TTL for transient facts (prices = 24h, prefs = 90d)
  createdAt: number
  updatedAt: number
}

// Memory limits per solver (prevents bloat):
// Facts: max 50 (oldest low-confidence archived at limit)
// Conversation summaries: max 20 (oldest merged into "history overview")
// Entities: max 100 (least-referenced archived)
// Total context loaded into prompt: ~2000 tokens always
```

**Memory continuity example:**

```
DAY 1: User: "I'm thinking about going to Tokyo"
  → Orchestrator spawns Travel Solver
  → Solver searches tiles, finds 12 Tokyo saves
  → Saves memory: {destination: Tokyo, stage: "exploring", tiles: 12}

DAY 4: User: "Find me hotels near Shibuya"
  → Routes to EXISTING Travel Solver
  → Loads memory: knows about Tokyo trip, 12 tiles
  → Saves memory: {hotel_area: "Shibuya", stage: "planning"}

DAY 7: User: "What's my Tokyo plan looking like?"
  → Same Travel Solver, full context preserved
  → Synthesizes: "12 saved places, Shibuya hotel shortlist, need flights..."
```

### Fact TTL (Stale Memory Prevention)

| Fact Type | TTL | Example |
|---|---|---|
| Prices | 24 hours | "Nike Dunks $98 on StockX" |
| Event dates | Until event passes | "Concert on April 5" |
| User preferences | 90 days | "Prefers boutique hotels" |
| Locations | 1 year | "Saved ramen shop in Shibuya" |
| Personal facts | Never expires | "Allergic to peanuts" |

Expired facts aren't deleted — they're flagged. Solver re-checks before presenting.

### Validation Layer

Every solver result passes through validation before the orchestrator uses it.

```
DETERMINISTIC CHECKS (fast, cheap, reliable):
  ✓ JSON schema matches expected structure
  ✓ Referenced tile IDs exist in DB for this user
  ✓ URLs resolve (HEAD request)
  ✓ Dates are sane (not in the past for future events)
  ✓ Confidence self-report > 0.6

LLM-BASED CHECKS (only when needed):
  ✓ "Given these source tiles, does this itinerary make sense?"
  ✓ "Does this price claim match the scraped data?"
  Uses DIFFERENT system prompt: "You are a fact-checker. Find errors."

VERDICT:
  ✅ PASS → use result
  ⚠️ PARTIAL → use with caveat ("prices as of March 26")
  ❌ FAIL → retry once with stricter prompt, else report error
```

### Depth Control (No Infinite Loops)

```
Rule 1: Depth counter on every call
  Orchestrator = 0, Solver = 1, Worker = 2, Sub-worker = 3

Rule 2: Children NEVER spawn parents
  Workers cannot create solvers. Spawning only goes DOWN.

Rule 3: Hard limit = depth 3
  At depth 3, the spawn tool is REMOVED from the agent's toolkit.
  It physically cannot spawn. Not "please don't" — it can't.

Rule 4: Token budget
  Every query starts with 100K token budget.
  Every LLM call deducts. Budget < 10K → no more spawning.
  Budget = 0 → force return best-effort result.
```

### Core Orchestrator Loop

```typescript
async function orchestrate(query: string, userId: string) {
  const budget = new BudgetTracker(100_000)

  // Step 1: Classify complexity (1 cheap Flash call)
  const complexity = await classifyComplexity(query, budget)

  if (complexity === "SIMPLE") {
    // Level 0: Answer directly, no spawning
    return await directAnswer(query, userId, budget)
  }

  // Step 2: Parse intents
  const intents = await parseIntents(query, budget)
  updateStatus(userId, "Understanding your request...")

  // Step 3: Find or spawn solvers
  const solverTasks = await Promise.all(
    intents.map(async (intent) => {
      const solverId = await findOrSpawnSolver(intent.domain, userId)
      updateStatus(userId, `${intent.domain} specialist is working...`)
      return { solverId, intent }
    })
  )

  // Step 4: Execute solvers IN PARALLEL
  const results = await Promise.all(
    solverTasks.map(({ solverId, intent }) =>
      executeSolver(solverId, intent, userId, budget)
    )
  )

  // Step 5: Validate each result
  const validated = await Promise.all(
    results.map(r => validateResult(r, userId))
  )

  // Step 6: Synthesize final response
  updateStatus(userId, "Putting it all together...")
  const response = await synthesize(validated, query, budget)

  // Step 7: Update solver memories
  await Promise.all(
    solverTasks.map(({ solverId }, i) =>
      updateSolverMemory(solverId, intents[i], validated[i])
    )
  )

  return response
}
```

---

## 8. Proactive Agent

This is what makes Pool a category of one. The agent doesn't wait to be asked.

### Reactive vs Proactive

```
REACTIVE:  User asks → Agent responds
PROACTIVE: Agent observes → thinks → initiates

REACTIVE:  "What's the cheapest Nike shoe?"  → searches, responds
PROACTIVE: "Hey, those Nike Air Max you've been eyeing dropped to ₹7,499 —
            lowest in 3 weeks. Want me to grab them?"
            (user never asked)
```

### The Five Pillars

```
OBSERVE → CONNECT → PREDICT → ACT → LEARN

1. OBSERVE:  Watch every screenshot as it's ingested
2. CONNECT:  Link dots across screenshots (flight + hotel = trip planning)
3. PREDICT:  Forecast what the user will need next
4. ACT:      Take action at the right time with the right permission level
5. LEARN:    Get smarter from user approve/dismiss feedback
```

### Pattern Detection (8 Types)

Runs on every new screenshot + periodically every 6 hours.

| Pattern | Signal | Example | Proactive Action |
|---------|--------|---------|------------------|
| **Repetition** | Same topic 3+ times | Nike shoes 6 times in 2 weeks | Start price tracking |
| **Sequence** | Multi-step plan | Flight → Hotel → Tourist spots | Offer itinerary |
| **Temporal** | Recurring behavior | Recipes every Saturday | Send recipe digest on Friday |
| **Convergence** | Multiple signals → one date | 5 screenshots pointing to Aug 15 | Create pre-event checklist |
| **Comparison** | Same product, multiple sites | Shoes from Amazon + Flipkart + Nike.com | Show price comparison |
| **Social** | Group chat about plan | Friends discussing "weekend trip" | Suggest shared pool |
| **Abandonment** | Interest drop-off | Bali screenshots stopped 2 weeks ago | Gentle check-in |
| **Urgency** | Deadline/expiry detected | "Sale ends tomorrow" | Set reminder |

### Intent Prediction Matrix

| Observed Signals | Predicted Intent | Action |
|---|---|---|
| Flight + Hotel screenshots | Trip planning | Offer itinerary |
| Same product, multiple sites | Purchase intent | Price comparison + tracking |
| Concert ticket | Event attendance | Calendar + transport + weather |
| Recipe screenshots on weekends | Cooking routine | Saturday recipe digest |
| Gym app + diet screenshots | Fitness journey | Weekly progress summary |
| Job posting screenshots | Job hunting | Application tracker |
| Apartment listings | Moving/renting | Comparison sheet |

### Permission Tiers (Earning Trust)

```
TIER 1: SILENT (no approval needed)
  • Organize screenshot into pool
  • Update user profile facts
  • Start tracking a pattern internally
  • Pre-compute an itinerary (don't show yet)

TIER 2: SUGGEST (in-app card, user taps to approve)
  • "Add Coldplay concert to calendar?"
  • "Nike Air Max cheaper on Amazon. See comparison?"
  • "14 Bali screenshots. Want me to plan your trip?"

TIER 3: NOTIFY (push notification, time-sensitive only)
  • "Nike Air Max 90 dropped to ₹7,499!"
  • "Your concert is tomorrow. Here's your e-ticket + directions."
  • Only for items user explicitly opted into tracking

TIER 4: AUTO-EXECUTE (agent acts on behalf)
  • Auto-add confirmed bookings to calendar
  • Auto-organize screenshots into pools
  • Only after user grants blanket permission per action type

PERMISSION ESCALATION:
  Agent starts at Tier 1 for everything.
  User approves Tier 2 suggestions 5+ times for same action type →
  Agent asks: "You've approved calendar adds 5 times. Auto-add from now on?"
  User says yes → that action type moves to Tier 4.
```

### Anti-Annoyance System

The #1 risk of proactive agents is being annoying. Prevention rules:

```
1. EARN BEFORE YOU PUSH
   First 50 screenshots: agent is SILENT (Tier 1 only)
   Must prove value with in-app suggestions before earning push rights

2. SMART THROTTLING
   Max push notifications/day: starts at 1, grows to 3 as trust builds
   Every dismissal reduces tomorrow's quota by 1
   3 consecutive dismissals → 48-hour cooldown

3. RELEVANCE GATE
   Every proactive action needs confidence > 0.7
   LLM self-evaluates: "Would the user find this helpful or annoying?"

4. USER CONTROL
   Per-category notification toggles
   "Stop suggesting calendar events" → instantly respected
   Focus mode → only urgent items

5. FEEDBACK INTEGRATION
   Every suggestion has: [Helpful] [Not helpful]
   Tracked per category, per time, per pattern type
   Model continuously recalibrates
```

### Timing Engine

```
URGENCY-BASED:
  Deadline < 2 hours    → notify immediately
  Deadline < 24 hours   → notify now if daytime
  Deadline < 1 week     → queue for daily digest
  No deadline           → in-app only, never push

CONTEXT-AWARE:
  Don't push at night (respect timezone + sleep schedule)
  Batch low-priority into daily/weekly "Pool Digest"
  Learn when user opens app → time suggestions then

FREQUENCY CAPPING:
  Max 3 push notifications per day
  Max 1 notification per topic per day
  If user dismisses same type 5 times → stop that type
```

### Delivery Channels

1. **In-App Insight Cards** — rich cards on home screen, swipe to dismiss
2. **Push Notifications** — time-sensitive only, deep-link into relevant pool
3. **Proactive Chat Messages** — agent initiates conversation in chat
4. **Weekly Intelligence Report** — interests detected, price movements, upcoming events, memory highlights
5. **Contextual Overlays** — when user opens a pool, agent shows relevant insights

---

## 9. Smart Pools (Auto-Folders)

```
Pool Creation Logic:

  1. CLUSTERING (periodic, every 6 hours)
     Run clustering on screenshot embeddings
     Detect natural groups: travel-Bali, shoes-Nike, music-Coldplay

  2. NAMING (LLM generates human-friendly names)
     "Bali Trip Planning", "Shoe Wishlist", "Concert Tickets"

  3. DYNAMIC MEMBERSHIP
     New screenshots auto-assigned to matching pools (similarity > 0.8)
     Screenshots can belong to multiple pools
     Pools merge/split as patterns evolve

  4. SMART VIEWS
     Timeline view (chronological within pool)
     Summary view (key facts extracted from all screenshots in pool)
     Action view (pending proactive actions from this pool)
```

**Example pools:**

```
📁 Bali Trip Planning (14 screenshots)
   ├── Hotels (4) — Hanging Gardens Ubud, Alila Seminyak...
   ├── Flights (2) — Delhi → Bali dates + prices
   ├── Activities (5) — Mount Batur, Uluwatu temple...
   └── Restaurants (3) — Japanese, seafood...
   → [Proactive: Itinerary ready to generate]

📁 Shoe Wishlist (6 screenshots)
   ├── Nike Air Max 90 — ₹7,499 to ₹12,999
   └── Adidas Ultraboost — ₹9,999 to ₹14,999
   → [Proactive: Price alert active on Nike Air Max]

📁 Music & Concerts (9 screenshots)
   ├── Coldplay Concert Ticket — Aug 15, Mumbai
   ├── Spotify playlists
   └── Song recommendations
   → [Proactive: Calendar event added for Aug 15]
```

---

## 10. Database Schema

All tables live in Convex (TypeScript-native, real-time reactive).

```typescript
// ──── CORE TABLES ────

// Every screenshot uploaded
screenshots: defineTable({
  userId: v.id("users"),
  imageUrl: v.string(),             // R2 path
  uploadedAt: v.number(),

  // Vision analysis output
  description: v.string(),
  category: v.string(),
  entities: v.any(),                // structured extracted data
  ocrText: v.optional(v.string()),
  intent: v.string(),
  sentiment: v.optional(v.string()),
  rawAnalysis: v.any(),             // full LLM response

  // Memory system
  importanceScore: v.float64(),     // 0-1
  decayRate: v.float64(),
  memoryTier: v.string(),           // "sensory" | "short_term" | "long_term" | "fading"
  lastRecalledAt: v.optional(v.number()),
  recallCount: v.number(),

  // Processing
  processingStatus: v.string(),     // "pending" | "processing" | "complete" | "failed"
})

// Vector embeddings
screenshotEmbeddings: defineTable({
  screenshotId: v.id("screenshots"),
  textEmbedding: v.array(v.float64()),   // 1536-dim
  imageEmbedding: v.array(v.float64()),  // 768-dim
  combinedEmbedding: v.array(v.float64()), // 1536-dim (fused)
})

// ──── USER PROFILE ────

userProfileFacts: defineTable({
  userId: v.id("users"),
  factType: v.string(),             // "name" | "location" | "interest" | "preference"
  factKey: v.string(),
  factValue: v.string(),
  confidence: v.float64(),
  sourceScreenshotIds: v.array(v.id("screenshots")),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  reinforcementCount: v.number(),
})

// ──── POOLS ────

pools: defineTable({
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  poolType: v.string(),             // "auto" | "manual"
  clusterCentroid: v.optional(v.array(v.float64())),
})

poolScreenshots: defineTable({
  poolId: v.id("pools"),
  screenshotId: v.id("screenshots"),
  relevanceScore: v.float64(),
})

// ──── MULTI-AGENT ────

agentRegistry: defineTable({
  userId: v.id("users"),
  domain: v.string(),               // "travel" | "shopping" | etc.
  status: v.string(),               // "active" | "idle" | "archived"
  lastActiveAt: v.number(),
})

agentMemory: defineTable({
  solverId: v.id("agentRegistry"),
  userId: v.id("users"),
  memoryType: v.string(),           // "fact" | "preference" | "conversation_summary" | "entity"
  key: v.string(),
  value: v.any(),
  confidence: v.float64(),
  source: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
})

agentConversations: defineTable({
  solverId: v.id("agentRegistry"),
  userId: v.id("users"),
  query: v.string(),
  summary: v.string(),              // compressed, not full transcript
  tilesReferenced: v.array(v.id("screenshots")),
  toolsUsed: v.array(v.string()),
  outcome: v.string(),              // "resolved" | "partial" | "failed"
})

// ──── PROACTIVE ────

patterns: defineTable({
  userId: v.id("users"),
  patternType: v.string(),          // "repetition" | "sequence" | "temporal" | etc.
  topic: v.string(),
  strength: v.float64(),
  screenshotIds: v.array(v.id("screenshots")),
  status: v.string(),               // "active" | "acted_on" | "dismissed" | "expired"
  predictedIntent: v.optional(v.string()),
  suggestedAction: v.optional(v.string()),
})

proactiveActions: defineTable({
  userId: v.id("users"),
  triggerPatternId: v.optional(v.id("patterns")),
  actionType: v.string(),
  permissionTier: v.number(),       // 1-4
  content: v.any(),
  deliveredVia: v.string(),         // "push" | "in_app" | "chat" | "digest"
  userResponse: v.optional(v.string()), // "approved" | "dismissed" | "ignored"
  deliveredAt: v.number(),
})

actionPermissions: defineTable({
  userId: v.id("users"),
  actionCategory: v.string(),       // "calendar" | "price_track" | etc.
  currentTier: v.number(),          // 1-4
  autoApproveCount: v.number(),
  cooldownUntil: v.optional(v.number()),
})

priceWatches: defineTable({
  userId: v.id("users"),
  productName: v.string(),
  productImageUrl: v.optional(v.string()),
  sources: v.any(),                 // [{url, lastPrice, lastChecked}]
  lowestPrice: v.optional(v.float64()),
  lowestSource: v.optional(v.string()),
  sourceScreenshotIds: v.array(v.id("screenshots")),
  active: v.boolean(),
})

userRoutines: defineTable({
  userId: v.id("users"),
  routineName: v.string(),
  triggerDay: v.optional(v.string()),
  triggerTime: v.optional(v.string()),
  triggerCondition: v.optional(v.string()),
  actionDescription: v.string(),
  confidence: v.float64(),
  active: v.boolean(),
})
```

---

## 11. Background Workers (Convex Scheduled Functions)

Convex replaces BullMQ/Redis/cron jobs. All scheduled via `ctx.scheduler`.

```
ON EVERY SCREENSHOT UPLOAD (event-driven):
  ├─ analyzeScreenshot       → vision + embed + store
  ├─ checkImmediatePatterns  → does this complete a sequence?
  └─ checkUrgency            → any deadlines to alert?

EVERY 6 HOURS (Convex cron):
  ├─ priceTracker            → scrape prices for all active watches
  ├─ patternDetector         → full pattern scan across recent screenshots
  └─ memoryDecay             → update memory tiers, promote/demote

DAILY (morning, user timezone):
  ├─ dailyDigest             → compile top insights
  ├─ eventReminders          → check upcoming events
  └─ routineTriggers         → fire any daily routines

WEEKLY (Sunday evening):
  ├─ weeklyIntelligenceReport → summarize the week
  ├─ poolMaintenance          → merge/split/rename pools
  ├─ profileConsolidation     → recalculate confidence, resolve conflicts
  └─ interestDecay            → reduce strength of abandoned interests

ON DEMAND (triggered by patterns):
  ├─ itineraryGenerator       → when travel pool is ready
  ├─ comparisonBuilder        → when comparison pattern detected
  └─ checklistGenerator       → when event approaching
```

---

## 12. Anti-Hallucination Safeguards

```
1. Every fact needs a source screenshot_id
2. Every fact has a confidence score (0-1)
3. Facts below 0.5 confidence → stored but never surfaced
4. Agent says "I don't know" rather than guessing
5. User corrections always win over agent inference
6. Conflicting evidence → present both, ask user

IMPLEMENTATION:
  • Vision prompt explicitly forbids assumption
  • Validation layer checks extracted facts against image
  • User profile has audit trail (which screenshot taught what)
  • UI shows "source" link for every profile fact
  • Expired facts are re-verified, not presented as current
  • Solver responses always cite tile IDs; validation confirms they exist
```

---

## 13. Privacy & Security

```
• Screenshots encrypted at rest (AES-256)
• Sensitive content auto-detected (SSN, credit cards, passwords, medical)
  → flagged, extra-encrypted, excluded from cloud AI processing
• User controls what the agent can see/learn
• "Forget me" → full data deletion
• LLM calls use ephemeral sessions (no training on user data)
• No screenshot data shared across users
• On-device triage possible (Apple Vision OCR + lightweight classifier)
  → full cloud analysis only for non-sensitive content

SENSITIVITY DETECTION:
  • Regex patterns: SSN, credit card, passport numbers
  • Vision classification: "document" + "id/license/passport/medical"
  • If sensitive → process locally only, encrypted vault storage
```

---

## 14. Cost Analysis

### Per-Query Cost (Gemini 2.0 Flash)

| Scenario | LLM Calls | Est. Cost |
|----------|-----------|-----------|
| Level 0 (direct answer) | 1 | ~$0.0003 |
| Level 1 (single solver) | 3 | ~$0.001 |
| Level 2 (multi solver, parallel) | 5-7 | ~$0.003 |
| Level 3 (solver + 3 workers) | 8-12 | ~$0.006 |
| Max complexity | 15-20 | ~$0.012 |

### Per-User Monthly Cost

| Component | Calculation | Cost/month |
|---|---|---|
| Screenshot analysis (Vision) | 30/day × $0.005 | ~$4.50 |
| Embeddings | 30/day × $0.001 | ~$0.90 |
| Agent queries (realistic mix) | 20/day × $0.002 avg | ~$1.20 |
| Proactive pattern scans | 4/day × $0.005 | ~$0.60 |
| Price scraping | 10 products × 4/day | ~$2.00 |
| Storage (R2) | ~2MB × 30/day | ~$0.03 |
| Push notifications (FCM) | free | $0 |
| **Total** | | **~$9-10/month/user** |

### Cost Optimization Strategies

| Strategy | Savings |
|---|---|
| Level 0 fast-path (80% of queries) | 60-70% |
| Solver memory cache (don't rebuild context) | 20-30% |
| Cheap models for routing/workers (Flash) | Built into estimates |
| Token budget caps per query | Safety net |
| Cache similar screenshots (don't re-analyze dupes) | 15-20% |
| Tiered analysis: quick classify → deep only if needed | 10-20% |

---

## 15. Roadmap

### Phase 1 — Foundation (Weeks 1-4)
```
☐ Convex project setup + schema
☐ User auth (Clerk/Convex Auth)
☐ Screenshot upload endpoint + R2 storage
☐ Gemini Flash vision analysis integration (Vercel AI SDK)
☐ Embedding generation (Voyage + CLIP)
☐ Basic metadata extraction and storage
☐ Simple category-based organization
☐ REST/Convex API for mobile app
```

### Phase 2 — Multi-Agent Core (Weeks 5-9)
```
☐ Orchestrator agent loop (Vercel AI SDK)
☐ Intent parser + complexity classifier
☐ Solver base class + lifecycle management
☐ Agent registry (Convex table)
☐ Per-solver memory system (read/write/decay)
☐ Validation pipeline (schema + source grounding)
☐ Budget tracker (token limits per query)
☐ Travel Solver + tools (first domain)
☐ Shopping Solver + tools (second domain)
☐ Worker spawning from solvers
☐ Real-time status updates via Convex reactivity
```

### Phase 3 — Memory + Pools (Weeks 10-13)
```
☐ Memory scoring and decay system (Ebbinghaus curve)
☐ Memory tier management (sensory → short-term → long-term)
☐ Recall engine — semantic search with memory-weighted ranking
☐ Memory reinforcement on user interaction
☐ Smart Pools — auto-clustering with dynamic naming
☐ Pool views: timeline, summary, action
☐ User Profile Builder — incremental fact extraction with confidence
```

### Phase 4 — Proactive Agent (Weeks 14-19)
```
☐ Pattern Detection Engine (8 pattern types)
☐ Intent Prediction Matrix (rule-based + LLM)
☐ Action Permission System (4 tiers + escalation)
☐ Timing Engine (urgency, timezone, frequency capping)
☐ Push notification infrastructure (FCM)
☐ In-app insight cards
☐ Price tracking background workers
☐ Event reminder system
☐ Daily/weekly digest generation
☐ Anti-annoyance system (earn-before-push, throttling, relevance gate)
☐ Feedback loop (approve/dismiss → recalibrate)
```

### Phase 5 — Advanced Intelligence (Weeks 20-23)
```
☐ Cross-screenshot reasoning (LLM-powered)
☐ Itinerary auto-generation from travel pools
☐ Comparison table builder for shopping patterns
☐ Routine detection (weekly behavioral patterns)
☐ Proactive chat messages (agent initiates conversation)
☐ Weekly intelligence report
☐ Contextual overlays in pool views
☐ Remaining solver domains (Cooking, Music, Events, Knowledge)
```

### Phase 6 — Polish & Scale (Weeks 24-28)
```
☐ Conversation interface — chat with your screenshots
☐ Multi-pool views and manual pool management
☐ Privacy controls — mark screenshots as sensitive
☐ On-device triage (Apple Vision + lightweight classifier)
☐ Performance optimization (batch processing, caching)
☐ Cost optimization (tiered models, dedup)
☐ Admin monitoring dashboard
☐ A/B test notification strategies
```

---

## 16. Key Architecture Decisions (Summary)

| Decision | Choice | Reasoning |
|---|---|---|
| Backend | Convex | Reactive real-time, scheduled functions, same language, no separate job queue needed |
| AI Framework | Vercel AI SDK | Runs inside Convex natively, no Python sidecar |
| Agent Pattern | Hierarchical multi-agent | Single LLM can't do per-domain memory, parallel research, cost budgets, or self-validation |
| Primary LLM | Gemini 2.0 Flash | Best cost/quality for tool-calling agents |
| Memory Model | Per-solver isolated + brain-like decay | Creates "it remembers me" experience; decay prevents bloat |
| Proactive Approach | Permission tiers + anti-annoyance | Avoids being creepy/annoying; earns trust over time |
| Validation | Separate layer (deterministic + LLM) | Self-validation doesn't work; separate fact-checker does |
| Knowledge Graph | Dropped (for now) | Vector embeddings + relational queries handle what we need |

---

## 17. What Makes This Architecture Defensible

```
1. CONTEXT MOAT — Pool knows things about the user no other app does.
   The 47 Tokyo screenshots, the shoe price history, the Saturday
   cooking routine — this context makes Pool's agent 10x more useful
   than generic ChatGPT.

2. MEMORY MOAT — The longer someone uses Pool, the smarter it gets.
   The Travel Solver that remembers 5 months of trip planning can't
   be replicated by a new competitor on day 1.

3. TRUST MOAT — The permission escalation system means Pool earns
   deeper access over time. A user who's auto-executing calendar
   adds and price tracking won't switch to an app that starts
   from scratch asking "add to calendar?"

4. DATA FLYWHEEL — More screenshots → smarter profile → better
   predictions → more value → more screenshots. Each user makes
   the system better for themselves.
```

---

*This is the definitive architecture for Pool. One document, all decisions resolved, ready to build.*
