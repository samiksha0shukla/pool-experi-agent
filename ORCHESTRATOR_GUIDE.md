# Orchestrator & Agents — Implementation Guide

## Architecture

```
User types query
    │
    ▼
query.ts (Chat UI)
    │ Just the terminal loop — zero intelligence here
    │
    ▼
orchestrator.ts (MAIN AGENT)
    │
    ├─ Step 1: Load user profile (typed UserProfile)
    ├─ Step 2: Load all screenshots
    ├─ Step 3: Classify intent via Gemini LLM → music | travel | profile | general
    ├─ Step 4: Build FOCUSED context for the target agent
    │            (not a raw JSON dump — structured, ranked, relevant data only)
    ├─ Step 5: Route to sub-agent
    │    ├─→ musicAgent.ts    (if music)
    │    ├─→ travelAgent.ts   (if travel)
    │    └─→ profileAgent.ts  (if profile)
    ├─ Step 6: Extract profile facts from conversation
    └─ Step 7: Return result
    │
    ▼
query.ts renders response in terminal + optional HTML
```

## The Orchestrator (`src/orchestrator.ts`)

The orchestrator is the **main agent**. It never answers queries itself — it delegates to sub-agents. Its job is:

1. **Load state** — profile + screenshots
2. **Classify** — what kind of query is this?
3. **Prepare context** — build the right context for the right agent
4. **Route** — call the sub-agent
5. **Learn** — update profile from the conversation
6. **Return** — give back the result

### Intent Classification

Uses Gemini Flash via `generateObject` with a Zod schema:

```typescript
const IntentSchema = z.object({
  intent: z.enum(["music", "travel", "profile", "general"]),
  reasoning: z.string(),
});
```

The system prompt explicitly defines each category with examples and edge cases. Falls back to keyword matching if the API is unavailable.

### Context Builders — The Key Differentiator

This is what separates the orchestrator from "just pass the JSON to the LLM."

**Before (old approach):**
```
Agent receives: JSON.stringify(entireProfile) + JSON.stringify(allScreenshots)
→ 90% irrelevant data, wastes tokens, agent has to figure out what matters
```

**Now (orchestrator approach):**
```
Agent receives: pre-processed, ranked, relevant-only context
→ Music Agent gets: platform + genres ranked by strength + artists ranked by mentions
                    + songs + playlists + listening patterns + only music screenshots
→ Travel Agent gets: destinations ranked by strength × recency + full details per destination
                     + dietary preferences + budget style + home city + only travel screenshots
```

#### `buildMusicContext()` produces:

```
PREFERRED PLATFORM: Spotify (95% confidence, 3 sources)

GENRES (ranked by strength):
  - Indie Rock: strength 80%, 5 artists
  - Lo-fi: strength 60%, 2 artists

FAVORITE ARTISTS (ranked by mentions):
  - Arctic Monkeys (mentioned 4×)
  - Tame Impala (mentioned 3×)

SONGS SEEN IN SCREENSHOTS:
  - "Do I Wanna Know?" by Arctic Monkeys
  - "Let It Happen" by Tame Impala

PLAYLISTS SEEN:
  - "Late Night Drive" on Spotify

LISTENING PATTERNS:
  Mood: introspective, indie
  Energy: medium
  Languages: English, Hindi

USER NAME: Samiksha

MUSIC SCREENSHOTS:
  [1] [Spotify] Screenshot of Spotify playlist showing indie rock songs...
  [2] [Spotify] Now playing screen showing Tame Impala...
```

#### `buildTravelContext()` produces:

```
TRAVEL INTERESTS (ranked by strength × recency):
  Tokyo: strength 80%, 5 screenshots, last seen 2026-03-28
    Hotels: Park Hyatt Tokyo
    Activities: Shibuya crossing, TeamLab
    Dates: April 10-17, 2026
    Budget: ₹45,000-55,000

TRAVEL STYLE:
  - accommodation: boutique

USER NAME: Samiksha
HOME CITY: Delhi
DIETARY PREFERENCES: vegetarian
BUDGET STYLE: mid-premium

TRAVEL SCREENSHOTS:
  [1] [Google Flights] Delhi to Tokyo flight search showing prices...
  [2] [Booking.com] Park Hyatt Tokyo hotel listing...
```

---

## Sub-Agents

### Music Agent (`src/agents/musicAgent.ts`)

**Receives:** Pre-processed music context string from orchestrator
**Returns:** Markdown response with personalized recommendations + platform links

Key behaviors:
- 70% familiar picks (adjacent to known artists), 30% discovery
- References the user's actual artists/genres to prove personalization
- Uses the preferred platform for all links (search URLs for reliability)
- Reads mood/energy signals — doesn't suggest EDM to a lo-fi listener
- Checks `contextPreferences` — if user said "I like lo-fi while working" and asks "music for work", uses that
- Honest about thin profiles — "I only have 2 music screenshots so far"

### Travel Agent (`src/agents/travelAgent.ts`)

**Receives:** Pre-processed travel context string from orchestrator
**Returns:** Markdown itinerary anchored on the user's screenshot saves

Key behaviors:
- If no destination specified → picks the strongest one from travel interests and explains why
- If two destinations are close → presents both, lets user choose
- Anchors itinerary on user's actual saves (their hotels, their attractions, their restaurants)
- Respects dietary restrictions throughout (vegetarian → only veg-friendly restaurants)
- Default relaxed pace (2 activities/day)
- Estimates costs in the user's likely currency (based on location)
- Honest about thin profiles — "I only have 3 travel screenshots"

### Profile Agent (`src/agents/profileAgent.ts`)

**Receives:** Full profile JSON + stats
**Returns:** Narrative profile summary with source citations

Key behaviors:
- Presents profile as a story, not a JSON dump
- "You're clearly into indie rock — Arctic Monkeys, Tame Impala show up across 8 screenshots"
- Shows confidence levels — "I'm 95% sure your name is Samiksha"
- Calls out gaps — "I don't know your travel budget. A flight search screenshot would help."
- Suggests specific screenshot types to fill gaps

---

## How Intent → Context → Agent Flows

### Example: "suggest me some music"

```
Orchestrator:
  [1/7] Loading user profile...
        Profile v14 — 10 screenshots analyzed
        User: Samiksha
  [2/7] Loading screenshot context...
        15 total, 10 analyzed (6 music, 3 travel)
  [3/7] Classifying intent...
        Routed to: 🎵 Music Agent — query mentions music recommendations
  [4/7] Building agent context...
        Music context: 5 artists, 3 genres, 8 songs
  [5/7] Agent generating response...
        ⠋ Agent is thinking...
        ✔ Response generated
  [6/7] Extracting profile facts from conversation...
        No new facts from this conversation
  [7/7] Complete
```

### Example: "plan my itinerary" (no destination)

```
Orchestrator:
  [1/7] Loading user profile...
        Profile v14 — 10 screenshots analyzed
        User: Samiksha
  [2/7] Loading screenshot context...
        15 total, 10 analyzed (6 music, 3 travel)
  [3/7] Classifying intent...
        Routed to: ✈️ Travel Agent — query about trip planning
  [4/7] Building agent context...
        Travel context: 2 destinations, 3 screenshots
        → Tokyo is strongest (strength 80%, 5 screenshots)
  [5/7] Agent generating response...
        ⠋ Agent is thinking...
        ✔ Response generated
  [6/7] Extracting profile facts from conversation...
        No new facts from this conversation
  [7/7] Complete

Travel Agent sees: Tokyo is #1 destination with hotels, activities, dates, budget
→ Builds itinerary for Tokyo without being told
→ Uses Park Hyatt Tokyo and Shibuya from user's actual screenshots
→ Respects vegetarian preference for all restaurant picks
```

### Example: "I'm vegetarian, suggest music for working"

```
Orchestrator:
  [3/7] Classifying intent...
        Routed to: 🎵 Music Agent — query about music for specific context
  [5/7] Agent generating response...
        Music Agent sees contextPreferences: { working: "lo-fi" }
        → Recommends lo-fi/ambient music specifically
  [6/7] Extracting profile facts from conversation...
        ✔ 1 new fact: foodPreferences += "vegetarian"
```

---

## Files Changed

| File | What changed |
|---|---|
| `src/orchestrator.ts` | **NEW** — The main agent. Intent classification, context builders, routing, profile updates. |
| `src/agents/musicAgent.ts` | **Rewritten** — receives pre-processed context string (not raw JSON), custom system prompt focused on taste-based personalization |
| `src/agents/travelAgent.ts` | **Rewritten** — receives pre-processed travel context with ranked destinations, custom system prompt for itinerary building |
| `src/agents/profileAgent.ts` | **Rewritten** — narrative profile presentation, source citations, gap analysis |
| `src/query.ts` | **Slimmed down** — now ONLY the chat UI loop. All intelligence delegated to `orchestrate()` |

## What the Orchestrator Is NOT

- It's **not an LLM agent** itself — it doesn't have a system prompt or generate text
- It's **not a router function** — it does real work: loading state, classifying intent, building context, updating profile
- It's **not a pass-through** — agents receive focused, ranked, pre-processed context, not raw data
- It's **deterministic code with one LLM call** (intent classification) — the rest is pure logic

The LLM intelligence lives in three places:
1. `classifyIntent()` — one Gemini call to determine which agent to route to
2. The sub-agent call — one Gemini call to generate the response
3. `analyzeScreenshot()` — one Gemini Vision call per screenshot upload (in the ingestion pipeline, not the orchestrator)
