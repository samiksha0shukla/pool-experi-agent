import { getProfile, saveProfile } from "../store.js";
import type { ScreenshotAnalysis, UserFact } from "./analyze.js";

// ── Types for profile structure ──

interface ProfileFact {
  value: string;
  confidence: number;
  sources: string[];
  evidence: string;
}

interface GenreEntry {
  genre: string;
  strength: number;
  artistCount: number;
}

interface ArtistEntry {
  name: string;
  mentions: number;
  sources: string[];
}

interface SongEntry {
  title: string;
  artist: string;
  source: string;
}

interface TravelInterest {
  destination: string;
  strength: number;
  screenshotCount: number;
  lastSeen: string;
  details: {
    hotelsSaved: string[];
    activitiesSaved: string[];
    foodSaved: string[];
    datesDetected: string[];
    budgetSignals: string[];
  };
}

// ── Update profile from screenshot analysis ──

export async function updateProfileFromAnalysis(
  screenshotId: string,
  analysis: ScreenshotAnalysis
): Promise<{ factsAdded: number; factsReinforced: number }> {
  const profile = await getProfile();
  let factsAdded = 0;
  let factsReinforced = 0;

  // Process user_facts from the analysis
  for (const fact of analysis.user_facts) {
    if (fact.confidence < 0.5) continue; // skip low confidence

    const result = applyFact(profile, screenshotId, fact);
    if (result === "added") factsAdded++;
    if (result === "reinforced") factsReinforced++;
  }

  // Process entities for domain-specific profile enrichment
  if (analysis.category === "music") {
    enrichMusicProfile(profile, screenshotId, analysis);
  } else if (analysis.category === "travel") {
    enrichTravelProfile(profile, screenshotId, analysis);
  } else if (analysis.category === "food") {
    enrichFoodProfile(profile, screenshotId, analysis);
  }

  // Update meta
  const totalScreenshots = ((profile.totalScreenshots as number) || 0) + 1;
  profile.totalScreenshots = totalScreenshots;
  profile.lastUpdated = new Date().toISOString();

  await saveProfile(profile);
  return { factsAdded, factsReinforced };
}

// ── Update profile from conversation (user explicitly says things) ──

export async function updateProfileFromConversation(
  query: string,
  response: string
): Promise<number> {
  // We use the LLM to extract facts from conversation in the orchestrator.
  // This is a lighter version that catches obvious patterns.
  const profile = await getProfile();
  let updated = 0;

  const q = query.toLowerCase();

  // Direct identity corrections
  if (q.includes("my name is ") || q.includes("i'm ") || q.includes("i am ")) {
    const nameMatch = query.match(/(?:my name is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch) {
      setIdentityFact(profile, "name", nameMatch[1], 1.0, "conversation", "user stated directly");
      updated++;
    }
  }

  // Food preference corrections
  if (q.includes("vegetarian") || q.includes("vegan") || q.includes("non-veg")) {
    const general = ensureObj(profile, "general");
    const prefs = ensureArray(general, "foodPreferences") as string[];
    if (q.includes("vegetarian") && !prefs.includes("vegetarian")) {
      prefs.push("vegetarian");
      updated++;
    }
    if (q.includes("vegan") && !prefs.includes("vegan")) {
      prefs.push("vegan");
      updated++;
    }
  }

  if (updated > 0) {
    profile.lastUpdated = new Date().toISOString();
    await saveProfile(profile);
  }
  return updated;
}

// ── Internal helpers ──

function applyFact(
  profile: Record<string, unknown>,
  screenshotId: string,
  fact: UserFact
): "added" | "reinforced" | "skipped" {
  switch (fact.fact) {
    case "name":
    case "location":
      return applyIdentityFact(profile, fact.fact, fact.value, fact.confidence, screenshotId, fact.evidence);

    case "music_platform":
      return applyMusicPlatform(profile, fact.value, fact.confidence, screenshotId);

    case "liked_artist":
    case "favorite_artist":
      return applyArtist(profile, fact.value, screenshotId);

    case "genre_preference":
      return applyGenre(profile, fact.value);

    case "travel_interest":
      return applyTravelInterest(profile, fact.value, screenshotId);

    case "food_preference":
      return applyFoodPreference(profile, fact.value);

    default:
      return "skipped";
  }
}

function applyIdentityFact(
  profile: Record<string, unknown>,
  key: string,
  value: string,
  confidence: number,
  source: string,
  evidence: string
): "added" | "reinforced" {
  return setIdentityFact(profile, key, value, confidence, source, evidence);
}

function setIdentityFact(
  profile: Record<string, unknown>,
  key: string,
  value: string,
  confidence: number,
  source: string,
  evidence: string
): "added" | "reinforced" {
  const identity = ensureObj(profile, "identity");
  const existing = identity[key] as ProfileFact | undefined;

  if (existing && existing.value.toLowerCase() === value.toLowerCase()) {
    // Reinforce
    existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    if (!existing.sources.includes(source)) {
      existing.sources.push(source);
    }
    return "reinforced";
  }

  // New fact (or override if higher confidence)
  if (!existing || confidence > existing.confidence) {
    identity[key] = {
      value,
      confidence,
      sources: [source],
      evidence,
    } satisfies ProfileFact;
    return "added";
  }
  return "reinforced";
}

function applyMusicPlatform(
  profile: Record<string, unknown>,
  platform: string,
  confidence: number,
  source: string
): "added" | "reinforced" {
  const music = ensureObj(profile, "music");
  const existing = music.preferredPlatform as ProfileFact | null | undefined;

  if (existing?.value?.toLowerCase() === platform.toLowerCase()) {
    existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return "reinforced";
  }

  if (!existing?.value || confidence > (existing?.confidence || 0)) {
    music.preferredPlatform = {
      value: platform,
      confidence,
      sources: [source],
      evidence: `Detected from screenshot`,
    } satisfies ProfileFact;
    return "added";
  }
  return "reinforced";
}

function applyArtist(
  profile: Record<string, unknown>,
  artistName: string,
  source: string
): "added" | "reinforced" {
  const music = ensureObj(profile, "music");
  const artists = ensureArray(music, "favoriteArtists") as ArtistEntry[];

  const existing = artists.find(
    (a) => a.name.toLowerCase() === artistName.toLowerCase()
  );
  if (existing) {
    existing.mentions++;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return "reinforced";
  }

  artists.push({ name: artistName, mentions: 1, sources: [source] });
  return "added";
}

function applyGenre(
  profile: Record<string, unknown>,
  genre: string
): "added" | "reinforced" {
  const music = ensureObj(profile, "music");
  const genres = ensureArray(music, "genres") as GenreEntry[];

  const existing = genres.find(
    (g) => g.genre.toLowerCase() === genre.toLowerCase()
  );
  if (existing) {
    existing.strength = Math.min(1.0, existing.strength + 0.1);
    existing.artistCount++;
    return "reinforced";
  }

  genres.push({ genre, strength: 0.5, artistCount: 1 });
  return "added";
}

function applyTravelInterest(
  profile: Record<string, unknown>,
  destination: string,
  source: string
): "added" | "reinforced" {
  const travel = ensureObj(profile, "travel");
  const interests = ensureArray(travel, "interests") as TravelInterest[];

  const existing = interests.find(
    (i) => i.destination.toLowerCase() === destination.toLowerCase()
  );
  if (existing) {
    existing.screenshotCount++;
    existing.strength = Math.min(1.0, existing.strength + 0.1);
    existing.lastSeen = new Date().toISOString();
    return "reinforced";
  }

  interests.push({
    destination,
    strength: 0.5,
    screenshotCount: 1,
    lastSeen: new Date().toISOString(),
    details: {
      hotelsSaved: [],
      activitiesSaved: [],
      foodSaved: [],
      datesDetected: [],
      budgetSignals: [],
    },
  });
  return "added";
}

function applyFoodPreference(
  profile: Record<string, unknown>,
  preference: string
): "added" | "reinforced" {
  const general = ensureObj(profile, "general");
  const prefs = ensureArray(general, "foodPreferences") as string[];

  if (prefs.some((p) => p.toLowerCase() === preference.toLowerCase())) {
    return "reinforced";
  }
  prefs.push(preference);
  return "added";
}

// ── Domain-specific enrichment from entities ──

function enrichMusicProfile(
  profile: Record<string, unknown>,
  screenshotId: string,
  analysis: ScreenshotAnalysis
): void {
  const music = ensureObj(profile, "music");
  const entities = analysis.entities as Record<string, unknown>;

  // Extract songs
  const songs = entities.songs as Array<{ title?: string; name?: string; artist?: string }> | undefined;
  if (songs && Array.isArray(songs)) {
    const likedSongs = ensureArray(music, "likedSongs") as SongEntry[];
    for (const song of songs) {
      const title = song.title || song.name || "";
      const artist = song.artist || "Unknown";
      if (title && !likedSongs.some((s) => s.title.toLowerCase() === title.toLowerCase())) {
        likedSongs.push({ title, artist, source: screenshotId });
      }
    }
  }

  // Extract playlist
  const playlistName = entities.playlist_name || entities.playlistName;
  if (playlistName && typeof playlistName === "string") {
    const playlists = ensureArray(music, "playlistsSeen") as Array<{
      name: string;
      platform: string;
      source: string;
    }>;
    const platform = (entities.platform as string) || "Unknown";
    if (!playlists.some((p) => p.name.toLowerCase() === playlistName.toLowerCase())) {
      playlists.push({ name: playlistName, platform, source: screenshotId });
    }
  }

  // Extract artists from entities directly
  const artistNames = entities.artists || entities.artist;
  if (artistNames) {
    const arr = Array.isArray(artistNames) ? artistNames : [artistNames];
    for (const name of arr) {
      if (typeof name === "string") {
        applyArtist(profile, name, screenshotId);
      }
    }
  }

  // Extract platform
  const platform = entities.platform || entities.streaming_platform;
  if (platform && typeof platform === "string") {
    applyMusicPlatform(profile, platform, 0.85, screenshotId);
  }
}

function enrichTravelProfile(
  profile: Record<string, unknown>,
  screenshotId: string,
  analysis: ScreenshotAnalysis
): void {
  const travel = ensureObj(profile, "travel");
  const entities = analysis.entities as Record<string, unknown>;

  const destination = entities.destination as string | undefined;
  if (destination) {
    applyTravelInterest(profile, destination, screenshotId);

    // Enrich details for existing interest
    const interests = ensureArray(travel, "interests") as TravelInterest[];
    const interest = interests.find(
      (i) => i.destination.toLowerCase() === destination.toLowerCase()
    );
    if (interest) {
      const hotel = entities.hotel || entities.hotel_name;
      if (hotel && typeof hotel === "string" && !interest.details.hotelsSaved.includes(hotel)) {
        interest.details.hotelsSaved.push(hotel);
      }

      const activity = entities.activity || entities.attraction;
      if (activity && typeof activity === "string" && !interest.details.activitiesSaved.includes(activity)) {
        interest.details.activitiesSaved.push(activity);
      }

      const dates = entities.dates || entities.date || entities.travel_dates;
      if (dates && typeof dates === "string" && !interest.details.datesDetected.includes(dates)) {
        interest.details.datesDetected.push(dates);
      }

      const price = entities.price || entities.price_range || entities.budget;
      if (price && typeof price === "string" && !interest.details.budgetSignals.includes(price)) {
        interest.details.budgetSignals.push(price);
      }

      const food = entities.restaurant || entities.food;
      if (food && typeof food === "string" && !interest.details.foodSaved.includes(food)) {
        interest.details.foodSaved.push(food);
      }
    }
  }

  // Travel style from hotels
  const style = ensureObj(travel, "style") as Record<string, string>;
  const hotelType = entities.hotel_type || entities.accommodation_type;
  if (hotelType && typeof hotelType === "string" && !style.accommodation) {
    style.accommodation = hotelType;
  }
}

function enrichFoodProfile(
  profile: Record<string, unknown>,
  _screenshotId: string,
  analysis: ScreenshotAnalysis
): void {
  const entities = analysis.entities as Record<string, unknown>;
  const cuisine = entities.cuisine || entities.cuisine_type;
  if (cuisine && typeof cuisine === "string") {
    applyFoodPreference(profile, cuisine);
  }
}

// ── Utility: safely ensure nested objects/arrays exist ──

function ensureObj(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key] as Record<string, unknown>;
}

function ensureArray(parent: Record<string, unknown>, key: string): unknown[] {
  if (!Array.isArray(parent[key])) {
    parent[key] = [];
  }
  return parent[key] as unknown[];
}
