/**
 * PROFILE UPDATER
 *
 * Pure code logic — no LLM calls. Takes structured analysis output
 * and deterministically routes facts into the knowledge store.
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

import type { KnowledgeStore } from "../knowledge/store.js";
import type { ScreenshotAnalysis, UserFact } from "./analyze.js";

// ══════════════════════════════════════════════════════════════
// PUBLIC: UPDATE FROM SCREENSHOT ANALYSIS
// ══════════════════════════════════════════════════════════════

export async function updateProfileFromAnalysis(
  store: KnowledgeStore,
  screenshotId: string,
  analysis: ScreenshotAnalysis
): Promise<{ factsAdded: number; factsReinforced: number }> {
  let factsAdded = 0;
  let factsReinforced = 0;

  const count = (r: "added" | "reinforced" | "skipped") => {
    if (r === "added") factsAdded++;
    if (r === "reinforced") factsReinforced++;
  };

  // ── 1. Process explicit user_facts from vision analysis ──
  for (const fact of analysis.user_facts) {
    if (fact.confidence < 0.5) continue;
    count(routeUserFact(store, screenshotId, fact));
  }

  // ── 2. Process entities from vision analysis ──
  const e = analysis.entities;

  // Add screenshot to graph
  store.graph.addScreenshot(screenshotId, {
    category: analysis.category,
    sourceApp: analysis.sourceApp,
    summary: analysis.summary,
  });

  if (analysis.category === "music") {
    // Platform
    if (e.platform) count(setMusicPlatform(store, e.platform, 0.85, screenshotId));
    if (analysis.sourceApp) {
      const mapped = mapAppToPlatform(analysis.sourceApp);
      if (mapped) count(setMusicPlatform(store, mapped, 0.9, screenshotId));
    }

    // Artists
    if (e.artists) {
      for (const name of e.artists) {
        count(addArtist(store, name, screenshotId));
        store.graph.addEntityFromScreenshot(screenshotId, "artist", name);
      }
    }

    // Genres
    if (e.genres) {
      for (const g of e.genres) {
        count(addGenre(store, g, screenshotId));
        store.graph.addEntityFromScreenshot(screenshotId, "genre", g);
      }
    }

    // Songs
    if (e.songs) {
      for (const song of e.songs) {
        if (song.title) {
          addSong(store, song.title, song.artist || "Unknown", screenshotId);
          store.graph.addEntityFromScreenshot(screenshotId, "song", song.title, { artist: song.artist });
          if (song.artist) {
            store.graph.addEntityRelation("song", song.title, "artist", song.artist, "BELONGS_TO");
          }
        }
      }
    }

    // Playlist
    if (e.playlistName) {
      addPlaylist(store, e.playlistName, e.platform || analysis.sourceApp || "Unknown", screenshotId);
    }

    // Platform in graph
    if (e.platform) {
      store.graph.addEntityFromScreenshot(screenshotId, "platform", e.platform);
    }

    // Infer listening patterns from accumulated genre data
    inferListeningPatterns(store);
  }

  if (analysis.category === "travel") {
    // Origin city → user's home location
    if (e.origin && isValidCityName(e.origin)) {
      count(setIdentityFact(store, "location", e.origin, 0.6, screenshotId, "flight origin city"));
    }

    // Destination
    const homeCities = getKnownHomeCities(store);
    if (e.destination && isValidDestination(e.destination, e.origin) && !homeCities.has(e.destination.toLowerCase())) {
      count(addTravelInterest(store, e.destination, screenshotId));
      enrichTravelDetails(store, e.destination, e, screenshotId);
      store.graph.addEntityFromScreenshot(screenshotId, "destination", e.destination);
    }

    // Hotels in graph
    if (e.hotel) {
      store.graph.addEntityFromScreenshot(screenshotId, "hotel", e.hotel);
      if (e.destination) {
        store.graph.addEntityRelation("destination", e.destination, "hotel", e.hotel, "HAS_HOTEL");
      }
    }

    // Travel style
    inferTravelStyle(store, e);
  }

  if (analysis.category === "food") {
    if (e.cuisine) {
      count(addFoodPreference(store, e.cuisine, screenshotId));
      store.graph.addEntityFromScreenshot(screenshotId, "cuisine", e.cuisine);
    }
    if (e.restaurant) {
      addRestaurant(store, e.restaurant, e.cuisine, e.location);
    }
  }

  // ── 3. Cross-domain extraction ──
  if (e.personName) count(setIdentityFact(store, "name", e.personName, 0.7, screenshotId, "name visible in screenshot"));
  if (e.location && analysis.category !== "travel") {
    count(setIdentityFact(store, "location", e.location, 0.5, screenshotId, "location visible in screenshot"));
  }

  // ── 4. General signals ──
  addPersonalitySignal(store, analysis.category);

  // ── 5. Meta ──
  store.incrementProfileVersion();
  store.sqlite.setMeta("last_updated", new Date().toISOString());

  // Persist graph
  await store.persistGraph();

  return { factsAdded, factsReinforced };
}

// ══════════════════════════════════════════════════════════════
// PUBLIC: UPDATE FROM CONVERSATION
// ══════════════════════════════════════════════════════════════

export async function updateProfileFromConversation(
  store: KnowledgeStore,
  query: string,
  _response: string
): Promise<number> {
  let updated = 0;
  const q = query.toLowerCase();

  // All conversation-extracted facts get confidence 1.0 (user stated directly)

  // ── Identity ──
  updated += matchAndApply(query,
    /(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    (m) => setIdentityFact(store, "name", m[1]!, 1.0, "conversation", "user stated directly") === "added" ? 1 : 0
  );

  updated += matchAndApply(query,
    /(?:i live in|i'm from|i am from|based in|located in|i stay in|my city is|my home is)\s+([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+)*)/i,
    (m) => setIdentityFact(store, "location", m[1]!, 1.0, "conversation", "user stated directly") === "added" ? 1 : 0
  );

  // ── Food preferences ──
  const foodPatterns = /\b(vegetarian|vegan|non[- ]?veg|pescatarian|gluten[- ]?free|halal|kosher|jain|eggetarian|lacto[- ]?vegetarian)\b/gi;
  let foodMatch;
  while ((foodMatch = foodPatterns.exec(q)) !== null) {
    const pref = foodMatch[1]!.toLowerCase();
    addFoodPreference(store, pref, "conversation");
    // Also update travel style
    const currentTravelFood = store.getProfileValue("travel.style.food");
    if (!currentTravelFood || !currentTravelFood.value.includes(pref)) {
      const newVal = currentTravelFood
        ? `${currentTravelFood.value}, ${pref} options important`
        : `${pref} options important`;
      store.setProfileValue("travel.style.food", newVal);
    }
    updated++;
  }

  // ── Music platform ──
  const platMatch = q.match(/(?:i\s+(?:use|prefer|listen\s+on|like|love)|my\s+(?:platform|app)\s+is)\s+(spotify|youtube\s*music|apple\s*music|amazon\s*music|soundcloud|tidal|deezer)/i);
  if (platMatch) {
    setMusicPlatform(store, platMatch[1]!.trim(), 1.0, "conversation");
    updated++;
  }

  // ── Listening context preferences ──
  const contextMatch = query.match(/(?:i\s+(?:prefer|like|listen\s+to|play|enjoy))\s+(.+?)\s+(?:when|while|for|during)\s+(working|studying|sleeping|driving|exercising|cooking|relaxing|running|meditating|reading|commuting|partying)/i);
  if (contextMatch) {
    store.setProfileValue(`music.context.${contextMatch[2]!.toLowerCase()}`, contextMatch[1]!.trim());
    updated++;
  }

  // ── Music mood / energy ──
  const moodMatch = q.match(/i\s+(?:like|prefer|enjoy|love)\s+(chill|energetic|upbeat|calm|intense|mellow|relaxing|sad|happy|introspective|dark|ambient)\s+music/i);
  if (moodMatch) {
    store.setProfileValue("music.moodPreference", moodMatch[1]!.toLowerCase());
    updated++;
  }

  // ── Budget style ──
  const budgetMatch = q.match(/(?:i\s+(?:am|like|prefer|travel)\s+(?:a\s+)?|my\s+(?:style|budget)\s+is\s+)(budget|luxury|mid[- ]?range|backpack(?:er|ing)?|premium|frugal|splurge)/i);
  if (budgetMatch) {
    store.setProfileValue("general.budgetStyle", budgetMatch[1]!.toLowerCase());
    store.setProfileValue("travel.style.budget", budgetMatch[1]!.toLowerCase());
    updated++;
  }

  // ── Travel pace ──
  const paceMatch = q.match(/(?:i\s+(?:like|prefer|want)\s+(?:a\s+)?)(relaxed|packed|slow|fast|chill|intense|busy|lazy|moderate)\s+(?:pace|itinerary|trip|travel|schedule)/i);
  if (paceMatch) {
    store.setProfileValue("travel.style.pace", paceMatch[1]!.toLowerCase());
    updated++;
  }

  // ── Travel activities ──
  const actMatch = q.match(/i\s+(?:like|prefer|enjoy|love)\s+(adventure|culture|beaches|nature|shopping|nightlife|history|food|hiking|photography|art|museums|temples|sightseeing)\s+(?:when\s+)?(?:travel|trip|vacation)?/i);
  if (actMatch) {
    const currentAct = store.getProfileValue("travel.style.activities");
    const newVal = currentAct
      ? `${currentAct.value}, ${actMatch[1]!.toLowerCase()}`
      : actMatch[1]!.toLowerCase();
    store.setProfileValue("travel.style.activities", newVal);
    updated++;
  }

  // ── Travel accommodation ──
  const accomMatch = q.match(/i\s+(?:like|prefer|stay\s+in|book)\s+(hostels?|hotels?|boutique\s+hotels?|airbnb|resorts?|ryokans?|homestays?|luxury\s+hotels?|budget\s+hotels?)/i);
  if (accomMatch) {
    store.setProfileValue("travel.style.accommodation", accomMatch[1]!.toLowerCase());
    updated++;
  }

  // ── Language ──
  const langMatch = query.match(/i\s+speak\s+(.+?)(?:\.|,|$)/i);
  if (langMatch) {
    store.setProfileValue("general.language", langMatch[1]!.trim());
    const langs = langMatch[1]!.split(/[,&]|\s+and\s+/).map((l) => l.trim()).filter(Boolean);
    for (const lang of langs) {
      store.addFact({ factType: "language", factValue: lang, confidence: 1.0, source: "conversation", evidence: "user stated directly" });
    }
    updated++;
  }

  // ── Artist likes from conversation ──
  const artistMatch = query.match(/i\s+(?:like|love|listen\s+to|enjoy|am\s+a\s+fan\s+of)\s+(.+?)(?:\.|,\s+and|$)/i);
  if (artistMatch && /music|song|artist|band/i.test(q)) {
    const names = artistMatch[1]!.split(/[,&]|\s+and\s+/).map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      if (name.length > 1 && name.length < 50) {
        addArtist(store, name, "conversation");
        updated++;
      }
    }
  }

  if (updated > 0) {
    store.incrementProfileVersion();
    store.sqlite.setMeta("last_updated", new Date().toISOString());
  }
  return updated;
}

// ══════════════════════════════════════════════════════════════
// FACT ROUTING — routes a user_fact to the correct store location
// ══════════════════════════════════════════════════════════════

function routeUserFact(
  store: KnowledgeStore,
  screenshotId: string,
  fact: UserFact
): "added" | "reinforced" | "skipped" {
  const f = fact.fact.toLowerCase().replace(/[\s_-]+/g, "_");

  switch (f) {
    case "name":
    case "user_name":
    case "person_name":
      return setIdentityFact(store, "name", fact.value, fact.confidence, screenshotId, fact.evidence);

    case "location":
    case "city":
    case "home_city":
    case "user_location":
      return setIdentityFact(store, "location", fact.value, fact.confidence, screenshotId, fact.evidence);

    case "music_platform":
    case "streaming_platform":
    case "preferred_platform":
      return setMusicPlatform(store, fact.value, fact.confidence, screenshotId);

    case "liked_artist":
    case "favorite_artist":
    case "artist":
      return addArtist(store, fact.value, screenshotId);

    case "genre_preference":
    case "genre":
    case "music_genre":
      return addGenre(store, fact.value, screenshotId);

    case "travel_interest":
    case "destination":
    case "travel_destination":
      return addTravelInterest(store, fact.value, screenshotId);

    case "food_preference":
    case "cuisine_preference":
    case "dietary_preference":
      return addFoodPreference(store, fact.value, screenshotId);

    case "language":
    case "language_preference":
    case "content_language":
      store.addFact({ factType: "language", factValue: fact.value, confidence: fact.confidence, source: screenshotId, evidence: fact.evidence });
      store.setProfileValue("general.language", fact.value, fact.confidence, [screenshotId]);
      return "added";

    case "budget":
    case "budget_style":
    case "spending_style":
      store.setProfileValue("general.budgetStyle", fact.value, fact.confidence, [screenshotId]);
      return "added";

    case "mood_preference":
    case "listening_mood":
      store.setProfileValue("music.moodPreference", fact.value, fact.confidence, [screenshotId]);
      return "added";

    default:
      return "skipped";
  }
}

// ══════════════════════════════════════════════════════════════
// IDENTITY
// ══════════════════════════════════════════════════════════════

function setIdentityFact(
  store: KnowledgeStore,
  key: string,
  value: string,
  confidence: number,
  source: string,
  evidence: string
): "added" | "reinforced" | "skipped" {
  const existing = store.getFactsByType(key);
  const topExisting = existing.length > 0 ? existing[0] : null;

  // Same value → reinforce
  if (topExisting && topExisting.factValue.toLowerCase() === value.toLowerCase()) {
    store.reinforceFact(key, value, source);
    store.setProfileValue(`identity.${key}`, value, Math.min(1.0, topExisting.confidence + 0.05), [
      ...store.sqlite.getFactSources(key, value),
      source,
    ]);
    return "reinforced";
  }

  // Contradiction with stronger existing → skip (keep both in facts table)
  if (topExisting && topExisting.confidence >= 0.5 && confidence < topExisting.confidence) {
    store.addFact({ factType: key, factValue: value, confidence, source, evidence });
    return "skipped";
  }

  // New fact or higher confidence → set as primary
  store.addFact({ factType: key, factValue: value, confidence, source, evidence });
  store.setProfileValue(`identity.${key}`, value, confidence, [source]);
  return "added";
}

// ══════════════════════════════════════════════════════════════
// MUSIC
// ══════════════════════════════════════════════════════════════

function setMusicPlatform(
  store: KnowledgeStore,
  platform: string,
  confidence: number,
  source: string
): "added" | "reinforced" {
  const existing = store.getFactsByType("music_platform");
  const top = existing.length > 0 ? existing[0] : null;

  if (top && top.factValue.toLowerCase() === platform.toLowerCase()) {
    store.reinforceFact("music_platform", platform, source);
    store.setProfileValue("music.preferredPlatform", platform, Math.min(1.0, top.confidence + 0.05));
    return "reinforced";
  }

  if (!top || confidence > top.confidence) {
    store.addFact({ factType: "music_platform", factValue: platform, confidence, source, evidence: `Detected from ${source.startsWith("ss_") ? "screenshot" : source}` });
    store.setProfileValue("music.preferredPlatform", platform, confidence, [source]);
    return "added";
  }
  return "reinforced";
}

function addArtist(store: KnowledgeStore, name: string, source: string): "added" | "reinforced" {
  if (!name || name.length < 2) return "reinforced"; // skip silently

  const existing = store.getFactsByType("liked_artist")
    .filter((f) => f.factValue.toLowerCase() === name.toLowerCase());

  if (existing.length > 0) {
    store.reinforceFact("liked_artist", name, source);
    return "reinforced";
  }
  store.addFact({ factType: "liked_artist", factValue: name, confidence: 0.7, source, evidence: "extracted from content" });
  return "added";
}

function addGenre(store: KnowledgeStore, genre: string, source: string): "added" | "reinforced" {
  if (!genre || genre.length < 2) return "reinforced";

  const existing = store.getFactsByType("genre")
    .filter((f) => f.factValue.toLowerCase() === genre.toLowerCase());

  if (existing.length > 0) {
    store.reinforceFact("genre", genre, source);
    return "reinforced";
  }
  store.addFact({ factType: "genre", factValue: genre, confidence: 0.5, source, evidence: "extracted from content" });
  return "added";
}

function addSong(store: KnowledgeStore, title: string, artist: string, source: string): void {
  if (!title) return;
  store.addFact({
    factType: "liked_song",
    factValue: `${title} - ${artist}`,
    confidence: 0.7,
    source,
    evidence: "song visible in screenshot",
  });
}

function addPlaylist(store: KnowledgeStore, name: string, platform: string, source: string): void {
  if (!name) return;
  store.addFact({
    factType: "playlist",
    factValue: name,
    confidence: 0.6,
    source,
    evidence: `Playlist on ${platform}`,
  });
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

function inferListeningPatterns(store: KnowledgeStore): void {
  const genreFacts = store.getFactsByType("genre");
  if (genreFacts.length === 0) return;

  const sorted = [...genreFacts].sort((a, b) => b.confidence - a.confidence);
  const topGenres = sorted.slice(0, 5).map((g) => g.factValue.toLowerCase());
  const genreStr = topGenres.join(" ");

  // Mood
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
      store.setProfileValue("music.moodPreference", rule.mood);
      break;
    }
  }

  // Energy
  if (/lo.?fi|chill|ambient|acoustic|soft|ballad|classical|jazz/i.test(genreStr)) {
    store.setProfileValue("music.energyLevel", "low");
  } else if (/edm|metal|punk|hardcore|drum|techno|house|trap/i.test(genreStr)) {
    store.setProfileValue("music.energyLevel", "high");
  } else {
    store.setProfileValue("music.energyLevel", "medium");
  }
}

// ══════════════════════════════════════════════════════════════
// TRAVEL
// ══════════════════════════════════════════════════════════════

function addTravelInterest(
  store: KnowledgeStore,
  destination: string,
  source: string
): "added" | "reinforced" {
  if (!destination || destination.length < 2) return "reinforced";

  const existing = store.getFactsByType("travel_interest")
    .filter((f) => f.factValue.toLowerCase() === destination.toLowerCase());

  if (existing.length > 0) {
    store.reinforceFact("travel_interest", destination, source);
    return "reinforced";
  }

  store.addFact({
    factType: "travel_interest",
    factValue: destination,
    confidence: 0.5,
    source,
    evidence: "destination found in screenshot",
  });
  return "added";
}

function enrichTravelDetails(
  store: KnowledgeStore,
  destination: string,
  entities: Record<string, unknown>,
  screenshotId: string
): void {
  const prefix = `travel.detail.${destination.toLowerCase()}`;
  const pushToKV = (key: string, val: unknown) => {
    if (!val || typeof val !== "string") return;
    const existing = store.getProfileValue(`${prefix}.${key}`);
    if (existing && existing.value.includes(val)) return;
    const newVal = existing ? `${existing.value}, ${val}` : val;
    store.setProfileValue(`${prefix}.${key}`, newVal, 0.7, [screenshotId]);
  };

  pushToKV("hotels", entities.hotel);
  pushToKV("activities", entities.activity);
  pushToKV("restaurants", entities.restaurant);
  pushToKV("dates", entities.dates || entities.date);
  pushToKV("budget", entities.price);
}

function inferTravelStyle(
  store: KnowledgeStore,
  entities: Record<string, unknown>
): void {
  // Hotel type → accommodation style
  const hotelType = entities.hotel_type || entities.accommodation_type;
  if (hotelType && typeof hotelType === "string") {
    const existing = store.getProfileValue("travel.style.accommodation");
    if (!existing) store.setProfileValue("travel.style.accommodation", hotelType as string);
  }

  // Price signals → budget style
  if (entities.price && typeof entities.price === "string") {
    const existing = store.getProfileValue("general.budgetStyle");
    if (!existing) {
      const p = (entities.price as string).toLowerCase();
      if (/\b(budget|cheap|hostel|under\s*[₹$€]\s*\d{3})\b/.test(p)) {
        store.setProfileValue("general.budgetStyle", "budget");
        store.setProfileValue("travel.style.budget", "budget");
      } else if (/\b(luxury|premium|5\s*star|suite|resort)\b/.test(p)) {
        store.setProfileValue("general.budgetStyle", "luxury");
        store.setProfileValue("travel.style.budget", "luxury");
      } else if (/\b(mid|moderate|3\s*star|4\s*star)\b/.test(p)) {
        store.setProfileValue("general.budgetStyle", "mid-range");
        store.setProfileValue("travel.style.budget", "mid-range");
      }
    }
  }

  // Airline class → budget signal
  const airlineClass = entities.cabin_class || entities.travel_class;
  if (airlineClass && typeof airlineClass === "string") {
    const c = airlineClass.toLowerCase();
    const existing = store.getProfileValue("travel.style.budget");
    if (!existing) {
      if (c.includes("business") || c.includes("first")) {
        store.setProfileValue("travel.style.budget", "premium");
      } else if (c.includes("economy")) {
        store.setProfileValue("travel.style.budget", "value-conscious");
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// FOOD
// ══════════════════════════════════════════════════════════════

function addFoodPreference(store: KnowledgeStore, pref: string, source: string): "added" | "reinforced" {
  if (!pref || pref.length < 2) return "reinforced";

  const existing = store.getFactsByType("food_preference")
    .filter((f) => f.factValue.toLowerCase() === pref.toLowerCase());

  if (existing.length > 0) {
    store.reinforceFact("food_preference", pref, source);
    return "reinforced";
  }
  store.addFact({ factType: "food_preference", factValue: pref, confidence: 0.7, source, evidence: "extracted from content" });
  return "added";
}

function addRestaurant(
  store: KnowledgeStore,
  restaurant: string,
  cuisine?: string,
  location?: string
): void {
  if (cuisine) addFoodPreference(store, cuisine, "screenshot");
  if (location) {
    const prefix = `travel.detail.${location.toLowerCase()}`;
    const existing = store.getProfileValue(`${prefix}.restaurants`);
    if (!existing || !existing.value.includes(restaurant)) {
      const newVal = existing ? `${existing.value}, ${restaurant}` : restaurant;
      store.setProfileValue(`${prefix}.restaurants`, newVal);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// GENERAL SIGNALS
// ══════════════════════════════════════════════════════════════

function addPersonalitySignal(store: KnowledgeStore, category: string): void {
  const signalMap: Record<string, string> = {
    music: "music enthusiast",
    travel: "travel-oriented",
    food: "foodie",
    shopping: "shopper",
    personal: "social/personal",
    other: "curious/exploratory",
  };

  const signal = signalMap[category];
  if (signal) {
    const existing = store.getProfileValue("general.personalitySignals");
    if (!existing || !existing.value.includes(signal)) {
      const newVal = existing ? `${existing.value}, ${signal}` : signal;
      store.setProfileValue("general.personalitySignals", newVal);
    }
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

function getKnownHomeCities(store: KnowledgeStore): Set<string> {
  const cities = new Set<string>();
  const locationFacts = store.getFactsByType("location");
  for (const fact of locationFacts) {
    if (fact.confidence >= 0.5) {
      cities.add(fact.factValue.toLowerCase());
    }
  }
  const homeCityFacts = store.getFactsByType("home_city");
  for (const fact of homeCityFacts) {
    cities.add(fact.factValue.toLowerCase());
  }
  return cities;
}

function isValidDestination(destination: string, origin?: string): boolean {
  if (!destination || destination.length < 2) return false;
  const d = destination.toLowerCase();
  if (/\b(to|from)\b/.test(d)) return false;
  if (/\b(flight|travel|booking|search|result|ticket)\b/i.test(d)) return false;
  if (/^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(d)) return false;
  if (origin && d === origin.toLowerCase()) return false;
  if (destination.length > 40) return false;
  return true;
}

function isValidCityName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 40) return false;
  if (/\b(to|from|flight|travel|booking)\b/i.test(name)) return false;
  return true;
}
