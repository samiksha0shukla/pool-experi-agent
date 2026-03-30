# Pool — Screenshot Intelligence Agent
## Architecture, Flow & Roadmap

---

## 1. Vision

Pool is a screenshot app with an embedded AI agent that:
- **Sees** every screenshot the user uploads
- **Understands** what each screenshot contains (products, tickets, travel, music, people, documents…)
- **Learns** who the user is — name, location, interests, habits — purely from screenshots, never hallucinating
- **Remembers** like a human brain — retaining important moments, letting irrelevant ones fade
- **Acts** proactively — suggesting calendar events, price alerts, itinerary plans, smart folders
- **Organizes** screenshots into contextual pools/folders automatically

---

## 2. Core Concepts

```
┌─────────────────────────────────────────────────────────────┐
│                        USER DEVICE                          │
│  Screenshot Capture → Upload → Pool App UI                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   INGESTION PIPELINE                        │
│                                                             │
│  1. OCR + Vision Analysis (multimodal LLM)                  │
│  2. Entity Extraction (people, places, products, dates)     │
│  3. Intent Classification (why did user screenshot this?)   │
│  4. Metadata Tagging + Embedding Generation                 │
│  5. Store in Screenshot Memory Store                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
┌───────────────┐ ┌────────────────┐ ┌──────────────────┐
│  USER PROFILE │ │ MEMORY SYSTEM  │ │ ACTION ENGINE    │
│  BUILDER      │ │ (Brain-like)   │ │ (Proactive)      │
│               │ │                │ │                  │
│ • Identity    │ │ • Retention    │ │ • Calendar adds  │
│ • Interests   │ │ • Decay        │ │ • Price tracking │
│ • Preferences │ │ • Recall       │ │ • Itinerary plan │
│ • Habits      │ │ • Clustering   │ │ • Notifications  │
│ • Wishlist    │ │ • Relevance    │ │ • Smart folders  │
└───────────────┘ └────────────────┘ └──────────────────┘
              │            │                │
              └────────────┼────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     POOL APP UI                             │
│                                                             │
│  • Smart Pools (auto-folders)    • Action Suggestions       │
│  • Memory Timeline               • Chat with Agent          │
│  • User Profile Card             • Alerts & Notifications   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Architecture

### 3.1 Ingestion Pipeline

Every screenshot flows through this pipeline on upload:

```
Screenshot (image)
    │
    ├─► [Stage 1] Vision Analysis (Multimodal LLM — Claude/GPT-4o)
    │     Input:  raw image
    │     Output: structured JSON
    │       {
    │         "description": "Concert ticket for Coldplay, Mumbai, Aug 15 2026",
    │         "category": "event_ticket",
    │         "entities": {
    │           "event": "Coldplay Concert",
    │           "location": "Mumbai",
    │           "date": "2026-08-15",
    │           "price": "₹4,500",
    │           "platform": "BookMyShow"
    │         },
    │         "intent": "planning_to_attend",
    │         "sentiment": "excited",
    │         "actionable": true,
    │         "suggested_actions": ["add_calendar_event", "set_reminder"]
    │       }
    │
    ├─► [Stage 2] Embedding Generation
    │     - Generate vector embedding of the image (CLIP / multimodal embedder)
    │     - Generate text embedding of extracted description
    │     - Both stored for similarity search & clustering
    │
    ├─► [Stage 3] User Profile Update
    │     - Feed extracted entities into User Profile Builder
    │     - Confidence-scored facts only (no hallucination)
    │
    ├─► [Stage 4] Memory Scoring
    │     - Assign importance score (0-1)
    │     - Assign decay rate
    │     - Link to related memories
    │
    └─► [Stage 5] Storage
          - Image → Object Storage (S3/Cloudflare R2)
          - Metadata → PostgreSQL
          - Embeddings → Vector DB (Pinecone/pgvector/Qdrant)
          - Actions → Action Queue
```

### 3.2 Screenshot Categories (Intent Taxonomy)

```
screenshot_categories:
  - product_shopping      # shoes, bags, electronics — triggers price tracking
  - event_ticket          # concerts, flights, movies — triggers calendar/reminder
  - travel_destination    # hotels, places, maps — feeds itinerary planner
  - food_restaurant       # menus, food pics, reviews — feeds taste profile
  - music_entertainment   # songs, playlists, artists — feeds music profile
  - conversation_chat     # chat screenshots — extracts plans, promises, contacts
  - document_info         # IDs, bills, receipts — extracts personal facts
  - social_media          # posts, reels, stories — extracts interests
  - meme_funny            # memes — extracts humor style
  - personal_photo        # selfies, group photos — extracts people, places
  - work_professional     # code, docs, emails — extracts work context
  - health_fitness        # workouts, diet, health apps
  - finance               # bank statements, investments, UPI
  - education             # notes, courses, books
  - other                 # uncategorized
```

### 3.3 User Profile Builder

The profile is built incrementally, screenshot by screenshot. **Every fact has a confidence score and source reference.**

```
UserProfile:
  identity:
    name: "Samiksha" (confidence: 0.95, source: screenshot_id_42, evidence: "name on boarding pass")
    location: "Delhi, India" (confidence: 0.80, source: [screenshot_id_12, screenshot_id_88])

  interests:
    - topic: "Bali travel" (strength: 0.9, screenshot_count: 14, recency: "2026-03-20")
    - topic: "Nike Air Max" (strength: 0.7, screenshot_count: 6, recency: "2026-03-18")
    - topic: "Coldplay" (strength: 0.85, screenshot_count: 9, recency: "2026-03-22")

  wishlist:           # products user is tracking
    - item: "Nike Air Max 90"
      sources: ["Amazon", "Flipkart", "Nike.com"]
      price_history: [{date, price, source}...]
      lowest_seen: ₹7,499

  upcoming_events:    # extracted from ticket/booking screenshots
    - event: "Coldplay Concert"
      date: "2026-08-15"
      location: "Mumbai"

  taste_profile:
    cuisine: ["Japanese", "Italian"]
    music: ["Alternative Rock", "Indie"]
    travel_style: "adventure + luxury"
    budget_range: "mid-premium"

  rules:
    - NEVER assume a fact without screenshot evidence
    - confidence < 0.5 → do not surface to user
    - conflicting facts → keep both, flag for resolution
    - personal info (passwords, private chats) → encrypt, never expose
```

### 3.4 Memory System (Brain-Like)

This is the core differentiator. Modeled after human memory:

```
┌─────────────────────────────────────────────────┐
│              MEMORY ARCHITECTURE                │
│                                                 │
│  ┌──────────────┐                               │
│  │ SENSORY      │  Every screenshot enters here │
│  │ MEMORY       │  (retained: ~seconds)         │
│  │              │  Quick classification only     │
│  └──────┬───────┘                               │
│         │ important?                            │
│         ▼                                       │
│  ┌──────────────┐                               │
│  │ SHORT-TERM   │  Recent screenshots           │
│  │ MEMORY       │  (retained: days-weeks)       │
│  │              │  Full detail available         │
│  │              │  Decay rate applied            │
│  └──────┬───────┘                               │
│         │ reinforced?                           │
│         ▼                                       │
│  ┌──────────────┐                               │
│  │ LONG-TERM    │  Consolidated knowledge        │
│  │ MEMORY       │  (retained: months-forever)   │
│  │              │  "User loves Bali"            │
│  │              │  "User tracks Nike shoes"     │
│  └──────────────┘                               │
└─────────────────────────────────────────────────┘

Memory Scoring Formula:
  importance = f(category_weight, user_engagement, entity_richness, uniqueness)

  Reinforcement triggers (move to long-term):
    - Multiple screenshots of same topic
    - User explicitly interacts with the screenshot
    - Screenshot leads to a completed action
    - Screenshot is recalled/searched for later

  Decay triggers (fade from memory):
    - No reinforcement over time
    - Low importance score
    - Superseded by newer info (old price screenshot)
    - Category is ephemeral (memes, random social posts)

  Recall:
    - Query: "show me travel stuff"
    - System searches vector DB by semantic similarity
    - Ranks by: relevance × recency × importance
    - Returns fragments (like human recall — not perfect, prioritized)
```

### 3.5 Action Engine

```
Action Engine Pipeline:

  1. DETECT actionable screenshot
     └─ Vision model flags: actionable = true

  2. CLASSIFY action type
     ├─ calendar_event    → extract date/time/location → add to calendar
     ├─ price_track       → extract product/price/source → start tracker
     ├─ reminder          → extract what/when → schedule notification
     ├─ save_contact      → extract name/phone/email → suggest contact save
     ├─ bookmark_place    → extract place → save to travel wishlist
     ├─ itinerary_plan    → aggregate travel screenshots → generate plan
     └─ custom            → user-defined actions

  3. SUGGEST to user (never auto-execute without permission)
     └─ "I noticed a Coldplay concert ticket for Aug 15. Add to calendar?"

  4. EXECUTE on approval
     └─ API call to calendar/reminder/price tracker

  5. LEARN from response
     └─ User approved? → increase confidence for similar future actions
     └─ User dismissed? → reduce aggressiveness for this action type
```

### 3.6 Smart Pools (Auto-Folders)

```
Pool Creation Logic:

  1. CLUSTERING
     - Run periodic clustering on screenshot embeddings
     - Detect natural groups (travel-Bali, shoes-Nike, music-Coldplay)

  2. NAMING
     - LLM generates human-friendly pool names from cluster content
     - "Bali Trip Planning", "Shoe Wishlist", "Concert Tickets"

  3. DYNAMIC MEMBERSHIP
     - New screenshots auto-assigned to matching pools
     - Screenshots can belong to multiple pools
     - Pools merge/split as patterns evolve

  4. SMART VIEWS
     - Timeline view (chronological within pool)
     - Summary view (key facts extracted from pool)
     - Action view (pending actions from this pool)

  Pool Examples:
    📁 Bali Trip Planning (14 screenshots)
       ├── Hotels (4)
       ├── Flights (2)
       ├── Activities (5)
       └── Restaurants (3)
       → [Action: Generate Itinerary]

    📁 Shoe Wishlist (6 screenshots)
       ├── Nike Air Max 90 — ₹7,499 to ₹12,999
       └── Adidas Ultraboost — ₹9,999 to ₹14,999
       → [Action: Price Alert Active]

    📁 Music & Concerts (9 screenshots)
       ├── Coldplay Concert Ticket
       ├── Spotify playlists
       └── Song recommendations
       → [Action: Calendar Event Added]
```

---

## 4. Tech Stack (Recommended)

```
Layer               Technology                    Why
─────────────────────────────────────────────────────────────
Mobile App          React Native / Flutter        Cross-platform
Backend API         FastAPI (Python)              ML ecosystem, async
Vision/LLM          Claude API (multimodal)       Best vision + reasoning
Embeddings          CLIP (image) + text-embed     Dual-modal similarity
Vector DB           pgvector or Qdrant            Similarity search
Primary DB          PostgreSQL                    Relational + JSON
Object Storage      Cloudflare R2 / S3            Screenshot images
Task Queue          Celery + Redis                Async processing
Price Tracking      Scrapy / BrightData           Web scraping
Calendar API        Google Calendar API           Event creation
Notifications       Firebase Cloud Messaging      Push alerts
Auth                Supabase Auth / Firebase      User management
Hosting             Railway / Fly.io / AWS        Backend infra
```

---

## 5. Database Schema (Core)

```sql
-- Users
users (id, email, created_at)

-- Every screenshot uploaded
screenshots (
  id, user_id,
  image_url,               -- S3/R2 path
  uploaded_at,

  -- Vision analysis output
  description TEXT,
  category VARCHAR,
  entities JSONB,           -- extracted structured data
  intent VARCHAR,
  sentiment VARCHAR,
  raw_analysis JSONB,       -- full LLM response

  -- Memory system
  importance_score FLOAT,   -- 0-1
  decay_rate FLOAT,         -- how fast it fades
  memory_tier VARCHAR,      -- sensory/short_term/long_term
  last_recalled_at TIMESTAMP,
  recall_count INT DEFAULT 0
)

-- Vector embeddings for similarity
screenshot_embeddings (
  screenshot_id,
  image_embedding VECTOR(512),
  text_embedding VECTOR(1536)
)

-- User profile built from screenshots
user_profile_facts (
  id, user_id,
  fact_type VARCHAR,        -- name/location/interest/preference
  fact_key VARCHAR,
  fact_value TEXT,
  confidence FLOAT,
  source_screenshot_ids INT[],
  first_seen_at, last_seen_at,
  reinforcement_count INT
)

-- Auto-generated pools/folders
pools (
  id, user_id,
  name VARCHAR,
  description TEXT,
  pool_type VARCHAR,        -- auto/manual
  cluster_centroid VECTOR(512),
  created_at, updated_at
)

-- Screenshot-to-pool mapping (many-to-many)
pool_screenshots (pool_id, screenshot_id, relevance_score)

-- Action suggestions
actions (
  id, user_id, screenshot_id,
  action_type VARCHAR,
  action_data JSONB,
  status VARCHAR,           -- suggested/approved/dismissed/completed
  created_at, acted_at
)

-- Price tracking
price_watches (
  id, user_id,
  product_name, product_image_url,
  sources JSONB,            -- [{url, last_price, last_checked}]
  lowest_price, lowest_source,
  alert_threshold FLOAT,
  source_screenshot_ids INT[],
  active BOOLEAN
)
```

---

## 6. API Flow Diagrams

### 6.1 Screenshot Upload Flow

```
User uploads screenshot
        │
        ▼
POST /api/screenshots/upload
        │
        ├─► Save image to R2/S3 → get image_url
        │
        ├─► Enqueue async job: "analyze_screenshot"
        │     │
        │     ├─► Call Claude Vision API with image
        │     │     Prompt: "Analyze this screenshot. Extract:
        │     │              category, entities, intent,
        │     │              suggested actions. Be factual."
        │     │
        │     ├─► Generate CLIP embedding for image
        │     ├─► Generate text embedding for description
        │     │
        │     ├─► Score importance (0-1)
        │     │     factors: actionability, entity richness,
        │     │              uniqueness vs existing screenshots
        │     │
        │     ├─► Update user profile facts
        │     │     - Only add facts with confidence > 0.5
        │     │     - Reinforce existing matching facts
        │     │
        │     ├─► Find matching pool(s) via embedding similarity
        │     │     - similarity > 0.8 → add to existing pool
        │     │     - no match → hold; may form new pool later
        │     │
        │     ├─► Check for actionable items
        │     │     - Event ticket? → suggest calendar add
        │     │     - Product? → suggest price tracking
        │     │     - Travel? → update travel interest
        │     │
        │     └─► Store everything in DB
        │
        └─► Return 202 Accepted { screenshot_id, status: "processing" }

        (Webhook/SSE pushes results when analysis completes)
```

### 6.2 "Plan My Trip" Flow (Zero-Context Query)

```
User: "Plan my itinerary"
(No destination mentioned)
        │
        ▼
POST /api/agent/query  { "message": "Plan my itinerary" }
        │
        ├─► Detect intent: "itinerary_planning"
        │
        ├─► Query user profile for travel interests
        │     → finds: "Bali" (strength: 0.9, 14 screenshots)
        │     → finds: "Thailand" (strength: 0.3, 2 screenshots)
        │     → selects: Bali (highest strength + recency)
        │
        ├─► Retrieve Bali pool screenshots
        │     → sort by importance × recency
        │     → filter: only travel-relevant (hotels, activities, flights)
        │
        ├─► Extract structured data from relevant screenshots
        │     → Hotels: "Hanging Gardens Ubud", "Alila Seminyak"
        │     → Activities: "Mount Batur sunrise trek", "Uluwatu temple"
        │     → Budget signals: mid-premium (from price ranges seen)
        │     → Duration signals: ~5 days (from flight screenshots)
        │
        ├─► Query user taste profile
        │     → cuisine: Japanese, healthy
        │     → travel_style: adventure + luxury
        │     → budget: mid-premium
        │
        ├─► Generate itinerary via LLM
        │     Input: all extracted context + user preferences
        │     Output: day-by-day plan with the actual hotels/places
        │             the user screenshotted, plus complementary suggestions
        │
        └─► Return itinerary + source screenshots as evidence
```

### 6.3 Price Alert Flow

```
User screenshots Nike shoes from Amazon
        │
        ▼
Analysis detects: product_shopping
  product: "Nike Air Max 90"
  price: ₹9,999
  source: "Amazon.in"
        │
        ├─► Check existing price_watches
        │     → Found! Same product from Flipkart at ₹10,499
        │     → Update: add Amazon as new source
        │
        ├─► Suggest to user:
        │     "You've been eyeing Nike Air Max 90.
        │      Amazon has it for ₹9,999 — ₹500 less than Flipkart.
        │      Want me to track the price?"
        │
        └─► If approved → activate price tracker
              │
              ├─► Cron job: check prices every 6 hours
              ├─► On price drop → push notification
              └─► "Nike Air Max 90 hit ₹7,499 on Amazon —
                   lowest in 2 weeks! 🎯"
```

---

## 7. Key LLM Prompts

### 7.1 Screenshot Analysis Prompt

```
You are the vision engine for Pool, a screenshot intelligence app.

Analyze this screenshot and return ONLY a JSON object:
{
  "description": "one-line human description of what this screenshot shows",
  "category": "one of: product_shopping, event_ticket, travel_destination,
               food_restaurant, music_entertainment, conversation_chat,
               document_info, social_media, meme_funny, personal_photo,
               work_professional, health_fitness, finance, education, other",
  "entities": {
    // Extract ALL named entities relevant to the category
    // Products: name, price, source/platform, color, size
    // Events: name, date, time, venue, price
    // Travel: destination, hotel, dates, price
    // People: names (only if clearly visible/written)
    // etc.
  },
  "intent": "why the user likely screenshotted this — e.g.,
             planning_to_buy, saving_for_later, sharing_with_someone,
             remembering_info, comparing_options, booking_confirmation",
  "user_facts": [
    // ONLY facts about the user that are DIRECTLY evidenced
    // e.g., {"fact": "user_name", "value": "Samiksha", "evidence": "name on ticket"}
    // NEVER guess or assume
  ],
  "actionable": true/false,
  "suggested_actions": ["calendar_event", "price_track", "save_contact", etc.],
  "importance_score": 0.0-1.0  // how important is this to retain long-term
}

Rules:
- Be factual. Only extract what is VISIBLE in the screenshot.
- Never hallucinate entities or facts.
- If text is partially visible, mark confidence as low.
- For products, always extract the exact price and platform if visible.
```

### 7.2 User Profile Update Prompt

```
Given the existing user profile and new screenshot analysis,
update the profile. Rules:
- Only ADD facts with clear evidence (include screenshot_id)
- REINFORCE existing facts if new evidence supports them
- NEVER remove facts based on absence
- NEVER assume — if unsure, don't add
- Conflicting facts: keep both, flag for user resolution
```

---

## 8. Memory Decay Algorithm

```python
def calculate_memory_strength(screenshot):
    """
    Determines how strongly a screenshot is retained in memory.
    Mirrors human memory: frequently recalled + important = retained.
    """
    base_importance = screenshot.importance_score  # 0-1 from analysis

    # Time decay (exponential, like human forgetting curve)
    hours_since_upload = (now - screenshot.uploaded_at).total_hours()
    time_factor = math.exp(-screenshot.decay_rate * hours_since_upload)

    # Reinforcement boost
    # Each recall/interaction strengthens the memory
    recall_boost = math.log(1 + screenshot.recall_count) * 0.2

    # Recency of last recall
    if screenshot.last_recalled_at:
        hours_since_recall = (now - screenshot.last_recalled_at).total_hours()
        recall_recency = math.exp(-0.01 * hours_since_recall)
    else:
        recall_recency = 0

    # Connection strength (how many other screenshots link to same topic)
    connection_score = len(screenshot.related_screenshots) * 0.05

    # Final memory strength
    strength = (
        base_importance * time_factor
        + recall_boost
        + recall_recency * 0.3
        + connection_score
    )

    return min(strength, 1.0)

def update_memory_tiers():
    """Run periodically to promote/demote screenshots between memory tiers."""
    for screenshot in all_screenshots:
        strength = calculate_memory_strength(screenshot)

        if strength > 0.7:
            screenshot.memory_tier = "long_term"
        elif strength > 0.3:
            screenshot.memory_tier = "short_term"
        else:
            screenshot.memory_tier = "fading"
            # Don't delete — just deprioritize in search/recall
```

---

## 9. Roadmap

### Phase 1 — Foundation (Weeks 1-4)
```
☐ Project setup (FastAPI + PostgreSQL + pgvector)
☐ User auth (Supabase/Firebase)
☐ Screenshot upload endpoint + R2/S3 storage
☐ Claude Vision API integration for screenshot analysis
☐ Basic metadata extraction and storage
☐ Simple category-based organization
☐ Basic REST API for mobile app
```

### Phase 2 — Intelligence (Weeks 5-8)
```
☐ Embedding generation pipeline (CLIP + text)
☐ Vector similarity search
☐ User Profile Builder — incremental fact extraction
☐ Smart Pools — auto-clustering with dynamic naming
☐ Intent classification refinement
☐ Action suggestion engine (calendar, reminders)
☐ Google Calendar API integration
```

### Phase 3 — Memory (Weeks 9-12)
```
☐ Memory scoring and decay system
☐ Memory tier management (sensory → short-term → long-term)
☐ Recall engine — semantic search with memory-weighted ranking
☐ Memory reinforcement on user interaction
☐ "Memory timeline" UI support in API
```

### Phase 4 — Proactive Agent (Weeks 13-16)
```
☐ Price tracking system (product screenshots → scraper)
☐ Cross-screenshot reasoning ("you've been looking at Bali")
☐ Zero-context queries ("plan my trip" without specifying destination)
☐ Itinerary generation from travel screenshot pools
☐ Push notification system for alerts
☐ Action learning — adapt suggestions based on user accept/dismiss
```

### Phase 5 — Polish & Scale (Weeks 17-20)
```
☐ Conversation interface — chat with your screenshots
☐ Multi-pool views and manual pool management
☐ Privacy controls — mark screenshots as sensitive
☐ Screenshot sharing between users
☐ Performance optimization (batch processing, caching)
☐ Rate limiting and cost management for LLM calls
```

---

## 10. Anti-Hallucination Safeguards

This is critical. The agent must NEVER fabricate information about the user.

```
Principles:
  1. Every fact needs a source screenshot_id
  2. Every fact has a confidence score
  3. Facts below 0.5 confidence are stored but never surfaced
  4. The agent says "I don't know" rather than guessing
  5. User can correct any fact → correction always wins
  6. Conflicting evidence → present both, ask user

Implementation:
  - LLM prompts explicitly forbid assumption
  - Post-processing validates extracted facts against image
  - User profile has audit trail (which screenshot taught what)
  - UI shows "source" link for every profile fact
  - Regular confidence recalculation as more data arrives
```

---

## 11. Privacy & Security

```
  - Screenshots encrypted at rest (AES-256)
  - Private screenshots (banking, medical) auto-flagged, extra-encrypted
  - User controls what the agent can see/learn
  - "Forget me" — full data deletion
  - LLM calls use ephemeral sessions (no training on user data)
  - No screenshot data shared across users
  - GDPR/privacy compliance from day 1
```

---

## 12. Cost Estimation Per User

```
  Assumption: ~30 screenshots/day average user

  Claude Vision API:  ~$0.015/screenshot  →  $0.45/day  →  ~$13.50/month
  Embeddings:         ~$0.001/screenshot  →  $0.03/day  →  ~$0.90/month
  Storage (R2):       ~2MB/screenshot     →  1.8GB/mo   →  ~$0.03/month
  Vector DB:          pgvector (self-host) →             →  ~$0 marginal
  Price scraping:     ~10 products/user   →              →  ~$2/month
  ─────────────────────────────────────────────────────────────────
  Total:                                                  ~$16-17/month/user

  Optimizations:
  - Cache similar screenshots (don't re-analyze duplicates)
  - Use lighter models for obvious categories (receipts, memes)
  - Batch embedding generation
  - Tiered analysis: quick classify first, deep analyze only if needed
```

---

## 13. Proactive Agent — Deep Dive

### 13.1 What Is a Proactive Agent?

Most AI agents are **reactive** — they sit idle until you ask them something. A chatbot waits for your message. A search engine waits for your query. Siri waits for "Hey Siri."

A **proactive agent** is fundamentally different. It:

```
REACTIVE AGENT                          PROACTIVE AGENT
─────────────────                       ─────────────────
User asks → Agent responds              Agent observes → Agent thinks → Agent initiates
Waits for commands                      Monitors continuously
Responds to explicit queries            Anticipates needs before user asks
Stateless (each query is fresh)         Stateful (builds understanding over time)
Tool                                    Partner

Example:                                Example:
"What's the cheapest Nike shoe?"        "Hey, those Nike Air Max you've been
  → searches, responds                   eyeing dropped to ₹7,499 — lowest
                                         in 3 weeks. Want me to grab them?"
                                         (user never asked)
```

**In Pool's context:** The agent doesn't wait for you to say "organize my screenshots" or "plan my trip." It watches your screenshots flow in, builds a mental model of your life, detects patterns, predicts what you need, and reaches out to you with suggestions, alerts, and actions — like a thoughtful personal assistant who pays attention.

### 13.2 Why Proactive Makes Pool a Category-Defining App

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMPACT ANALYSIS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WITHOUT PROACTIVE (just a smart gallery):                      │
│  ├─ User uploads screenshot                                     │
│  ├─ App categorizes it                                          │
│  ├─ User manually searches when needed                          │
│  └─ Competes with: Google Photos, Apple Photos, Samsung Gallery │
│      → commodity features, hard to differentiate                │
│                                                                 │
│  WITH PROACTIVE (intelligent life assistant):                   │
│  ├─ User uploads screenshot                                     │
│  ├─ Agent understands, connects dots, takes initiative           │
│  ├─ User gets value WITHOUT opening the app                     │
│  └─ Competes with: NOTHING (new category)                       │
│      → "the app that knows me and acts for me"                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  KEY METRICS PROACTIVE IMPACTS:                                 │
│                                                                 │
│  Retention         ↑↑↑  Users come back because the app         │
│                         reaches out to THEM                     │
│                                                                 │
│  Engagement        ↑↑↑  Every notification is a value moment,   │
│                         not spam — user learns to trust it       │
│                                                                 │
│  Daily Active Use  ↑↑   Users screenshot MORE because they      │
│                         know the agent will do something with it │
│                                                                 │
│  Word of Mouth     ↑↑↑  "My app told me my shoes hit lowest     │
│                         price" — that's a story people share     │
│                                                                 │
│  Monetization      ↑↑   Affiliate links on price alerts,        │
│                         premium proactive features               │
│                                                                 │
│  Switching Cost    ↑↑↑  The more the agent learns about you,    │
│                         the harder it is to leave — your life    │
│                         context lives here                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 13.3 The Five Pillars of Pool's Proactive Agent

```
┌──────────────────────────────────────────────────────────────────────┐
│                    PROACTIVE AGENT PILLARS                           │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ OBSERVE  │ │ CONNECT  │ │ PREDICT  │ │ ACT      │ │ LEARN    │  │
│  │          │ │          │ │          │ │          │ │          │  │
│  │ Watch    │ │ Link     │ │ Forecast │ │ Take     │ │ Improve  │  │
│  │ every    │ │ dots     │ │ what     │ │ action   │ │ from     │  │
│  │ screen-  │ │ across   │ │ user     │ │ before   │ │ user     │  │
│  │ shot     │ │ screen-  │ │ will     │ │ being    │ │ feedback │  │
│  │          │ │ shots    │ │ need     │ │ asked    │ │          │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       │            │            │            │            │          │
│       ▼            ▼            ▼            ▼            ▼          │
│  "Concert    "Same user    "They'll     "Add to      "User loved   │
│   ticket      also saved    need a       calendar,    calendar      │
│   detected"   hotel in      taxi from    suggest      add — do      │
│               Mumbai"       hotel to     transport"   this auto     │
│                             venue"                    next time"    │
└──────────────────────────────────────────────────────────────────────┘
```

**Pillar 1: OBSERVE** — Continuous ingestion & analysis of every screenshot
**Pillar 2: CONNECT** — Cross-screenshot reasoning to find patterns
**Pillar 3: PREDICT** — Anticipate user needs from accumulated context
**Pillar 4: ACT** — Initiate actions (with appropriate permission levels)
**Pillar 5: LEARN** — Feedback loop to get smarter over time

### 13.4 Modified Architecture for Proactive Agent

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER DEVICE                                 │
│   Screenshot Capture → Upload → Pool App UI ← Push Notifications   │
└──────────────────────────┬────────────────────────▲─────────────────┘
                           │                        │
                           ▼                        │
┌──────────────────────────────────────────────────────────────────────┐
│                      INGESTION PIPELINE                              │
│   OCR + Vision → Entity Extract → Intent Classify → Embed → Store   │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
         ┌─────────────────┼──────────────────────┐
         ▼                 ▼                      ▼
┌──────────────┐  ┌────────────────┐  ┌────────────────────────────┐
│ USER PROFILE │  │ MEMORY SYSTEM  │  │   ★ PROACTIVE BRAIN ★      │
│ BUILDER      │  │ (Brain-like)   │  │                            │
│              │  │                │  │  ┌────────────────────┐    │
│ • Identity   │  │ • Retention    │  │  │ PATTERN DETECTOR   │    │
│ • Interests  │  │ • Decay        │  │  │ (what's emerging?) │    │
│ • Preferences│  │ • Recall       │  │  └────────┬───────────┘    │
│ • Habits     │  │ • Clustering   │  │           │                │
│ • Wishlist   │  │ • Relevance    │  │  ┌────────▼───────────┐    │
│ • Routines   │  │                │  │  │ INTENT PREDICTOR   │    │
│ • Schedule   │  │                │  │  │ (what will they     │    │
│              │  │                │  │  │  need next?)        │    │
└──────┬───────┘  └───────┬────────┘  │  └────────┬───────────┘    │
       │                  │           │           │                │
       │                  │           │  ┌────────▼───────────┐    │
       └──────────────────┼──────────►│  │ ACTION PLANNER     │    │
                          │           │  │ (what should I do?) │    │
                          └──────────►│  └────────┬───────────┘    │
                                      │           │                │
                                      │  ┌────────▼───────────┐    │
                                      │  │ TIMING ENGINE      │    │
                                      │  │ (when to act?)     │    │
                                      │  └────────┬───────────┘    │
                                      │           │                │
                                      │  ┌────────▼───────────┐    │
                                      │  │ DELIVERY MANAGER   │    │
                                      │  │ (how to tell user?)│    │
                                      │  └────────────────────┘    │
                                      └─────────────┬──────────────┘
                                                    │
                          ┌─────────────────────────┼──────────────┐
                          ▼                         ▼              ▼
                 ┌──────────────┐        ┌──────────────┐  ┌───────────┐
                 │ NOTIFICATION │        │ IN-APP       │  │ ACTION    │
                 │ SYSTEM       │        │ SUGGESTIONS  │  │ EXECUTOR  │
                 │              │        │              │  │           │
                 │ • Push       │        │ • Cards      │  │ • Calendar│
                 │ • Smart      │        │ • Insights   │  │ • Price   │
                 │   digest     │        │ • Nudges     │  │ • Booking │
                 │ • Urgency    │        │ • Summaries  │  │ • Remind  │
                 │   levels     │        │              │  │           │
                 └──────────────┘        └──────────────┘  └───────────┘
                          │                         │              │
                          └─────────────────────────┼──────────────┘
                                                    ▼
                                           ┌──────────────┐
                                           │ FEEDBACK     │
                                           │ LOOP         │
                                           │              │
                                           │ User acts?   │
                                           │ Dismisses?   │
                                           │ Engages?     │
                                           │ → Tune model │
                                           └──────────────┘
```

### 13.5 Proactive Brain — Detailed Components

#### A. Pattern Detector

Runs periodically (every few hours) + on every new screenshot. Looks for emerging patterns.

```
Pattern Detection Engine:

  INPUT:
    - All screenshots from last N days
    - User profile
    - Historical patterns

  PATTERNS IT DETECTS:

  1. REPETITION PATTERN
     "User has screenshotted Nike shoes 6 times in 2 weeks"
     → Signal: strong purchase intent
     → Action: start price tracking

  2. SEQUENCE PATTERN
     "User screenshotted: flight search → hotel → tourist spots → restaurant"
     → Signal: trip planning in progress
     → Action: offer to build itinerary

  3. TEMPORAL PATTERN
     "Every Sunday, user screenshots meal prep recipes"
     → Signal: weekly routine
     → Action: send recipe digest on Saturday evening

  4. CONVERGENCE PATTERN
     "Multiple screenshots pointing to same date (Aug 15)"
     → Signal: event approaching
     → Action: create pre-event checklist

  5. COMPARISON PATTERN
     "User screenshotted same product from 3 different sites"
     → Signal: price comparison shopping
     → Action: show price comparison table

  6. SOCIAL PATTERN
     "User screenshotted group chat about weekend plan"
     → Signal: social planning
     → Action: suggest creating a shared pool with friends

  7. ABANDONMENT PATTERN
     "User was heavily screenshotting Bali content, then stopped 2 weeks ago"
     → Signal: interest cooling or decision made
     → Action: gentle check-in: "Still thinking about Bali?"

  8. URGENCY PATTERN
     "Screenshot contains a deadline, sale end date, or expiry"
     → Signal: time-sensitive
     → Action: set reminder before deadline
```

```python
# Pattern Detection Implementation

class PatternDetector:
    def __init__(self, user_id):
        self.user_id = user_id

    def detect_all_patterns(self):
        """Run all pattern detectors and return findings."""
        screenshots = get_recent_screenshots(self.user_id, days=30)
        profile = get_user_profile(self.user_id)

        patterns = []
        patterns += self.detect_repetition(screenshots)
        patterns += self.detect_sequences(screenshots)
        patterns += self.detect_temporal(screenshots)
        patterns += self.detect_convergence(screenshots)
        patterns += self.detect_comparison(screenshots)
        patterns += self.detect_urgency(screenshots)
        patterns += self.detect_abandonment(screenshots, profile)

        return self.rank_and_deduplicate(patterns)

    def detect_repetition(self, screenshots):
        """Find topics that appear repeatedly."""
        topic_counts = Counter()
        topic_screenshots = defaultdict(list)

        for s in screenshots:
            for entity in s.entities:
                key = normalize_entity(entity)
                topic_counts[key] += 1
                topic_screenshots[key].append(s)

        patterns = []
        for topic, count in topic_counts.items():
            if count >= 3:  # threshold: 3+ screenshots = pattern
                patterns.append(Pattern(
                    type="repetition",
                    topic=topic,
                    strength=min(count / 10, 1.0),
                    screenshots=topic_screenshots[topic],
                    suggested_action=self.action_for_repetition(topic, count)
                ))
        return patterns

    def detect_sequences(self, screenshots):
        """Find sequences that suggest a multi-step plan."""
        # Group by time windows (e.g., 48-hour clusters)
        clusters = cluster_by_time(screenshots, window_hours=48)

        patterns = []
        for cluster in clusters:
            categories = [s.category for s in cluster]

            # Known planning sequences
            if is_travel_sequence(categories):
                patterns.append(Pattern(
                    type="sequence",
                    topic="trip_planning",
                    details=extract_travel_details(cluster),
                    suggested_action="offer_itinerary"
                ))
            elif is_shopping_sequence(categories):
                patterns.append(Pattern(
                    type="sequence",
                    topic="purchase_research",
                    details=extract_product_details(cluster),
                    suggested_action="offer_comparison"
                ))
        return patterns

    def detect_urgency(self, screenshots):
        """Find screenshots with time-sensitive content."""
        patterns = []
        for s in screenshots:
            if s.entities.get("deadline") or s.entities.get("sale_ends"):
                deadline = parse_date(s.entities.get("deadline") or s.entities.get("sale_ends"))
                if deadline and deadline > now():
                    hours_until = (deadline - now()).total_seconds() / 3600
                    patterns.append(Pattern(
                        type="urgency",
                        topic=s.description,
                        deadline=deadline,
                        urgency=1.0 if hours_until < 24 else 0.5,
                        suggested_action="set_reminder"
                    ))
        return patterns
```

#### B. Intent Predictor

Takes detected patterns + user profile and predicts what the user will need next.

```
Intent Prediction Engine:

  Uses a combination of:
    1. Rule-based heuristics (fast, predictable)
    2. LLM reasoning (complex, nuanced)

  ┌─────────────────────────────────────────────────────────┐
  │              INTENT PREDICTION MATRIX                   │
  ├────────────────────┬────────────────────────────────────┤
  │ OBSERVED SIGNALS   │ PREDICTED INTENT                   │
  ├────────────────────┼────────────────────────────────────┤
  │ Flight + Hotel     │ Trip planning → need itinerary     │
  │ screenshots        │                                    │
  ├────────────────────┼────────────────────────────────────┤
  │ Same product,      │ Purchase intent → need best price  │
  │ multiple sites     │                                    │
  ├────────────────────┼────────────────────────────────────┤
  │ Concert ticket     │ Event attendance → need calendar   │
  │ screenshot         │ entry + transport + accommodation  │
  ├────────────────────┼────────────────────────────────────┤
  │ Recipe screenshots │ Cooking plan → need grocery list   │
  │ on weekends        │                                    │
  ├────────────────────┼────────────────────────────────────┤
  │ Gym app + diet     │ Fitness journey → need weekly      │
  │ screenshots        │ summary / progress tracker         │
  ├────────────────────┼────────────────────────────────────┤
  │ Job posting        │ Job hunting → need application     │
  │ screenshots        │ tracker + company research         │
  ├────────────────────┼────────────────────────────────────┤
  │ Apartment/house    │ Moving/renting → need comparison   │
  │ listings           │ sheet + checklist                  │
  ├────────────────────┼────────────────────────────────────┤
  │ Course/tutorial    │ Learning → need study plan +       │
  │ screenshots        │ resource organization              │
  ├────────────────────┼────────────────────────────────────┤
  │ Bank/UPI           │ Financial tracking → need          │
  │ screenshots        │ spending summary                   │
  └────────────────────┴────────────────────────────────────┘

  For complex predictions, the LLM prompt:

  "Given this user's profile and recent screenshot patterns,
   predict what they are likely to need in the next 24-72 hours.
   Only predict with high confidence. Rank by likelihood.
   Format: [{intent, confidence, reasoning, suggested_action}]"
```

#### C. Action Planner

Decides WHAT to do based on predicted intent. Key innovation: **permission levels.**

```
Action Permission Tiers:

  TIER 1: SILENT (no user approval needed)
  ──────────────────────────────────────
  - Organize screenshot into pool
  - Update user profile facts
  - Start tracking a pattern
  - Pre-compute an itinerary (don't show yet)
  - Cache price data
  → These are invisible background operations

  TIER 2: SUGGEST (show card, user taps to approve)
  ──────────────────────────────────────
  - "Add Coldplay concert to calendar?"
  - "I found Nike Air Max cheaper on Amazon. See comparison?"
  - "You've saved 14 Bali screenshots. Want me to plan your trip?"
  - "Your sale ends tomorrow. Set a reminder?"
  → Gentle nudge, easy to dismiss

  TIER 3: NOTIFY (push notification for time-sensitive items)
  ──────────────────────────────────────
  - "Nike Air Max 90 dropped to ₹7,499 — lowest in 3 weeks!"
  - "Your concert is tomorrow. Here's your e-ticket + directions."
  - "Flash sale on the jacket you saved — ends in 4 hours."
  → Only for things the user explicitly opted into tracking

  TIER 4: AUTO-EXECUTE (agent acts on user's behalf)
  ──────────────────────────────────────
  - Auto-add confirmed bookings to calendar
  - Auto-organize screenshots into pools
  - Auto-archive fading memories
  → Only after user has granted blanket permission for this action type
  → User can revoke anytime

  PERMISSION ESCALATION:
  - Agent starts at Tier 1 (silent) for everything
  - As user approves Tier 2 suggestions repeatedly for same action type,
    agent asks: "You've approved calendar adds 5 times. Auto-add from now on?"
  - If user says yes → that action type moves to Tier 4
  - This is how the agent earns trust over time
```

#### D. Timing Engine

A proactive agent that interrupts at the wrong time is annoying. Timing is everything.

```
Timing Engine Rules:

  1. URGENCY-BASED
     - Deadline < 2 hours    → notify immediately
     - Deadline < 24 hours   → notify now if daytime
     - Deadline < 1 week     → queue for daily digest
     - No deadline           → show in-app, never push

  2. CONTEXT-AWARE
     - Don't push at night (respect user's timezone + sleep schedule)
     - Don't push during detected work hours for non-work items
     - Batch low-priority items into a daily/weekly "Pool Digest"
     - Learn when user typically opens the app → time suggestions then

  3. FREQUENCY CAPPING
     - Max 3 push notifications per day
     - Max 1 notification per topic per day
     - If user dismisses 3 in a row → pause for 48 hours
     - If user dismisses same type 5 times → stop that type entirely

  4. SMART DIGEST (instead of spamming)
     ┌─────────────────────────────────────────────┐
     │  Your Pool Digest — March 23                │
     │                                             │
     │  🛒 Price Drop: Nike Air Max → ₹7,499       │
     │  ✈️ Bali Trip: 14 screenshots, ready to plan?│
     │  📅 Coldplay concert in 4 months             │
     │  📁 New pool created: "Home Decor Ideas" (7) │
     │                                             │
     │  [Open Pool]                                │
     └─────────────────────────────────────────────┘
```

#### E. Delivery Manager

How the proactive agent communicates with the user.

```
Delivery Channels:

  1. IN-APP INSIGHT CARDS
     - Appear on home screen of Pool app
     - Rich cards with screenshot thumbnails + action buttons
     - Swipe to dismiss, tap to act
     - Sorted by relevance + urgency

  2. PUSH NOTIFICATIONS
     - Only for time-sensitive or high-value items
     - Deep-link into the relevant pool/action
     - Respect frequency caps

  3. PROACTIVE CHAT MESSAGES
     - Agent sends messages in the chat interface
     - "Hey! I noticed you've been looking at a lot of Bali content.
        Want me to put together an itinerary based on what you've saved?"
     - Feels conversational, not robotic

  4. WEEKLY INTELLIGENCE REPORT
     - "This week in your screenshots:"
     - New interests detected
     - Price movements on tracked items
     - Upcoming events
     - Memory highlights (screenshots promoted to long-term)
     - Pools that grew

  5. CONTEXTUAL OVERLAYS
     - When user opens a specific pool, agent shows relevant insights
     - "This pool has 14 Bali screenshots. You seem most interested in
        Ubud (6 screenshots) and beach clubs (4 screenshots)."
```

### 13.6 Proactive Agent — Real-World Scenarios

#### Scenario 1: The Full Travel Journey

```
Day 1:  User screenshots Instagram reel of Bali rice terraces
        → Agent: silently tags as travel_destination, creates "Bali" interest

Day 3:  User screenshots Bali hotel from MakeMyTrip
        → Agent: detects sequence pattern (travel content accumulating)
        → Agent: silently starts a "Bali Trip" pool

Day 5:  User screenshots Bali flight prices from Google Flights
        → Agent: detects convergence (Bali) + recognizes trip planning sequence
        → Agent: IN-APP CARD: "Planning a Bali trip? I've collected 5
                  screenshots so far. Want me to organize them?"

Day 7:  User screenshots 3 more Bali activities
        → Agent: pool now has 8 items
        → Agent: pre-computes draft itinerary in background (Tier 1)

Day 10: User screenshots friend's chat saying "let's go first week of May"
        → Agent: extracts dates (May 1-7, 2026) from chat screenshot
        → Agent: PUSH: "Bali trip dates detected: May 1-7.
                  I have an itinerary ready based on your 11 screenshots.
                  Want to see it?"

Day 10: User taps "Show me"
        → Agent: shows full itinerary built from THEIR specific screenshots
          Day 1: Arrive Bali → Alila Seminyak (from their hotel screenshot)
          Day 2: Ubud rice terraces (from their Instagram save)
          Day 3: Mount Batur sunrise (from activity screenshot)
          ...
          Budget estimate: ₹85,000 (based on price signals from screenshots)
          Includes: restaurants matching their cuisine preference (Japanese)

Day 12: Agent: "Flight to Bali on Apr 30 dropped ₹2,000 on MakeMyTrip.
                Book now?"
```

#### Scenario 2: The Smart Shopper

```
Week 1: User screenshots Nike Air Max from Amazon (₹10,999)
        → Agent: creates price_watch entry

Week 1: User screenshots same shoe from Flipkart (₹10,499)
        → Agent: adds second source, detects comparison pattern
        → IN-APP: "Nike Air Max 90: Flipkart ₹10,499 vs Amazon ₹10,999.
                   Want me to track the best price?"
        → User: "Yes"

Week 2: User screenshots same shoe from Nike.com (₹11,499)
        → Agent: adds third source, updates comparison
        → Agent: silently monitors all 3 sources every 6 hours

Week 3: Amazon price drops to ₹7,499
        → PUSH: "Nike Air Max 90 hit ₹7,499 on Amazon — lowest
                 across all 3 sites you compared. 32% off!"
        → Deep link to Amazon product page
```

#### Scenario 3: The Event Companion

```
Mar 15: User screenshots Coldplay concert ticket (Aug 15, Mumbai)
        → Agent: extracts event, date, venue, seat info
        → SUGGEST: "Add Coldplay concert to calendar? Aug 15, Mumbai"
        → User approves

Aug 13: (2 days before concert)
        → PUSH: "Coldplay concert in 2 days! Here's your prep checklist:
                 ✅ E-ticket saved in Pool (screenshot #42)
                 📍 DY Patil Stadium, Navi Mumbai
                 🕐 Gates open 4 PM, show starts 7 PM
                 🚗 Suggest booking cab by 2 PM (traffic on Western Express)
                 🌤️ Weather forecast: Clear, 32°C — carry water
                 🏨 Need a hotel? I noticed you're based in Delhi."

        → Agent proactively checked:
          - Weather API for Mumbai on Aug 15
          - User's home location (Delhi, from profile)
          - Traffic patterns (general knowledge)
          - No hotel booking screenshot found → suggests one
```

#### Scenario 4: The Life Pattern Learner

```
Over 3 months, the agent notices:
  - User screenshots recipes every Saturday
  - User screenshots gym app progress every Monday
  - User screenshots motivational quotes on bad days (low-sentiment chat screenshots)

Agent creates ROUTINES in user profile:
  routine: "weekend_cooking"
    trigger: Saturday
    action: "Surface saved recipe screenshots + suggest new ones"

  routine: "fitness_tracking"
    trigger: Monday
    action: "Show weekly gym progress from screenshotted data"

  routine: "mood_support"
    trigger: detected_low_mood (from chat sentiment analysis)
    action: "Surface saved motivational content + positive memories"
    sensitivity: HIGH (be gentle, don't be presumptuous)
```

### 13.7 Proactive Agent — Database Additions

```sql
-- Detected patterns
patterns (
  id, user_id,
  pattern_type VARCHAR,         -- repetition/sequence/temporal/convergence/etc.
  topic VARCHAR,
  strength FLOAT,               -- 0-1, how strong is this pattern
  first_detected_at TIMESTAMP,
  last_reinforced_at TIMESTAMP,
  screenshot_ids INT[],
  status VARCHAR,               -- active/acted_on/dismissed/expired
  predicted_intent VARCHAR,
  suggested_action VARCHAR
)

-- Proactive actions taken by agent
proactive_actions (
  id, user_id,
  trigger_pattern_id INT,       -- what pattern triggered this
  action_type VARCHAR,          -- suggest/notify/auto_execute
  permission_tier INT,          -- 1-4
  content JSONB,                -- what was shown/done
  delivered_via VARCHAR,        -- push/in_app/chat/digest
  delivered_at TIMESTAMP,
  user_response VARCHAR,        -- approved/dismissed/ignored/snoozed
  response_time_seconds INT,    -- how fast user responded
  created_at TIMESTAMP
)

-- User's permission preferences per action type
action_permissions (
  id, user_id,
  action_category VARCHAR,     -- calendar/price_track/reminder/etc.
  current_tier INT,            -- 1-4
  auto_approve_count INT,      -- how many times user approved (for escalation)
  last_dismissed_at TIMESTAMP,
  cooldown_until TIMESTAMP     -- if user dismissed too many times
)

-- Scheduled proactive checks
proactive_schedule (
  id, user_id,
  check_type VARCHAR,          -- pattern_scan/price_check/event_reminder/digest
  frequency VARCHAR,           -- hourly/daily/weekly/custom
  next_run_at TIMESTAMP,
  last_run_at TIMESTAMP,
  config JSONB                 -- check-specific config
)

-- User routines detected over time
user_routines (
  id, user_id,
  routine_name VARCHAR,
  trigger_day VARCHAR,         -- monday/saturday/daily
  trigger_time TIME,
  trigger_condition VARCHAR,   -- optional (e.g., "low_mood_detected")
  action_description TEXT,
  confidence FLOAT,
  active BOOLEAN
)
```

### 13.8 Proactive Agent — Background Workers

```
┌─────────────────────────────────────────────────────────────┐
│                  BACKGROUND WORKER SYSTEM                    │
│                  (Celery + Redis + Cron)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  EVERY SCREENSHOT UPLOAD (event-driven):                    │
│  ├─ analyze_screenshot         → vision + embed + store     │
│  ├─ check_immediate_patterns   → does this complete a       │
│  │                               sequence or hit a trigger? │
│  └─ check_urgency              → any deadlines to alert?    │
│                                                             │
│  EVERY 6 HOURS (scheduled):                                 │
│  ├─ price_tracker              → scrape prices for all      │
│  │                               active price_watches       │
│  ├─ pattern_detector           → run full pattern scan      │
│  │                               across recent screenshots  │
│  └─ memory_decay               → update memory tiers,       │
│                                  promote/demote screenshots  │
│                                                             │
│  DAILY (morning, user timezone):                            │
│  ├─ daily_digest               → compile top insights       │
│  ├─ event_reminders            → check upcoming events      │
│  └─ routine_triggers           → fire any daily routines    │
│                                                             │
│  WEEKLY (Sunday evening):                                   │
│  ├─ weekly_intelligence_report → summarize the week         │
│  ├─ pool_maintenance           → merge/split/rename pools   │
│  ├─ profile_consolidation      → recalculate confidence     │
│  │                               scores, resolve conflicts  │
│  └─ interest_decay             → reduce strength of         │
│                                  abandoned interests         │
│                                                             │
│  ON DEMAND (triggered by patterns):                         │
│  ├─ itinerary_generator        → when travel pool is ready  │
│  ├─ comparison_builder         → when comparison detected   │
│  └─ checklist_generator        → when event approaching     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 13.9 Proactive Agent — LLM Prompts

#### Pattern Analysis Prompt
```
You are Pool's proactive intelligence engine.

Given this user's recent screenshots (last 30 days) and their profile,
identify patterns and predict what the user needs.

User Profile:
{user_profile_json}

Recent Screenshots (summarized):
{screenshot_summaries}

Existing Active Patterns:
{current_patterns}

Tasks:
1. Identify NEW patterns not already tracked
2. For each pattern, predict the user's likely need
3. Suggest a proactive action with appropriate urgency
4. Rate your confidence (0-1) — only surface if > 0.7

Return JSON array of:
{
  "pattern_type": "repetition|sequence|temporal|convergence|comparison|urgency",
  "topic": "what is this pattern about",
  "evidence": ["screenshot_id_1", "screenshot_id_2"],
  "predicted_need": "what the user likely needs",
  "suggested_action": "what Pool should do",
  "urgency": "immediate|today|this_week|whenever",
  "confidence": 0.0-1.0,
  "message_to_user": "the actual text to show the user (warm, helpful, concise)"
}

Rules:
- Only high-confidence patterns. When in doubt, don't surface.
- Never be creepy. "I noticed you saved 5 hotels in Bali" = OK.
  "I see you're planning a secret trip" = NOT OK.
- Be helpful, not intrusive. Think thoughtful friend, not stalker.
- Time-sensitive items get higher urgency.
- If user has dismissed similar suggestions before, lower confidence.
```

#### Proactive Message Generation Prompt
```
Generate a brief, warm notification message for Pool app.

Context: {pattern_details}
User name: {name_or_empty}
Tone: helpful friend, not corporate bot

Rules:
- Max 2 sentences
- Lead with the value ("Your shoes dropped to ₹7,499")
- Include a clear action ("Want me to add it to calendar?")
- Never be presumptuous about personal life
- Use specifics from their screenshots, not generic advice
```

### 13.10 How Proactive Pool Beats Google Photos

```
┌──────────────────────┬──────────────────┬──────────────────────┐
│ CAPABILITY           │ GOOGLE PHOTOS    │ POOL (PROACTIVE)     │
├──────────────────────┼──────────────────┼──────────────────────┤
│ Photo storage        │ ✅ Yes           │ ✅ Yes               │
│ Search by content    │ ✅ Good          │ ✅ Better (intent)   │
│ Auto-albums          │ ✅ Basic (faces, │ ✅ Smart pools by    │
│                      │    places)       │    context & intent  │
│ Understand intent    │ ❌ No            │ ✅ Yes               │
│ Build user profile   │ ❌ No            │ ✅ From screenshots  │
│ Proactive actions    │ ❌ No            │ ✅ Calendar, prices  │
│ Price tracking       │ ❌ No            │ ✅ Cross-platform    │
│ Trip planning        │ ❌ No            │ ✅ Auto-itinerary    │
│ Pattern detection    │ ❌ No            │ ✅ 8 pattern types   │
│ Smart reminders      │ ❌ No            │ ✅ From screenshots  │
│ Brain-like memory    │ ❌ No            │ ✅ Decay + recall    │
│ Proactive nudges     │ ❌ No            │ ✅ Timed, smart      │
│ Learn preferences    │ ❌ No            │ ✅ Continuously      │
│ Chat with agent      │ ❌ No            │ ✅ Context-aware     │
│ Weekly digest        │ ❌ No            │ ✅ Intelligence rpt  │
│ Permission learning  │ ❌ No            │ ✅ Earns trust       │
│                      │                  │                      │
│ MOAT                 │ Scale + storage  │ Intelligence +       │
│                      │ (commodity)      │ personalization      │
│                      │                  │ (defensible)         │
└──────────────────────┴──────────────────┴──────────────────────┘

Google Photos is a STORAGE product.
Pool is an INTELLIGENCE product.
They're not even in the same category.
```

### 13.11 Proactive Agent — Anti-Annoyance System

The #1 risk of proactive agents is being annoying. Pool prevents this:

```
Anti-Annoyance Rules:

  1. EARN BEFORE YOU PUSH
     - First 50 screenshots: agent is SILENT (Tier 1 only)
     - Agent must prove value with in-app suggestions first
     - Push notifications only after user has approved 5+ suggestions

  2. SMART THROTTLING
     - Max notifications/day: starts at 1, grows to 3 as trust builds
     - Every dismissal reduces tomorrow's quota by 1
     - 3 consecutive dismissals → 48-hour cooldown
     - User can set "focus mode" → only urgent items

  3. RELEVANCE GATE
     - Every proactive action needs confidence > 0.7
     - LLM self-evaluates: "Would the user find this helpful or annoying?"
     - If unsure → don't send

  4. USER CONTROL
     - Settings: per-category notification toggles
     - "Stop suggesting calendar events" → instantly respected
     - "More price alerts" → increase frequency
     - "Never for memes" → meme category excluded from proactive

  5. FEEDBACK INTEGRATION
     - Every suggestion has: [Helpful] [Not helpful] buttons
     - Tracked per category, per time of day, per pattern type
     - Model continuously recalibrates what to surface
```

### 13.12 Updated Roadmap (with Proactive Agent)

```
Phase 1 — Foundation (Weeks 1-4)        [unchanged]
Phase 2 — Intelligence (Weeks 5-8)      [unchanged]
Phase 3 — Memory (Weeks 9-12)           [unchanged]

Phase 4 — Proactive Agent Core (Weeks 13-18)  [EXPANDED]
  ☐ Pattern Detection Engine (all 8 pattern types)
  ☐ Intent Prediction Matrix (rule-based + LLM)
  ☐ Action Permission System (4 tiers)
  ☐ Timing Engine with timezone + frequency capping
  ☐ Push notification infrastructure (FCM)
  ☐ In-app insight cards UI
  ☐ Price tracking background workers (Celery)
  ☐ Event reminder system
  ☐ Daily/weekly digest generation
  ☐ Feedback loop + anti-annoyance system
  ☐ Permission escalation ("auto-add calendars from now on?")

Phase 5 — Proactive Intelligence (Weeks 19-22)  [NEW]
  ☐ Cross-screenshot reasoning (LLM-powered)
  ☐ Itinerary auto-generation from travel pools
  ☐ Comparison table builder for shopping patterns
  ☐ Routine detection (weekly patterns)
  ☐ Proactive chat messages (agent initiates conversation)
  ☐ Weekly intelligence report
  ☐ Contextual overlays in pool views

Phase 6 — Polish & Scale (Weeks 23-26)   [shifted]
  ☐ Everything from original Phase 5
  ☐ A/B test notification strategies
  ☐ Optimize LLM costs for background pattern scans
  ☐ User trust score dashboard (internal)
```

### 13.13 Cost Impact of Proactive Agent

```
Additional costs per user per month:

  Pattern detection (LLM calls):
    - 4x daily scan × 30 days = 120 calls/month
    - ~$0.005/call (summarized input, not full images)
    - = $0.60/month

  Price scraping:
    - 10 products × 4 checks/day × 30 days = 1,200 scrapes
    - = ~$2/month (via BrightData or self-hosted)

  Push notifications:
    - FCM is free
    - = $0/month

  Background workers (compute):
    - Small Celery worker
    - = ~$5/month (shared across users, amortized: ~$0.50/user)

  ────────────────────────────────────────────
  Proactive agent overhead:           ~$3/month/user
  Base cost (from Section 12):        ~$16/month/user
  Total with proactive:               ~$19/month/user

  Revenue potential of proactive features:
  - Affiliate commission on price-alert purchases: $1-5/conversion
  - Premium tier for advanced proactive features: $5-10/month
  - The proactive features are what justify a paid subscription
```

---

*This document is the living architecture reference for Pool. Update it as decisions are made and the system evolves.*
