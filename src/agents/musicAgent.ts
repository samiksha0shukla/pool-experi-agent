/**
 * MUSIC AGENT — Sub-agent of the Orchestrator
 *
 * Queries the KnowledgeStore directly for user's music data.
 * Generates personalized music recommendations with real platform links.
 */

import { generateText, generateTextWithSearch, type ChatMessage } from "../llm.js";
import type { KnowledgeStore } from "../knowledge/store.js";

const SYSTEM_PROMPT = `You are a music discovery agent embedded inside Pool, a screenshot-based personal intelligence app.

You know the user ONLY through their screenshots — playlists they saved, songs they listened to, artists they follow, and the streaming platform they use.

WHAT YOU DO:
- Recommend songs, albums, artists, and playlists that match the user's actual taste DNA
- Every recommendation must connect back to something in their profile — an artist they like, a genre pattern, a mood they lean toward
- Provide clickable links to their preferred streaming platform

HOW TO THINK ABOUT RECOMMENDATIONS:
- 70% should feel like "yes, this is exactly my vibe" — adjacent to artists/genres they already love
- 30% should be tasteful discovery — things they haven't seen but would love based on the pattern
- If they like Arctic Monkeys and Tame Impala, don't suggest Ed Sheeran. Suggest Khruangbin, King Gizzard, or Pond.
- Read the mood/energy signals. If their vibe is "chill, introspective", don't lead with high-energy EDM.
- If they have context preferences (e.g., "lo-fi while working"), use them when the query matches.

LINKS — use search URLs (they always work):
- Spotify → https://open.spotify.com/search/{query}
- YouTube Music → https://music.youtube.com/search?q={query}
- Apple Music → https://music.apple.com/search?term={query}
Replace {query} with URL-encoded artist+song/album name.
If platform is unknown → give both Spotify and YouTube Music links.

FORMAT — respond in clean markdown:
- Use ## for the main heading
- Use ### for sections (Albums, Songs, Playlist Ideas, etc.)
- Each recommendation: **'Title'** — Artist, then a line explaining WHY, then the link
- Keep it conversational, not robotic
- End with an invitation to go deeper

THIN PROFILE HANDLING:
If you receive very few data points (e.g., 1-2 artists, no genres), say so directly:
"I only have [N] music screenshots to work with so far, so these are early guesses. Upload more Spotify/YouTube Music screenshots and I'll get much better."
Still give your best recommendations with what you have.

ABSOLUTE RULES:
- Never recommend fictional or made-up artists/songs
- Never ignore the preferred platform — always link to it
- Never give generic "top hits" recommendations that ignore the profile
- Always reference at least 2-3 specific things from their profile to prove personalization
- If the user asks something you can't answer from their music profile, say so honestly`;

/**
 * Build music context by querying the knowledge store directly.
 */
async function buildMusicContext(store: KnowledgeStore, query: string): Promise<string> {
  const context = await store.getContextForAgent("music", query);
  const parts: string[] = [];

  // Platform — count actual screenshots per music app (ground truth)
  const musicScreenshots = store.getScreenshotsByCategory("music");
  const appCounts = new Map<string, number>();
  for (const ss of musicScreenshots) {
    if (ss.source_app) {
      const app = ss.source_app;
      appCounts.set(app, (appCounts.get(app) ?? 0) + 1);
    }
  }
  if (appCounts.size > 0) {
    const sorted = [...appCounts.entries()].sort((a, b) => b[1] - a[1]);
    const mostUsed = sorted[0]![0];
    parts.push(
      `PLATFORM USAGE (from ${musicScreenshots.length} music screenshots):\n` +
      sorted.map(([app, count]) => `  - ${app}: ${count} screenshots`).join("\n") +
      `\nMOST USED PLATFORM: ${mostUsed}`
    );
  } else {
    const platform = store.getProfileValue("music.preferredPlatform");
    if (platform) {
      parts.push(`PREFERRED PLATFORM: ${platform.value} (${(platform.confidence * 100).toFixed(0)}% confidence)`);
    } else {
      parts.push("PREFERRED PLATFORM: Unknown — provide both Spotify and YouTube Music links");
    }
  }

  // Genres from facts
  const genres = store.getFactsByType("genre");
  if (genres.length > 0) {
    parts.push("GENRES (ranked by confidence):\n" +
      genres.map((g) => `  - ${g.fact_value}: ${(g.confidence * 100).toFixed(0)}% confidence`).join("\n")
    );
  } else {
    parts.push("GENRES: None detected yet");
  }

  // Artists from facts
  const artists = store.getFactsByType("liked_artist");
  if (artists.length > 0) {
    parts.push("FAVORITE ARTISTS (ranked by confidence):\n" +
      artists.slice(0, 15).map((a) => `  - ${a.fact_value} (${(a.confidence * 100).toFixed(0)}%)`).join("\n")
    );
  }

  // Songs
  const songs = store.getFactsByType("liked_song");
  if (songs.length > 0) {
    parts.push("SONGS SEEN IN SCREENSHOTS:\n" +
      songs.slice(0, 20).map((s) => `  - ${s.fact_value}`).join("\n")
    );
  }

  // Playlists
  const playlists = store.getFactsByType("playlist");
  if (playlists.length > 0) {
    parts.push("PLAYLISTS SEEN:\n" +
      playlists.map((p) => `  - "${p.fact_value}" (${p.evidence || ""})`).join("\n")
    );
  }

  // Listening patterns from profile KV
  const mood = store.getProfileValue("music.moodPreference");
  const energy = store.getProfileValue("music.energyLevel");
  const langFacts = store.getFactsByType("language");
  const contextKV = store.getProfileSection("music.context.");
  if (mood || energy || langFacts.length > 0 || contextKV.length > 0) {
    const patternParts: string[] = [];
    if (mood) patternParts.push(`Mood: ${mood.value}`);
    if (energy) patternParts.push(`Energy: ${energy.value}`);
    if (langFacts.length > 0) patternParts.push(`Languages: ${langFacts.map((l) => l.fact_value).join(", ")}`);
    if (contextKV.length > 0) {
      patternParts.push("Context preferences: " + contextKV.map((c) => `${c.key.replace("music.context.", "")}→${c.value}`).join(", "));
    }
    parts.push("LISTENING PATTERNS:\n  " + patternParts.join("\n  "));
  }

  // User name for personalization
  const name = store.getTopFact("name");
  if (name) parts.push(`USER NAME: ${name}`);

  // Semantic search results
  if (context.semanticMatches.length > 0) {
    parts.push("RELEVANT SCREENSHOTS (semantic search):\n" +
      context.semanticMatches.map((m, i) => `  [${i + 1}] ${m.summary || "No summary"} (relevance: ${(m.score * 100).toFixed(0)}%)`).join("\n")
    );
  }

  // Music screenshots from SQLite
  if (context.screenshots.length > 0) {
    parts.push("MUSIC SCREENSHOTS:\n" +
      context.screenshots.map((s, i) => {
        const app = s.source_app ? `[${s.source_app}] ` : "";
        const desc = s.detailed_description || s.summary || "No description";
        return `  [${i + 1}] ${app}${desc}`;
      }).join("\n")
    );
  }

  return parts.join("\n\n");
}

export async function runMusicAgent(
  query: string,
  store: KnowledgeStore,
  chatHistory?: ChatMessage[],
  useSearch?: boolean
): Promise<string> {
  const musicContext = await buildMusicContext(store, query);

  const userMessage = `HERE IS EVERYTHING I KNOW ABOUT THIS USER'S MUSIC TASTE:

${musicContext}

---

THE USER ASKED: "${query}"
${useSearch ? "\n⚡ LIVE SEARCH IS ENABLED — you can search for real-time info like concert dates, ticket availability, new releases, trending songs." : ""}

Give them a personalized response. Reference their actual artists, genres, platform, and listening patterns from the data above.`;

  if (useSearch) {
    return generateTextWithSearch(SYSTEM_PROMPT, userMessage, chatHistory);
  }
  return generateText(SYSTEM_PROMPT, userMessage, chatHistory);
}
