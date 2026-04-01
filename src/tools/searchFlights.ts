/**
 * TOOL: searchFlights
 *
 * 1. Searches Google for real flight data from multiple platforms
 * 2. Feeds ALL search snippets to Gemini to summarize flight options
 * 3. Returns the raw summary + source links for the travel agent to present
 */

import { webSearch } from "./webSearch.js";
import { generateText } from "../llm.js";
import type { SearchResults } from "./types.js";

export async function searchFlights(
  origin: string,
  destination: string,
  date: string
): Promise<SearchResults> {
  const formattedDate = formatDateForSearch(date);

  // Step 1: Search Google — cast a wide net
  const queries = [
    `${origin} to ${destination} flights ${formattedDate} price ticket`,
    `cheap flights ${origin} to ${destination} ${formattedDate}`,
  ];

  const allResults = [];
  for (const q of queries) {
    try {
      const results = await webSearch(q, 5);
      allResults.push(...results);
    } catch {
      // continue
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });

  const sources = uniqueResults.map((r) => r.link);
  const searchContext = uniqueResults
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.link}`)
    .join("\n\n");

  if (uniqueResults.length === 0) {
    return emptyResult(origin, destination, date, "No search results found.");
  }

  // Step 2: Ask Gemini to extract AND VALIDATE flight info from search snippets
  const summary = await generateText(
    `You are a flight data extractor and validator. You read web search snippets and extract ONLY genuine, verified flight results.`,
    `Here are web search results for flights from ${origin} to ${destination} on ${formattedDate}.

SEARCH RESULTS:
${searchContext}

TASK: Extract flight options. But FIRST, validate each search result:

VALIDATION RULES — reject results that:
- Are generic airport/city pages WITHOUT specific ${origin}→${destination} route pricing
- Show flights to/from a DIFFERENT city than what was asked (e.g., asked Jabalpur→Portugal but result shows Delhi→Mumbai)
- Are link-only results with no actual price or airline for THIS specific route
- Show "lowest prices" or "cheapest flights" without any actual price for ${origin}→${destination}
- Are about a completely different route even if they mention one of the cities

ONLY include results where you can see ACTUAL flight data for ${origin} → ${destination}:
- A specific airline operating this route
- A specific price for this route (not a generic "flights from ₹X" for a different route)
- Actual departure/arrival times for this route

For each VALIDATED flight, output:
FLIGHT | Airline | Price | Platform | Details

If NO search results contain genuine ${origin}→${destination} flight data, output EXACTLY:
NO_DIRECT_FLIGHTS | No direct or connecting flights found from ${origin} to ${destination}. This route may not have regular service. Consider flying from a major nearby hub (Delhi, Mumbai, Bengaluru) instead.

Be strict. It's better to return NO_DIRECT_FLIGHTS than to present fake or irrelevant results.`
  );

  // Step 3: Check for NO_DIRECT_FLIGHTS
  if (summary.includes("NO_DIRECT_FLIGHTS")) {
    // Extract the suggestion from the NO_DIRECT_FLIGHTS line
    const noFlightLine = summary.split("\n").find((l) => l.includes("NO_DIRECT_FLIGHTS"));
    const suggestion = noFlightLine?.split("|").slice(1).join("|").trim() ||
      `No direct flights found from ${origin} to ${destination}. Try a major hub like Delhi or Mumbai.`;

    return {
      mode: "flights",
      route: `${origin} → ${destination}`,
      date,
      results: [],
      sources,
      searchedAt: new Date().toISOString(),
      disclaimer: suggestion,
    };
  }

  // Step 4: Parse the FLIGHT lines
  const results = parseFlightLines(summary);

  return {
    mode: "flights",
    route: `${origin} → ${destination}`,
    date,
    results,
    sources,
    searchedAt: new Date().toISOString(),
    disclaimer: results.length > 0
      ? "Prices approximate from web search. Check platforms for exact availability."
      : `Could not find verified flight results for ${origin} → ${destination}. This route may have limited service.`,
  };
}

function parseFlightLines(text: string): SearchResults["results"] {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("FLIGHT |") || l.trim().startsWith("FLIGHT|"));
  return lines.map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    return {
      provider: parts[3] || "Unknown",
      operator: parts[1] || "Unknown",
      identifier: "",
      departureTime: "",
      arrivalTime: "",
      duration: "",
      price: parts[2] || "",
      stops: "",
      classType: "Economy",
      availability: "Check platform",
      notes: parts[4] || "",
    };
  }).filter((r) => r.price || r.operator !== "Unknown");
}

function extractFirstPrice(text: string): string | null {
  const match = text.match(/[₹$][\d,]+/);
  return match ? match[0] : null;
}

function emptyResult(origin: string, destination: string, date: string, msg: string): SearchResults {
  return {
    mode: "flights",
    route: `${origin} → ${destination}`,
    date,
    results: [],
    sources: [],
    searchedAt: new Date().toISOString(),
    disclaimer: msg,
  };
}

function formatDateForSearch(date: string): string {
  try {
    const d = new Date(date);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return date;
  }
}
