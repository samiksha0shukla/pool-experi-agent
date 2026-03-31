/**
 * Tool registry — exports all tools as plain async functions.
 */

export { searchFlights } from "./searchFlights.js";
export { searchTrains } from "./searchTrains.js";
export { searchBuses } from "./searchBuses.js";
export { webSearch } from "./webSearch.js";
export type { TransportResult, SearchResults, TravelParams } from "./types.js";
