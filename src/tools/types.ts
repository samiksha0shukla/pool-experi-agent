/**
 * Shared types for all transport search tools.
 */

export interface TransportResult {
  provider: string;        // MakeMyTrip, IRCTC, RedBus, etc.
  operator: string;        // Airline, train name, bus operator
  identifier: string;      // Flight number, train number
  departureTime: string;   // "06:15 AM"
  arrivalTime: string;     // "08:30 AM"
  duration: string;        // "2h 15m"
  price: string;           // "₹4,500" — kept as string to preserve currency symbol
  stops: string;           // "Direct" or "1 stop"
  classType: string;       // Economy, 3AC, AC Sleeper, etc.
  availability: string;    // Available, Waitlist, etc.
  notes: string;           // Refundable, meal included, etc.
}

export interface SearchResults {
  mode: "flights" | "trains" | "buses";
  route: string;           // "Bangalore → Jabalpur"
  date: string;
  results: TransportResult[];
  sources: string[];       // URLs searched
  searchedAt: string;      // ISO timestamp
  disclaimer: string;
}

export interface TravelParams {
  origin: string;
  destination: string;
  date: string;            // YYYY-MM-DD
}
