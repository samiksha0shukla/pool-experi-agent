/**
 * Shared types for all transport search tools.
 * Every tool returns results in this standard shape.
 */

import { z } from "zod";

// ── Base transport result ──

export const TransportResultSchema = z.object({
  provider: z.string().describe("Booking platform: MakeMyTrip, IRCTC, RedBus, Google Flights, Cleartrip, etc."),
  operator: z.string().describe("Airline name, train name, or bus operator"),
  identifier: z.string().describe("Flight number like 6E-245, train number like 12649, or bus ID"),
  departureTime: z.string().describe("Departure time like '06:15 AM'"),
  arrivalTime: z.string().describe("Arrival time like '08:30 AM'"),
  duration: z.string().describe("Total duration like '2h 15m'"),
  price: z.number().describe("Price in INR"),
  currency: z.string().default("INR"),
  stops: z.number().describe("0 = direct, 1 = one stop, etc."),
  classType: z.string().optional().describe("Economy, Business, Sleeper, 3AC, etc."),
  seatsAvailable: z.string().optional().describe("Seats/berths available or 'Available'/'Waitlist'"),
  notes: z.string().optional().describe("Any extra info like refundable, meal included, etc."),
});

export type TransportResult = z.infer<typeof TransportResultSchema>;

// ── Search results wrapper ──

export const SearchResultsSchema = z.object({
  results: z.array(TransportResultSchema).describe("List of transport options found"),
  searchedOn: z.string().describe("ISO timestamp of when search was performed"),
  disclaimer: z.string().describe("Note about data freshness — e.g., 'Prices are approximate and may vary'"),
});

export type SearchResults = z.infer<typeof SearchResultsSchema>;

// ── Travel params extracted from user query ──

export const TravelParamsSchema = z.object({
  origin: z.string().describe("Departure city"),
  destination: z.string().describe("Arrival city"),
  date: z.string().describe("Travel date in YYYY-MM-DD format"),
  returnDate: z.string().optional().describe("Return date if round trip"),
  passengers: z.number().default(1).describe("Number of passengers"),
});

export type TravelParams = z.infer<typeof TravelParamsSchema>;
