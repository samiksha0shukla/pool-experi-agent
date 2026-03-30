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
  type UserProfile,
  type ScreenshotMeta,
} from "./store.js";
import { isConfigured, generateJSON } from "./llm.js";
import { runMusicAgent } from "./agents/musicAgent.js";
import { runTravelAgent } from "./agents/travelAgent.js";
import { runProfileAgent } from "./agents/profileAgent.js";
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

const INTENT_SYSTEM_PROMPT = `You classify user queries into exactly one category.

Categories:
- "music": anything about songs, albums, playlists, artists, music taste, listening suggestions, concerts, music platforms, genres, what to listen to, music recommendations, similar artists
- "travel": anything about trips, itineraries, destinations, flights, hotels, travel planning, vacation, sightseeing, where to go, trip planning, booking, packing
- "profile": user asking about themselves — "what do you know about me", "who am I", "what are my interests", "what have you learned", "my profile", "tell me about myself"
- "general": anything else — greetings, help requests, ambiguous queries, or questions not about music/travel/profile

Be precise. If the query mentions both music and travel, pick the PRIMARY intent.
Return the category and a brief reasoning.`;

async function classifyIntent(query: string): Promise<{ intent: Intent; reasoning: string }> {
  if (!isConfigured()) {
    return classifyIntentFallback(query);
  }

  try {
    const result = await generateJSON(
      INTENT_SYSTEM_PROMPT,
      `Query: "${query}"`,
      IntentSchema
    );
    return result;
  } catch {
    return classifyIntentFallback(query);
  }
}

function classifyIntentFallback(query: string): { intent: Intent; reasoning: string } {
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

  // ── Step 2: Load screenshots ──
  logStep(2, totalSteps, chalk.hex("#A29BFE")("Loading screenshot context..."));
  const screenshots = await getScreenshots();
  const analyzedCount = screenshots.filter((s) => s.analyzed).length;
  const musicCount = screenshots.filter((s) => s.category === "music").length;
  const travelCount = screenshots.filter((s) => s.category === "travel").length;
  log("info", `${screenshots.length} total, ${analyzedCount} analyzed (${musicCount} music, ${travelCount} travel)`);

  // ── Step 3: Classify intent ──
  logStep(3, totalSteps, chalk.hex("#74B9FF")("Classifying intent..."));
  const classification = await classifyIntent(query);
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
      agentContext = "";
      break;
  }

  // ── Step 5: Route to agent ──
  logStep(5, totalSteps, chalk.hex("#6C5CE7")("Agent generating response..."));
  let response: string;

  if (!isConfigured()) {
    response = buildUnconfiguredResponse(intent, query, screenshots.length);
  } else {
    const spinner = startSpinner("Agent is thinking...");
    try {
      switch (intent) {
        case "music":
          response = await runMusicAgent(query, agentContext);
          break;
        case "travel":
          response = await runTravelAgent(query, agentContext);
          break;
        case "profile":
          response = await runProfileAgent(query, agentContext, {
            totalScreenshots: screenshots.length,
            analyzedScreenshots: analyzedCount,
          });
          break;
        default:
          response = buildGeneralResponse(query);
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

function buildGeneralResponse(query: string): string {
  return `## Pool Agent

I'm your **Music** and **Travel** assistant. Here's what I can do:

- 🎵 **Music:** "Suggest me some music", "What kind of music do I like?", "Find songs like Arctic Monkeys"
- ✈️ **Travel:** "Plan my itinerary", "Where should I travel?", "Build me a Tokyo trip"
- 👤 **Profile:** "What do you know about me?", "Who am I?"

Your query "${query}" didn't match music or travel. Try rephrasing!`;
}
