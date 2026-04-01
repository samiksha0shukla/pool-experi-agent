/**
 * MUSIC LINK FINDER — Extracts song info from screenshot metadata,
 * finds the exact streaming link via Google SERP, and optionally
 * finds a cross-platform link for the user's preferred platform.
 *
 * Flow:
 *   1. LLM extracts { song_title, artist, album, platform } from tile metadata
 *   2. Google SERP search with site: filter finds the URL
 *   3. Deterministic scoring validates the result
 *   4. (Optional) Repeat step 2-3 for user's preferred platform
 *   5. (Optional) Odesli fallback for cross-platform conversion
 */

import { z } from "zod";
import { generateJSON } from "../llm.js";
import { webSearch, type WebSearchResult } from "../tools/webSearch.js";
import type { KnowledgeStore } from "../knowledge/store.js";
import type { ScreenshotRow } from "../knowledge/types.js";
import { log } from "../logger.js";

// ══════════════════════════════════════════════════════════════
// PLATFORM CONFIG
// ══════════════════════════════════════════════════════════════

export interface PlatformConfig {
  name: string;
  domain: string;
  trackPatterns: string[];   // URL patterns that indicate a track page
}

const PLATFORMS: Record<string, PlatformConfig> = {
  spotify: {
    name: "Spotify",
    domain: "open.spotify.com",
    trackPatterns: ["/track/", "/album/"],
  },
  "apple music": {
    name: "Apple Music",
    domain: "music.apple.com",
    trackPatterns: ["/album/", "/song/"],
  },
  "youtube music": {
    name: "YouTube Music",
    domain: "music.youtube.com",
    trackPatterns: ["/watch?", "/playlist?"],
  },
  soundcloud: {
    name: "SoundCloud",
    domain: "soundcloud.com",
    trackPatterns: ["/"],
  },
  tidal: {
    name: "Tidal",
    domain: "tidal.com",
    trackPatterns: ["/track/", "/album/"],
  },
  deezer: {
    name: "Deezer",
    domain: "deezer.com",
    trackPatterns: ["/track/", "/album/"],
  },
  bandcamp: {
    name: "Bandcamp",
    domain: "bandcamp.com",
    trackPatterns: ["/track/", "/album/"],
  },
};

function getPlatformConfig(platformName: string): PlatformConfig | null {
  const key = platformName.toLowerCase().trim();
  return PLATFORMS[key] ?? null;
}

// ══════════════════════════════════════════════════════════════
// STEP 1 — LLM EXTRACTION
// ══════════════════════════════════════════════════════════════

const SongInfoSchema = z.object({
  song_title: z.string().describe("The song title visible or inferable from the metadata"),
  artist: z.string().describe("The artist name(s), comma-separated if multiple"),
  album: z.string().optional().describe("Album name if visible"),
  platform: z.string().describe("The streaming platform: spotify, youtube music, apple music, soundcloud, tidal, deezer, bandcamp, or unknown"),
  confidence: z.number().min(0).max(1).describe("How confident you are in this extraction"),
});

export type SongInfo = z.infer<typeof SongInfoSchema>;

const EXTRACTION_SYSTEM_PROMPT = `You extract song information from screenshot metadata.
You receive metadata about a music screenshot — OCR text, source app, description, entities, etc.
Extract the EXACT song, artist, album, and platform.

RULES:
- Use the most specific information available
- If multiple songs are visible, pick the one that is actively playing or most prominent
- For platform: normalize to lowercase (spotify, youtube music, apple music, soundcloud, tidal, deezer, bandcamp)
- If source_app says "Spotify" → platform is "spotify"
- If source_app says "YouTube Music" → platform is "youtube music"
- Confidence: 0.9+ = song title + artist clearly visible, 0.7-0.9 = partially visible, 0.5-0.7 = inferred
- If you truly cannot determine the song, return song_title as "unknown"

CRITICAL — CLEAN SONG TITLES:
- Remove "(feat. ...)", "(ft. ...)", "(with ...)" from the song title — put featured artists in the artist field instead
- If the OCR text is truncated (e.g. "Lagan Laagi Re (feat. Shreya G"), use your knowledge to complete the full song title
- Remove trailing punctuation artifacts, unmatched brackets/parens
- Return the CLEAN base song title, e.g. "Lagan Laagi Re" not "Lagan Laagi Re (feat. Shreya Ghoshal)"
- Include ALL artists (primary + featured) in the artist field, comma-separated`;

export async function extractSongInfo(screenshot: ScreenshotRow): Promise<SongInfo> {
  // Assemble all available metadata signals
  const signals: string[] = [];

  if (screenshot.source_app) {
    signals.push(`SOURCE APP: ${screenshot.source_app}`);
  }
  if (screenshot.summary) {
    signals.push(`SUMMARY: ${screenshot.summary}`);
  }
  if (screenshot.detailed_description) {
    signals.push(`VISION DESCRIPTION: ${screenshot.detailed_description}`);
  }
  if (screenshot.ocr_text) {
    signals.push(`OCR TEXT:\n${screenshot.ocr_text}`);
  }

  const metadataText = signals.length > 0
    ? signals.join("\n\n")
    : "No metadata available — cannot extract song info.";

  return generateJSON(
    EXTRACTION_SYSTEM_PROMPT,
    `Extract song information from this screenshot metadata:\n\n${metadataText}`,
    SongInfoSchema
  );
}

// ══════════════════════════════════════════════════════════════
// STEP 2 — GOOGLE SERP SEARCH + SCORING
// ══════════════════════════════════════════════════════════════

interface ScoredResult {
  result: WebSearchResult;
  score: number;
}

/**
 * Clean a song title for search — strip feat/ft/with clauses,
 * unmatched parens/brackets, and trailing punctuation.
 */
function cleanTitleForSearch(title: string): string {
  let cleaned = title;
  // Remove (feat. ...), (ft. ...), (with ...), [feat. ...] etc — even if truncated
  cleaned = cleaned.replace(/[\(\[]\s*(feat\.?|ft\.?|with)\b[^\)\]]*/gi, "");
  // Remove leftover unmatched parens/brackets
  cleaned = cleaned.replace(/[\(\)\[\]]/g, "");
  // Remove trailing punctuation and whitespace
  cleaned = cleaned.replace(/[\s\-–—,;:!.]+$/, "");
  return cleaned.trim();
}

function buildSearchQuery(songInfo: SongInfo, platform: PlatformConfig): string {
  const parts: string[] = [];

  // Clean and quote song title for search
  if (songInfo.song_title && songInfo.song_title !== "unknown") {
    const cleanTitle = cleanTitleForSearch(songInfo.song_title);
    if (cleanTitle) {
      parts.push(`"${cleanTitle}"`);
    }
  }

  // Quote primary artist (first artist only for tighter match)
  const primaryArtist = songInfo.artist.split(",")[0]?.trim();
  if (primaryArtist) {
    parts.push(`"${primaryArtist}"`);
  }

  // Site filter
  parts.push(`site:${platform.domain}`);

  return parts.join(" ");
}

function scoreResult(
  result: WebSearchResult,
  songInfo: SongInfo,
  platform: PlatformConfig
): number {
  let score = 0;
  const titleLower = result.title.toLowerCase();
  const snippetLower = result.snippet.toLowerCase();
  const linkLower = result.link.toLowerCase();
  const combined = `${titleLower} ${snippetLower}`;

  // Wrong domain → reject entirely
  if (!linkLower.includes(platform.domain)) {
    return -100;
  }

  // Song title match — use cleaned title (no feat/ft cruft)
  const songLower = cleanTitleForSearch(songInfo.song_title).toLowerCase();
  if (songLower && songLower !== "unknown") {
    if (combined.includes(songLower)) {
      score += 10;
    } else {
      // Partial match — check significant words
      const words = songLower.split(/\s+/).filter(w => w.length > 2);
      const matched = words.filter(w => combined.includes(w));
      if (matched.length > 0) {
        score += Math.min(6, matched.length * 2);
      }
    }
  }

  // Artist match
  const artists = songInfo.artist.toLowerCase().split(",").map(a => a.trim());
  for (const artist of artists) {
    if (combined.includes(artist)) {
      score += 8;
      break; // one match is enough
    }
    // Partial artist match
    const artistWords = artist.split(/\s+/).filter(w => w.length > 2);
    const matched = artistWords.filter(w => combined.includes(w));
    if (matched.length > 0) {
      score += Math.min(4, matched.length * 2);
      break;
    }
  }

  // Track URL pattern bonus
  for (const pattern of platform.trackPatterns) {
    if (linkLower.includes(pattern)) {
      score += 3;
      break;
    }
  }

  // Album match (small bonus)
  if (songInfo.album) {
    const albumLower = songInfo.album.toLowerCase();
    if (combined.includes(albumLower)) {
      score += 2;
    }
  }

  return score;
}

async function searchForLink(
  songInfo: SongInfo,
  platform: PlatformConfig
): Promise<{ url: string; confidence: number } | null> {
  const query = buildSearchQuery(songInfo, platform);
  log("search", `SERP query: ${query}`);

  let results: WebSearchResult[];
  try {
    results = await webSearch(query, 5);
  } catch (err) {
    log("warn", `SERP search failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  if (results.length === 0) {
    return null;
  }

  // Score all results
  const scored: ScoredResult[] = results
    .map(r => ({ result: r, score: scoreResult(r, songInfo, platform) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return null;
  }

  const best = scored[0]!;

  // Minimum score threshold
  if (best.score < 5) {
    return null;
  }

  // Convert score to confidence (5=0.5, 10=0.7, 15=0.85, 21+=0.95)
  const confidence = Math.min(0.95, 0.3 + best.score * 0.03);

  return { url: best.result.link, confidence };
}

// ══════════════════════════════════════════════════════════════
// ODESLI FALLBACK — Cross-platform conversion
// ══════════════════════════════════════════════════════════════

interface OdesliResponse {
  linksByPlatform?: Record<string, { url?: string }>;
}

async function odesliLookup(
  sourceUrl: string,
  targetPlatformKey: string
): Promise<string | null> {
  // Map our platform keys to Odesli platform names
  const odesliMap: Record<string, string> = {
    spotify: "spotify",
    "apple music": "appleMusic",
    "youtube music": "youtubeMusic",
    soundcloud: "soundcloud",
    tidal: "tidal",
    deezer: "deezer",
  };

  const odesliPlatform = odesliMap[targetPlatformKey];
  if (!odesliPlatform) return null;

  try {
    const params = new URLSearchParams({ url: sourceUrl });
    const response = await fetch(`https://api.song.link/v1-alpha.1/links?${params}`);
    if (!response.ok) return null;

    const data = (await response.json()) as OdesliResponse;
    return data.linksByPlatform?.[odesliPlatform]?.url ?? null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// DETECT USER'S PREFERRED LISTENING PLATFORM
// ══════════════════════════════════════════════════════════════

export function detectPreferredPlatform(store: KnowledgeStore): string | null {
  // Always count actual music screenshots — this is the ground truth
  const musicScreenshots = store.getScreenshotsByCategory("music");

  const appCounts = new Map<string, number>();
  for (const ss of musicScreenshots) {
    if (!ss.source_app) continue;
    const app = ss.source_app.toLowerCase();
    // Normalize app names to platform keys
    let key: string | null = null;
    if (app.includes("spotify")) key = "spotify";
    else if (app.includes("youtube music") || app.includes("ytmusic")) key = "youtube music";
    else if (app.includes("apple music") || app.includes("music.apple")) key = "apple music";
    else if (app.includes("soundcloud")) key = "soundcloud";
    else if (app.includes("tidal")) key = "tidal";
    else if (app.includes("deezer")) key = "deezer";
    else if (app.includes("bandcamp")) key = "bandcamp";

    if (key) {
      appCounts.set(key, (appCounts.get(key) ?? 0) + 1);
    }
  }

  // If we have screenshot data, use the most frequent platform
  if (appCounts.size > 0) {
    let best: string | null = null;
    let bestCount = 0;
    for (const [key, count] of appCounts) {
      if (count > bestCount) {
        bestCount = count;
        best = key;
      }
    }
    if (best) return best;
  }

  // Fallback: check profile KV (may be set from early screenshots)
  const explicit = store.getProfileValue("music.preferredPlatform");
  if (explicit) return explicit.value.toLowerCase();

  return null;
}

// ══════════════════════════════════════════════════════════════
// MAIN ENTRY — Find music link for a screenshot
// ══════════════════════════════════════════════════════════════

export interface MusicLinkResult {
  songInfo: SongInfo;
  sourceUrl: string | null;
  sourcePlatform: string;
  preferredUrl: string | null;
  preferredPlatform: string | null;
}

/**
 * Extract song info and find streaming links for a music screenshot.
 *
 * @param screenshot - The analyzed screenshot row
 * @param store - KnowledgeStore for platform detection + saving
 * @param findPreferred - Whether to also find the link on user's preferred platform
 */
export async function findMusicLink(
  screenshot: ScreenshotRow,
  store: KnowledgeStore,
  findPreferred = false
): Promise<MusicLinkResult> {
  // Step 1: Extract song info via LLM
  const songInfo = await extractSongInfo(screenshot);

  if (songInfo.song_title === "unknown" || songInfo.confidence < 0.4) {
    return {
      songInfo,
      sourceUrl: null,
      sourcePlatform: songInfo.platform,
      preferredUrl: null,
      preferredPlatform: null,
    };
  }

  // Resolve source platform
  const sourcePlatformKey = songInfo.platform.toLowerCase();
  const sourcePlatform = getPlatformConfig(sourcePlatformKey);

  let sourceUrl: string | null = null;
  let sourceConfidence = 0;

  // Step 2: Search for the link on the source platform
  if (sourcePlatform) {
    const result = await searchForLink(songInfo, sourcePlatform);
    if (result) {
      sourceUrl = result.url;
      sourceConfidence = result.confidence;
    }
  }

  // Step 3: Find link on preferred platform (if different from source)
  let preferredUrl: string | null = null;
  let preferredPlatformKey: string | null = null;

  if (findPreferred) {
    preferredPlatformKey = detectPreferredPlatform(store);

    if (preferredPlatformKey && preferredPlatformKey !== sourcePlatformKey) {
      const preferredPlatform = getPlatformConfig(preferredPlatformKey);

      if (preferredPlatform) {
        // Try Odesli first if we have a source URL (more reliable)
        if (sourceUrl) {
          preferredUrl = await odesliLookup(sourceUrl, preferredPlatformKey);
        }

        // Fallback to Google SERP
        if (!preferredUrl) {
          const result = await searchForLink(songInfo, preferredPlatform);
          if (result) {
            preferredUrl = result.url;
          }
        }
      }
    }
  }

  // Step 4: Save to store
  store.saveMusicLink({
    screenshot_id: screenshot.id,
    song_title: songInfo.song_title,
    artist: songInfo.artist,
    album: songInfo.album ?? null,
    source_platform: sourcePlatformKey,
    source_url: sourceUrl,
    preferred_platform: preferredPlatformKey,
    preferred_url: preferredUrl,
    confidence: sourceConfidence,
  });

  return {
    songInfo,
    sourceUrl,
    sourcePlatform: sourcePlatformKey,
    preferredUrl,
    preferredPlatform: preferredPlatformKey,
  };
}

/**
 * Find music link for a screenshot by ID (convenience wrapper).
 */
export async function findMusicLinkById(
  screenshotId: string,
  store: KnowledgeStore,
  findPreferred = false
): Promise<MusicLinkResult | null> {
  const screenshot = store.getScreenshot(screenshotId);
  if (!screenshot) return null;
  if (screenshot.category !== "music") return null;

  return findMusicLink(screenshot, store, findPreferred);
}
