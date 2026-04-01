# Tools & Skills — Implementation Guide

## Concepts

**Tool** = A function the LLM can call mid-generation to get real-time data. The LLM decides WHEN to call it. Built using Vercel AI SDK's `tool()`.

**Skill** = A higher-level capability that orchestrates multiple tools + reasoning. Called by the orchestrator BEFORE the LLM runs, not by the LLM itself.

```
User: "search flights from Bangalore to Jabalpur for tomorrow"
  → Orchestrator detects needsRealTimeSearch = true
  → Travel Agent runs with tools enabled
  → LLM decides to call searchFlights tool
  → Tool searches the web via Gemini Search Grounding
  → Tool structures results into FlightResult[]
  → LLM receives results, formats a response with prices and times

User: "compare all travel options from Bangalore to Jabalpur"
  → Orchestrator detects needsCompareSkill = true
  → Orchestrator extracts travel params (origin, destination, date)
  → compareTravelOptions skill runs
  → Skill calls searchFlights + searchTrains + searchBuses IN PARALLEL
  → Skill validates results
  → Skill asks LLM to compare and recommend
  → Returns formatted comparison table
```

---

## File Structure

```
src/
├── tools/
│   ├── types.ts              # Shared types: TransportResult, SearchResults, TravelParams
│   ├── searchFlights.ts      # Tool: search real-time flights
│   ├── searchTrains.ts       # Tool: search real-time trains
│   ├── searchBuses.ts        # Tool: search real-time buses
│   └── index.ts              # Barrel export
│
├── skills/
│   ├── compareTravelOptions.ts  # Skill: parallel search + compare + recommend
│   └── index.ts              # Barrel export
│
├── llm.ts                    # MODIFIED: added generateTextWithTools()
├── orchestrator.ts           # MODIFIED: added compare detection + params extraction
└── agents/travelAgent.ts     # MODIFIED: uses tools when search is enabled
```

---

## Tools — File by File

### `src/tools/types.ts` — Shared Types

Defines Zod schemas for all transport search results:

- **TransportResult** — one transport option (flight/train/bus) with: provider, operator, identifier (flight number / train number), departure/arrival times, duration, price, stops, class, availability
- **SearchResults** — wrapper: array of TransportResult + timestamp + disclaimer
- **TravelParams** — extracted from user query: origin, destination, date, passengers

### `src/tools/searchFlights.ts` — Flight Search Tool

Uses Vercel AI SDK's `tool()` pattern:

```
tool({
  description: "Search for flights...",
  parameters: z.object({ origin, destination, date }),
  execute: async ({ origin, destination, date }) => {
    // Step 1: Search web via Gemini with Google Search grounding
    // Step 2: Parse raw text into structured SearchResults via generateJSON
    // Step 3: Return validated results
  }
})
```

**How it searches:** Internally calls `generateTextWithSearch()` (Gemini + `useSearchGrounding: true`) with a prompt that asks for flight data from Google Flights, MakeMyTrip, Cleartrip, EaseMyTrip, Ixigo. The raw text response is then structured into `SearchResults` via `generateJSON()`.

**Platforms searched:** Google Flights, MakeMyTrip, Cleartrip, EaseMyTrip, Ixigo.

### `src/tools/searchTrains.ts` — Train Search Tool

Same pattern as flights. Searches IRCTC, ConfirmTkt, RailYatri, Trainman, MakeMyTrip. Returns train number, classes (Sleeper/3AC/2AC/1AC), availability status.

### `src/tools/searchBuses.ts` — Bus Search Tool

Same pattern. Searches RedBus, AbhiBus, MakeMyTrip buses, Goibibo. Returns operator, bus type (AC/Non-AC/Volvo/Sleeper), seat type.

---

## Skills — File by File

### `src/skills/compareTravelOptions.ts` — Compare All Transport Modes

This is the only skill so far. It:

1. **Calls all 3 tools in parallel** using `Promise.allSettled` — so one failing doesn't block the others
2. **Validates results** — checks each tool succeeded, handles failures gracefully
3. **Builds comparison context** — formats all results into a structured text block
4. **Asks LLM to compare** — calls `generateText()` with a comparison prompt that produces:
   - Flights table (sorted by price)
   - Trains table (sorted by price)
   - Buses table (sorted by price)
   - Best overall recommendation
   - Cheapest option across all modes
   - Disclaimer about price freshness

**Triggered when:** User says "compare", "vs", "which is cheaper", "all options", "best way to reach", etc.

---

## LLM Layer Changes

### `src/llm.ts` — Added `generateTextWithTools()`

```typescript
generateTextWithTools(
  systemPrompt: string,
  userMessage: string,
  tools: Record<string, CoreTool>,  // the tools the LLM can call
  history?: ChatMessage[],
  maxSteps?: number                  // how many tool-call rounds (default 5)
): Promise<string>
```

Uses Vercel AI SDK's `aiGenerateText()` with the `tools` and `maxSteps` parameters. The `maxSteps` enables multi-step tool calling: LLM calls a tool → gets result → calls another tool or generates final text.

**Date injection:** `withDate()` prepends today's date to EVERY LLM call (generateText, generateTextWithTools, generateTextWithSearch, generateJSON). So the LLM always knows what "tomorrow" means.

---

## Orchestrator Changes

### Detection Functions

```
needsRealTimeSearch(query)  → true for: search, find, tomorrow, check, available, tickets, etc.
needsCompareSkill(query)    → true for: compare, vs, which is cheaper, all options, etc.
```

### Routing Logic (for travel intent)

```
if (needsCompareSkill(query)):
  → extractTravelParams(query, profile) via LLM
  → compareTravelOptions(origin, destination, date, preferences)

else if (needsRealTimeSearch(query)):
  → runTravelAgent(query, context, history, useSearch=true)
  → Agent has tools: { searchFlights, searchTrains, searchBuses }
  → LLM decides which tools to call based on the query

else:
  → runTravelAgent(query, context, history, useSearch=false)
  → No tools, answers from profile/screenshot data only
```

### `extractTravelParams()` — Travel Params Extraction

Uses `generateJSON()` to extract origin, destination, and date from the user's query:
- If origin not mentioned → uses `profile.identity.location` (user's home city)
- If destination not mentioned → uses top travel interest from profile
- If date not mentioned → uses saved dates from profile or today's date
- Resolves relative dates ("tomorrow" → actual date)

---

## Data Flow Examples

### "Search flights from Bangalore to Jabalpur for tomorrow"

```
1. Orchestrator classifies: intent = "travel"
2. needsRealTimeSearch("search flights...") = true
3. needsCompareSkill("search flights...") = false
4. Calls runTravelAgent(query, context, history, useSearch=true)
5. Travel agent calls generateTextWithTools() with tools: { searchFlights, searchTrains, searchBuses }
6. Gemini sees query + tools → decides to call searchFlights({ origin: "Bangalore", destination: "Jabalpur", date: "2026-04-01" })
7. searchFlights.execute() internally:
   a. Calls generateTextWithSearch() → Gemini searches Google for real flights
   b. Gets raw text with flight data
   c. Calls generateJSON() → parses into SearchResults { results: [...] }
   d. Returns structured results
8. Gemini receives tool results → formats response with flight table
9. Response: "Here are flights from Bangalore to Jabalpur on April 1st: IndiGo 6E-245 at 06:15 AM..."
```

### "Compare all options from Bangalore to Jabalpur"

```
1. Orchestrator classifies: intent = "travel"
2. needsCompareSkill("compare all options...") = true
3. extractTravelParams() → { origin: "Bangalore", destination: "Jabalpur", date: "2026-04-01" }
4. compareTravelOptions("Bangalore", "Jabalpur", "2026-04-01", prefs)
5. Skill calls Promise.allSettled([searchFlights, searchTrains, searchBuses])
6. All three tools search in parallel
7. Skill collects results, formats comparison context
8. Skill calls generateText() with comparison prompt
9. Response: table with flights/trains/buses sorted by price + recommendation
```

### "What's the cheapest way to reach Jabalpur?"

```
1. Orchestrator: intent = "travel"
2. needsCompareSkill("cheapest way") = true (matches "which is cheaper")
3. extractTravelParams() → origin from profile (Bangalore), destination "Jabalpur"
4. compareTravelOptions runs → all three tools → comparison
5. Response: cheapest option highlighted across all modes
```

---

## How Tools Search the Web

Each tool uses a three-step pattern:

```
Step 1: WEB SEARCH — webSearch() via Google Custom Search API
  Sends real search queries to Google (e.g., "Bangalore to Jabalpur flights April 2026")
  Returns actual search results: titles, snippets, URLs from Yatra, MakeMyTrip, Cleartrip, IRCTC, RedBus, etc.
  Uses GOOGLE_CUSTOM_SEARCH_API_KEY + GOOGLE_CUSTOM_SEARCH_ENGINE_ID

Step 2: EXTRACT — generateText() via Gemini
  Feeds the real search snippets to Gemini
  Asks it to extract structured transport data (operator, times, prices)
  Uses a strict line format: "FLIGHT | IndiGo | 6E-245 | 06:15 AM | ..."
  Gemini can ONLY use what's in the search snippets — no fabrication

Step 3: PARSE — parseTransportLines()
  Pure code (no LLM) — splits the lines and maps to TransportResult objects
  Returns typed, structured results
```

**Requires two API keys:**
- `GOOGLE_GENERATIVE_AI_API_KEY` — for Gemini (already had this)
- `GOOGLE_CUSTOM_SEARCH_API_KEY` + `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` — for real Google Search

**Why not Gemini Search Grounding?** It was failing — the `useSearchGrounding` flag with Gemini didn't reliably return flight/train data, and Zod v4 broke the AI SDK tool() function calling. Using Google Custom Search API directly is more reliable and gives us actual URLs from booking platforms.

**Limitation:** Results are based on search snippets, not direct API calls to airlines/railways. Prices may be slightly different from what you see on the booking platform. The disclaimer in results always notes this.

---

## What Queries Now Work

| Query | What happens |
|---|---|
| "Search flights from BLR to JBP tomorrow" | searchFlights tool called, returns real flight data |
| "Find trains to Jabalpur" | searchTrains tool called |
| "Check bus availability to Jabalpur" | searchBuses tool called |
| "Compare all options from Bangalore to Jabalpur" | compareTravelOptions skill runs all 3 in parallel |
| "Which is cheaper — flight or train to Jabalpur?" | compare skill triggered |
| "Best way to reach Jabalpur from Bangalore" | compare skill triggered |
| "Where am I going?" | No tools — answers from profile (fast, free) |
| "Plan my itinerary" | No tools — answers from profile (fast, free) |
