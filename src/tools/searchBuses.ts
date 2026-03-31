/**
 * TOOL: searchBuses
 *
 * Searches for real-time bus options between two cities.
 * Uses Gemini with Google Search grounding to find actual bus data
 * from platforms like RedBus, AbhiBus, MakeMyTrip.
 */

import { tool } from "ai";
import { z } from "zod";
import { generateTextWithSearch, generateJSON } from "../llm.js";
import { SearchResultsSchema, type SearchResults } from "./types.js";

export const searchBuses = tool({
  description: "Search for real-time buses between two cities on a specific date. Returns bus options with operators, times, types, and prices from multiple platforms.",
  parameters: z.object({
    origin: z.string().describe("Origin city, e.g. 'Bangalore' or 'Bengaluru'"),
    destination: z.string().describe("Destination city, e.g. 'Jabalpur'"),
    date: z.string().describe("Travel date in YYYY-MM-DD format, e.g. '2026-04-01'"),
  }),
  execute: async ({ origin, destination, date }): Promise<SearchResults> => {
    const formattedDate = formatDate(date);

    // Step 1: Search the web for real bus data
    const rawResults = await generateTextWithSearch(
      "You are a bus search assistant for India. Return ONLY factual bus data you find. Never fabricate operators or schedules.",
      `Search for buses from ${origin} to ${destination} on ${formattedDate}.

Find results from: RedBus, AbhiBus, MakeMyTrip buses, Goibibo buses.

For each bus provide:
- Bus operator name
- Bus type (Sleeper, Semi-Sleeper, AC, Non-AC, Volvo, etc.)
- Departure time and arrival time
- Duration
- Price in INR
- Seat availability
- Which platform/source you found it on
- Seat type (seater/sleeper)
- Rating if available

List ALL buses you can find on this route. Be specific with exact times and prices.
Today's date is ${new Date().toISOString().split("T")[0]}.`
    );

    // Step 2: Parse into structured results
    try {
      const structured = await generateJSON<SearchResults>(
        "You parse bus search results into structured JSON. Only include buses with actual data. Never fabricate operators.",
        `Parse these bus search results into the exact JSON schema. Use classType for the bus type (AC Sleeper, Volvo, Semi-Sleeper, etc.).

RAW SEARCH RESULTS:
${rawResults}

SEARCH CONTEXT:
- Route: ${origin} → ${destination}
- Date: ${formattedDate}
- Searched on: ${new Date().toISOString()}`,
        SearchResultsSchema
      );
      return structured;
    } catch {
      return {
        results: [],
        searchedOn: new Date().toISOString(),
        disclaimer: `Could not structure results. Raw data: ${rawResults.slice(0, 500)}`,
      };
    }
  },
});

function formatDate(date: string): string {
  try {
    const d = new Date(date);
    return d.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return date;
  }
}
