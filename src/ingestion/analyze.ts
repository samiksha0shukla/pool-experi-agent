import { z } from "zod";
import { analyzeImageJSON } from "../llm.js";
import type { ScreenshotMeta } from "../store.js";

// ── Schema for vision analysis output ──

const UserFactSchema = z.object({
  fact: z.string().describe("What kind of fact: name, location, music_platform, liked_artist, genre_preference, travel_interest, food_preference, etc."),
  value: z.string().describe("The actual value extracted"),
  evidence: z.string().describe("What in the screenshot proves this fact"),
  confidence: z.number().min(0).max(1).describe("How confident: 0.0 to 1.0"),
});

const ScreenshotAnalysisSchema = z.object({
  description: z.string().describe("One-line human description of what this screenshot shows"),
  category: z.enum(["music", "travel", "food", "shopping", "personal", "other"]),
  entities: z.record(z.unknown()).describe("Extracted entities: for music = songs/artists/album/platform, for travel = destination/hotel/dates/prices, etc."),
  user_facts: z.array(UserFactSchema).describe("Facts about the user directly visible in the screenshot"),
});

export type ScreenshotAnalysis = z.infer<typeof ScreenshotAnalysisSchema>;
export type UserFact = z.infer<typeof UserFactSchema>;

// ── The analysis prompt (from architecture doc) ──

const ANALYSIS_PROMPT = `Analyze this screenshot. Extract structured information from it.

Focus on:
- What the screenshot shows (description)
- Category: is this music, travel, food, shopping, personal, or other?
- Entities: extract ALL relevant named entities visible
  - For music: song names, artist names, album names, playlist names, streaming platform (Spotify/YouTube Music/Apple Music/etc.)
  - For travel: destination, hotel name, flight details, dates, prices, airlines, activities
  - For food: restaurant name, cuisine type, location, price range
  - For personal: names visible, locations, dates
  - For other: whatever is relevant
- User facts: what can we learn about the OWNER of this phone from this screenshot?
  - Their name (from tickets, boarding passes, app profiles)
  - Their music platform (which app is this screenshot from?)
  - Their music taste (what genres/artists are visible?)
  - Their travel interests (what destinations are they looking at?)
  - Their location (what city are they in or from?)
  - Their food preferences (what cuisine are they browsing?)

RULES:
- Be factual. Only extract what is VISIBLE in the screenshot.
- Never guess or assume facts that aren't directly evidenced.
- For music: ALWAYS note which platform the screenshot is from if visible.
- For travel: ALWAYS extract destination, dates, and prices if visible.
- Confidence scoring: 0.9+ = clearly visible text/data, 0.7-0.9 = visible but partially obscured, 0.5-0.7 = inferred from context.
- Below 0.5 confidence = don't include.`;

// ── Run analysis on a screenshot ──

export async function analyzeScreenshot(
  screenshotPath: string
): Promise<ScreenshotAnalysis> {
  const analysis = await analyzeImageJSON<ScreenshotAnalysis>(
    screenshotPath,
    ANALYSIS_PROMPT,
    ScreenshotAnalysisSchema
  );
  return analysis;
}

// ── Update screenshot metadata with analysis results ──

export function applyAnalysis(
  meta: ScreenshotMeta,
  analysis: ScreenshotAnalysis
): ScreenshotMeta {
  return {
    ...meta,
    description: analysis.description,
    category: analysis.category,
    entities: analysis.entities,
    analyzed: true,
  };
}
