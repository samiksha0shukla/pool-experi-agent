import { z } from "zod";
import { analyzeImageJSON, extractOCR } from "../llm.js";
import type { ScreenshotMeta } from "../knowledge/types.js";

// ── Schema for vision analysis output ──

const UserFactSchema = z.object({
  fact: z.string().describe("Fact type: name, location, music_platform, liked_artist, genre_preference, travel_interest, food_preference, etc."),
  value: z.string().describe("The actual value extracted"),
  evidence: z.string().describe("What in the screenshot proves this fact"),
  confidence: z.number().min(0).max(1).describe("Confidence: 0.0 to 1.0"),
});

const SongSchema = z.object({
  title: z.string(),
  artist: z.string(),
});

const EntitiesSchema = z.object({
  // Music
  platform: z.string().optional().describe("Streaming platform: Spotify, YouTube Music, Apple Music, etc."),
  songs: z.array(SongSchema).optional().describe("Songs visible in the screenshot"),
  artists: z.array(z.string()).optional().describe("Artist names visible"),
  album: z.string().optional().describe("Album name if visible"),
  playlistName: z.string().optional().describe("Playlist name if visible"),
  genres: z.array(z.string()).optional().describe("Music genres visible or inferable"),
  // Travel — CRITICAL: for flights, origin = where user flies FROM, destination = where user flies TO
  origin: z.string().optional().describe("The city the user is DEPARTING FROM. For flights this is the departure city (the user's home). Must be a single city name like 'Bengaluru'."),
  destination: z.string().optional().describe("The city the user is TRAVELING TO — their actual travel destination. Must be a single city name like 'Jabalpur' or 'Tokyo'. NEVER a route like 'X to Y'. NEVER a sentence. Just the destination city name."),
  hotel: z.string().optional().describe("Hotel name"),
  airline: z.string().optional().describe("Airline name"),
  dates: z.string().optional().describe("Travel dates"),
  price: z.string().optional().describe("Price or price range"),
  activity: z.string().optional().describe("Activity or attraction"),
  // Food
  restaurant: z.string().optional().describe("Restaurant name"),
  cuisine: z.string().optional().describe("Cuisine type"),
  // Shopping
  productName: z.string().optional().describe("Product name"),
  brand: z.string().optional().describe("Brand name"),
  // General
  personName: z.string().optional().describe("Person's name visible"),
  location: z.string().optional().describe("Location visible"),
  date: z.string().optional().describe("Date visible"),
  url: z.string().optional().describe("URL visible in screenshot"),
}).passthrough();

const ScreenshotAnalysisSchema = z.object({
  summary: z.string().describe("One-line summary of the screenshot (max 100 chars)"),
  detailedDescription: z.string().describe("Detailed 3-5 sentence description covering everything visible in the screenshot — all text, UI elements, content, context, colors, layout. Be thorough."),
  sourceApp: z.string().describe("Which app or website this screenshot is from. Examples: Spotify, YouTube Music, Apple Music, Instagram, Google Flights, Booking.com, WhatsApp, Safari, Chrome, Settings, unknown. Detect from UI elements, logos, color schemes, navigation bars."),
  category: z.enum(["music", "travel", "food", "shopping", "personal", "other"]),
  entities: EntitiesSchema,
  user_facts: z.array(UserFactSchema).describe("Facts about the user directly visible in the screenshot"),
});

export type ScreenshotAnalysis = z.infer<typeof ScreenshotAnalysisSchema>;
export type UserFact = z.infer<typeof UserFactSchema>;

// ── The analysis prompt ──

const ANALYSIS_PROMPT = `Analyze this screenshot thoroughly. Extract ALL structured information from it.

You must provide:

1. **summary**: A short one-line summary (under 100 characters).

2. **detailedDescription**: A thorough 3-5 sentence description of EVERYTHING visible in the screenshot. Include:
   - What app/website it's from and how you can tell (UI elements, logos, colors)
   - All visible text, numbers, names, titles
   - The layout and what sections are shown
   - Any actionable information (dates, prices, locations, contact info)
   - The context: what is the user doing or looking at?
   Be specific — mention exact text, exact numbers, exact names. Don't be vague.

3. **sourceApp**: Identify which app or website this screenshot is from. Look at:
   - App navigation bars, status bars, icons
   - Color schemes (Spotify = green/black, Instagram = gradient, YouTube Music = red)
   - UI patterns (bottom nav tabs, player controls, search bars)
   - Logos, watermarks, branding
   - URL bars if visible
   Return the app name: "Spotify", "YouTube Music", "Apple Music", "Instagram", "Google Flights", "Booking.com", "WhatsApp", "Safari", "Chrome", "Google Maps", "Amazon", "Flipkart", etc.
   If you truly cannot identify it, return "unknown".

4. **category**: music, travel, food, shopping, personal, or other.

5. **entities**: Extract ALL named entities relevant to the category.

   FLIGHT SCREENSHOTS — CRITICAL:
   When you see a flight search (Google Flights, Skyscanner, MakeMyTrip, etc.) showing "City A → City B":
   - origin = City A (the departure city — likely the user's home)
   - destination = City B (where the user wants to go)
   - destination must be a SINGLE city name like "Jabalpur" — never a route like "X to Y", never a sentence
   - For return flights (City B → City A): destination is still City B (the place they're visiting)
   - The origin is the user's HOME CITY, not a travel interest

6. **user_facts**: What can we learn about the phone's OWNER from this screenshot? Look for:
   - Their name (tickets, boarding passes, profiles, login screens)
   - Their music platform preference (which music app?)
   - Their music taste (genres, artists they follow/listen to)
   - Their travel interests (destinations they're searching)
   - Their home city (flight origins, delivery addresses)
   - Their food preferences (cuisine types they browse)
   - Their language preference (app language, content language)

RULES:
- Be factual. Only extract what is VISIBLE.
- Never guess or hallucinate information not shown.
- For the detailed description: be exhaustive. Mention every piece of visible text and data.
- Confidence: 0.9+ = clearly readable, 0.7-0.9 = partially visible, 0.5-0.7 = inferred from context.
- Below 0.5 confidence = don't include in user_facts.`;

// ── Run OCR + analysis on a screenshot ──

export interface AnalysisResult {
  analysis: ScreenshotAnalysis;
  ocrText: string;
}

export async function analyzeScreenshot(
  screenshotPath: string
): Promise<AnalysisResult> {
  // Step 1: Extract raw text via OCR
  const ocrText = await extractOCR(screenshotPath);

  // Step 2: Run structured analysis with OCR text as additional context
  const enhancedPrompt = ocrText.trim()
    ? `${ANALYSIS_PROMPT}\n\n── OCR TEXT EXTRACTED FROM THIS IMAGE ──\nUse this raw text to improve your analysis accuracy. It contains every visible word in the screenshot:\n\n${ocrText}`
    : ANALYSIS_PROMPT;

  const analysis = await analyzeImageJSON<ScreenshotAnalysis>(
    screenshotPath,
    enhancedPrompt,
    ScreenshotAnalysisSchema
  );

  return { analysis, ocrText };
}

// ── Apply analysis results to screenshot metadata ──

export function applyAnalysis(
  meta: ScreenshotMeta,
  result: AnalysisResult
): ScreenshotMeta {
  const { analysis, ocrText } = result;
  return {
    ...meta,
    analyzed: true,
    analyzedAt: new Date().toISOString(),
    sourceApp: analysis.sourceApp,
    category: analysis.category,
    summary: analysis.summary,
    detailedDescription: analysis.detailedDescription,
    ocrText: ocrText || undefined,
    entities: analysis.entities,
    userFacts: analysis.user_facts,
  } as ScreenshotMeta;
}
