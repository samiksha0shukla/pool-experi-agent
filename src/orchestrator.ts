/**
 * ORCHESTRATOR — The Main Agent
 *
 * The orchestrator does NOT solve anything itself. Its job:
 * 1. Load user profile
 * 2. Load screenshot context
 * 3. Classify intent (music / travel / profile / general) via LLM
 * 4. Build focused context for the target agent
 * 5. Route to the correct sub-agent
 * 6. Return the response
 * 7. Update profile from conversation
 *
 * It's a manager, not a worker.
 */

import chalk from "chalk";
import { z } from "zod";
import {
  log,
  logStep,
  startSpinner,
  stopSpinner,
} from "./logger.js";
import {
  getProfile,
  getScreenshots,
  getRecentConversations,
  type UserProfile,
  type ScreenshotMeta,
  type Conversation,
} from "./store.js";
import { isConfigured, generateText, generateJSON, type ChatMessage } from "./llm.js";
import { runMusicAgent } from "./agents/musicAgent.js";
import { runTravelAgent } from "./agents/travelAgent.js";
import { runProfileAgent } from "./agents/profileAgent.js";
import { runGeneralQuery } from "./agents/generalAgent.js";
import { compareTravelOptions } from "./skills/compareTravelOptions.js";
import type { TravelParams } from "./tools/types.js";
import { updateProfileFromConversation } from "./ingestion/profileUpdater.js";

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

export type Intent = "music" | "travel" | "profile" | "general";

export interface OrchestratorResult {
  intent: Intent;
  response: string;
  profileUpdated: boolean;
  factsExtracted: number;
}

// ══════════════════════════════════════════════════════════════
// INTENT CLASSIFICATION
// ══════════════════════════════════════════════════════════════

const IntentSchema = z.object({
  intent: z.enum(["music", "travel", "profile", "general"]),
  reasoning: z.string().describe("Brief explanation of why this category was chosen"),
});

// ══════════════════════════════════════════════════════════════
// CONVERSATION HISTORY
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// REAL-TIME SEARCH DETECTION
// ══════════════════════════════════════════════════════════════

function needsRealTimeSearch(query: string): boolean {
  const q = query.toLowerCase();

  // Explicit search keywords
  if (/\b(search|find|look up|check|latest|today|tomorrow|tonight|current|now|live|available|availability|book|booking|price right now|cheapest|best price|upcoming|this week|this month|next week|next month|real.?time|show me flights|search flights|find flights|find hotels|find restaurants|nearby|open now|weather|ticket|tickets)\b/i.test(q)) {
    return true;
  }

  // Query mentions a specific transport route → needs search
  // "flights from X to Y", "train to Z", "bus from A to B", "flight options from X"
  if (/\b(flights?|trains?|buses?|fare|airfare)\b/i.test(q) && /\b(from|to|between|for)\b/i.test(q)) {
    return true;
  }

  // "suggest flights", "show trains", "get buses", "flight options"
  if (/\b(suggest|show|get|give|list)\b.*\b(flights?|trains?|buses?|option)/i.test(q)) {
    return true;
  }

  // Bare "flights from X to Y" or "trains to Y"
  if (/\b(flights?|trains?|buses?)\b/i.test(q) && /\b[A-Z][a-z]+\b/.test(query)) {
    return true;
  }

  return false;
}

function needsCompareSkill(query: string): boolean {
  return /\b(compare|comparison|vs|versus|which is (cheaper|faster|better)|all options|all modes|flights?\s+(and|or|vs)\s+trains?|trains?\s+(and|or|vs)\s+buses?|every\s+option|best\s+way\s+to\s+(travel|reach|go))\b/i.test(query.toLowerCase());
}

function buildChatHistory(conversations: Conversation[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (const c of conversations) {
    history.push({ role: "user", content: c.query });
    // Keep full responses — no trimming, so follow-ups have complete context
    history.push({ role: "assistant", content: c.response });
  }
  return history;
}

// ══════════════════════════════════════════════════════════════
// INTENT CLASSIFICATION
// ══════════════════════════════════════════════════════════════

const INTENT_SYSTEM_PROMPT = `You classify user queries into exactly one category.

Categories:
- "music": songs, albums, playlists, artists, music taste, listening suggestions, concerts, music platforms, genres, recommendations, similar artists
- "travel": trips, itineraries, destinations, flights, hotels, travel planning, vacation, sightseeing, trip costs, booking, packing
- "profile": user asking about themselves — "what do you know about me", "who am I", "my interests"
- "general": anything else — greetings, help, or truly unrelated questions

CRITICAL — FOLLOW-UP DETECTION:
You receive recent conversation context below. Use it to classify ambiguous or short follow-up queries:
- User just discussed travel, now asks "how much will it cost?" → "travel" (trip cost)
- User just got music recs, now asks "any more like that?" → "music" (more recs)
- User just discussed travel, now asks "tell me more" or "details?" → "travel"
- Short vague queries ("and?", "what else?", "what about dates?") → same category as the previous conversation

Return the category and a brief reasoning.`;

async function classifyIntent(
  query: string,
  recentConversations: Conversation[]
): Promise<{ intent: Intent; reasoning: string }> {
  if (!isConfigured()) {
    return classifyIntentFallback(query, recentConversations);
  }

  // Build context from recent conversations so the classifier knows what we were talking about
  let contextHint = "";
  if (recentConversations.length > 0) {
    const recent = recentConversations.slice(-3);
    contextHint = "\n\nRECENT CONVERSATION CONTEXT (use this to understand follow-up questions):\n" +
      recent.map((c) => `User: "${c.query}" → Routed to: ${c.intent}`).join("\n");
  }

  try {
    const result = await generateJSON(
      INTENT_SYSTEM_PROMPT,
      `${contextHint}\n\nNow classify this query: "${query}"`,
      IntentSchema
    );
    return result;
  } catch {
    return classifyIntentFallback(query, recentConversations);
  }
}

function classifyIntentFallback(
  query: string,
  recentConversations: Conversation[]
): { intent: Intent; reasoning: string } {
  const q = query.toLowerCase();
  if (/music|song|album|playlist|listen|artist|genre|spotify|apple music|youtube music|concert|recommend.*song|suggest.*music|what.*listen/i.test(q)) {
    return { intent: "music", reasoning: "keyword match" };
  }
  if (/travel|trip|itinerary|visit|flight|hotel|plan.*trip|destination|vacation|where.*go|plan.*visit|book.*flight/i.test(q)) {
    return { intent: "travel", reasoning: "keyword match" };
  }
  if (/who am i|about me|my profile|know about|my interest|tell.*about.*me|what.*learned/i.test(q)) {
    return { intent: "profile", reasoning: "keyword match" };
  }

  // Follow-up detection: if the query is short/vague, check what we were just talking about
  if (recentConversations.length > 0 && q.split(" ").length <= 8) {
    const lastIntent = recentConversations[recentConversations.length - 1].intent as Intent;
    if (lastIntent !== "general") {
      // Short follow-up like "how much?" / "what dates?" → same domain as last conversation
      if (/how much|cost|price|budget|when|what date|which|tell me more|details|and|also|what about/i.test(q)) {
        return { intent: lastIntent, reasoning: `follow-up to previous ${lastIntent} conversation` };
      }
    }
  }

  return { intent: "general", reasoning: "no domain match" };
}

// ══════════════════════════════════════════════════════════════
// CONTEXT BUILDERS — prepare focused context for each agent
// ══════════════════════════════════════════════════════════════

function buildMusicContext(profile: UserProfile, screenshots: ScreenshotMeta[]): string {
  const musicScreenshots = screenshots.filter((s) => s.analyzed && s.category === "music");
  const p = profile.music;

  const parts: string[] = [];

  // Platform
  if (p.preferredPlatform?.value) {
    parts.push(`PREFERRED PLATFORM: ${p.preferredPlatform.value} (${(p.preferredPlatform.confidence * 100).toFixed(0)}% confidence, ${p.preferredPlatform.sources.length} source(s))`);
  } else {
    parts.push("PREFERRED PLATFORM: Unknown — provide both Spotify and YouTube Music links");
  }

  // Genres
  if (p.genres.length > 0) {
    const sorted = [...p.genres].sort((a, b) => b.strength - a.strength);
    parts.push("GENRES (ranked by strength):\n" +
      sorted.map((g) => `  - ${g.genre}: strength ${(g.strength * 100).toFixed(0)}%, ${g.artistCount} artist(s)`).join("\n")
    );
  } else {
    parts.push("GENRES: None detected yet");
  }

  // Artists
  if (p.favoriteArtists.length > 0) {
    const sorted = [...p.favoriteArtists].sort((a, b) => b.mentions - a.mentions);
    parts.push("FAVORITE ARTISTS (ranked by mentions):\n" +
      sorted.slice(0, 15).map((a) => `  - ${a.name} (mentioned ${a.mentions}×)`).join("\n")
    );
  }

  // Songs
  if (p.likedSongs.length > 0) {
    parts.push("SONGS SEEN IN SCREENSHOTS:\n" +
      p.likedSongs.slice(0, 20).map((s) => `  - "${s.title}" by ${s.artist}`).join("\n")
    );
  }

  // Playlists
  if (p.playlistsSeen.length > 0) {
    parts.push("PLAYLISTS SEEN:\n" +
      p.playlistsSeen.map((pl) => `  - "${pl.name}" on ${pl.platform}`).join("\n")
    );
  }

  // Listening patterns
  const lp = p.listeningPatterns;
  if (lp.moodPreference || lp.energyLevel || lp.languages.length > 0) {
    const patternParts: string[] = [];
    if (lp.moodPreference) patternParts.push(`Mood: ${lp.moodPreference}`);
    if (lp.energyLevel) patternParts.push(`Energy: ${lp.energyLevel}`);
    if (lp.languages.length > 0) patternParts.push(`Languages: ${lp.languages.join(", ")}`);
    const contexts = Object.entries(lp.contextPreferences);
    if (contexts.length > 0) {
      patternParts.push("Context preferences: " + contexts.map(([k, v]) => `${k}→${v}`).join(", "));
    }
    parts.push("LISTENING PATTERNS:\n  " + patternParts.join("\n  "));
  }

  // General context
  if (profile.general.foodPreferences.length > 0) {
    parts.push(`FOOD PREFERENCES: ${profile.general.foodPreferences.join(", ")}`);
  }
  if (profile.identity.name?.value) {
    parts.push(`USER NAME: ${profile.identity.name.value}`);
  }

  // Screenshot summaries
  if (musicScreenshots.length > 0) {
    parts.push("MUSIC SCREENSHOTS:\n" +
      musicScreenshots.map((s, i) => {
        const app = s.sourceApp ? `[${s.sourceApp}] ` : "";
        const desc = s.detailedDescription || s.summary || "No description";
        return `  [${i + 1}] ${app}${desc}`;
      }).join("\n")
    );
  }

  return parts.join("\n\n");
}

function buildTravelContext(profile: UserProfile, screenshots: ScreenshotMeta[]): string {
  const travelScreenshots = screenshots.filter((s) => s.analyzed && s.category === "travel");
  const t = profile.travel;

  const parts: string[] = [];

  // Destinations ranked
  if (t.interests.length > 0) {
    const sorted = [...t.interests].sort((a, b) => b.strength - a.strength);
    parts.push("TRAVEL INTERESTS (ranked by strength × recency):");
    for (const dest of sorted) {
      const d = dest.details;
      const detailParts: string[] = [];
      if (d.hotelsSaved.length > 0) detailParts.push(`Hotels: ${d.hotelsSaved.join(", ")}`);
      if (d.activitiesSaved.length > 0) detailParts.push(`Activities: ${d.activitiesSaved.join(", ")}`);
      if (d.foodSaved.length > 0) detailParts.push(`Food: ${d.foodSaved.join(", ")}`);
      if (d.datesDetected.length > 0) detailParts.push(`Dates: ${d.datesDetected.join(", ")}`);
      if (d.budgetSignals.length > 0) detailParts.push(`Budget: ${d.budgetSignals.join(", ")}`);

      parts.push(`  ${dest.destination}: strength ${(dest.strength * 100).toFixed(0)}%, ${dest.screenshotCount} screenshot(s), last seen ${dest.lastSeen}`);
      if (detailParts.length > 0) {
        parts.push("    " + detailParts.join("\n    "));
      }
    }
  } else {
    parts.push("TRAVEL INTERESTS: None detected yet");
  }

  // Travel style
  const style = t.style;
  const styleEntries = Object.entries(style).filter(([, v]) => v !== null);
  if (styleEntries.length > 0) {
    parts.push("TRAVEL STYLE:\n" +
      styleEntries.map(([k, v]) => `  - ${k}: ${v}`).join("\n")
    );
  }

  // User context
  if (profile.identity.name?.value) parts.push(`USER NAME: ${profile.identity.name.value}`);
  if (profile.identity.location?.value) parts.push(`HOME CITY: ${profile.identity.location.value}`);
  if (profile.general.foodPreferences.length > 0) {
    parts.push(`DIETARY PREFERENCES: ${profile.general.foodPreferences.join(", ")}`);
  }
  if (profile.general.budgetStyle) parts.push(`BUDGET STYLE: ${profile.general.budgetStyle}`);

  // Screenshot summaries
  if (travelScreenshots.length > 0) {
    parts.push("TRAVEL SCREENSHOTS:\n" +
      travelScreenshots.map((s, i) => {
        const app = s.sourceApp ? `[${s.sourceApp}] ` : "";
        const desc = s.detailedDescription || s.summary || "No description";
        const entities = s.entities ? ` | entities: ${JSON.stringify(s.entities)}` : "";
        return `  [${i + 1}] ${app}${desc}${entities}`;
      }).join("\n")
    );
  }

  return parts.join("\n\n");
}

function buildProfileContext(profile: UserProfile, screenshots: ScreenshotMeta[]): string {
  return JSON.stringify(profile, null, 2);
}

// ══════════════════════════════════════════════════════════════
// TRAVEL PARAMS EXTRACTION
// ══════════════════════════════════════════════════════════════

async function extractTravelParams(query: string, profile: UserProfile): Promise<TravelParams> {
  const homeCity = profile.identity.location?.value || "Unknown";
  const topDestination = profile.travel.interests.length > 0
    ? [...profile.travel.interests].sort((a, b) => b.strength - a.strength)[0]
    : null;
  const savedDates = topDestination?.details?.datesDetected?.[0] || "";

  try {
    const result = await generateText(
      "You extract travel parameters from user queries. Return ONLY a JSON object. Nothing else — no explanation, no markdown.",
      `Extract origin, destination, and date from this query:

"${query}"

RULES — follow in this exact priority order:
1. If the user EXPLICITLY says "from X" → origin = X. Do NOT override with their home city.
2. If the user EXPLICITLY says "to Y" → destination = Y. Do NOT override with their saved interests.
3. If the user says a date like "5th May" or "May 5" → date = that date in YYYY-MM-DD.
4. If the user says "tomorrow" → date = the day after today.
5. If the user says "next month" → date = 1st of next month.
6. ONLY if origin is truly not mentioned at all → use "${homeCity}".
7. ONLY if destination is truly not mentioned at all → use "${topDestination?.destination || "unknown"}".
8. ONLY if no date is mentioned at all → use "${savedDates || "tomorrow"}".

The user's words ALWAYS win over profile defaults. If they say "from Delhi" → origin is Delhi, even if their home is ${homeCity}.

Return ONLY: {"origin": "...", "destination": "...", "date": "YYYY-MM-DD"}`
    );

    // Parse the JSON from the response
    const jsonMatch = result.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const extracted = {
        origin: parsed.origin || homeCity,
        destination: parsed.destination || topDestination?.destination || "Unknown",
        date: parsed.date || new Date().toISOString().split("T")[0],
      };
      log("info", `Params extracted: ${extracted.origin} → ${extracted.destination} on ${extracted.date}`);
      return extracted;
    }
    log("warn", `Could not parse JSON from LLM response: ${result.slice(0, 100)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("warn", `Param extraction failed: ${msg}`);
  }

  // Fallback — LLM extraction failed completely, use profile defaults
  log("warn", `Param extraction fell through to fallback — using profile defaults`);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    origin: homeCity,
    destination: topDestination?.destination || "Unknown",
    date: tomorrow.toISOString().split("T")[0],
  };
}

function buildGeneralContext(profile: UserProfile): string {
  const parts: string[] = [];
  if (profile.identity.name?.value) parts.push(`User: ${profile.identity.name.value}`);
  if (profile.identity.location?.value) parts.push(`Location: ${profile.identity.location.value}`);
  if (profile.general.language) parts.push(`Language: ${profile.general.language}`);
  if (parts.length === 0) parts.push("No user context available yet.");
  return parts.join("\n");
}

// ══════════════════════════════════════════════════════════════
// ORCHESTRATOR — MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════

export async function orchestrate(query: string): Promise<OrchestratorResult> {
  const totalSteps = 7;

  // ── Step 1: Load profile ──
  logStep(1, totalSteps, chalk.hex("#6C5CE7")("Loading user profile..."));
  const profile = await getProfile();
  log("info", `Profile v${profile.profileVersion} — ${profile.totalScreenshots} screenshots analyzed`);
  if (profile.identity.name?.value) {
    log("info", `User: ${chalk.white.bold(profile.identity.name.value)}`);
  }

  // ── Step 2: Load screenshots + conversation history ──
  logStep(2, totalSteps, chalk.hex("#A29BFE")("Loading context..."));
  const screenshots = await getScreenshots();
  const analyzedCount = screenshots.filter((s) => s.analyzed).length;
  const musicCount = screenshots.filter((s) => s.category === "music").length;
  const travelCount = screenshots.filter((s) => s.category === "travel").length;

  const recentConversations = await getRecentConversations(5);
  const chatHistory = buildChatHistory(recentConversations);
  log("info", `${screenshots.length} screenshots (${musicCount} music, ${travelCount} travel), ${recentConversations.length} recent chats`);

  // ── Step 3: Classify intent (with conversation context) ──
  logStep(3, totalSteps, chalk.hex("#74B9FF")("Classifying intent..."));
  const classification = await classifyIntent(query, recentConversations);
  const intent = classification.intent;

  const intentIcons: Record<Intent, string> = {
    music: chalk.green("🎵 Music Agent"),
    travel: chalk.blue("✈️  Travel Agent"),
    profile: chalk.magenta("👤 Profile Agent"),
    general: chalk.dim("💬 General"),
  };
  log("success", `Routed to: ${intentIcons[intent]} ${chalk.dim(`— ${classification.reasoning}`)}`);

  // ── Step 4: Build agent context ──
  logStep(4, totalSteps, chalk.hex("#0984E3")("Building agent context..."));
  let agentContext: string;
  switch (intent) {
    case "music":
      agentContext = buildMusicContext(profile, screenshots);
      log("info", `Music context: ${profile.music.favoriteArtists.length} artists, ${profile.music.genres.length} genres, ${profile.music.likedSongs.length} songs`);
      break;
    case "travel":
      agentContext = buildTravelContext(profile, screenshots);
      log("info", `Travel context: ${profile.travel.interests.length} destinations, ${travelCount} screenshots`);
      break;
    case "profile":
      agentContext = buildProfileContext(profile, screenshots);
      log("info", `Full profile context prepared`);
      break;
    default:
      agentContext = buildGeneralContext(profile);
      log("info", "Orchestrator will handle this directly");
      break;
  }

  // ── Step 5: Route to agent ──
  const useSearch = needsRealTimeSearch(query);
  if (useSearch) {
    logStep(5, totalSteps, chalk.hex("#6C5CE7")("Agent generating response ") + chalk.yellow("(🔍 live search enabled)") + chalk.hex("#6C5CE7")("..."));
  } else {
    logStep(5, totalSteps, chalk.hex("#6C5CE7")("Agent generating response..."));
  }
  let response: string;

  if (!isConfigured()) {
    response = buildUnconfiguredResponse(intent, query, screenshots.length);
  } else {
    const spinner = startSpinner(useSearch ? "Searching the web + thinking..." : "Agent is thinking...");
    try {
      switch (intent) {
        case "music":
          response = await runMusicAgent(query, agentContext, chatHistory, useSearch);
          break;
        case "travel":
          if (needsCompareSkill(query)) {
            const params = await extractTravelParams(query, profile);
            log("info", `Comparing all options: ${params.origin} → ${params.destination} on ${params.date}`);
            response = await compareTravelOptions(
              params.origin,
              params.destination,
              params.date,
              { budget: profile.general.budgetStyle, pace: profile.travel.style.pace }
            );
          } else if (useSearch) {
            const params = await extractTravelParams(query, profile);
            log("info", `Searching: ${params.origin} → ${params.destination} on ${params.date}`);
            response = await runTravelAgent(query, agentContext, chatHistory, true, params);
          } else {
            response = await runTravelAgent(query, agentContext, chatHistory, false);
          }
          break;
        case "profile":
          response = await runProfileAgent(query, agentContext, {
            totalScreenshots: screenshots.length,
            analyzedScreenshots: analyzedCount,
          }, chatHistory);
          break;
        default:
          response = await runGeneralQuery(query, agentContext, chatHistory, useSearch);
          break;
      }
      stopSpinner(spinner, "Response generated");
    } catch (err) {
      stopSpinner(spinner, "Agent error", false);
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `Agent failed: ${chalk.dim(msg)}`);
      response = `## Error\n\nThe agent encountered an error.\n\n**Error:** ${msg}\n\nPlease try again or check your API key.`;
    }
  }

  // ── Step 6: Update profile from conversation ──
  logStep(6, totalSteps, chalk.hex("#A29BFE")("Extracting profile facts from conversation..."));
  let factsExtracted = 0;
  try {
    factsExtracted = await updateProfileFromConversation(query, response);
    if (factsExtracted > 0) {
      log("success", `${factsExtracted} new fact(s) learned from conversation`);
    } else {
      log("info", "No new facts from this conversation");
    }
  } catch {
    log("info", "No new facts from this conversation");
  }

  // ── Step 7: Complete ──
  logStep(7, totalSteps, chalk.hex("#74B9FF")("Complete"));

  return {
    intent,
    response,
    profileUpdated: factsExtracted > 0,
    factsExtracted,
  };
}

// ══════════════════════════════════════════════════════════════
// FALLBACK RESPONSES
// ══════════════════════════════════════════════════════════════

function buildUnconfiguredResponse(intent: string, query: string, screenshotCount: number): string {
  return `## API Key Not Configured

To use the ${intent} agent, set up your Gemini API key:

1. Get a free key at: https://aistudio.google.com/apikey
2. Create a \`.env\` file in the project root
3. Add: \`GOOGLE_GENERATIVE_AI_API_KEY=your_key_here\`
4. Restart the CLI

You have ${screenshotCount} screenshots uploaded. Once configured, I can answer: "${query}"`;
}

