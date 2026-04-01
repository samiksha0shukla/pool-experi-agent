/**
 * PROFILE AGENT — Sub-agent of the Orchestrator
 *
 * Queries the KnowledgeStore directly for all user facts.
 * Presents what Pool has learned about the user from their screenshots.
 * Every fact is cited with its source. Gaps are called out honestly.
 */

import { generateText, type ChatMessage } from "../llm.js";
import type { KnowledgeStore } from "../knowledge/store.js";

const SYSTEM_PROMPT = `You are the profile agent for Pool, a screenshot-based personal intelligence app.

Your job is to present what Pool has learned about the user — clearly, warmly, and honestly.

HOW TO PRESENT THE PROFILE:
- Walk through each section: Identity, Music Taste, Travel Interests, Food & Lifestyle
- For each fact, ALWAYS mention the actual source — which screenshot or conversation it came from
- Use natural language to describe certainty. NEVER show raw percentages like "95% confidence" or "100% confident"
  Instead use phrases like:
  - "Based on your Spotify screenshots..." (strong evidence)
  - "It looks like..." or "From what I can see..." (moderate evidence)
  - "I noticed once in a screenshot that..." (weak evidence, single source)
- Highlight patterns — if the same artist appears across 5 screenshots, that's meaningful

CRITICAL — VALIDATE BEFORE PRESENTING:
- Before stating any identity fact (name, location), check: does this actually make sense?
  - A name should look like a real person's name (not a verb, phrase, or random word)
  - A location should be a real place name
- If a fact looks wrong or implausible, say "I'm not sure about this" or skip it entirely
- If a fact has only 1 source, present it cautiously: "From one screenshot, it looks like..."
- If multiple sources agree, present it confidently: "Across several screenshots..."
- NEVER say "you told me" unless the source is explicitly "conversation" AND the value makes logical sense

FORMAT:
- ## Your Pool Profile
- ### sections for each area
- Bullet points for facts, always with source context
- End with "What Would Help Me Learn More" suggesting specific screenshot types

ABSOLUTE RULES:
- Never fabricate facts not present in the profile data
- Never show raw confidence numbers or percentages to the user
- Never present a dubious fact as certain — if it doesn't look right, flag it or skip it
- If a section is empty, say "Nothing here yet" and suggest what screenshots would help
- Be warm and conversational, like a thoughtful friend`;

/**
 * Build complete profile context by querying the knowledge store.
 */
function describeSource(source: string): string {
  if (source === "conversation") return "from conversation";
  if (source === "migration") return "from earlier data";
  if (source.startsWith("ss_")) return "from screenshot";
  return `from ${source}`;
}

function describeStrength(fact: { confidence: number; source: string }, allSources: string[]): string {
  const count = allSources.length;
  if (count >= 3) return `seen across ${count} sources — strong signal`;
  if (count === 2) return `seen in 2 sources`;
  return `${describeSource(fact.source)} — single source`;
}

function buildProfileContext(store: KnowledgeStore): string {
  const parts: string[] = [];

  // ── Identity ──
  parts.push("=== IDENTITY ===");
  const locationFacts = store.getFactsByType("location");
  const langFacts = store.getFactsByType("language");

  // Name: prefer the promoted value from profile_kv, fall back to facts
  const promotedName = store.getProfileValue("identity.name");
  const nameFacts = store.getFactsByType("name");
  if (promotedName) {
    const sources = store.sqlite.getFactSources("name", promotedName.value);
    parts.push(`Name: "${promotedName.value}" (${describeStrength({ confidence: promotedName.confidence, source: sources[0] || "unknown" }, sources)})`);
  } else if (nameFacts.length > 0) {
    // We have candidate names but none promoted — present cautiously
    const candidates = nameFacts.slice(0, 3).map((n) => `"${n.fact_value}"`).join(", ");
    parts.push(`Name: NOT CONFIRMED — candidate names spotted in screenshots: ${candidates}. These are names visible in screenshots but not confirmed as the user's own name. Do NOT present these as the user's name. Ask the user to confirm.`);
  } else {
    parts.push("Name: Not detected yet");
  }
  if (locationFacts.length > 0) {
    const l = locationFacts[0]!;
    const sources = store.sqlite.getFactSources("location", l.fact_value);
    parts.push(`Location: "${l.fact_value}" (${describeStrength(l, sources)})`);
  }
  if (langFacts.length > 0) {
    parts.push(`Languages: ${langFacts.map((l) => l.fact_value).join(", ")}`);
  }

  // ── Music ──
  parts.push("\n=== MUSIC ===");
  const platform = store.getProfileValue("music.preferredPlatform");
  if (platform) parts.push(`Platform: ${platform.value}`);
  const artists = store.getFactsByType("liked_artist");
  if (artists.length > 0) {
    parts.push(`Artists (${artists.length}): ${artists.map((a) => a.fact_value).join(", ")}`);
  }
  const genres = store.getFactsByType("genre");
  if (genres.length > 0) {
    parts.push(`Genres: ${genres.map((g) => g.fact_value).join(", ")}`);
  }
  const songs = store.getFactsByType("liked_song");
  if (songs.length > 0) {
    parts.push(`Songs: ${songs.map((s) => s.fact_value).join(", ")}`);
  }
  const playlists = store.getFactsByType("playlist");
  if (playlists.length > 0) {
    parts.push(`Playlists: ${playlists.map((p) => p.fact_value).join(", ")}`);
  }
  const mood = store.getProfileValue("music.moodPreference");
  const energy = store.getProfileValue("music.energyLevel");
  if (mood) parts.push(`Mood preference: ${mood.value}`);
  if (energy) parts.push(`Energy level: ${energy.value}`);

  // ── Travel ──
  parts.push("\n=== TRAVEL ===");
  const destinations = store.getFactsByType("travel_interest");
  if (destinations.length > 0) {
    for (const dest of destinations) {
      const sources = store.sqlite.getFactSources("travel_interest", dest.fact_value);
      const prefix = `travel.detail.${dest.fact_value.toLowerCase()}`;
      const details = store.getProfileSection(prefix);
      parts.push(`  ${dest.fact_value} (${describeStrength(dest, sources)})`);
      for (const d of details) {
        parts.push(`    ${d.key.replace(`${prefix}.`, "")}: ${d.value}`);
      }
    }
  } else {
    parts.push("  No destinations detected yet");
  }
  const styleKV = store.getProfileSection("travel.style.");
  if (styleKV.length > 0) {
    parts.push("  Style: " + styleKV.map((s) => `${s.key.replace("travel.style.", "")}: ${s.value}`).join(", "));
  }

  // ── General ──
  parts.push("\n=== GENERAL ===");
  const foodPrefs = store.getFactsByType("food_preference");
  if (foodPrefs.length > 0) {
    parts.push(`Food preferences: ${foodPrefs.map((f) => f.fact_value).join(", ")}`);
  }
  const budget = store.getProfileValue("general.budgetStyle");
  if (budget) parts.push(`Budget style: ${budget.value}`);
  const personality = store.getProfileValue("general.personalitySignals");
  if (personality) parts.push(`Personality signals: ${personality.value}`);

  return parts.join("\n");
}

export async function runProfileAgent(
  query: string,
  store: KnowledgeStore,
  stats: { totalScreenshots: number; analyzedScreenshots: number },
  chatHistory?: ChatMessage[]
): Promise<string> {
  const profileContext = buildProfileContext(store);
  const meta = store.getProfileMeta();

  const userMessage = `HERE IS THE USER'S COMPLETE PROFILE DATA:

${profileContext}

STATS:
- Total screenshots uploaded: ${stats.totalScreenshots}
- Screenshots analyzed: ${stats.analyzedScreenshots}
- Profile version: ${meta.version}
- Knowledge graph: ${store.graph.nodeCount} nodes, ${store.graph.edgeCount} edges

---

THE USER ASKED: "${query}"

Present their profile as a narrative — connect the dots, highlight strong signals, be honest about gaps, and suggest what screenshots would help fill them.`;

  return generateText(SYSTEM_PROMPT, userMessage, chatHistory);
}
