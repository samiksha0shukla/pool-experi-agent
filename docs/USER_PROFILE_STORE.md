# User Profile Store — Implementation Guide

## What It Is

The User Profile Store is the central knowledge system that both agents (Music + Travel) read from. It learns who the user is incrementally — from every screenshot upload and every conversation — without ever guessing or hallucinating.

Every fact has a source, a confidence score, and evidence.

---

## Where It Lives

```
data/profile.json       ← single JSON file, the full user profile
```

Managed by: `src/store.ts` (read/write) + `src/ingestion/profileUpdater.ts` (intelligence)

---

## Profile Structure (TypeScript Interface)

Defined in `src/store.ts` as `UserProfile`:

```typescript
interface UserProfile {

  // ═══ IDENTITY ═══
  // Hard facts about the user, each with evidence trail
  identity: {
    name?: ProfileFact;          // "Samiksha" — from boarding pass
    location?: ProfileFact;      // "Delhi, India" — from flight origins
    [key: string]: ProfileFact;  // extensible for future facts
  };

  // ═══ MUSIC ═══
  music: {
    preferredPlatform: ProfileFact | null;   // "Spotify" with confidence + sources
    genres: GenreEntry[];                     // ranked by strength
    favoriteArtists: ArtistEntry[];           // ranked by mention count
    likedSongs: SongEntry[];                  // every song seen in screenshots
    playlistsSeen: PlaylistEntry[];           // playlists detected
    listeningPatterns: ListeningPatterns;     // inferred mood/energy/language/context
  };

  // ═══ TRAVEL ═══
  travel: {
    interests: TravelInterest[];   // destinations ranked by strength × recency
    style: TravelStyle;            // accommodation, food, pace, budget preferences
  };

  // ═══ GENERAL ═══
  general: {
    personalitySignals: string[];    // "music enthusiast", "travel-oriented"
    language: string | null;         // "English, Hindi"
    foodPreferences: string[];       // "Japanese", "vegetarian"
    budgetStyle: string | null;      // "mid-premium"
  };

  // ═══ META ═══
  totalScreenshots: number;      // how many screenshots have been analyzed
  lastUpdated: string | null;    // ISO timestamp
  profileVersion: number;        // bumps on every profile change
}
```

### Sub-Types

```typescript
// Every identity/platform fact carries its proof
interface ProfileFact {
  value: string;
  confidence: number;        // 0.0 to 1.0
  sources: string[];          // screenshot IDs or "conversation"
  evidence: string;           // human-readable proof
}

// Music genre with strength from 0 to 1
interface GenreEntry {
  genre: string;              // "Indie Rock"
  strength: number;           // 0.5 starts, +0.1 per reinforcement, max 1.0
  artistCount: number;        // how many artists in this genre
}

// Artist mention tracking
interface ArtistEntry {
  name: string;
  mentions: number;           // increments each time seen
  sources: string[];          // which screenshots
}

// Individual songs detected
interface SongEntry {
  title: string;
  artist: string;
  source: string;             // screenshot ID
}

// Playlist detected
interface PlaylistEntry {
  name: string;
  platform: string;
  source: string;
}

// Inferred from accumulated music data
interface ListeningPatterns {
  moodPreference: string | null;                   // "chill, introspective"
  energyLevel: string | null;                      // "low" | "medium" | "high"
  languages: string[];                              // ["English", "Hindi"]
  contextPreferences: Record<string, string>;       // { working: "lo-fi" }
}

// Travel destination with rich details
interface TravelInterest {
  destination: string;
  strength: number;            // 0-1, increases with more screenshots
  screenshotCount: number;
  lastSeen: string;            // ISO timestamp
  details: {
    hotelsSaved: string[];
    activitiesSaved: string[];
    foodSaved: string[];
    datesDetected: string[];
    budgetSignals: string[];
  };
}

// Travel style preferences
interface TravelStyle {
  accommodation: string | null;  // "boutique hotels, mid-range"
  food: string | null;           // "street food + fine dining"
  activities: string | null;     // "culture + adventure"
  pace: string | null;           // "relaxed, not packed"
  budget: string | null;         // "mid-premium"
}
```

---

## How the Profile Gets Built

### Source 1: Screenshot Analysis (automatic)

When a screenshot is uploaded → Gemini Vision analyzes it → `profileUpdater.ts` processes the results.

```
Upload screenshot
    │
    ▼
Gemini Vision returns:
  { category: "music", entities: {...}, user_facts: [...] }
    │
    ▼
profileUpdater.updateProfileFromAnalysis(screenshotId, analysis)
    │
    ├─► Process user_facts (name, location, platform, artist, genre, etc.)
    │     Each fact routed to its handler by fact.fact type
    │
    ├─► Enrich domain-specific data from entities
    │     Music: songs, playlists, artists, genres, platform from sourceApp
    │     Travel: destination details (hotels, activities, dates, prices)
    │     Food: cuisine preferences
    │
    ├─► Infer higher-level patterns
    │     listeningPatterns (mood, energy) from genre accumulation
    │     personalitySignals from category distribution
    │
    └─► Bump totalScreenshots + profileVersion + lastUpdated
```

**Fact routing table** — `applyUserFact()` in `profileUpdater.ts`:

| `fact.fact` value | Where it's stored | Handler |
|---|---|---|
| `name` | `identity.name` | `setIdentityFact()` |
| `location` | `identity.location` | `setIdentityFact()` |
| `music_platform` | `music.preferredPlatform` | `setMusicPlatform()` |
| `liked_artist` / `favorite_artist` | `music.favoriteArtists[]` | `addArtist()` |
| `genre_preference` | `music.genres[]` | `addGenre()` |
| `travel_interest` | `travel.interests[]` | `addTravelInterest()` |
| `food_preference` | `general.foodPreferences[]` | `addFoodPreference()` |
| `language` / `language_preference` | `music.listeningPatterns.languages[]` + `general.language` | direct push |

### Source 2: Conversation Extraction (semi-automatic)

After every chat query → `profileUpdater.updateProfileFromConversation()` scans for explicit user statements.

| User says | Profile update | Confidence |
|---|---|---|
| "My name is Samiksha" | `identity.name = "Samiksha"` | 1.0 |
| "I live in Delhi" | `identity.location = "Delhi"` | 1.0 |
| "I'm vegetarian" | `general.foodPreferences += "vegetarian"` | 1.0 |
| "I use Spotify" | `music.preferredPlatform = "Spotify"` | 1.0 |
| "I prefer lo-fi while working" | `music.listeningPatterns.contextPreferences.working = "lo-fi"` | 1.0 |
| "I'm a budget traveler" | `general.budgetStyle = "budget"` | 1.0 |
| "I speak Hindi and English" | `general.language = "Hindi and English"` | 1.0 |

User-stated facts always get confidence 1.0 and override inferred facts.

---

## Profile Update Rules

These rules are enforced in `profileUpdater.ts`:

```
1. ONLY add facts with evidence (screenshot_id or "conversation")
2. REINFORCE existing facts when new evidence appears
   → confidence += 0.05, source added to sources[]
3. NEVER remove facts based on absence
4. NEVER assume — only extract what is VISIBLE
5. Contradictions → higher confidence wins, both kept
6. User corrections (via conversation) → confidence 1.0, always override
7. Confidence thresholds:
   < 0.5: not extracted (filtered in analyze.ts)
   0.5-0.8: stored, used with caveat
   > 0.8: used confidently
```

---

## How Each Field Gets Populated

### `music.listeningPatterns` — Inferred Automatically

`inferListeningPatterns()` runs after every music screenshot analysis. It reads accumulated genres and infers:

| Genres contain | `moodPreference` | `energyLevel` |
|---|---|---|
| lo-fi, chill, ambient | "chill, relaxed" | "low" |
| rock, metal, punk | "energetic, intense" | "high" |
| indie, alternative, folk | "introspective, indie" | "medium" |
| pop, dance, EDM | "upbeat, pop" | "high" |
| classical, jazz, blues | "sophisticated, mellow" | "medium" |

`languages[]` populated from `user_facts` with fact type `language`.
`contextPreferences` populated from conversation ("I prefer X when/while Y").

### `general.personalitySignals` — Category-Based

`updateGeneralSignals()` adds a signal based on screenshot category:

| Category | Signal added |
|---|---|
| music | "music enthusiast" |
| travel | "travel-oriented" |
| food | "foodie" |
| shopping | "shopper" |
| personal | "social/personal" |

### `general.budgetStyle` — From Price Signals

If travel screenshot has a price entity containing "budget" or "cheap" → `budgetStyle = "budget"`.
If it contains "luxury" or "premium" → `budgetStyle = "luxury"`.
Can also be set explicitly via conversation.

### `travel.style` — From Entity Patterns

`accommodation` set from `hotel_type` / `accommodation_type` entities.
Other style fields (`food`, `activities`, `pace`, `budget`) currently set via conversation corrections.

### `profileVersion` — Auto-Incrementing

Bumps by 1 on every `updateProfileFromAnalysis()` and `updateProfileFromConversation()` call. Useful for cache invalidation and tracking how much the profile has evolved.

---

## Defaults (Fresh Profile)

When no `data/profile.json` exists, `getProfile()` returns:

```json
{
  "identity": {},
  "music": {
    "preferredPlatform": null,
    "genres": [],
    "favoriteArtists": [],
    "likedSongs": [],
    "playlistsSeen": [],
    "listeningPatterns": {
      "moodPreference": null,
      "energyLevel": null,
      "languages": [],
      "contextPreferences": {}
    }
  },
  "travel": {
    "interests": [],
    "style": {
      "accommodation": null,
      "food": null,
      "activities": null,
      "pace": null,
      "budget": null
    }
  },
  "general": {
    "personalitySignals": [],
    "language": null,
    "foodPreferences": [],
    "budgetStyle": null
  },
  "totalScreenshots": 0,
  "lastUpdated": null,
  "profileVersion": 0
}
```

### Backward Compatibility

`getProfile()` uses `mergeWithDefaults()` to deep-merge any existing `profile.json` with the default structure. If you had an old profile with missing fields (e.g., no `listeningPatterns`), they're filled in automatically without losing existing data.

---

## How Agents Consume the Profile

Both agents receive the full profile as a JSON string in their prompt:

```
query.ts → formatProfileForAgent(profile)
         → passes JSON.stringify(profile, null, 2) to the agent

Music Agent system prompt + USER PROFILE: {json} + USER QUERY: "..."
Travel Agent system prompt + USER PROFILE: {json} + USER QUERY: "..."
```

The agent LLM reads the profile and personalizes its response accordingly — using the user's preferred platform for links, respecting food preferences for itineraries, etc.

---

## How the Profile Is Displayed

`src/profile.ts` → `viewProfile()` renders the profile in the CLI with:

- Stats bar: screenshots / analyzed / pending / version
- Identity: name + location with confidence %
- Music: platform, genres (bar chart), top artists (ranked), songs count, playlists, listening patterns (mood, energy, languages, context prefs)
- Travel: destinations (bar chart with screenshot count), details (hotels, activities, dates, budget), style preferences
- General: language, food prefs, budget style, personality signals

---

## Files Involved

| File | Role |
|---|---|
| `src/store.ts` | `UserProfile` type definition, `getProfile()`, `saveProfile()`, default structure, `mergeWithDefaults()` |
| `src/ingestion/profileUpdater.ts` | All write logic — fact routing, domain enrichment, pattern inference, conversation extraction |
| `src/ingestion/analyze.ts` | Tells Gemini Vision what `user_facts` to extract (the prompt instructs it to look for name, platform, artists, destinations, etc.) |
| `src/profile.ts` | CLI display of the profile with bar charts and formatting |
| `src/query.ts` | Loads profile, passes it as JSON to agents, calls `updateProfileFromConversation()` after each chat |
| `src/upload.ts` | Calls `updateProfileFromAnalysis()` after each screenshot is analyzed |
| `src/agents/musicAgent.ts` | Reads profile to personalize music recommendations |
| `src/agents/travelAgent.ts` | Reads profile to personalize itineraries |
| `src/agents/profileAgent.ts` | Reads profile to answer "what do you know about me?" |

---

## Example: Profile After 10 Screenshots

```json
{
  "identity": {
    "name": {
      "value": "Samiksha",
      "confidence": 0.95,
      "sources": ["ss_1711538400_a3f2b1"],
      "evidence": "name on boarding pass"
    },
    "location": {
      "value": "Delhi",
      "confidence": 0.85,
      "sources": ["ss_1711538400_a3f2b1", "ss_1711538800_b4c3d2"],
      "evidence": "flight origin city appearing multiple times"
    }
  },
  "music": {
    "preferredPlatform": {
      "value": "Spotify",
      "confidence": 0.95,
      "sources": ["ss_1711539000_x1y2z3", "ss_1711539200_m4n5o6", "ss_1711539400_p7q8r9"],
      "evidence": "Detected from screenshot"
    },
    "genres": [
      { "genre": "Indie Rock", "strength": 0.8, "artistCount": 5 },
      { "genre": "Lo-fi", "strength": 0.6, "artistCount": 2 },
      { "genre": "Bollywood", "strength": 0.5, "artistCount": 2 }
    ],
    "favoriteArtists": [
      { "name": "Arctic Monkeys", "mentions": 4, "sources": ["ss_...", "ss_..."] },
      { "name": "Tame Impala", "mentions": 3, "sources": ["ss_..."] },
      { "name": "Prateek Kuhad", "mentions": 2, "sources": ["ss_..."] }
    ],
    "likedSongs": [
      { "title": "Do I Wanna Know?", "artist": "Arctic Monkeys", "source": "ss_..." },
      { "title": "Let It Happen", "artist": "Tame Impala", "source": "ss_..." }
    ],
    "playlistsSeen": [
      { "name": "Late Night Drive", "platform": "Spotify", "source": "ss_..." }
    ],
    "listeningPatterns": {
      "moodPreference": "introspective, indie",
      "energyLevel": "medium",
      "languages": ["English", "Hindi"],
      "contextPreferences": { "working": "lo-fi" }
    }
  },
  "travel": {
    "interests": [
      {
        "destination": "Tokyo",
        "strength": 0.8,
        "screenshotCount": 5,
        "lastSeen": "2026-03-28T10:00:00.000Z",
        "details": {
          "hotelsSaved": ["Park Hyatt Tokyo"],
          "activitiesSaved": ["Shibuya crossing", "TeamLab"],
          "foodSaved": ["Ichiran Ramen"],
          "datesDetected": ["April 10-17, 2026"],
          "budgetSignals": ["₹45,000-55,000"]
        }
      }
    ],
    "style": {
      "accommodation": "boutique",
      "food": null,
      "activities": null,
      "pace": null,
      "budget": null
    }
  },
  "general": {
    "personalitySignals": ["music enthusiast", "travel-oriented"],
    "language": "English",
    "foodPreferences": ["Japanese", "vegetarian"],
    "budgetStyle": null
  },
  "totalScreenshots": 10,
  "lastUpdated": "2026-03-30T12:00:00.000Z",
  "profileVersion": 14
}
```
