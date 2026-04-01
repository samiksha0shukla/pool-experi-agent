/**
 * ORCHESTRATOR — The Main Agent
 *
 * The orchestrator does NOT solve anything itself. Its job:
 * 1. Load context from knowledge store
 * 2. Classify intent (music / travel / profile / general) via LLM
 * 3. Route to the correct sub-agent (passing the store)
 * 4. Update profile from conversation
 *
 * It's a manager, not a worker. Agents query the store directly.
 */

import chalk from "chalk";
import { z } from "zod";
import {
  log,
  logStep,
  startSpinner,
  stopSpinner,
} from "./logger.js";
import type { KnowledgeStore } from "./knowledge/store.js";
import type { ConversationRow } from "./knowledge/types.js";
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
// REAL-TIME SEARCH DETECTION
// ══════════════════════════════════════════════════════════════

function needsRealTimeSearch(query: string): boolean {
  const q = query.toLowerCase();

  if (/\b(search|find|look up|check|latest|today|tomorrow|tonight|current|now|live|available|availability|book|booking|price right now|cheapest|best price|upcoming|this week|this month|next week|next month|real.?time|show me flights|search flights|find flights|find hotels|find restaurants|nearby|open now|weather|ticket|tickets)\b/i.test(q)) {
    return true;
  }

  if (/\b(flights?|trains?|buses?|fare|airfare)\b/i.test(q) && /\b(from|to|between|for)\b/i.test(q)) {
    return true;
  }

  if (/\b(suggest|show|get|give|list)\b.*\b(flights?|trains?|buses?|option)/i.test(q)) {
    return true;
  }

  if (/\b(flights?|trains?|buses?)\b/i.test(q) && /\b[A-Z][a-z]+\b/.test(query)) {
    return true;
  }

  return false;
}

function needsCompareSkill(query: string): boolean {
  return /\b(compare|comparison|vs|versus|which is (cheaper|faster|better)|all options|all modes|flights?\s+(and|or|vs)\s+trains?|trains?\s+(and|or|vs)\s+buses?|every\s+option|best\s+way\s+to\s+(travel|reach|go))\b/i.test(query.toLowerCase());
}

function buildChatHistory(conversations: ConversationRow[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (const c of conversations) {
    history.push({ role: "user", content: c.query });
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
  recentConversations: ConversationRow[]
): Promise<{ intent: Intent; reasoning: string }> {
  if (!isConfigured()) {
    return classifyIntentFallback(query, recentConversations);
  }

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
  recentConversations: ConversationRow[]
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

  if (recentConversations.length > 0 && q.split(" ").length <= 8) {
    const lastIntent = recentConversations[recentConversations.length - 1]!.intent as Intent;
    if (lastIntent !== "general") {
      if (/how much|cost|price|budget|when|what date|which|tell me more|details|and|also|what about/i.test(q)) {
        return { intent: lastIntent, reasoning: `follow-up to previous ${lastIntent} conversation` };
      }
    }
  }

  return { intent: "general", reasoning: "no domain match" };
}

// ══════════════════════════════════════════════════════════════
// TRAVEL PARAMS EXTRACTION
// ══════════════════════════════════════════════════════════════

async function extractTravelParams(query: string, store: KnowledgeStore): Promise<TravelParams> {
  const homeCity = store.getTopFact("location") || "Unknown";
  const destinations = store.getFactsByType("travel_interest");
  const topDestination = destinations.length > 0 ? destinations[0]!.factValue : null;

  // Check for saved dates in travel details
  let savedDates = "";
  if (topDestination) {
    const datesKV = store.getProfileValue(`travel.detail.${topDestination.toLowerCase()}.dates`);
    if (datesKV) savedDates = datesKV.value;
  }

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
7. ONLY if destination is truly not mentioned at all → use "${topDestination || "unknown"}".
8. ONLY if no date is mentioned at all → use "${savedDates || "tomorrow"}".

The user's words ALWAYS win over profile defaults. If they say "from Delhi" → origin is Delhi, even if their home is ${homeCity}.

Return ONLY: {"origin": "...", "destination": "...", "date": "YYYY-MM-DD"}`
    );

    const jsonMatch = result.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const extracted = {
        origin: parsed.origin || homeCity,
        destination: parsed.destination || topDestination || "Unknown",
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

  // Fallback
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    origin: homeCity,
    destination: topDestination || "Unknown",
    date: tomorrow.toISOString().split("T")[0]!,
  };
}

// ══════════════════════════════════════════════════════════════
// ORCHESTRATOR — MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════

export async function orchestrate(query: string, store: KnowledgeStore): Promise<OrchestratorResult> {
  const totalSteps = 5;

  // ── Step 1: Load context from knowledge store ──
  logStep(1, totalSteps, chalk.hex("#6C5CE7")("Loading context from knowledge store..."));
  const meta = store.getProfileMeta();
  const screenshots = store.getAllScreenshots();
  const analyzedCount = screenshots.filter((s) => s.analyzed).length;
  const musicCount = store.getScreenshotsByCategory("music").length;
  const travelCount = store.getScreenshotsByCategory("travel").length;

  const recentConversations = store.getRecentConversations(5);
  const chatHistory = buildChatHistory(recentConversations);
  log("info", `Profile v${meta.version} — ${screenshots.length} screenshots (${musicCount} music, ${travelCount} travel), ${recentConversations.length} recent chats`);

  const userName = store.getTopFact("name");
  if (userName) log("info", `User: ${chalk.white.bold(userName)}`);

  // ── Step 2: Classify intent ──
  logStep(2, totalSteps, chalk.hex("#74B9FF")("Classifying intent..."));
  const classification = await classifyIntent(query, recentConversations);
  const intent = classification.intent;

  const intentIcons: Record<Intent, string> = {
    music: chalk.green("🎵 Music Agent"),
    travel: chalk.blue("✈️  Travel Agent"),
    profile: chalk.magenta("👤 Profile Agent"),
    general: chalk.dim("💬 General"),
  };
  log("success", `Routed to: ${intentIcons[intent]} ${chalk.dim(`— ${classification.reasoning}`)}`);

  // ── Step 3: Route to agent (agents build their own context from store) ──
  const useSearch = needsRealTimeSearch(query);
  if (useSearch) {
    logStep(3, totalSteps, chalk.hex("#6C5CE7")("Agent generating response ") + chalk.yellow("(🔍 live search enabled)") + chalk.hex("#6C5CE7")("..."));
  } else {
    logStep(3, totalSteps, chalk.hex("#6C5CE7")("Agent generating response..."));
  }
  let response: string;

  if (!isConfigured()) {
    response = buildUnconfiguredResponse(intent, query, screenshots.length);
  } else {
    const spinner = startSpinner(useSearch ? "Searching the web + thinking..." : "Agent is thinking...");
    try {
      switch (intent) {
        case "music":
          response = await runMusicAgent(query, store, chatHistory, useSearch);
          break;
        case "travel":
          if (needsCompareSkill(query)) {
            const params = await extractTravelParams(query, store);
            log("info", `Comparing all options: ${params.origin} → ${params.destination} on ${params.date}`);
            const budget = store.getProfileValue("general.budgetStyle");
            const pace = store.getProfileValue("travel.style.pace");
            response = await compareTravelOptions(
              params.origin,
              params.destination,
              params.date,
              { budget: budget?.value ?? null, pace: pace?.value ?? null }
            );
          } else if (useSearch) {
            const params = await extractTravelParams(query, store);
            log("info", `Searching: ${params.origin} → ${params.destination} on ${params.date}`);
            response = await runTravelAgent(query, store, chatHistory, true, params);
          } else {
            response = await runTravelAgent(query, store, chatHistory, false);
          }
          break;
        case "profile":
          response = await runProfileAgent(query, store, {
            totalScreenshots: screenshots.length,
            analyzedScreenshots: analyzedCount,
          }, chatHistory);
          break;
        default:
          response = await runGeneralQuery(query, store, chatHistory, useSearch);
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

  // ── Step 4: Update profile from conversation ──
  logStep(4, totalSteps, chalk.hex("#A29BFE")("Extracting profile facts from conversation..."));
  let factsExtracted = 0;
  try {
    factsExtracted = await updateProfileFromConversation(store, query, response);
    if (factsExtracted > 0) {
      log("success", `${factsExtracted} new fact(s) learned from conversation`);
    } else {
      log("info", "No new facts from this conversation");
    }
  } catch {
    log("info", "No new facts from this conversation");
  }

  // ── Step 5: Complete ──
  logStep(5, totalSteps, chalk.hex("#74B9FF")("Complete"));

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
