/**
 * SKILL: compareTravelOptions
 *
 * Higher-level capability that:
 * 1. Calls all 3 transport tools (flights, trains, buses) in parallel
 * 2. Validates and filters results
 * 3. Asks the LLM to compare and recommend the best options
 *
 * This is NOT a tool the LLM calls — it's a function the orchestrator
 * invokes directly when it detects a comparison query.
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

  // ── 1. Search all three transport modes in parallel ──
  const [flightsResult, trainsResult, busesResult] = await Promise.allSettled([
    searchFlights.execute({ origin, destination, date }, { toolCallId: "flights", messages: [] }),
    searchTrains.execute({ origin, destination, date }, { toolCallId: "trains", messages: [] }),
    searchBuses.execute({ origin, destination, date }, { toolCallId: "buses", messages: [] }),
  ]);

  // ── 2. Collect results, handle failures gracefully ──
  const flights = flightsResult.status === "fulfilled" ? flightsResult.value as SearchResults : null;
  const trains = trainsResult.status === "fulfilled" ? trainsResult.value as SearchResults : null;
  const buses = busesResult.status === "fulfilled" ? busesResult.value as SearchResults : null;

  // ── 3. Build comparison context ──
  const sections: string[] = [];

  sections.push(`ROUTE: ${origin} → ${destination}`);
  sections.push(`DATE: ${date}`);
  sections.push(`SEARCHED ON: ${new Date().toISOString()}`);
  sections.push("");

  if (flights && flights.results.length > 0) {
    sections.push(`✈️ FLIGHTS FOUND (${flights.results.length}):`);
    for (const f of flights.results) {
      sections.push(`  ${f.operator} ${f.identifier} | ${f.departureTime}→${f.arrivalTime} | ${f.duration} | ₹${f.price} | ${f.stops === 0 ? "Direct" : f.stops + " stop(s)"} | ${f.provider} | ${f.classType || "Economy"}`);
    }
    sections.push(`  Source: ${flights.disclaimer}`);
  } else {
    const reason = flightsResult.status === "rejected" ? flightsResult.reason : "No flights found";
    sections.push(`✈️ FLIGHTS: ${reason}`);
  }

  sections.push("");

  if (trains && trains.results.length > 0) {
    sections.push(`🚂 TRAINS FOUND (${trains.results.length}):`);
    for (const t of trains.results) {
      sections.push(`  ${t.operator} ${t.identifier} | ${t.departureTime}→${t.arrivalTime} | ${t.duration} | ₹${t.price} | ${t.classType || "Sleeper"} | ${t.seatsAvailable || "?"} | ${t.provider}`);
    }
    sections.push(`  Source: ${trains.disclaimer}`);
  } else {
    const reason = trainsResult.status === "rejected" ? trainsResult.reason : "No trains found";
    sections.push(`🚂 TRAINS: ${reason}`);
  }

  sections.push("");

  if (buses && buses.results.length > 0) {
    sections.push(`🚌 BUSES FOUND (${buses.results.length}):`);
    for (const b of buses.results) {
      sections.push(`  ${b.operator} | ${b.departureTime}→${b.arrivalTime} | ${b.duration} | ₹${b.price} | ${b.classType || "Standard"} | ${b.provider}`);
    }
    sections.push(`  Source: ${buses.disclaimer}`);
  } else {
    const reason = busesResult.status === "rejected" ? busesResult.reason : "No buses found";
    sections.push(`🚌 BUSES: ${reason}`);
  }

  const comparisonData = sections.join("\n");

  // ── 4. Ask LLM to compare and recommend ──
  const response = await generateText(
    `You are a travel comparison expert. Present search results in a clear, structured way.`,
    `Compare these travel options and present them clearly.

${comparisonData}

USER PREFERENCES:
- Budget style: ${preferences?.budget || "not specified"}
- Travel pace: ${preferences?.pace || "not specified"}

FORMAT YOUR RESPONSE AS:
## 🗺️ Travel Options: ${origin} → ${destination} (${date})

### ✈️ Flights
(table or list of flight options sorted by price, with airline, times, duration, price, platform)

### 🚂 Trains
(table or list of train options sorted by price, with train name/number, times, class, price, platform)

### 🚌 Buses
(table or list of bus options sorted by price, with operator, type, times, price, platform)

### 🏆 Recommendation
Pick the best overall option and explain why. Consider: price, duration, comfort, convenience.
Also pick the cheapest option across all modes.

### ⚠️ Note
Add a disclaimer that prices are approximate and may vary. Suggest checking the platforms directly for booking.

If any transport mode has no results, say so and suggest alternatives.`
  );

  return response;
}
