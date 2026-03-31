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

  // Step 2: Ask Gemini to extract flight info from the search snippets
  const summary = await generateText(
    `You are a flight data extractor. You read web search snippets and extract every piece of flight information you can find.`,
    `Here are web search results for flights from ${origin} to ${destination} on ${formattedDate}.

SEARCH RESULTS:
${searchContext}

From these search snippets, extract EVERY flight option or price you can find. For each, list:
- Airline (IndiGo, Air India, SpiceJet, Vistara, etc.) — if mentioned
- Price — exact if available, or range
- Platform (which website: MakeMyTrip, Yatra, ixigo, Cleartrip, Expedia, Skyscanner)
- Any times, flight numbers, or duration if mentioned
- Any offers or discounts mentioned

Format each as:
FLIGHT | Airline | Price | Platform | Details

Examples:
FLIGHT | IndiGo | ₹5,567 | ixigo | Departing 06:55, cheapest option on Apr 1
FLIGHT | Multiple Airlines | from ₹4,816 | Yatra | Lowest fare available
FLIGHT | IndiGo/SpiceJet | $55-56 | Expedia | Multiple options available

Extract EVERYTHING you can see — even partial info is useful. Include every platform and every price point mentioned.
If a snippet mentions a price or airline, include it. Don't skip anything.`
  );

  // Step 3: Parse the FLIGHT lines
  const results = parseFlightLines(summary);

  // If Gemini couldn't parse into lines, store the raw summary as a single result
  if (results.length === 0 && summary.length > 10) {
    return {
      mode: "flights",
      route: `${origin} → ${destination}`,
      date,
      results: [{
        provider: "Multiple platforms",
        operator: "Various airlines",
        identifier: "",
        departureTime: "",
        arrivalTime: "",
        duration: "",
        price: extractFirstPrice(summary) || "See sources",
        stops: "",
        classType: "Economy",
        availability: "Check platforms",
        notes: summary.slice(0, 300),
      }],
      sources,
      searchedAt: new Date().toISOString(),
      disclaimer: "Data from web search. Check platforms for exact prices and booking.",
    };
  }

  return {
    mode: "flights",
    route: `${origin} → ${destination}`,
    date,
    results,
    sources,
    searchedAt: new Date().toISOString(),
    disclaimer: "Prices approximate from web search. Check platforms for exact availability.",
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
