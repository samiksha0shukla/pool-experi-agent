/**
 * TOOL: searchTrains
 *
 * 1. Searches Google for real train data from IRCTC, ConfirmTkt, RailYatri
 * 2. Feeds ALL search snippets to Gemini to extract train options
 * 3. Returns results + source links
 */

import { webSearch } from "./webSearch.js";
import { generateText } from "../llm.js";
import type { SearchResults } from "./types.js";

export async function searchTrains(
  origin: string,
  destination: string,
  date: string
): Promise<SearchResults> {
  const formattedDate = formatDateForSearch(date);

  const queries = [
    `${origin} to ${destination} train schedule IRCTC fare price`,
    `${origin} to ${destination} train ${formattedDate} ticket availability`,
    `${origin} ${destination} train number timing price`,
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
    return emptyResult(origin, destination, date, "No train results found.");
  }

  const summary = await generateText(
    "You extract and validate Indian railway train information from web search snippets. Be strict — only include verified results.",
    `Here are web search results for trains from ${origin} to ${destination} on/around ${formattedDate}.

SEARCH RESULTS:
${searchContext}

VALIDATION — only include results where:
- The search result is specifically about ${origin} → ${destination} train route
- There's an actual train name/number, price, or timing for THIS route
- NOT generic railway pages that just mention one of the cities

For each VALIDATED train, output:
TRAIN | Train Name & Number | Price/Fare | Class | Departure→Arrival | Duration | Platform

If NO results contain genuine ${origin}→${destination} train data, output:
NO_TRAINS | No trains found on the ${origin} to ${destination} route. This route may not have direct train service.

Be strict. Don't extract data from results about different routes.`
  );

  if (summary.includes("NO_TRAINS")) {
    const suggestion = summary.split("\n").find((l) => l.includes("NO_TRAINS"))?.split("|").slice(1).join("|").trim() ||
      `No trains found for ${origin} → ${destination}.`;
    return emptyResult(origin, destination, date, suggestion);
  }

  const results = parseLines(summary);

  if (results.length === 0 && summary.length > 10) {
    return {
      mode: "trains",
      route: `${origin} → ${destination}`,
      date,
      results: [{
        provider: "Multiple platforms",
        operator: "Indian Railways",
        identifier: "",
        departureTime: "",
        arrivalTime: "",
        duration: "",
        price: extractFirstPrice(summary) || "Check IRCTC",
        stops: "",
        classType: "Various",
        availability: "Check IRCTC",
        notes: summary.slice(0, 400),
      }],
      sources,
      searchedAt: new Date().toISOString(),
      disclaimer: "Check IRCTC for exact availability and booking.",
    };
  }

  return {
    mode: "trains",
    route: `${origin} → ${destination}`,
    date,
    results,
    sources,
    searchedAt: new Date().toISOString(),
    disclaimer: "Train data from web search. Check IRCTC for exact availability and waitlist status.",
  };
}

function parseLines(text: string): SearchResults["results"] {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("TRAIN |") || l.trim().startsWith("TRAIN|"));
  return lines.map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    // TRAIN | Name & Number | Price | Class | Dep→Arr | Duration | Platform
    const timeParts = (parts[4] || "").split("→");
    return {
      provider: parts[6] || "IRCTC",
      operator: parts[1] || "Unknown",
      identifier: "",
      departureTime: timeParts[0]?.trim() || "",
      arrivalTime: timeParts[1]?.trim() || "",
      duration: parts[5] || "",
      price: parts[2] || "",
      stops: "",
      classType: parts[3] || "Various",
      availability: "Check IRCTC",
      notes: "",
    };
  }).filter((r) => r.operator !== "Unknown" || r.price);
}

function extractFirstPrice(text: string): string | null {
  const match = text.match(/[₹][\d,]+/);
  return match ? match[0] : null;
}

function emptyResult(origin: string, destination: string, date: string, msg: string): SearchResults {
  return { mode: "trains", route: `${origin} → ${destination}`, date, results: [], sources: [], searchedAt: new Date().toISOString(), disclaimer: msg };
}

function formatDateForSearch(date: string): string {
  try {
    return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  } catch { return date; }
}
