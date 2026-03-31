/**
 * SKILL: compareTravelOptions
 *
 * 1. Calls searchFlights + searchTrains + searchBuses in PARALLEL
 * 2. Collects and validates results
 * 3. Asks Gemini to compare and recommend the best option
 */

import { searchFlights } from "../tools/searchFlights.js";
import { searchTrains } from "../tools/searchTrains.js";
import { searchBuses } from "../tools/searchBuses.js";
import type { SearchResults } from "../tools/types.js";
import { generateText } from "../llm.js";

export async function compareTravelOptions(
  origin: string,
  destination: string,
  date: string,
  preferences?: { budget?: string | null; pace?: string | null }
): Promise<string> {

  // ── 1. Search all three in parallel ──
  const [flightsResult, trainsResult, busesResult] = await Promise.allSettled([
    searchFlights(origin, destination, date),
    searchTrains(origin, destination, date),
    searchBuses(origin, destination, date),
  ]);

  // ── 2. Collect results ──
  const flights = flightsResult.status === "fulfilled" ? flightsResult.value : null;
  const trains = trainsResult.status === "fulfilled" ? trainsResult.value : null;
  const buses = busesResult.status === "fulfilled" ? busesResult.value : null;

  // ── 3. Build comparison context ──
  const sections: string[] = [];
  sections.push(`ROUTE: ${origin} → ${destination}`);
  sections.push(`DATE: ${date}`);
  sections.push("");

  sections.push(formatSection("✈️ FLIGHTS", flights));
  sections.push(formatSection("🚂 TRAINS", trains));
  sections.push(formatSection("🚌 BUSES", buses));

  const comparisonData = sections.join("\n");

  // ── 4. Ask LLM to compare and recommend ──
  return generateText(
    "You are a travel comparison expert. Present results clearly with tables and a recommendation.",
    `Compare these travel options and present them in a clear format.

${comparisonData}

USER PREFERENCES:
- Budget: ${preferences?.budget || "not specified"}

FORMAT:
## 🗺️ ${origin} → ${destination} — Travel Options (${date})

### ✈️ Flights
(list each with airline, flight no, times, duration, price, platform — sorted by price)

### 🚂 Trains
(list each with train name/number, times, class, price, availability — sorted by price)

### 🚌 Buses
(list each with operator, type, times, price, rating — sorted by price)

### 🏆 Recommendation
- **Cheapest overall:** [option]
- **Fastest:** [option]
- **Best value:** [option with reasoning]

### ⚠️ Note
Prices are approximate from web search. Check platforms directly for exact prices and booking.
Include the source URLs for each mode.

If a mode has no results, say "No [flights/trains/buses] found on this route" and move on.`
  );
}

function formatSection(label: string, results: SearchResults | null): string {
  if (!results || results.results.length === 0) {
    return `${label}: No results found\n`;
  }

  const lines = results.results.map((r) =>
    `  ${r.operator} ${r.identifier} | ${r.departureTime}→${r.arrivalTime} | ${r.duration} | ${r.price} | ${r.classType} | ${r.availability} | ${r.provider}`
  );

  return `${label} (${results.results.length} options):\n${lines.join("\n")}\nSources: ${results.sources.join(", ")}\n${results.disclaimer}\n`;
}
