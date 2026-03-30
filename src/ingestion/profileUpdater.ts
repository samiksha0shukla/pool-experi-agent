/**
 * PROFILE UPDATER
 *
 * Pure code logic — no LLM calls. Takes structured analysis output
 * and deterministically routes facts into the user profile.
 *
 * Two entry points:
 *   1. updateProfileFromAnalysis()  — called after each screenshot is analyzed
 *   2. updateProfileFromConversation() — called after each chat interaction
 *
 * Rules (from AGENT_V1_ARCHITECTURE.md):
 *   1. ONLY add facts with evidence (screenshot_id or "conversation")
 *   2. REINFORCE existing facts → confidence increases, source list grows
 *   3. NEVER remove facts based on absence
 *   4. NEVER assume — if unsure, don't add
 *   5. Contradictions → keep BOTH, higher confidence wins for display
 *   6. User corrections (conversation) → confidence 1.0, always override
 *   7. Confidence thresholds: <0.5 skip, 0.5-0.8 with caveat, >0.8 confident
 */

import {
  getProfile,
  saveProfile,
  type UserProfile,
  type ProfileFact,
} from "../store.js";
import type { ScreenshotAnalysis, UserFact } from "./analyze.js";

// ══════════════════════════════════════════════════════════════
// PUBLIC: UPDATE FROM SCREENSHOT ANALYSIS
// ══════════════════════════════════════════════════════════════

export async function updateProfileFromAnalysis(
  screenshotId: string,
  analysis: ScreenshotAnalysis
): Promise<{ factsAdded: number; factsReinforced: number }> {
  const profile = await getProfile();
  let factsAdded = 0;
  let factsReinforced = 0;

  const count = (r: "added" | "reinforced" | "skipped") => {
    if (r === "added") factsAdded++;
    if (r === "reinforced") factsReinforced++;
  };

  // ── 1. Process explicit user_facts from vision analysis ──
  for (const fact of analysis.user_facts) {
    if (fact.confidence < 0.5) continue;
    count(routeUserFact(profile, screenshotId, fact));
  }

  // ── 2. Process entities from vision analysis ──
  // Entities are the structured data (songs, artists, destinations, etc.)
  // that the vision model extracted. These go into domain-specific profile sections.
  const e = analysis.entities;

  if (analysis.category === "music") {
    // Platform — from entities AND from sourceApp detection
    if (e.platform) count(setMusicPlatform(profile, e.platform, 0.85, screenshotId));
    if (analysis.sourceApp) {
      const mapped = mapAppToPlatform(analysis.sourceApp);
      if (mapped) count(setMusicPlatform(profile, mapped, 0.9, screenshotId));
    }

    // Artists
    if (e.artists) {
      for (const name of e.artists) count(addArtist(profile, name, screenshotId));
    }

    // Genres
    if (e.genres) {
      for (const g of e.genres) count(addGenre(profile, g));
    }

    // Songs
    if (e.songs) {
      for (const song of e.songs) {
        if (song.title) addSong(profile, song.title, song.artist || "Unknown", screenshotId);
      }
    }

    // Playlist
    if (e.playlistName) {
      addPlaylist(profile, e.playlistName, e.platform || analysis.sourceApp || "Unknown", screenshotId);
    }

    // After accumulating music data, infer listening patterns
    inferListeningPatterns(profile);
  }

  if (analysis.category === "travel") {
    // Destination
    if (e.destination) {
      count(addTravelInterest(profile, e.destination, screenshotId));
      enrichTravelDetails(profile, e.destination, e, screenshotId);
    }

    // Origin city → user's home location (weak signal)
    if (e.origin) {
      count(setIdentityFact(profile, "location", e.origin, 0.6, screenshotId, "flight origin city"));
    }

    // Travel style from entity signals
    inferTravelStyle(profile, e);
  }

  if (analysis.category === "food") {
    if (e.cuisine) count(addFoodPreference(profile, e.cuisine));
    if (e.restaurant) addRestaurant(profile, e.restaurant, e.cuisine, e.location);
  }

  // ── 3. Cross-domain extraction ──
  // A personal screenshot might contain a name. A food screenshot might contain a location.
  if (e.personName) count(setIdentityFact(profile, "name", e.personName, 0.7, screenshotId, "name visible in screenshot"));
  if (e.location && analysis.category !== "travel") {
    count(setIdentityFact(profile, "location", e.location, 0.5, screenshotId, "location visible in screenshot"));
  }

  // ── 4. General signals ──
  addPersonalitySignal(profile, analysis.category);

  // ── 5. Meta ──
  profile.totalScreenshots++;
  profile.profileVersion++;
  profile.lastUpdated = new Date().toISOString();

  await saveProfile(profile);
  return { factsAdded, factsReinforced };
}

// ══════════════════════════════════════════════════════════════
// PUBLIC: UPDATE FROM CONVERSATION
// ══════════════════════════════════════════════════════════════

export async function updateProfileFromConversation(
  query: string,
  _response: string
): Promise<number> {
  const profile = await getProfile();
  let updated = 0;
  const q = query.toLowerCase();

  // All conversation-extracted facts get confidence 1.0 (user stated directly)

  // ── Identity ──
  updated += matchAndApply(query,
    /(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    (m) => setIdentityFact(profile, "name", m[1], 1.0, "conversation", "user stated directly") === "added" ? 1 : 0
  );

  updated += matchAndApply(query,
    /(?:i live in|i'm from|i am from|based in|located in|i stay in|my city is|my home is)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+)*)/i,
    (m) => setIdentityFact(profile, "location", m[1], 1.0, "conversation", "user stated directly") === "added" ? 1 : 0
  );

  // ── Food preferences ──
  const foodPatterns = /\b(vegetarian|vegan|non[- ]?veg|pescatarian|gluten[- ]?free|halal|kosher|jain|eggetarian|lacto[- ]?vegetarian)\b/gi;
  let foodMatch;
  while ((foodMatch = foodPatterns.exec(q)) !== null) {
    const pref = foodMatch[1].toLowerCase();
    if (!profile.general.foodPreferences.some((p) => p.toLowerCase() === pref)) {
      profile.general.foodPreferences.push(pref);
      updated++;
    }
    // Architecture rule: food preference should also update travel style
    if (!profile.travel.style.food || !profile.travel.style.food.includes(pref)) {
      profile.travel.style.food = profile.travel.style.food
        ? `${profile.travel.style.food}, ${pref} options important`
        : `${pref} options important`;
    }
  }

  // ── Music platform ──
  const platMatch = q.match(/(?:i\s+(?:use|prefer|listen\s+on|like|love)|my\s+(?:platform|app)\s+is)\s+(spotify|youtube\s*music|apple\s*music|amazon\s*music|soundcloud|tidal|deezer)/i);
  if (platMatch) {
    profile.music.preferredPlatform = {
      value: platMatch[1].trim(),
      confidence: 1.0,
      sources: ["conversation"],
      evidence: "user stated directly",
    };
    updated++;
  }

  // ── Listening context preferences ──
  const contextMatch = query.match(/(?:i\s+(?:prefer|like|listen\s+to|play|enjoy))\s+(.+?)\s+(?:when|while|for|during)\s+(working|studying|sleeping|driving|exercising|cooking|relaxing|running|meditating|reading|commuting|partying)/i);
  if (contextMatch) {
    profile.music.listeningPatterns.contextPreferences[contextMatch[2].toLowerCase()] = contextMatch[1].trim();
    updated++;
  }

  // ── Music mood / energy ──
  const moodMatch = q.match(/i\s+(?:like|prefer|enjoy|love)\s+(chill|energetic|upbeat|calm|intense|mellow|relaxing|sad|happy|introspective|dark|ambient)\s+music/i);
  if (moodMatch) {
    profile.music.listeningPatterns.moodPreference = moodMatch[1].toLowerCase();
    updated++;
  }

  // ── Budget style ──
  const budgetMatch = q.match(/(?:i\s+(?:am|like|prefer|travel)\s+(?:a\s+)?|my\s+(?:style|budget)\s+is\s+)(budget|luxury|mid[- ]?range|backpack(?:er|ing)?|premium|frugal|splurge)/i);
  if (budgetMatch) {
    profile.general.budgetStyle = budgetMatch[1].toLowerCase();
    profile.travel.style.budget = budgetMatch[1].toLowerCase();
    updated++;
  }

  // ── Travel pace ──
  const paceMatch = q.match(/(?:i\s+(?:like|prefer|want)\s+(?:a\s+)?)(relaxed|packed|slow|fast|chill|intense|busy|lazy|moderate)\s+(?:pace|itinerary|trip|travel|schedule)/i);
  if (paceMatch) {
    profile.travel.style.pace = paceMatch[1].toLowerCase();
    updated++;
  }

  // ── Travel activities ──
  const actMatch = q.match(/i\s+(?:like|prefer|enjoy|love)\s+(adventure|culture|beaches|nature|shopping|nightlife|history|food|hiking|photography|art|museums|temples|sightseeing)\s+(?:when\s+)?(?:travel|trip|vacation)?/i);
  if (actMatch) {
    profile.travel.style.activities = profile.travel.style.activities
      ? `${profile.travel.style.activities}, ${actMatch[1].toLowerCase()}`
      : actMatch[1].toLowerCase();
    updated++;
  }

  // ── Travel accommodation ──
  const accomMatch = q.match(/i\s+(?:like|prefer|stay\s+in|book)\s+(hostels?|hotels?|boutique\s+hotels?|airbnb|resorts?|ryokans?|homestays?|luxury\s+hotels?|budget\s+hotels?)/i);
  if (accomMatch) {
    profile.travel.style.accommodation = accomMatch[1].toLowerCase();
    updated++;
  }

  // ── Language ──
  const langMatch = query.match(/i\s+speak\s+(.+?)(?:\.|,|$)/i);
  if (langMatch) {
    profile.general.language = langMatch[1].trim();
    const langs = langMatch[1].split(/[,&]|\s+and\s+/).map((l) => l.trim()).filter(Boolean);
    for (const lang of langs) {
      if (!profile.music.listeningPatterns.languages.includes(lang)) {
        profile.music.listeningPatterns.languages.push(lang);
      }
    }
    updated++;
  }

  // ── Artist likes from conversation ──
  const artistMatch = query.match(/i\s+(?:like|love|listen\s+to|enjoy|am\s+a\s+fan\s+of)\s+(.+?)(?:\.|,\s+and|$)/i);
  if (artistMatch && /music|song|artist|band/i.test(q)) {
    const names = artistMatch[1].split(/[,&]|\s+and\s+/).map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      if (name.length > 1 && name.length < 50) {
        addArtist(profile, name, "conversation");
        updated++;
      }
    }
  }

  if (updated > 0) {
    profile.profileVersion++;
    profile.lastUpdated = new Date().toISOString();
    await saveProfile(profile);
  }
  return updated;
}

// ══════════════════════════════════════════════════════════════
// FACT ROUTING — routes a user_fact to the correct profile field
// ══════════════════════════════════════════════════════════════

function routeUserFact(
  profile: UserProfile,
  screenshotId: string,
  fact: UserFact
): "added" | "reinforced" | "skipped" {
  const f = fact.fact.toLowerCase().replace(/[\s_-]+/g, "_");

  switch (f) {
    case "name":
    case "user_name":
    case "person_name":
      return setIdentityFact(profile, "name", fact.value, fact.confidence, screenshotId, fact.evidence);

    case "location":
    case "city":
    case "home_city":
    case "user_location":
      return setIdentityFact(profile, "location", fact.value, fact.confidence, screenshotId, fact.evidence);

    case "music_platform":
    case "streaming_platform":
    case "preferred_platform":
      return setMusicPlatform(profile, fact.value, fact.confidence, screenshotId);

    case "liked_artist":
    case "favorite_artist":
    case "artist":
      return addArtist(profile, fact.value, screenshotId);

    case "genre_preference":
    case "genre":
    case "music_genre":
      return addGenre(profile, fact.value);

    case "travel_interest":
    case "destination":
    case "travel_destination":
      return addTravelInterest(profile, fact.value, screenshotId);

    case "food_preference":
    case "cuisine_preference":
    case "dietary_preference":
      return addFoodPreference(profile, fact.value);

    case "language":
    case "language_preference":
    case "content_language":
      if (!profile.music.listeningPatterns.languages.includes(fact.value)) {
        profile.music.listeningPatterns.languages.push(fact.value);
      }
      if (!profile.general.language) {
        profile.general.language = fact.value;
      } else if (!profile.general.language.toLowerCase().includes(fact.value.toLowerCase())) {
        profile.general.language += `, ${fact.value}`;
      }
      return "added";

    case "budget":
    case "budget_style":
    case "spending_style":
      if (!profile.general.budgetStyle) profile.general.budgetStyle = fact.value;
      return "added";

    case "mood_preference":
    case "listening_mood":
      if (!profile.music.listeningPatterns.moodPreference) {
        profile.music.listeningPatterns.moodPreference = fact.value;
      }
      return "added";

    default:
      return "skipped";
  }
}

// ══════════════════════════════════════════════════════════════
// IDENTITY
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

  // Same value → reinforce
  if (existing && existing.value.toLowerCase() === value.toLowerCase()) {
    existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return "reinforced";
  }

  // Contradiction → keep BOTH if old has decent confidence, but new wins display
  // (Architecture rule #5: contradictions → keep both)
  if (existing && existing.confidence >= 0.5 && confidence < existing.confidence) {
    // Old is stronger — keep old, store new as alternative
    const altKey = `${key}_alt`;
    if (!profile.identity[altKey]) {
      profile.identity[altKey] = { value, confidence, sources: [source], evidence };
    }
    return "skipped" as "reinforced"; // don't count as added since primary didn't change
  }

  // New fact or higher confidence → set as primary
  if (existing && existing.confidence >= 0.5) {
    // Save old as alternative before overwriting
    const altKey = `${key}_alt`;
    profile.identity[altKey] = { ...existing };
  }
  profile.identity[key] = { value, confidence, sources: [source], evidence };
  return "added";
}

// ══════════════════════════════════════════════════════════════
// MUSIC
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
      evidence: `Detected from ${source.startsWith("ss_") ? "screenshot" : source}`,
    };
    return "added";
  }
  return "reinforced";
}

function addArtist(profile: UserProfile, name: string, source: string): "added" | "reinforced" {
  if (!name || name.length < 2) return "skipped" as "reinforced";

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
  if (!genre || genre.length < 2) return "skipped" as "reinforced";

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
  if (!title) return;
  if (!profile.music.likedSongs.some((s) =>
    s.title.toLowerCase() === title.toLowerCase() && s.artist.toLowerCase() === artist.toLowerCase()
  )) {
    profile.music.likedSongs.push({ title, artist, source });
  }
}

function addPlaylist(profile: UserProfile, name: string, platform: string, source: string): void {
  if (!name) return;
  if (!profile.music.playlistsSeen.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    profile.music.playlistsSeen.push({ name, platform, source });
  }
}

function mapAppToPlatform(sourceApp: string): string | null {
  const map: Record<string, string> = {
    spotify: "Spotify",
    "youtube music": "YouTube Music",
    "apple music": "Apple Music",
    "amazon music": "Amazon Music",
    soundcloud: "SoundCloud",
    tidal: "TIDAL",
    deezer: "Deezer",
  };
  return map[sourceApp.toLowerCase()] || null;
}

function inferListeningPatterns(profile: UserProfile): void {
  const genres = profile.music.genres;
  if (genres.length === 0) return;

  // Build weighted genre string — stronger genres matter more
  const sorted = [...genres].sort((a, b) => b.strength - a.strength);
  const topGenres = sorted.slice(0, 5).map((g) => g.genre.toLowerCase());
  const genreStr = topGenres.join(" ");

  // Mood — inferred from dominant genres
  const moodRules: Array<{ pattern: RegExp; mood: string }> = [
    { pattern: /lo.?fi|chill|ambient|relaxing|acoustic|soft/, mood: "chill, relaxed" },
    { pattern: /indie|alternative|folk|singer.songwriter/, mood: "introspective, indie" },
    { pattern: /rock|metal|punk|grunge|hardcore/, mood: "energetic, intense" },
    { pattern: /pop|dance|edm|electronic|house|techno/, mood: "upbeat, energetic" },
    { pattern: /classical|jazz|blues|soul|r&b/, mood: "sophisticated, mellow" },
    { pattern: /hip.?hop|rap|trap/, mood: "rhythmic, urban" },
    { pattern: /bollywood|desi|punjabi|indian/, mood: "desi, vibrant" },
    { pattern: /country|bluegrass|americana/, mood: "warm, storytelling" },
  ];

  for (const rule of moodRules) {
    if (rule.pattern.test(genreStr)) {
      profile.music.listeningPatterns.moodPreference = rule.mood;
      break;
    }
  }

  // Energy — from genre characteristics
  if (/lo.?fi|chill|ambient|acoustic|soft|ballad|classical|jazz/i.test(genreStr)) {
    profile.music.listeningPatterns.energyLevel = "low";
  } else if (/edm|metal|punk|hardcore|drum|techno|house|trap/i.test(genreStr)) {
    profile.music.listeningPatterns.energyLevel = "high";
  } else {
    profile.music.listeningPatterns.energyLevel = "medium";
  }
}

// ══════════════════════════════════════════════════════════════
// TRAVEL
// ══════════════════════════════════════════════════════════════

function addTravelInterest(
  profile: UserProfile,
  destination: string,
  source: string
): "added" | "reinforced" {
  if (!destination || destination.length < 2) return "skipped" as "reinforced";

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

function enrichTravelDetails(
  profile: UserProfile,
  destination: string,
  entities: Record<string, unknown>,
  _screenshotId: string
): void {
  const interest = profile.travel.interests.find(
    (i) => i.destination.toLowerCase() === destination.toLowerCase()
  );
  if (!interest) return;

  const d = interest.details;
  const pushUnique = (arr: string[], val: unknown) => {
    if (val && typeof val === "string" && !arr.includes(val)) arr.push(val);
  };

  pushUnique(d.hotelsSaved, entities.hotel);
  pushUnique(d.activitiesSaved, entities.activity);
  pushUnique(d.foodSaved, entities.restaurant);
  pushUnique(d.datesDetected, entities.dates || entities.date);
  pushUnique(d.budgetSignals, entities.price);
}

function inferTravelStyle(
  profile: UserProfile,
  entities: Record<string, unknown>
): void {
  const style = profile.travel.style;

  // Hotel type → accommodation style
  const hotelType = entities.hotel_type || entities.accommodation_type;
  if (hotelType && typeof hotelType === "string" && !style.accommodation) {
    style.accommodation = hotelType;
  }

  // Price signals → budget style
  if (entities.price && typeof entities.price === "string" && !profile.general.budgetStyle) {
    const p = (entities.price as string).toLowerCase();
    if (/\b(budget|cheap|hostel|under\s*[₹$€]\s*\d{3})\b/.test(p)) {
      profile.general.budgetStyle = "budget";
      style.budget = "budget";
    } else if (/\b(luxury|premium|5\s*star|suite|resort)\b/.test(p)) {
      profile.general.budgetStyle = "luxury";
      style.budget = "luxury";
    } else if (/\b(mid|moderate|3\s*star|4\s*star)\b/.test(p)) {
      profile.general.budgetStyle = "mid-range";
      style.budget = "mid-range";
    }
  }

  // Airline class → budget signal
  const airlineClass = entities.cabin_class || entities.travel_class;
  if (airlineClass && typeof airlineClass === "string") {
    const c = airlineClass.toLowerCase();
    if (c.includes("business") || c.includes("first")) {
      if (!style.budget) style.budget = "premium";
    } else if (c.includes("economy")) {
      if (!style.budget) style.budget = "value-conscious";
    }
  }
}

// ══════════════════════════════════════════════════════════════
// FOOD
// ══════════════════════════════════════════════════════════════

function addFoodPreference(profile: UserProfile, pref: string): "added" | "reinforced" {
  if (!pref || pref.length < 2) return "skipped" as "reinforced";

  if (profile.general.foodPreferences.some((p) => p.toLowerCase() === pref.toLowerCase())) {
    return "reinforced";
  }
  profile.general.foodPreferences.push(pref);
  return "added";
}

function addRestaurant(
  profile: UserProfile,
  restaurant: string,
  cuisine?: string,
  location?: string
): void {
  // If we know the cuisine, add it as a food preference
  if (cuisine) addFoodPreference(profile, cuisine);

  // If we know the location, it's a weak travel signal
  if (location) {
    const existing = profile.travel.interests.find(
      (i) => i.destination.toLowerCase() === location.toLowerCase()
    );
    if (existing) {
      if (!existing.details.foodSaved.includes(restaurant)) {
        existing.details.foodSaved.push(restaurant);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// GENERAL SIGNALS
// ══════════════════════════════════════════════════════════════

function addPersonalitySignal(profile: UserProfile, category: string): void {
  const signalMap: Record<string, string> = {
    music: "music enthusiast",
    travel: "travel-oriented",
    food: "foodie",
    shopping: "shopper",
    personal: "social/personal",
    other: "curious/exploratory",
  };

  const signal = signalMap[category];
  if (signal && !profile.general.personalitySignals.includes(signal)) {
    profile.general.personalitySignals.push(signal);
  }
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function matchAndApply(
  text: string,
  pattern: RegExp,
  handler: (match: RegExpMatchArray) => number
): number {
  const match = text.match(pattern);
  if (match) return handler(match);
  return 0;
}
