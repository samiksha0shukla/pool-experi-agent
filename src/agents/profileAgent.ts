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

Your job is to present what Pool has learned about the user — clearly, warmly, and honestly. You're showing them their own data, not guessing about them.

HOW TO PRESENT THE PROFILE:
- Walk through each section: Identity, Music Taste, Travel Interests, Food & Lifestyle
- For each fact, mention HOW it was learned (e.g., "from your Spotify screenshot" or "you mentioned this in conversation")
- Show confidence levels — "I'm 95% sure your name is Samiksha (from a boarding pass screenshot)" vs "I think you might like Japanese food (seen once)"
- Highlight the STRONGEST signals — if they have 8 indie rock artists, that's a strong signal worth emphasizing
- Call out gaps directly — "I don't know your travel budget yet. A screenshot of a flight search would help."

FORMAT — respond in clean markdown:
- ## Your Pool Profile
- ### sections for each area
- Use bullet points for facts
- End with "What Would Help Me Learn More" section suggesting specific screenshot types

WHAT MAKES THIS DIFFERENT FROM A DATABASE DUMP:
- Don't just list facts — connect them into a narrative
- "You're clearly into indie rock — Arctic Monkeys, Tame Impala, and Prateek Kuhad show up across 8 of your screenshots. You listen on Spotify, and your vibe leans introspective and chill."
- This is a profile STORY, not a JSON readout

ABSOLUTE RULES:
- Never fabricate facts not present in the profile data
- If a section is completely empty, say "Nothing here yet" and suggest what screenshots would help
- Present confidence honestly — don't say "you love X" if confidence is 0.5
- Be warm and conversational, like a thoughtful friend summarizing what they know about you`;

/**
 * Build complete profile context by querying the knowledge store.
 */
function buildProfileContext(store: KnowledgeStore): string {
  const parts: string[] = [];

  // ── Identity ──
  parts.push("=== IDENTITY ===");
  const nameFacts = store.getFactsByType("name");
  const locationFacts = store.getFactsByType("location");
  const langFacts = store.getFactsByType("language");
  if (nameFacts.length > 0) {
    const n = nameFacts[0]!;
    parts.push(`Name: ${n.factValue} (${(n.confidence * 100).toFixed(0)}% confidence, source: ${n.source})`);
  } else {
    parts.push("Name: Unknown");
  }
  if (locationFacts.length > 0) {
    const l = locationFacts[0]!;
    parts.push(`Location: ${l.factValue} (${(l.confidence * 100).toFixed(0)}% confidence, source: ${l.source})`);
  }
  if (langFacts.length > 0) {
    parts.push(`Languages: ${langFacts.map((l) => l.factValue).join(", ")}`);
  }

  // ── Music ──
  parts.push("\n=== MUSIC ===");
  const platform = store.getProfileValue("music.preferredPlatform");
  if (platform) parts.push(`Platform: ${platform.value} (${(platform.confidence * 100).toFixed(0)}% confidence)`);
  const artists = store.getFactsByType("liked_artist");
  if (artists.length > 0) {
    parts.push(`Artists (${artists.length}): ${artists.map((a) => `${a.factValue} (${(a.confidence * 100).toFixed(0)}%)`).join(", ")}`);
  }
  const genres = store.getFactsByType("genre");
  if (genres.length > 0) {
    parts.push(`Genres: ${genres.map((g) => `${g.factValue} (${(g.confidence * 100).toFixed(0)}%)`).join(", ")}`);
  }
  const songs = store.getFactsByType("liked_song");
  if (songs.length > 0) {
    parts.push(`Songs: ${songs.map((s) => s.factValue).join(", ")}`);
  }
  const playlists = store.getFactsByType("playlist");
  if (playlists.length > 0) {
    parts.push(`Playlists: ${playlists.map((p) => p.factValue).join(", ")}`);
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
      const prefix = `travel.detail.${dest.factValue.toLowerCase()}`;
      const details = store.getProfileSection(prefix);
      parts.push(`  ${dest.factValue}: ${(dest.confidence * 100).toFixed(0)}% confidence`);
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
    parts.push(`Food preferences: ${foodPrefs.map((f) => f.factValue).join(", ")}`);
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
