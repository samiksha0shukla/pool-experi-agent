import {
  getProfile,
  saveProfile,
  type UserProfile,
  type ProfileFact,
  type GenreEntry,
  type ArtistEntry,
  type SongEntry,
  type PlaylistEntry,
  type TravelInterest,
} from "../store.js";
import type { ScreenshotAnalysis, UserFact } from "./analyze.js";

// ══════════════════════════════════════════════════════════════
// UPDATE PROFILE FROM SCREENSHOT ANALYSIS
// ══════════════════════════════════════════════════════════════

export async function updateProfileFromAnalysis(
  screenshotId: string,
  analysis: ScreenshotAnalysis
): Promise<{ factsAdded: number; factsReinforced: number }> {
  const profile = await getProfile();
  let factsAdded = 0;
  let factsReinforced = 0;

  // 1. Process explicit user_facts from vision analysis
  for (const fact of analysis.user_facts) {
    if (fact.confidence < 0.5) continue;
    const result = applyUserFact(profile, screenshotId, fact);
    if (result === "added") factsAdded++;
    if (result === "reinforced") factsReinforced++;
  }

  // 2. Domain-specific enrichment from entities
  if (analysis.category === "music") {
    const r = enrichMusicProfile(profile, screenshotId, analysis);
    factsAdded += r.added;
    factsReinforced += r.reinforced;
  } else if (analysis.category === "travel") {
    const r = enrichTravelProfile(profile, screenshotId, analysis);
    factsAdded += r.added;
    factsReinforced += r.reinforced;
  } else if (analysis.category === "food") {
    enrichFoodProfile(profile, analysis);
  }

  // 3. Update general signals from category patterns
  updateGeneralSignals(profile, analysis);

  // 4. Bump meta
  profile.totalScreenshots++;
  profile.profileVersion++;
  profile.lastUpdated = new Date().toISOString();

  await saveProfile(profile);
  return { factsAdded, factsReinforced };
}

// ══════════════════════════════════════════════════════════════
// UPDATE PROFILE FROM CONVERSATION
// ══════════════════════════════════════════════════════════════

export async function updateProfileFromConversation(
  query: string,
  _response: string
): Promise<number> {
  const profile = await getProfile();
  let updated = 0;

  const q = query.toLowerCase();

  // ── Name ──
  const nameMatch = query.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (nameMatch) {
    setIdentityFact(profile, "name", nameMatch[1], 1.0, "conversation", "user stated directly");
    updated++;
  }

  // ── Location ──
  const locMatch = query.match(/(?:i live in|i'm from|i am from|based in|located in)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+)*)/i);
  if (locMatch) {
    setIdentityFact(profile, "location", locMatch[1], 1.0, "conversation", "user stated directly");
    updated++;
  }

  // ── Food preferences ──
  if (/\b(vegetarian|vegan|non-veg|pescatarian|gluten.free)\b/i.test(q)) {
    const match = q.match(/\b(vegetarian|vegan|non-veg|pescatarian|gluten.free)\b/i);
    if (match && !profile.general.foodPreferences.some(
      (p) => p.toLowerCase() === match[1].toLowerCase()
    )) {
      profile.general.foodPreferences.push(match[1]);
      updated++;
    }
  }

  // ── Music platform preference ──
  const platMatch = q.match(/i (?:use|prefer|listen on|like)\s+(spotify|youtube music|apple music|amazon music)/i);
  if (platMatch) {
    profile.music.preferredPlatform = {
      value: platMatch[1],
      confidence: 1.0,
      sources: ["conversation"],
      evidence: "user stated directly",
    };
    updated++;
  }

  // ── Context-based listening ──
  const contextMatch = query.match(/(?:i (?:prefer|like|listen to))\s+(.+?)\s+(?:when|while|for)\s+(working|studying|sleeping|driving|exercising|cooking)/i);
  if (contextMatch) {
    profile.music.listeningPatterns.contextPreferences[contextMatch[2].toLowerCase()] = contextMatch[1];
    updated++;
  }

  // ── Budget style ──
  if (/\b(budget|luxury|mid.range|backpack|premium)\b/i.test(q) && /\b(travel|trip|hotel)\b/i.test(q)) {
    const budgetMatch = q.match(/\b(budget|luxury|mid-range|backpacker|premium)\b/i);
    if (budgetMatch) {
      profile.general.budgetStyle = budgetMatch[1];
      updated++;
    }
  }

  // ── Language ──
  const langMatch = query.match(/i speak\s+(.+?)(?:\.|$)/i);
  if (langMatch) {
    profile.general.language = langMatch[1].trim();
    updated++;
  }

  if (updated > 0) {
    profile.profileVersion++;
    profile.lastUpdated = new Date().toISOString();
    await saveProfile(profile);
  }
  return updated;
}

// ══════════════════════════════════════════════════════════════
// FACT ROUTING
// ══════════════════════════════════════════════════════════════

function applyUserFact(
  profile: UserProfile,
  screenshotId: string,
  fact: UserFact
): "added" | "reinforced" | "skipped" {
  switch (fact.fact) {
    case "name":
    case "location":
      return setIdentityFact(profile, fact.fact, fact.value, fact.confidence, screenshotId, fact.evidence);

    case "music_platform":
      return setMusicPlatform(profile, fact.value, fact.confidence, screenshotId);

    case "liked_artist":
    case "favorite_artist":
      return addArtist(profile, fact.value, screenshotId);

    case "genre_preference":
      return addGenre(profile, fact.value);

    case "travel_interest":
      return addTravelInterest(profile, fact.value, screenshotId);

    case "food_preference":
      return addFoodPreference(profile, fact.value);

    case "language":
    case "language_preference":
      if (!profile.music.listeningPatterns.languages.includes(fact.value)) {
        profile.music.listeningPatterns.languages.push(fact.value);
      }
      if (!profile.general.language) {
        profile.general.language = fact.value;
      }
      return "added";

    default:
      return "skipped";
  }
}

// ══════════════════════════════════════════════════════════════
// IDENTITY FACTS
// ══════════════════════════════════════════════════════════════

function setIdentityFact(
  profile: UserProfile,
  key: string,
  value: string,
  confidence: number,
  source: string,
  evidence: string
): "added" | "reinforced" {
  const existing = profile.identity[key];

  if (existing && existing.value.toLowerCase() === value.toLowerCase()) {
    existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return "reinforced";
  }

  if (!existing || confidence > existing.confidence) {
    profile.identity[key] = { value, confidence, sources: [source], evidence };
    return "added";
  }
  return "reinforced";
}

// ══════════════════════════════════════════════════════════════
// MUSIC PROFILE
// ══════════════════════════════════════════════════════════════

function setMusicPlatform(
  profile: UserProfile,
  platform: string,
  confidence: number,
  source: string
): "added" | "reinforced" {
  const existing = profile.music.preferredPlatform;

  if (existing && existing.value.toLowerCase() === platform.toLowerCase()) {
    existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return "reinforced";
  }

  if (!existing || confidence > existing.confidence) {
    profile.music.preferredPlatform = {
      value: platform,
      confidence,
      sources: [source],
      evidence: "Detected from screenshot",
    };
    return "added";
  }
  return "reinforced";
}

function addArtist(profile: UserProfile, name: string, source: string): "added" | "reinforced" {
  const existing = profile.music.favoriteArtists.find(
    (a) => a.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    existing.mentions++;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return "reinforced";
  }
  profile.music.favoriteArtists.push({ name, mentions: 1, sources: [source] });
  return "added";
}

function addGenre(profile: UserProfile, genre: string): "added" | "reinforced" {
  const existing = profile.music.genres.find(
    (g) => g.genre.toLowerCase() === genre.toLowerCase()
  );
  if (existing) {
    existing.strength = Math.min(1.0, existing.strength + 0.1);
    existing.artistCount++;
    return "reinforced";
  }
  profile.music.genres.push({ genre, strength: 0.5, artistCount: 1 });
  return "added";
}

function addSong(profile: UserProfile, title: string, artist: string, source: string): void {
  if (!profile.music.likedSongs.some((s) => s.title.toLowerCase() === title.toLowerCase())) {
    profile.music.likedSongs.push({ title, artist, source });
  }
}

function addPlaylist(profile: UserProfile, name: string, platform: string, source: string): void {
  if (!profile.music.playlistsSeen.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    profile.music.playlistsSeen.push({ name, platform, source });
  }
}

// ══════════════════════════════════════════════════════════════
// TRAVEL PROFILE
// ══════════════════════════════════════════════════════════════

function addTravelInterest(
  profile: UserProfile,
  destination: string,
  source: string
): "added" | "reinforced" {
  const existing = profile.travel.interests.find(
    (i) => i.destination.toLowerCase() === destination.toLowerCase()
  );
  if (existing) {
    existing.screenshotCount++;
    existing.strength = Math.min(1.0, existing.strength + 0.1);
    existing.lastSeen = new Date().toISOString();
    return "reinforced";
  }
  profile.travel.interests.push({
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

function addFoodPreference(profile: UserProfile, pref: string): "added" | "reinforced" {
  if (profile.general.foodPreferences.some((p) => p.toLowerCase() === pref.toLowerCase())) {
    return "reinforced";
  }
  profile.general.foodPreferences.push(pref);
  return "added";
}

// ══════════════════════════════════════════════════════════════
// DOMAIN-SPECIFIC ENRICHMENT FROM ENTITIES
// ══════════════════════════════════════════════════════════════

function enrichMusicProfile(
  profile: UserProfile,
  screenshotId: string,
  analysis: ScreenshotAnalysis
): { added: number; reinforced: number } {
  let added = 0;
  let reinforced = 0;
  const e = analysis.entities;

  // Songs
  if (e.songs && Array.isArray(e.songs)) {
    for (const song of e.songs) {
      const title = song.title || "";
      const artist = song.artist || "Unknown";
      if (title) addSong(profile, title, artist, screenshotId);
    }
  }

  // Playlist
  const playlistName = e.playlistName || (e as Record<string, unknown>).playlist_name;
  if (playlistName && typeof playlistName === "string") {
    const platform = e.platform || "Unknown";
    addPlaylist(profile, playlistName, platform, screenshotId);
  }

  // Artists from entities
  if (e.artists && Array.isArray(e.artists)) {
    for (const name of e.artists) {
      if (typeof name === "string") {
        const r = addArtist(profile, name, screenshotId);
        if (r === "added") added++;
        else reinforced++;
      }
    }
  }

  // Genres from entities
  if (e.genres && Array.isArray(e.genres)) {
    for (const g of e.genres) {
      if (typeof g === "string") {
        const r = addGenre(profile, g);
        if (r === "added") added++;
        else reinforced++;
      }
    }
  }

  // Platform from entities
  if (e.platform && typeof e.platform === "string") {
    const r = setMusicPlatform(profile, e.platform, 0.85, screenshotId);
    if (r === "added") added++;
    else reinforced++;
  }

  // Source app as platform hint
  if (analysis.sourceApp) {
    const appLower = analysis.sourceApp.toLowerCase();
    const platformMap: Record<string, string> = {
      spotify: "Spotify",
      "youtube music": "YouTube Music",
      "apple music": "Apple Music",
      "amazon music": "Amazon Music",
    };
    const detected = platformMap[appLower];
    if (detected) {
      const r = setMusicPlatform(profile, detected, 0.9, screenshotId);
      if (r === "added") added++;
      else reinforced++;
    }
  }

  // Infer listening patterns from accumulated data
  inferListeningPatterns(profile);

  return { added, reinforced };
}

function enrichTravelProfile(
  profile: UserProfile,
  screenshotId: string,
  analysis: ScreenshotAnalysis
): { added: number; reinforced: number } {
  let added = 0;
  let reinforced = 0;
  const e = analysis.entities;

  // Destination
  const destination = e.destination;
  if (destination && typeof destination === "string") {
    const r = addTravelInterest(profile, destination, screenshotId);
    if (r === "added") added++;
    else reinforced++;

    // Enrich details
    const interest = profile.travel.interests.find(
      (i) => i.destination.toLowerCase() === destination.toLowerCase()
    );
    if (interest) {
      if (e.hotel && typeof e.hotel === "string" && !interest.details.hotelsSaved.includes(e.hotel)) {
        interest.details.hotelsSaved.push(e.hotel);
      }
      if (e.activity && typeof e.activity === "string" && !interest.details.activitiesSaved.includes(e.activity)) {
        interest.details.activitiesSaved.push(e.activity);
      }
      if (e.dates && typeof e.dates === "string" && !interest.details.datesDetected.includes(e.dates)) {
        interest.details.datesDetected.push(e.dates);
      }
      if (e.price && typeof e.price === "string" && !interest.details.budgetSignals.includes(e.price)) {
        interest.details.budgetSignals.push(e.price);
      }
      if (e.restaurant && typeof e.restaurant === "string" && !interest.details.foodSaved.includes(e.restaurant)) {
        interest.details.foodSaved.push(e.restaurant);
      }
    }
  }

  // Travel style from hotel type
  const hotelType = (e as Record<string, unknown>).hotel_type || (e as Record<string, unknown>).accommodation_type;
  if (hotelType && typeof hotelType === "string" && !profile.travel.style.accommodation) {
    profile.travel.style.accommodation = hotelType;
  }

  // Budget signals → general budget style
  if (e.price && typeof e.price === "string" && !profile.general.budgetStyle) {
    const priceLower = e.price.toLowerCase();
    if (priceLower.includes("budget") || priceLower.includes("cheap")) {
      profile.general.budgetStyle = "budget";
    } else if (priceLower.includes("luxury") || priceLower.includes("premium")) {
      profile.general.budgetStyle = "luxury";
    }
  }

  return { added, reinforced };
}

function enrichFoodProfile(profile: UserProfile, analysis: ScreenshotAnalysis): void {
  const e = analysis.entities;
  if (e.cuisine && typeof e.cuisine === "string") {
    addFoodPreference(profile, e.cuisine);
  }
  if (e.restaurant && typeof e.restaurant === "string") {
    // Restaurant name hints at food preference — but don't add the restaurant name itself as a food pref
  }
}

// ══════════════════════════════════════════════════════════════
// INFER HIGHER-LEVEL PATTERNS FROM ACCUMULATED DATA
// ══════════════════════════════════════════════════════════════

function inferListeningPatterns(profile: UserProfile): void {
  const genres = profile.music.genres;
  if (genres.length === 0) return;

  // Mood preference — infer from genre names
  const genreNames = genres.map((g) => g.genre.toLowerCase()).join(", ");
  if (/lo.?fi|chill|ambient|relaxing|acoustic/i.test(genreNames)) {
    profile.music.listeningPatterns.moodPreference = "chill, relaxed";
  } else if (/rock|metal|punk|hard/i.test(genreNames)) {
    profile.music.listeningPatterns.moodPreference = "energetic, intense";
  } else if (/indie|alternative|folk/i.test(genreNames)) {
    profile.music.listeningPatterns.moodPreference = "introspective, indie";
  } else if (/pop|dance|edm|electronic/i.test(genreNames)) {
    profile.music.listeningPatterns.moodPreference = "upbeat, pop";
  } else if (/classical|jazz|blues/i.test(genreNames)) {
    profile.music.listeningPatterns.moodPreference = "sophisticated, mellow";
  }

  // Energy level
  if (/lo.?fi|chill|ambient|acoustic|soft|ballad/i.test(genreNames)) {
    profile.music.listeningPatterns.energyLevel = "low";
  } else if (/edm|metal|punk|hardcore|drum/i.test(genreNames)) {
    profile.music.listeningPatterns.energyLevel = "high";
  } else {
    profile.music.listeningPatterns.energyLevel = "medium";
  }
}

function updateGeneralSignals(profile: UserProfile, analysis: ScreenshotAnalysis): void {
  // Track category distribution to infer personality
  const cat = analysis.category;
  const signals = profile.general.personalitySignals;

  const signalMap: Record<string, string> = {
    music: "music enthusiast",
    travel: "travel-oriented",
    food: "foodie",
    shopping: "shopper",
    personal: "social/personal",
  };

  const signal = signalMap[cat];
  if (signal && !signals.includes(signal)) {
    signals.push(signal);
  }

  // Detect language from sourceApp/content
  if (analysis.sourceApp) {
    // Language detection from app names is limited; mainly captured via user_facts
  }
}
