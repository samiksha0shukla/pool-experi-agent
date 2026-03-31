/**
 * TRAVEL AGENT — Sub-agent of the Orchestrator
 *
 * Two modes:
 * 1. Profile-based (useSearch=false): answers from screenshot/profile data
 * 2. Search-based (useSearch=true): calls search tools, then formats results
 */

import { generateText, type ChatMessage } from "../llm.js";
import { searchFlights } from "../tools/searchFlights.js";
import { searchTrains } from "../tools/searchTrains.js";
import { searchBuses } from "../tools/searchBuses.js";
import type { SearchResults, TravelParams } from "../tools/types.js";

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

RULES:
- NEVER give an itinerary unless explicitly asked
- When search results are provided, present ALL of them, don't skip any
- Never fabricate data
- Use ₹ for Indian routes, $ for international
- Respect dietary restrictions
- CRITICAL: If the user asks about a specific route (e.g., "Delhi to Jabalpur"), ALWAYS use that route — even if their profile shows a different route. The user's explicit query ALWAYS overrides the profile. Never substitute a profile route for what the user actually asked.`;

export async function runTravelAgent(
  query: string,
  travelContext: string,
  chatHistory?: ChatMessage[],
  useSearch?: boolean,
  travelParams?: TravelParams
): Promise<string> {

  if (useSearch && travelParams) {
    // ── SEARCH MODE: Call tools, then format results ──
    return await searchAndRespond(query, travelContext, travelParams, chatHistory);
  }

  // ── PROFILE MODE: Answer from profile/screenshot data ──
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

  // Search in parallel — only the modes the user asked about
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
    const label = labels[i].toUpperCase();
    const result = settled[i];

    if (result.status === "fulfilled" && result.value.results.length > 0) {
      const sr = result.value;
      resultSections.push(`${label} (${sr.results.length} options found):`);
      for (const r of sr.results) {
        resultSections.push(`  ${r.operator} ${r.identifier} | ${r.departureTime}→${r.arrivalTime} | ${r.duration} | ${r.price} | ${r.classType} | ${r.provider}`);
      }
      resultSections.push(`  Sources: ${sr.sources.join(", ")}`);
      resultSections.push(`  ${sr.disclaimer}`);
    } else {
      const reason = result.status === "rejected" ? result.reason?.message || "Search failed" : "No results found";
      resultSections.push(`${label}: ${reason}`);
    }
    resultSections.push("");
  }

  const searchData = resultSections.join("\n");

  // Pass profile context and chat history BUT make the explicit query + search results dominate
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
  // Generic searches like "search tickets", "find options", "check availability", "suggest options" → search all modes
  return /\b(ticket|option|availab|search|find|check|cheapest|best|suggest|give|show|get)\b/i.test(query) &&
    !/\b(flight|train|bus|plane|rail|road)\b/i.test(query);
}
