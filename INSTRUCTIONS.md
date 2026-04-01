# Pool Agent — Instruction Manual

> Screenshot Intelligence CLI — Analyze screenshots with AI to discover music, plan travel, and build your personal profile.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up your API keys
cp .env.example .env
# Edit .env and add your Gemini API key

# 3. Launch
npm start
# — or, if installed globally —
pool-agent
```

---

## Installation

### From Source (Recommended)

```bash
git clone https://github.com/samiksha0shukla/pool-experi-agent.git
cd pool-experi-agent
npm install
```

### Global Install (after cloning)

```bash
npm install -g .
pool-agent          # Now available anywhere
```

### Using npx (after global install)

```bash
npx pool-agent
```

---

## Configuration

Pool Agent requires API keys to function. Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

### Required

| Variable | Description | Get it at |
|----------|-------------|-----------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key for AI analysis | [Google AI Studio](https://aistudio.google.com/apikey) |

### Optional

| Variable | Description | Get it at |
|----------|-------------|-----------|
| `GOOGLE_CUSTOM_SEARCH_API_KEY` | Enables real-time web search for travel queries | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` | Custom Search Engine ID | [Programmable Search Engine](https://programmablesearchengine.google.com/) |

---

## Features

### 1. Upload Screenshots

Upload one or more screenshot images for AI analysis. The agent performs:

- **OCR** — Extracts all visible text from the image
- **Vision Analysis** — Understands context, layout, and content type
- **Metadata Extraction** — Identifies music tracks, travel info, prices, dates
- **Profile Updates** — Learns your preferences from what you share

**Supported formats:** PNG, JPG, JPEG, WebP, GIF, BMP

### 2. Ask Agent

Chat with a context-aware AI agent that knows your data. It has specialized sub-agents:

- **Music Agent** — Answers questions about songs, artists, and genres found in your screenshots
- **Travel Agent** — Helps with travel planning using extracted flight/train/bus info
- **General Agent** — Handles anything else using your full knowledge base

The agent uses your profile and screenshot history to give personalized answers.

### 3. View Profile

See everything the agent has learned about you:

- Music preferences (genres, artists, platforms)
- Travel patterns (destinations, airlines, preferences)
- Lifestyle interests extracted from your screenshots

### 4. Music Link Generator

Upload a music screenshot and get the exact streaming link. That's it.

**How it works:**

```
Screenshot metadata (OCR + source app + vision description)
        ↓
LLM extracts: song title, artist, album, platform
        ↓
Google SERP search: "Song Title" "Artist" site:open.spotify.com
        ↓
Deterministic scoring picks the best result
```

No guessing, no search-URL hacks. You get the actual track page.

**What you get back — two links:**

1. **Original platform link** — the exact song on the platform from the screenshot (e.g., Spotify track page)
2. **Your platform link** — the same song on the platform you actually use (auto-detected from your screenshot history)

Example: you screenshot a song on Apple Music but you listen on YouTube Music. You get both the Apple Music link AND the YouTube Music link.

**Cross-platform resolution** uses Odesli (song.link) first — if that fails, falls back to another Google SERP search on your preferred platform.

**Scoring — no LLM needed for validation:**

| Signal | Points |
|--------|--------|
| Song title in result | +10 |
| Artist name in result | +8 |
| URL is a track page (`/track/`, `/watch?`) | +3 |
| Album match | +2 |
| Wrong domain | reject |

Result needs score >= 5 to be accepted.

**Auto-extract on upload** — when you upload a music screenshot through the normal upload flow, the link is automatically extracted and saved to the `music_links` table. No extra step needed. Toggle this off in the Music Link Generator settings if you don't want it.

**Preferred platform detection** — the system counts your `source_app` across all music screenshots and picks the most frequent one. 18 YouTube Music screenshots vs 7 Spotify? Your platform is YouTube Music. No stale profile values — it recounts every time.

**Supported platforms:** Spotify, YouTube Music, Apple Music, SoundCloud, Tidal, Deezer, Bandcamp.

### 5. Music Agent — Your Music Brain

The music agent lives inside "Ask Agent" and handles any music-related question. It builds context by pulling everything the knowledge store knows about your taste:

- **Platform usage** — actual screenshot counts per app, not a guess
- **Artists, songs, genres** — from the facts table, ranked by confidence
- **Playlists** — names seen in screenshots
- **Listening patterns** — mood, energy, language preferences from profile KV
- **Semantic matches** — vector search finds relevant screenshots even for vague queries

All of this comes from the same knowledge store that every other agent uses. The music agent doesn't maintain its own data — it queries SQLite for facts, Vectra for semantic search, and the graph for relationships. One store, many agents.

When it recommends something, it links to your preferred platform. When it answers "which platform do I use most", it gives you the real numbers.

---

### Examples in Action

#### Music Link Generator — screenshot to link

You upload a YouTube Music screenshot showing "Saat Samundar Paar" by Sadhana Sargam playing.

```
  ✔ music from YouTube Music
  🔍 SERP query: "Saat Samundar Paar" "Sadhana Sargam" site:music.youtube.com
  ✔ 🎵 Music link: https://music.youtube.com/watch?v=...

  Song Information
  Title:    Saat Samundar Paar
  Artist:   Sadhana Sargam
  Album:    Vishwatma
  Platform: youtube music

  Streaming Links
  1. Original platform (youtube music)
     https://music.youtube.com/watch?v=...
  2. Your platform (spotify)
     https://open.spotify.com/track/...
```

Two links. One from the screenshot, one for where you actually listen. Done.

#### Music Agent — asking about your taste

```
you → which platform i use the most for listening music
```

The agent counts your actual screenshots:

```
  PLATFORM USAGE (from 30 music screenshots):
    - YouTube Music: 18 screenshots
    - Spotify: 7 screenshots
    - Apple Music: 4 screenshots
    - YouTube: 1 screenshot

  Your most-used platform is YouTube Music by a wide margin.
  You have 18 screenshots from YouTube Music, compared to
  7 from Spotify and 4 from Apple Music.
```

Real numbers from real data. Not a guess.

#### Batch upload — auto-extraction in action

When you upload a folder of 20 screenshots, the system processes each one. For every screenshot categorized as `music`, the music link is automatically extracted right there — no extra step:

```
  [9/20] Importing IMG_0401.PNG
  ✔ music from YouTube Music — Bollywood Party Songs playlist
  🔍 SERP query: "ANKHIYON SE GOLI MAARE" "SONU NIGAM" site:music.youtube.com
  ✔ 🎵 Music link: https://music.youtube.com/watch?v=...

  [10/20] Importing IMG_0400.PNG
  ✔ music from YouTube Music — Saat Samundar Paar playing
  🔍 SERP query: "Saat Samundar Paar" "Sadhana Sargam" site:music.youtube.com
  ✔ 🎵 Music link: https://music.youtube.com/watch?v=...

  [11/20] Importing IMG_0399.PNG
  ✔ travel from Google Flights — Flights to Lisbon
  (not a music screenshot — skipped)
```

Every music screenshot gets its link saved to the `music_links` table automatically. Non-music screenshots are left alone. This happens by default — toggle it off in the Music Link Generator menu if you don't want it.

---

### 6. View Screenshots

Browse all uploaded screenshots with their analysis status, metadata, and extracted text.

---

## CLI Usage

```
pool-agent                Launch interactive mode
pool-agent --help         Show help message
pool-agent --version      Show version number
```

### Interactive Menu

When you launch without flags, you get an interactive menu:

```
  📤  Upload Screenshots     Add new screenshots to analyze
  💬  Ask Agent              Chat with music & travel agent
  👤  View Profile           See what the agent knows about you
  🎵  Music Link Generator   Get streaming links from a screenshot
  🖼️   View Screenshots       Browse uploaded screenshots
  👋  Exit
```

Use arrow keys to navigate, Enter to select.

---

## Architecture

### The big picture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Menu                            │
│   Upload · Ask Agent · Profile · Music Links · Screenshots  │
└─────────────┬───────────────────────────────┬───────────────┘
              │                               │
         Ask Agent                      Upload Screenshots
              │                               │
              ▼                               ▼
┌──────────────────────┐        ┌──────────────────────────┐
│     Orchestrator      │        │    Ingestion Pipeline     │
│                       │        │                           │
│  1. Classify intent   │        │  1. Copy image to store   │
│  2. Pick the agent    │        │  2. OCR (extract text)    │
│  3. Run it            │        │  3. Vision analysis       │
│  4. Learn from convo  │        │  4. Index in vector DB    │
└───────┬───────────────┘        │  5. Update profile facts  │
        │                        │  6. Build graph edges     │
        ▼                        │  7. Extract music links   │
┌───────────────────┐            └─────────────┬────────────┘
│   Sub-Agents      │                          │
│                   │                          ▼
│  🎵 Music Agent   │            ┌──────────────────────────┐
│  ✈️  Travel Agent  │            │     Knowledge Store       │
│  👤 Profile Agent │◄──────────►│                           │
│  💬 General Agent │  query     │  SQLite · Vectra · Graph  │
└───────────────────┘            └──────────────────────────┘
```

Every agent queries the knowledge store directly. No middleman building context strings — each agent knows what data it needs and asks for it.

### What happens when you upload a screenshot

```
Your screenshot (e.g. a Spotify playlist)
    │
    ▼
┌─ OCR ────────────────────────────────────┐
│ Gemini reads every visible word:         │
│ "Liked Songs · 342 songs                 │
│  Arctic Monkeys - Do I Wanna Know?       │
│  Tame Impala - The Less I Know..."       │
└──────────────┬───────────────────────────┘
               │
               ▼
┌─ Vision Analysis ────────────────────────┐
│ Gemini looks at image + OCR text:        │
│                                          │
│ summary: "Spotify Liked Songs playlist"  │
│ sourceApp: "Spotify"                     │
│ category: "music"                        │
│ entities:                                │
│   artists: [Arctic Monkeys, Tame Impala] │
│   genres: [indie rock]                   │
│   platform: Spotify                      │
│ user_facts:                              │
│   music_platform = Spotify (95%)         │
│   liked_artist = Arctic Monkeys (90%)    │
└──────────────┬───────────────────────────┘
               │
               ▼
┌─ Store Everything ───────────────────────┐
│                                          │
│ SQLite:                                  │
│   screenshots table ← metadata + OCR     │
│   entities table ← artists, genres       │
│   facts table ← "likes Arctic Monkeys"   │
│   profile_kv ← platform = Spotify        │
│                                          │
│ Vectra:                                  │
│   vector embedding of all the text       │
│   (so you can search by meaning later)   │
│                                          │
│ Graph:                                   │
│   user ──LISTENS_TO──► Arctic Monkeys    │
│   user ──PREFERS─────► indie rock        │
│   screenshot ─CONTAINS─► Arctic Monkeys  │
│   Arctic Monkeys ─IN_GENRE─► indie rock  │
└──────────────────────────────────────────┘
```

### What happens when you ask a question

```
You: "recommend me some music like what I listen to"
    │
    ▼
┌─ Orchestrator ───────────────────────────┐
│                                          │
│ Step 1: What kind of question is this?   │
│   → LLM classifies: "music"             │
│                                          │
│ Step 2: Does this need live search?      │
│   → No (it's about your taste, not      │
│     searching for flights or prices)     │
│                                          │
│ Step 3: Route to Music Agent             │
└──────────────┬───────────────────────────┘
               │
               ▼
┌─ Music Agent ────────────────────────────┐
│                                          │
│ Queries the knowledge store directly:    │
│                                          │
│ SQLite:                                  │
│   "What artists does this user like?"    │
│   → Arctic Monkeys, Tame Impala          │
│   "What genres?"                         │
│   → indie rock                           │
│   "What platform?"                       │
│   → Spotify                              │
│                                          │
│ Vectra:                                  │
│   "Find screenshots related to this      │
│    query" → top 5 music screenshots      │
│                                          │
│ Graph:                                   │
│   "What is this user connected to?"      │
│   → LISTENS_TO: Arctic Monkeys,          │
│     Tame Impala                          │
│                                          │
│ Builds context → sends to Gemini         │
│ → Personalized recommendations with      │
│   Spotify links                          │
└──────────────────────────────────────────┘
```

### The four agents

Each agent has a different job, but they all get their data from the same knowledge store.

**🎵 Music Agent** — knows your taste

Pulls your artists, genres, songs, playlists, platform, mood/energy preferences from the store. Recommends music that matches your actual taste — 70% familiar vibes, 30% discovery. Every recommendation links to your streaming platform.

**✈️ Travel Agent** — knows your plans

Two modes. **Profile mode**: answers from your stored travel data ("where am I planning to go?" → reads your destinations, dates, hotels from the facts table). **Search mode**: when you ask for live results ("flights from Delhi to Goa on May 5"), it calls the flight/train/bus search tools in parallel, gets real prices, and presents them sorted by price.

**👤 Profile Agent** — knows what we know (and what we don't)

Reads everything in the store and presents it as a narrative. Cites sources for every fact — "based on your Spotify screenshots" vs "from one screenshot, not confirmed." Never shows raw confidence numbers. Flags gaps honestly and suggests what screenshots would help.

**💬 General Agent** — handles everything else

Greetings, general questions, and screenshot Q&A. When you ask "what was that app I was looking at?", it runs a semantic search across your screenshots to find the answer. Can also do web search for current events.

### How facts get validated

Not everything extracted from a screenshot is trustworthy. A name visible in one screenshot could be anyone — a contact, an artist, a sender. The system has rules:

```
Fact seen in 1 screenshot at 0.7 confidence
  → Stored in facts table as a candidate
  → NOT shown as "your name" or "your location"
  → Agents see it but treat it cautiously

Same fact seen in 2+ screenshots
  → Confidence increases via reinforcement
  → Promoted to profile_kv (agents treat it as real)

User says "my name is X" in conversation
  → Validated against a blocklist (not a verb, not "thinking of")
  → If valid: stored at 0.85 confidence, promoted to profile_kv

Fact with invalid value (e.g. "Economy" as a name)
  → Blocked by validation (isValidPersonName checks 80+ non-name words)
  → Never stored
```

### The knowledge store in one sentence

**SQLite** stores the facts. **Vectra** finds things by meaning. **Graph** connects everything together. Agents query all three.

---

## Memory — How Pool Remembers You

This is the core of what makes Pool feel intelligent. It's not just storing data — it's building a living memory of who you are, what you care about, and how things connect. Every screenshot, every conversation, every interaction adds to this memory. Nothing is thrown away, nothing is forgotten unless you ask.

### Three layers of memory

Think of Pool's memory like a brain with three systems:

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   EPISODIC MEMORY (SQLite — facts table)                    │
│   ─────────────────────────────────────                     │
│   Individual memories with full context                     │
│                                                              │
│   "Arctic Monkeys seen in screenshot ss_123                 │
│    on March 30th, confidence 0.85,                          │
│    evidence: in Liked Songs playlist"                       │
│                                                              │
│   "User said they live in Bengaluru                         │
│    during conversation on April 1st"                        │
│                                                              │
│   Every fact remembers WHERE it came from,                  │
│   WHEN it was learned, and HOW sure we are.                 │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   SEMANTIC MEMORY (Vectra — vector embeddings)              │
│   ─────────────────────────────────────────                 │
│   The "feeling" of what you've seen                         │
│                                                              │
│   Every screenshot becomes a point in meaning-space.        │
│   When you ask "that beach vacation thing I was             │
│   looking at" — Pool doesn't search by keywords.            │
│   It finds screenshots that FEEL similar to your            │
│   question, even if the exact words don't match.            │
│                                                              │
│   This is why you can ask vague questions and               │
│   still get the right answer.                               │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ASSOCIATIVE MEMORY (Graphology — knowledge graph)         │
│   ──────────────────────────────────────────────            │
│   How things connect to each other                          │
│                                                              │
│   You ──LISTENS_TO──► Arctic Monkeys                        │
│   Arctic Monkeys ──IN_GENRE──► indie rock                   │
│   You ──INTERESTED_IN──► Lisbon                             │
│   Screenshot #3 ──CONTAINS──► Arctic Monkeys                │
│   Screenshot #7 ──CONTAINS──► Lisbon                        │
│                                                              │
│   The graph lets Pool traverse connections:                  │
│   "What genres do my favorite artists share?"               │
│   "Which screenshots mention this destination?"             │
│   "Are my music taste and travel interests linked?"         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Memory formation — how a screenshot becomes memory

When you upload a screenshot, Pool doesn't just save the image. It goes through a multi-stage memory formation process:

```
RAW INPUT                    PERCEPTION                  MEMORY ENCODING
──────────                   ──────────                  ───────────────

Screenshot image             OCR extracts               Facts table:
(pixels, nothing more)   →   every visible word    →    individual memories
                             Vision model                with confidence
                             understands context         and sources

                                                         Profile KV:
                                                    →    current beliefs
                                                         (only when evidence
                                                         is strong enough)

                                                         Vector embedding:
                                                    →    the "meaning" of this
                                                         screenshot encoded
                                                         as a point in space

                                                         Graph edges:
                                                    →    connections between
                                                         you, this screenshot,
                                                         and every entity in it
```

One screenshot creates memories across all three systems simultaneously. A Spotify screenshot doesn't just become a row in a database — it becomes:
- 3-5 individual facts (artist, genre, platform) with confidence scores
- A searchable vector that captures the full meaning of what was on screen
- 4-6 graph edges connecting you to artists, genres, and the platform

### Memory reinforcement — how Pool gets more confident

Pool doesn't just collect facts. It watches for patterns.

```
Screenshot #1 (Spotify playlist):
  → "liked_artist: Arctic Monkeys" — confidence 0.7, 1 source

Screenshot #4 (Spotify Now Playing):
  → Same artist seen again
  → Confidence bumps to 0.75, now 2 sources

Screenshot #9 (concert ticket screenshot):
  → Arctic Monkeys again
  → Confidence bumps to 0.80, now 3 sources
  → "This user really listens to Arctic Monkeys"

Conversation: "I love Arctic Monkeys"
  → Direct confirmation
  → Confidence goes to 0.85
  → Promoted to profile — strong signal
```

Each time the same fact appears from a different source, confidence increases. The system never removes a fact because it's absent — it only strengthens when it sees evidence. This means your profile gets richer and more accurate with every screenshot you upload, without ever losing what it already learned.

### Memory retrieval — how agents access what Pool knows

When you ask a question, the agent doesn't get a raw database dump. It assembles a focused memory snapshot:

```
You: "suggest me some music"

Music Agent's memory retrieval:
│
├── SQLite (episodic):
│   "What artists has this user liked?"
│   → Arctic Monkeys (3 sources, 0.80)
│   → Tame Impala (2 sources, 0.75)
│   "What genres?"
│   → indie rock (strong signal)
│   "What platform?"
│   → Spotify (seen in 5 screenshots)
│   "Mood / energy preferences?"
│   → chill, introspective / medium energy
│
├── Vectra (semantic):
│   "Find screenshots similar to 'suggest me some music'"
│   → Screenshot #1: Spotify Liked Songs (0.87 similarity)
│   → Screenshot #4: Now Playing Arctic Monkeys (0.82)
│   → Screenshot #9: Concert tickets (0.71)
│
└── Graph (associative):
    "What is this user connected to musically?"
    → LISTENS_TO: Arctic Monkeys, Tame Impala
    → PREFERS: indie rock, Spotify
    → Arctic Monkeys ─IN_GENRE─► indie rock
    → Tame Impala ─IN_GENRE─► psychedelic rock
```

Three memory systems, one coherent picture. The agent sees your complete musical identity — not a flat list of data, but a rich web of facts, feelings, and connections.

### Conversation memory — Pool learns while you chat

It's not just screenshots. Every conversation teaches Pool something:

```
You: "I live in Bengaluru and I love indie music"

Profile Updater catches:
  → "i live in" + "Bengaluru" → fact: location = Bengaluru (0.85)
  → "i love" + "indie music" → fact: genre = indie (0.85)

These go into:
  → SQLite facts table (with source = "conversation")
  → Profile KV (promoted because user stated directly)
  → Next time any agent runs, it knows your location and genre preference
```

The conversation extraction uses pattern matching — not another LLM call. It's fast, deterministic, and validates everything before storing (no more "thinking of" being saved as a name).

### Memory across sessions

All memory persists between sessions. Close the CLI, come back tomorrow, and Pool remembers everything:

```
data/
├── pool.db        ← SQLite: all facts, profile, conversations, screenshots
├── vectors/       ← Vectra: all embeddings for semantic search
├── graph.json     ← Graphology: all entity relationships
└── screenshots/   ← Your actual image files
```

No cloud sync, no account needed. Your memory lives on your machine. Delete the `data/` folder to start fresh — that's the only way to "forget."

### Why this matters

Most apps store your data as dead records in a database. Pool treats your data as living memory:

- **Dead record:** `{ name: "Arctic Monkeys", type: "artist" }` — just a row, no context
- **Living memory:** Arctic Monkeys seen across 3 screenshots, connected to indie rock genre, linked to Spotify platform, part of a chill/introspective listening pattern, related to your liked songs playlist — and the system gets more confident every time it sees them again

That's the difference. Pool doesn't just know WHAT you like — it knows WHY it thinks so, HOW confident it is, WHERE it learned it, and HOW everything connects.

---

## How We Store Data (and why it changed)

### The old way (JSON dumps)

Earlier, everything lived in flat JSON files — `profile.json`, `screenshots.json`, `conversations.json`. The profile was one big nested object that got loaded, mutated, and saved back on every operation.

Problems with that:
- **No querying** — want all travel screenshots? Load the entire array and filter in memory.
- **No provenance** — if the profile says you like "indie rock", which screenshot proved that? No idea.
- **Fragile** — one bad write corrupts the whole file. No transactions, no rollback.
- **No semantic search** — you couldn't ask "find that screenshot about beach vacations" because there were no embeddings.
- **No relationships** — the system knew you liked Arctic Monkeys and indie rock separately, but couldn't connect them.

### The new way (Knowledge Store)

Now we use three purpose-built stores, each doing what it's good at:

#### SQLite (`data/pool.db`) — the filing cabinet

Structured data with proper tables, indexes, and transactions.

| Table | What's in it |
|-------|-------------|
| `screenshots` | Every uploaded screenshot — metadata, analysis results, OCR text |
| `entities` | Structured things extracted from screenshots — artists, destinations, prices, hotels |
| `facts` | Individual facts about you, each with a confidence score and source trail |
| `profile_kv` | Your current profile — key-value pairs derived from facts (only promoted when there's enough evidence) |
| `conversations` | Chat history |
| `music_links` | Streaming links extracted from music screenshots |

Every fact tracks WHERE it came from (which screenshot or conversation) and HOW confident we are. A name seen once in a random screenshot stays as a "candidate" — it only becomes "your name" when multiple sources agree or you confirm it.

#### Vectra (`data/vectors/`) — the search engine

Each analyzed screenshot gets converted into a vector embedding (using Gemini's embedding model). This lets you search by meaning, not keywords.

Ask "that flight I was looking at with a Dubai layover" → Vectra finds the screenshot even though you never tagged it that way. The embedding includes the summary, description, entities, AND the raw OCR text — so it matches against everything that was visible.

No server needed — Vectra stores everything as local files. Pure TypeScript.

#### Graphology (`data/graph.json`) — the mind map

A relationship graph that connects everything:

- **You** → LISTENS_TO → **Arctic Monkeys**
- **Arctic Monkeys** → IN_GENRE → **indie rock**
- **Screenshot #3** → CONTAINS → **Arctic Monkeys**
- **You** → INTERESTED_IN → **Lisbon**
- **Lisbon** → HAS_HOTEL → **Taj Palace**

This lets agents traverse connections — "which screenshots mention Goa?", "what genres do my favorite artists share?", "are my travel interests connected to my music taste?"

### How the profile works now

There's no single `profile.json` anymore. Your profile lives **across all three stores**:

- **Facts table** = raw evidence with sources ("Arctic Monkeys seen in ss_123 at 85% confidence")
- **Profile KV** = the current answer ("preferred platform = Spotify") — only populated when there's enough evidence
- **Graph** = relationships between entities
- **Vectors** = semantic access to your screenshot content

When an agent needs your music context, it queries the facts table for artists/genres, the profile KV for your platform preference, and the graph for related entities. No more loading a giant JSON blob and hoping it's up to date.

### OCR — why we read every word first

Before the AI analyzes a screenshot, we run a separate OCR step that extracts **every single piece of visible text** from the image — verbatim. Every word, number, URL, price, button label, menu item, promo code.

Why not just let the vision model handle it? Because Gemini Vision *interprets*. It'll look at a flight search and say "flights from Bengaluru to Lisbon starting at $258." That's a nice summary, but the screenshot actually had 6 airlines, exact departure times, layover cities, fare classes, baggage info, and a booking deadline — all of which the summary skipped.

OCR captures everything. Then we feed that raw text INTO the vision analysis prompt, so Gemini has both the image AND the pre-extracted text to work with. Result: way more accurate entity extraction.

**Where OCR text goes:**
- **SQLite** — stored in the `ocr_text` column on each screenshot, so agents can read the exact text later
- **Vectra embeddings** — included in the vector, so semantic search matches against actual visible text. You ask "that screenshot with the Dubai layover" → it finds it because "DXB" was in the OCR text, even though the summary never mentioned it

**What this means in practice:**
- Flight screenshot → captures every airline, time, price, not just the cheapest one
- Spotify playlist → captures every song title and artist, not just the top 3
- Food delivery app → captures the full menu, ratings, delivery time
- Boarding pass → captures PNR, gate, seat, baggage allowance

Without OCR, you lose most of the detail. With it, the system remembers everything you saw.

### All local

Everything stays on your machine. The only external calls are to Gemini's API for analysis and embeddings. No cloud database, no server to run.

```
data/
├── pool.db            # SQLite — facts, metadata, profile, conversations
├── vectors/           # Vectra — semantic search embeddings
├── graph.json         # Graphology — relationship graph
└── screenshots/       # Your uploaded image files
```

To reset everything, delete the `data/` directory and restart.

---

## Development

```bash
# Run in dev mode (hot reload)
npm run dev

# Type-check without building
npm run typecheck

# Build for production
npm run build

# Run the built version
npm start

# Reprocess existing screenshots
npm run reprocess

# Run database migrations
npm run migrate
```

### Project Structure

```
src/
├── cli.ts              # Entry point + interactive menu
├── banner.ts           # ASCII art banner
├── logger.ts           # Logging utilities
├── llm.ts              # Gemini AI integration (text, vision, OCR)
├── orchestrator.ts     # Routes queries to the right agent
├── query.ts            # Chat interface
├── profile.ts          # Profile viewer
├── upload.ts           # Screenshot upload flow
├── renderer.ts         # Terminal rendering
├── musicLinkMenu.ts    # Music link generator UI
├── reprocess.ts        # Batch reprocess screenshots
├── agents/             # Specialized AI agents
│   ├── generalAgent.ts
│   ├── musicAgent.ts
│   ├── musicLinkFinder.ts
│   ├── profileAgent.ts
│   └── travelAgent.ts
├── ingestion/          # Screenshot analysis pipeline
│   ├── analyze.ts
│   └── profileUpdater.ts
├── knowledge/          # Data layer
│   ├── store.ts        # Main KnowledgeStore class
│   ├── sqlite.ts       # SQLite operations
│   ├── vectors.ts      # Vector search
│   ├── embeddings.ts   # Embedding generation
│   ├── graph.ts        # Knowledge graph
│   ├── types.ts        # Type definitions
│   └── migrate.ts      # Database migrations
├── tools/              # Agent tools (web search, travel)
│   ├── index.ts
│   ├── webSearch.ts
│   ├── searchFlights.ts
│   ├── searchTrains.ts
│   ├── searchBuses.ts
│   └── types.ts
└── skills/             # Agent skills
    ├── index.ts
    └── compareTravelOptions.ts
```

---

## Troubleshooting

### "GOOGLE_GENERATIVE_AI_API_KEY not set"

You haven't configured your `.env` file. Run:
```bash
cp .env.example .env
```
Then edit `.env` and paste your Gemini API key.

### Screenshots not being analyzed

- Check that the file format is supported (PNG, JPG, JPEG, WebP, GIF, BMP)
- Ensure your API key is valid and has quota remaining
- Check the terminal for error messages during upload

### Agent gives generic answers

Upload more screenshots! The agent gets smarter as it learns more about your preferences from your data.

### Database errors

Try running migrations:
```bash
npm run migrate
```

If that doesn't help, delete `data/pool.db` and restart (this resets all data).

---

## License

ISC
