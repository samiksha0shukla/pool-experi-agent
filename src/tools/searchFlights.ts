/**
 * TOOL: searchFlights
 *
 * Searches for real-time flight options between two cities.
 * Uses Gemini with Google Search grounding to find actual flight data
 * from platforms like Google Flights, MakeMyTrip, Cleartrip.
 * Then structures the results into a validated format.
 */

import { tool } from "ai";
import { z } from "zod";
import { generateTextWithSearch, generateJSON } from "../llm.js";
import { SearchResultsSchema, type SearchResults } from "./types.js";

export const searchFlights = tool({
  description: "Search for real-time flights between two cities on a specific date. Returns flight options with airlines, times, and prices from multiple booking platforms.",
  parameters: z.object({
    origin: z.string().describe("Origin city, e.g. 'Bangalore' or 'Bengaluru'"),
    destination: z.string().describe("Destination city, e.g. 'Jabalpur'"),
    date: z.string().describe("Travel date in YYYY-MM-DD format, e.g. '2026-04-01'"),
  }),
  execute: async ({ origin, destination, date }): Promise<SearchResults> => {
    const formattedDate = formatDate(date);

    // Step 1: Search the web for real flight data
    const rawResults = await generateTextWithSearch(
      "You are a flight search assistant. Return ONLY factual flight data you find. Never fabricate flights.",
      `Search for flights from ${origin} to ${destination} on ${formattedDate}.

Find results from multiple platforms: Google Flights, MakeMyTrip, Cleartrip, EaseMyTrip, Ixigo.

For each flight provide:
- Airline name and flight number
- Departure time and arrival time
- Duration
- Number of stops (0 = direct)
- Price in INR
- Which platform/source you found it on
- Class (Economy/Business)
- Availability if mentioned

List ALL flights you can find. Be specific with exact times and prices.
Today's date is ${new Date().toISOString().split("T")[0]}.`
    );

    // Step 2: Parse into structured results
    try {
      const structured = await generateJSON<SearchResults>(
        "You parse flight search results into structured JSON. Only include flights with actual price and time data. Never fabricate data.",
        `Parse these flight search results into the exact JSON schema. If a field is unclear, make your best estimate but mark it in notes.

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
      // If structured parsing fails, return raw as a single result
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
