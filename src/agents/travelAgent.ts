/**
 * TRAVEL AGENT — Sub-agent of the Orchestrator
 *
 * Queries the KnowledgeStore directly for user's travel data.
 *
 * Two modes:
 * 1. Profile-based (useSearch=false): answers from knowledge store data
 * 2. Search-based (useSearch=true): calls search tools, then formats results
 */

import { generateText, type ChatMessage } from "../llm.js";
import { searchFlights } from "../tools/searchFlights.js";
import { searchTrains } from "../tools/searchTrains.js";
import { searchBuses } from "../tools/searchBuses.js";
import type { SearchResults, TravelParams } from "../tools/types.js";
import type { KnowledgeStore } from "../knowledge/store.js";

const SYSTEM_PROMPT = `You are a travel agent embedded inside Pool, a screenshot-based personal intelligence app.

You know the user through their screenshots — flights they searched, hotels they browsed, tourist spots they saved.

MOST IMPORTANT RULE: Answer EXACTLY what the user asked. Nothing more.

- "Where am I planning to go?" → Short answer with destination and evidence. No itinerary.
- "What are my travel plans?" → Brief summary. No itinerary.
- "Plan my trip" / "Build me an itinerary" → Full day-by-day plan.
- "How much will my trip cost?" → Budget estimates only. No itinerary.
- "Search flights / trains / buses" → Present search results clearly.
- "When am I traveling?" → Just the dates.

WHEN SEARCH RESULTS ARE PROVIDED:
You will receive real search results from Google. Present them clearly:
- Sort by price (cheapest first)
- Include all details: operator, times, duration, price, platform
- Highlight the best option
- Always note that prices are approximate

FORMAT:
- Markdown with ## and ### headers
- Tables or clean lists for search results
- Concise for simple questions, detailed for itineraries/searches

WHEN NO RESULTS ARE FOUND:
If the search tools return no results or say "no direct flights/trains/buses":
- Tell the user honestly: "No direct [flights/trains/buses] found from [origin] to [destination]"
- Explain WHY (e.g., "Jabalpur is a small city with limited direct international flight connectivity")
- Suggest a PRACTICAL alternative: "You could fly from Delhi/Mumbai to Portugal instead" or "Take a connecting flight via Delhi"
- If the user's home city is known, suggest the most logical hub
- Do NOT show fake results or links to generic pages

RULES:
- NEVER give an itinerary unless explicitly asked
- When search results are provided, present ALL of them, don't skip any
- Never fabricate data — if there are no results, say so clearly
- Use ₹ for Indian routes, $ for international
- Respect dietary restrictions
- CRITICAL: The user's explicit query ALWAYS overrides the profile. If they say "Delhi to Jabalpur", use that route.
- If results look suspicious (generic pages, wrong routes), say "no verified results found" rather than showing bad data`;

/**
 * Build travel context by querying the knowledge store directly.
 */
async function buildTravelContext(store: KnowledgeStore, query: string): Promise<string> {
  const context = await store.getContextForAgent("travel", query);
  const parts: string[] = [];

  // Destinations from facts
  const destinations = store.getFactsByType("travel_interest");
  if (destinations.length > 0) {
    parts.push("TRAVEL INTERESTS (ranked by confidence):");
    for (const dest of destinations) {
      const prefix = `travel.detail.${dest.fact_value.toLowerCase()}`;
      const details = store.getProfileSection(prefix);
      const detailParts: string[] = [];
      for (const d of details) {
        const shortKey = d.key.replace(`${prefix}.`, "");
        detailParts.push(`${shortKey}: ${d.value}`);
      }
      parts.push(`  ${dest.fact_value}: ${(dest.confidence * 100).toFixed(0)}% confidence`);
      if (detailParts.length > 0) {
        parts.push("    " + detailParts.join("\n    "));
      }
    }
  } else {
    parts.push("TRAVEL INTERESTS: None detected yet");
  }

  // Travel style
  const styleKV = store.getProfileSection("travel.style.");
  if (styleKV.length > 0) {
    parts.push("TRAVEL STYLE:\n" +
      styleKV.map((s) => `  - ${s.key.replace("travel.style.", "")}: ${s.value}`).join("\n")
    );
  }

  // User identity
  const name = store.getTopFact("name");
  const location = store.getTopFact("location");
  if (name) parts.push(`USER NAME: ${name}`);
  if (location) parts.push(`HOME CITY: ${location}`);

  // Dietary preferences
  const foodPrefs = store.getFactsByType("food_preference");
  if (foodPrefs.length > 0) {
    parts.push(`DIETARY PREFERENCES: ${foodPrefs.map((f) => f.fact_value).join(", ")}`);
  }

  // Budget
  const budget = store.getProfileValue("general.budgetStyle");
  if (budget) parts.push(`BUDGET STYLE: ${budget.value}`);

  // Semantic search results
  if (context.semanticMatches.length > 0) {
    parts.push("RELEVANT SCREENSHOTS (semantic search):\n" +
      context.semanticMatches.map((m, i) => `  [${i + 1}] ${m.summary || "No summary"} (relevance: ${(m.score * 100).toFixed(0)}%)`).join("\n")
    );
  }

  // Travel screenshots
  if (context.screenshots.length > 0) {
    parts.push("TRAVEL SCREENSHOTS:\n" +
      context.screenshots.map((s, i) => {
        const app = s.source_app ? `[${s.source_app}] ` : "";
        const desc = s.detailed_description || s.summary || "No description";
        // Get entities for this screenshot
        const entities = store.getEntitiesByScreenshot(s.id);
        const entityStr = entities.length > 0 ? ` | entities: ${entities.map((e) => `${e.entity_type}=${e.entity_value}`).join(", ")}` : "";
        return `  [${i + 1}] ${app}${desc}${entityStr}`;
      }).join("\n")
    );
  }

  // Graph connections
  if (context.graphNeighbors.length > 0) {
    parts.push("DESTINATIONS IN KNOWLEDGE GRAPH:\n" +
      context.graphNeighbors.map((n) => `  - ${n.attrs.name || n.id}`).join("\n")
    );
  }

  return parts.join("\n\n");
}

export async function runTravelAgent(
  query: string,
  store: KnowledgeStore,
  chatHistory?: ChatMessage[],
  useSearch?: boolean,
  travelParams?: TravelParams
): Promise<string> {

  if (useSearch && travelParams) {
    const travelContext = await buildTravelContext(store, query);
    return await searchAndRespond(query, travelContext, travelParams, chatHistory);
  }

  // ── PROFILE MODE: Answer from knowledge store data ──
  const travelContext = await buildTravelContext(store, query);
  const userMessage = `USER'S TRAVEL DATA:

${travelContext}

---

USER'S QUESTION: "${query}"

Answer their specific question from the profile data above.`;

  return generateText(SYSTEM_PROMPT, userMessage, chatHistory);
}

async function searchAndRespond(
  query: string,
  travelContext: string,
  params: TravelParams,
  chatHistory?: ChatMessage[]
): Promise<string> {
  const q = query.toLowerCase();

  // Determine which transport modes to search
  const searchFlightsMode = /flight|fly|plane|air|suggest/i.test(q) || isGenericSearch(q);
  const searchTrainsMode = /train|rail|irctc/i.test(q) || isGenericSearch(q);
  const searchBusesMode = /bus|road/i.test(q) || isGenericSearch(q);

  // Search in parallel
  const searches: Array<Promise<SearchResults>> = [];
  const labels: string[] = [];

  if (searchFlightsMode) {
    searches.push(searchFlights(params.origin, params.destination, params.date));
    labels.push("flights");
  }
  if (searchTrainsMode) {
    searches.push(searchTrains(params.origin, params.destination, params.date));
    labels.push("trains");
  }
  if (searchBusesMode) {
    searches.push(searchBuses(params.origin, params.destination, params.date));
    labels.push("buses");
  }

  const settled = await Promise.allSettled(searches);

  // Build search results context
  const resultSections: string[] = [];
  resultSections.push(`SEARCH: ${params.origin} → ${params.destination} on ${params.date}`);
  resultSections.push(`MODES SEARCHED: ${labels.join(", ")}`);
  resultSections.push("");

  for (let i = 0; i < settled.length; i++) {
    const label = labels[i]!.toUpperCase();
    const result = settled[i]!;

    if (result.status === "fulfilled" && result.value.results.length > 0) {
      const sr = result.value;
      resultSections.push(`${label} (${sr.results.length} options found):`);
      for (const r of sr.results) {
        resultSections.push(`  ${r.operator} ${r.identifier} | ${r.departureTime}→${r.arrivalTime} | ${r.duration} | ${r.price} | ${r.classType} | ${r.provider}`);
      }
      resultSections.push(`  Sources: ${sr.sources.join(", ")}`);
      resultSections.push(`  ${sr.disclaimer}`);
    } else if (result.status === "rejected") {
      resultSections.push(`${label}: ${result.reason?.message || "Search failed"}`);
    } else {
      resultSections.push(`${label}: No results found`);
    }
    resultSections.push("");
  }

  const searchData = resultSections.join("\n");

  const userMessage = `BACKGROUND (for personalization only — do NOT use this to change the route):
${travelContext}

════════════════════════════════════════════
THE USER EXPLICITLY ASKED FOR: ${params.origin} → ${params.destination} on ${params.date}
THIS IS THE ROUTE YOU MUST PRESENT. NOT any other route from the profile or chat history.
════════════════════════════════════════════

REAL-TIME SEARCH RESULTS FOR ${params.origin} → ${params.destination}:
${searchData}

USER'S QUESTION: "${query}"

INSTRUCTIONS:
1. Present ONLY the search results above for ${params.origin} → ${params.destination}
2. Sort by price (cheapest first). Highlight the best option.
3. Show ALL results — do not skip any
4. Include source platform links
5. If no results found, say so and suggest checking platforms directly
6. You MAY use the background profile for personalization (e.g., user's name, preferences)
7. You MUST NOT change the route to match the profile — the user asked for ${params.origin} → ${params.destination}, not any other route
8. Even if the profile says the user usually flies Bengaluru→Jabalpur, RIGHT NOW they asked about ${params.origin} → ${params.destination}`;

  return generateText(SYSTEM_PROMPT, userMessage, chatHistory);
}

function isGenericSearch(query: string): boolean {
  return /\b(ticket|option|availab|search|find|check|cheapest|best|suggest|give|show|get)\b/i.test(query) &&
    !/\b(flight|train|bus|plane|rail|road)\b/i.test(query);
}
