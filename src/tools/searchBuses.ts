/**
 * TOOL: searchBuses
 *
 * 1. Searches Google for real bus data from RedBus, AbhiBus, MakeMyTrip
 * 2. Feeds ALL search snippets to Gemini to extract bus options
 * 3. Returns results + source links
 */

import { webSearch } from "./webSearch.js";
import { generateText } from "../llm.js";
import type { SearchResults } from "./types.js";

export async function searchBuses(
  origin: string,
  destination: string,
  date: string
): Promise<SearchResults> {
  const formattedDate = formatDateForSearch(date);

  const queries = [
    `${origin} to ${destination} bus ${formattedDate} RedBus price ticket`,
    `${origin} to ${destination} bus booking ${formattedDate} operators fare`,
    `${origin} ${destination} bus ticket price sleeper AC`,
  ];

  const allResults = [];
  for (const q of queries) {
    try {
      const results = await webSearch(q, 5);
      allResults.push(...results);
    } catch { /* continue */ }
  }

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
    return emptyResult(origin, destination, date, "No bus results found.");
  }

  const summary = await generateText(
    "You extract bus travel information from web search snippets. Be factual — extract every operator, price, bus type you can find.",
    `Here are web search results for buses from ${origin} to ${destination} on/around ${formattedDate}.

SEARCH RESULTS:
${searchContext}

Extract EVERY bus option mentioned. For each, provide ONE LINE:
BUS | Operator Name | Price | Bus Type | Departure→Arrival | Duration | Platform

Examples:
BUS | VRL Travels | ₹1,200 | AC Sleeper | 20:00→10:30+1 | 14h 30m | RedBus
BUS | SRS Travels | ₹1,500 | Volvo Multi-Axle | 21:30→11:00+1 | 13h 30m | AbhiBus
BUS | Multiple operators | from ₹800 | Various | Multiple departures | 12-16h | RedBus
BUS | KSRTC | ₹950 | Non-AC Sleeper | 19:00→09:00+1 | 14h | MakeMyTrip

Rules:
- Extract every operator name and price you see
- If you see "X buses starting from ₹Y", include that
- Include bus types (AC, Non-AC, Sleeper, Semi-Sleeper, Volvo, etc.)
- Include ratings if mentioned (e.g., 4.2★)
- Don't skip any bus mention. Every data point counts.
- Do NOT fabricate operators — only use what's in the snippets`
  );

  const results = parseLines(summary);

  if (results.length === 0 && summary.length > 10) {
    return {
      mode: "buses",
      route: `${origin} → ${destination}`,
      date,
      results: [{
        provider: "Multiple platforms",
        operator: "Various operators",
        identifier: "",
        departureTime: "",
        arrivalTime: "",
        duration: "",
        price: extractFirstPrice(summary) || "Check RedBus",
        stops: "",
        classType: "Various",
        availability: "Check platform",
        notes: summary.slice(0, 400),
      }],
      sources,
      searchedAt: new Date().toISOString(),
      disclaimer: "Check RedBus/AbhiBus for exact availability.",
    };
  }

  return {
    mode: "buses",
    route: `${origin} → ${destination}`,
    date,
    results,
    sources,
    searchedAt: new Date().toISOString(),
    disclaimer: "Bus data from web search. Check platforms for exact seat availability and prices.",
  };
}

function parseLines(text: string): SearchResults["results"] {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("BUS |") || l.trim().startsWith("BUS|"));
  return lines.map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    // BUS | Operator | Price | Type | Dep→Arr | Duration | Platform
    const timeParts = (parts[4] || "").split("→");
    return {
      provider: parts[6] || "RedBus",
      operator: parts[1] || "Unknown",
      identifier: "",
      departureTime: timeParts[0]?.trim() || "",
      arrivalTime: timeParts[1]?.trim() || "",
      duration: parts[5] || "",
      price: parts[2] || "",
      stops: "",
      classType: parts[3] || "Standard",
      availability: "Check platform",
      notes: "",
    };
  }).filter((r) => r.operator !== "Unknown" || r.price);
}

function extractFirstPrice(text: string): string | null {
  const match = text.match(/[₹][\d,]+/);
  return match ? match[0] : null;
}

function emptyResult(origin: string, destination: string, date: string, msg: string): SearchResults {
  return { mode: "buses", route: `${origin} → ${destination}`, date, results: [], sources: [], searchedAt: new Date().toISOString(), disclaimer: msg };
}

function formatDateForSearch(date: string): string {
  try {
    return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  } catch { return date; }
}
