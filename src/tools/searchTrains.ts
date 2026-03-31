/**
 * TOOL: searchTrains
 *
 * Searches for real-time train options between two cities.
 * Uses Gemini with Google Search grounding to find actual train data
 * from platforms like IRCTC, ConfirmTkt, RailYatri.
 */

import { tool } from "ai";
import { z } from "zod";
import { generateTextWithSearch, generateJSON } from "../llm.js";
import { SearchResultsSchema, type SearchResults } from "./types.js";

export const searchTrains = tool({
  description: "Search for real-time trains between two cities on a specific date. Returns train options with names, times, classes, and prices from multiple platforms.",
  parameters: z.object({
    origin: z.string().describe("Origin city, e.g. 'Bangalore' or 'Bengaluru'"),
    destination: z.string().describe("Destination city, e.g. 'Jabalpur'"),
    date: z.string().describe("Travel date in YYYY-MM-DD format, e.g. '2026-04-01'"),
  }),
  execute: async ({ origin, destination, date }): Promise<SearchResults> => {
    const formattedDate = formatDate(date);

    // Step 1: Search the web for real train data
    const rawResults = await generateTextWithSearch(
      "You are an Indian railways search assistant. Return ONLY factual train data you find. Never fabricate train numbers or schedules.",
      `Search for trains from ${origin} to ${destination} on or around ${formattedDate}.

Find results from: IRCTC, ConfirmTkt, RailYatri, Trainman, MakeMyTrip trains.

For each train provide:
- Train name and train number
- Departure time and arrival time
- Duration
- Available classes (Sleeper, 3AC, 2AC, 1AC) with prices for each
- Availability status (Available, RAC, Waitlist)
- Which platform/source you found it on
- Number of stops or if it's a superfast/express

List ALL trains you can find on this route. Be specific with exact train numbers and times.
Today's date is ${new Date().toISOString().split("T")[0]}.`
    );

    // Step 2: Parse into structured results
    try {
      const structured = await generateJSON<SearchResults>(
        "You parse train search results into structured JSON. Only include trains with actual data. Never fabricate train numbers.",
        `Parse these train search results into the exact JSON schema. Use classType for the class (Sleeper/3AC/2AC/1AC). If multiple classes, create separate entries for each class.

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
