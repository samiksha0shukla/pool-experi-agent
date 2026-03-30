# Pool Agent V1 — Reactive Agent Architecture
## Music Agent + Travel Agent (Two Use Cases)

---

## 1. What We're Building

A **reactive** screenshot-based agent with exactly two capabilities:

1. **Music Agent** — Analyzes screenshots to learn your music taste, detects your preferred platform, and suggests music/albums with real links when asked
2. **Travel Agent** — Analyzes travel-related screenshots to plan itineraries based on where you want to go, shaped by who you are and what you like

Both agents are powered by a shared **User Profile** that continuously learns who you are from every screenshot and every conversation.

```
NOT building: proactive notifications, push alerts, price tracking,
              auto-folders, smart pools, permission tiers, or any
              "agent initiates" behavior.

This agent ONLY responds when asked. It's reactive.
```

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER                                     │
│    Uploads screenshots    │    Sends queries (chat)              │
└─────────────┬─────────────┴──────────────┬───────────────────────┘
              │                            │
              ▼                            ▼
┌──────────────────────────┐  ┌──────────────────────────────────┐
│   SCREENSHOT INGESTION   │  │         QUERY HANDLER            │
│                          │  │                                  │
│  Vision LLM analyzes     │  │  "Suggest me some music"         │
│  every screenshot:       │  │  "Plan my itinerary"             │
│  • What is this?         │  │  "What kind of music do I like?" │
│  • Extract entities      │  │                                  │
│  • Detect user facts     │  └──────────────┬───────────────────┘
│  • Classify category     │                 │
│                          │                 ▼
└─────────────┬────────────┘  ┌──────────────────────────────────┐
              │               │          ORCHESTRATOR             │
              │               │                                  │
              ▼               │  1. Load User Profile             │
┌──────────────────────────┐  │  2. Classify intent               │
│    USER PROFILE STORE    │◄─┤  3. Route to correct agent        │
│                          │  │  4. Return response               │
│  • Name, location        │  │                                  │
│  • Music taste           │  └──────┬──────────────┬────────────┘
│  • Preferred platform    │         │              │
│  • Travel interests      │         ▼              ▼
│  • Budget style          │  ┌────────────┐ ┌────────────────┐
│  • Food preferences      │  │   MUSIC    │ │    TRAVEL      │
│  • Personality traits    │  │   AGENT    │ │    AGENT       │
│  (all evidence-backed)   │  │            │ │                │
│                          │  │ • Analyze  │ │ • Analyze      │
└──────────────────────────┘  │   taste    │ │   destinations │
              ▲               │ • Suggest  │ │ • Build        │
              │               │   songs/   │ │   itinerary    │
              │               │   albums   │ │ • Personalize  │
              │               │ • Detect   │ │   based on     │
              │               │   platform │ │   profile      │
              │               │ • Give     │ │                │
              │               │   real     │ │                │
              │               │   links    │ │                │
              │               └────────────┘ └────────────────┘
              │                      │              │
              │                      ▼              ▼
              │               ┌──────────────────────────┐
              └───────────────┤   PROFILE UPDATER        │
                              │                          │
                              │  After every interaction, │
                              │  extract new facts about  │
                              │  the user and update      │
                              │  their profile.           │
                              └──────────────────────────┘
```

---

## 3. The Three Core Systems

### 3.1 Screenshot Ingestion (Runs on Every Upload)

Every screenshot the user uploads gets analyzed. This is how the agent learns about you *passively* — you don't have to tell it anything.

```
Screenshot uploaded
    │
    ▼
[1] VISION ANALYSIS (Gemini Flash — single multimodal call)

    Prompt:
    "Analyze this screenshot. Return JSON:
     {
       description: 'what this screenshot shows',
       category: 'music | travel | food | shopping | personal | other',
       entities: {
         // For music: song name, artist, album, playlist name, platform
         // For travel: destination, hotel, flight, dates, prices
         // For other: whatever is visible
       },
       user_facts: [
         // ONLY facts directly visible in the screenshot
         // { fact, value, evidence, confidence }
         // e.g., { fact: 'name', value: 'Samiksha', evidence: 'name on ticket', confidence: 0.95 }
         // e.g., { fact: 'music_platform', value: 'Spotify', evidence: 'Spotify app screenshot', confidence: 0.9 }
       ]
     }

     Rules:
     - Be factual. Only extract what is VISIBLE.
     - Never guess or assume.
     - For music: always extract platform if visible (Spotify/YouTube Music/Apple Music/etc.)
     - For travel: always extract destination, dates, prices if visible."
    │
    ▼
[2] EMBEDDING GENERATION
    • Text embedding of description + entities (for similarity search later)
    │
    ▼
[3] PROFILE UPDATE
    • For each user_fact with confidence > 0.5:
      - If fact already exists → reinforce (increase confidence, add source)
      - If new fact → add to profile with source screenshot ID
      - If contradicts existing → keep both, flag for future resolution
    │
    ▼
[4] STORE
    • Screenshot metadata → DB
    • Embedding → vector store
    • Profile updates → profile store
```

**What gets extracted from different screenshot types:**

| Screenshot | Extracted Entities | Profile Facts Learned |
|---|---|---|
| Spotify playlist | songs, artists, playlist name, genre | music_platform: Spotify, genres: [indie, rock] |
| YouTube Music "Now Playing" | song, artist, album | music_platform: YouTube Music, artists_liked: [X] |
| Apple Music library | albums, playlists | music_platform: Apple Music |
| Song lyrics screenshot | song name, artist | artists_liked: [X], genres inferred |
| Concert ticket | artist, venue, date, city | favorite_artists: [X], location hint |
| Google Flights result | origin, destination, dates, price | travel_interest: Tokyo, budget_signal: ₹45,000 |
| Hotel booking | hotel name, city, dates, price | accommodation_style: boutique/luxury/budget |
| Instagram travel reel | destination name, activity | travel_interest: Bali |
| Restaurant screenshot | name, cuisine, location, price range | food_preference: Japanese, budget_style: mid |
| Boarding pass | name, origin, destination, date | user_name: Samiksha, home_city: Delhi |
| Chat about trip | mentioned destinations, dates | travel_interest: [places mentioned] |

---

### 3.2 User Profile (The Shared Brain)

The profile is the central knowledge store. Both agents read from it. It's updated after every screenshot AND after every conversation.

```
UserProfile {

  // ── IDENTITY (hard facts from screenshots) ──
  identity: {
    name: {
      value: "Samiksha",
      confidence: 0.95,
      sources: ["screenshot_42"],        // boarding pass
      evidence: "name on boarding pass"
    },
    location: {
      value: "Delhi, India",
      confidence: 0.80,
      sources: ["screenshot_12", "screenshot_88"],
      evidence: "flight origin city appearing multiple times"
    }
  }

  // ── MUSIC PROFILE (built from music-related screenshots) ──
  music: {
    preferred_platform: {
      value: "Spotify",
      confidence: 0.9,
      sources: ["screenshot_5", "screenshot_18", "screenshot_33"],
      evidence: "3 Spotify app screenshots, 0 from other platforms"
    },
    genres: [
      { genre: "Indie Rock", strength: 0.9, artist_count: 8 },
      { genre: "Lo-fi / Chill", strength: 0.7, artist_count: 4 },
      { genre: "Bollywood", strength: 0.5, artist_count: 3 }
    ],
    favorite_artists: [
      { name: "Arctic Monkeys", mentions: 5, sources: [...] },
      { name: "Tame Impala", mentions: 3, sources: [...] },
      { name: "Prateek Kuhad", mentions: 4, sources: [...] }
    ],
    liked_songs: [
      { title: "Do I Wanna Know?", artist: "Arctic Monkeys", source: "screenshot_5" },
      ...
    ],
    playlists_seen: [
      { name: "Late Night Drive", platform: "Spotify", source: "screenshot_18" },
      ...
    ],
    listening_patterns: {
      mood_preference: "chill, introspective",    // inferred from genres + songs
      energy_level: "low-to-medium",              // inferred
      language: ["English", "Hindi"]              // from songs detected
    }
  }

  // ── TRAVEL PROFILE (built from travel-related screenshots) ──
  travel: {
    interests: [
      {
        destination: "Tokyo",
        strength: 0.9,
        screenshot_count: 12,
        last_seen: "2026-03-20",
        details: {
          hotels_saved: ["Park Hyatt Tokyo", "Shinjuku Granbell"],
          activities_saved: ["Shibuya crossing", "Tsukiji market", "TeamLab"],
          food_saved: ["Ichiran Ramen", "Conveyor belt sushi"],
          dates_detected: "April 10-17, 2026",
          budget_signals: "₹40,000-60,000 for flights"
        }
      },
      {
        destination: "Bali",
        strength: 0.5,
        screenshot_count: 4,
        last_seen: "2026-03-10",
        details: { ... }
      }
    ],
    style: {
      accommodation: "boutique hotels, mid-range",    // from hotel screenshots
      food: "street food + one fine dining per trip",  // from restaurant screenshots
      activities: "culture + adventure, not beaches",  // from activity screenshots
      pace: "relaxed, not packed",                     // inferred
      budget: "mid-premium"                            // from price signals
    }
  }

  // ── GENERAL PREFERENCES (inferred across all screenshots) ──
  general: {
    personality_signals: [
      "curious (lots of learning/article screenshots)",
      "detail-oriented (comparison screenshots)",
      "social (group chat/plan screenshots)"
    ],
    language: "English, Hindi",
    food_preferences: ["Japanese", "Italian", "street food"],
    budget_style: "mid-premium, value-conscious"
  }

  // ── META ──
  total_screenshots: 147,
  profile_last_updated: "2026-03-27T14:30:00Z",
  profile_version: 42
}
```

### Profile Update Rules

```
1. ONLY add facts with evidence (screenshot_id + what was visible)
2. REINFORCE existing facts when new evidence appears
   → confidence increases, source list grows
3. NEVER remove facts based on absence
4. NEVER assume — if unsure, don't add
5. Contradictions → keep both, mark for resolution
6. User corrections (via conversation) ALWAYS override inference
7. Confidence thresholds:
   → < 0.3: stored, never used
   → 0.3-0.5: stored, used only as weak signal
   → 0.5-0.8: used in recommendations with caveat
   → > 0.8: used confidently
```

### Profile Update After Conversations

After every agent conversation, the orchestrator extracts new facts:

```
User: "I actually prefer lo-fi over rock when working"

→ Profile update:
  music.listening_patterns.context_preference = {
    working: "lo-fi, chill",
    source: "conversation_2026-03-27",
    confidence: 1.0  // user explicitly said it
  }

User: "I'm vegetarian"

→ Profile update:
  general.food_preferences += "vegetarian"
  travel.style.food += "vegetarian options important"
  source: "conversation_2026-03-27"
  confidence: 1.0  // user explicitly said it
```

---

### 3.3 The Two Agents

#### MUSIC AGENT

```
WHAT IT DOES:
  • Tells you what kind of music you like (based on screenshot analysis)
  • Suggests songs, albums, playlists based on your taste
  • Provides real links to your preferred platform
  • Detects which platform you use

WHEN IT ACTIVATES:
  • User asks anything music-related:
    "Suggest me some music"
    "What kind of music do I like?"
    "Find me something similar to Arctic Monkeys"
    "Give me a playlist for a road trip"
    "What should I listen to while working?"

HOW IT WORKS:

  User: "Suggest me some music"
      │
      ▼
  Orchestrator loads User Profile
      │
      ▼
  Routes to Music Agent with full profile context
      │
      ▼
  Music Agent reads profile:
    • Platform: Spotify (0.9 confidence)
    • Top genres: Indie Rock (0.9), Lo-fi (0.7), Bollywood (0.5)
    • Top artists: Arctic Monkeys, Tame Impala, Prateek Kuhad
    • Mood preference: chill, introspective
    • Languages: English, Hindi
      │
      ▼
  Music Agent generates recommendations:
    • Based on taste DNA, NOT generic "top charts"
    • Weighted toward genres with high strength
    • Includes mix of familiar (artists they know) + discovery
    • All links are for their preferred platform (Spotify)
      │
      ▼
  Response to user:

  "Based on your screenshots, you're into indie rock and lo-fi,
   with artists like Arctic Monkeys, Tame Impala, and Prateek Kuhad.
   You mostly listen on Spotify. Here are my picks:

   🎵 Albums:
   • 'In Rainbows' — Radiohead
     https://open.spotify.com/album/7eyQXxuf2nGj9d2367Gi5f
   • 'Wasteland, Baby!' — Hozier
     https://open.spotify.com/album/0VOF4JjJzjJFAdXJInHfGK
   • 'COLD/MESS' — Prateek Kuhad
     https://open.spotify.com/album/...

   🎵 Songs you might love:
   • 'Notion' — The Rare Occasions
     https://open.spotify.com/track/...
   • 'Heat Waves' — Glass Animals
     https://open.spotify.com/track/...
   • 'Khaabon Ke Parinday' — Mohit Chauhan
     https://open.spotify.com/track/...

   🎵 Playlist for your vibe:
   • 'Indie Chill Vibes' (community playlist, 200+ songs)
     https://open.spotify.com/playlist/...

   You lean toward introspective, mid-energy music. Want me to
   go deeper into any genre, or find something for a specific mood?"
      │
      ▼
  Profile Updater checks if conversation revealed new facts
```

**Music Agent — System Prompt:**

```
You are the Music Agent for Pool. You help users discover music
based on their taste profile.

INPUTS YOU RECEIVE:
- User's full music profile (genres, artists, platform, mood preferences)
- User's general profile (personality, language, preferences)
- The user's query

YOUR RESPONSIBILITIES:
1. Analyze the user's music taste from their profile
2. Generate personalized recommendations (not generic top charts)
3. Provide real, working links to their preferred platform
4. Explain WHY you're suggesting each item (connect to their taste)
5. Mix familiar territory (70%) with discovery (30%)

LINK FORMAT:
- Spotify: https://open.spotify.com/track/{id} or /album/{id}
- YouTube Music: https://music.youtube.com/watch?v={id}
- Apple Music: https://music.apple.com/{region}/album/{name}/{id}
- If you cannot find the exact link, give the search URL:
  Spotify: https://open.spotify.com/search/{query}
  YouTube Music: https://music.youtube.com/search?q={query}

RULES:
- Always use the user's preferred platform for links
- If platform unknown, provide Spotify + YouTube Music links both
- Never recommend songs that are clearly outside their taste
  (unless they ask for exploration)
- If the profile is thin (few screenshots), say so honestly:
  "I don't have much data on your music taste yet. Based on the
   few screenshots I've seen, here's what I can suggest..."
- Always offer to refine: "Tell me if this is on track"
```

#### TRAVEL AGENT

```
WHAT IT DOES:
  • Detects where you want to travel (from screenshots + timestamps)
  • Plans a personalized itinerary based on your profile
  • Shapes the itinerary to YOUR preferences, not generic

WHEN IT ACTIVATES:
  • User asks anything travel-related:
    "Plan my itinerary"
    "Where should I go?"
    "Build me a Tokyo trip"
    "Plan a 5-day trip based on my saves"

HOW IT WORKS:

  User: "Plan my itinerary"
  (No destination specified)
      │
      ▼
  Orchestrator loads User Profile
      │
      ▼
  Routes to Travel Agent with full profile context
      │
      ▼
  Travel Agent reads profile:
    • Travel interests:
      - Tokyo (strength: 0.9, 12 screenshots, most recent: 5 days ago)
      - Bali (strength: 0.5, 4 screenshots, most recent: 17 days ago)
    • Detected dates: April 10-17 (from flight screenshot)
    • Hotels saved: Park Hyatt Tokyo, Shinjuku Granbell
    • Activities saved: Shibuya, Tsukiji, TeamLab
    • Food saved: Ichiran Ramen, conveyor belt sushi
    • Budget signals: ₹40,000-60,000 for flights
    • Style: boutique hotels, street food + fine dining, culture + adventure, relaxed pace
    • User is: vegetarian (from general profile)
      │
      ▼
  Travel Agent determines:
    • Destination: Tokyo (highest strength + recency)
    • Dates: April 10-17 (from flight screenshot)
    • Duration: 7 days
    • Style: relaxed, cultural, not packed
    • Budget: mid-premium
    • Dietary: vegetarian
      │
      ▼
  Travel Agent generates itinerary:

  "Based on your 12 Tokyo screenshots (saved over the last 3 weeks)
   and the flights you were looking at (April 10-17), here's your
   personalized Tokyo itinerary:

   📍 Destination: Tokyo, Japan
   📅 Dates: April 10-17, 2026 (7 days)
   💰 Estimated budget: ₹1.5L - 2L (flights + stay + food + activities)

   🏨 Hotels (from your saves):
   • Option A: Park Hyatt Tokyo — luxury, Shinjuku, ₹18K/night
   • Option B: Shinjuku Granbell — boutique, ₹6K/night ← fits your style better

   📋 DAY-BY-DAY PLAN:

   Day 1 (Apr 10) — Arrival + Shinjuku
   • Arrive Narita/Haneda
   • Check into Shinjuku Granbell
   • Evening: explore Shinjuku, Golden Gai (low-key bars area)
   • Dinner: Afuri Ramen (vegetarian ramen option) — Shinjuku

   Day 2 (Apr 11) — Shibuya + Harajuku
   • Morning: Shibuya crossing (from your screenshot)
   • Meiji Shrine (free, peaceful, 30 min walk)
   • Lunch: Ain Soph Journey (fully vegetarian, Shinjuku)
   • Afternoon: Harajuku, Takeshita Street
   • Evening: TeamLab Borderless (from your screenshot — book in advance!)

   Day 3 (Apr 12) — Tsukiji + Ginza
   • Morning: Tsukiji Outer Market (from your screenshot)
     Note: as a vegetarian, try the tamagoyaki and fresh fruit stalls
   • Afternoon: Ginza, window shopping, architecture
   • Dinner: T's TanTan (vegan ramen, Tokyo Station)

   ...

   Day 7 (Apr 17) — Departure
   • Pack + checkout
   • Last-minute shopping: Don Quijote for souvenirs
   • Head to airport

   ✈️ FLIGHTS:
   Based on your screenshot showing Delhi → Tokyo flights at ₹40-60K,
   I'd recommend booking on the ₹45K range (Air India direct).

   🍽️ FOOD NOTE:
   All restaurant picks are vegetarian-friendly since you mentioned
   being vegetarian. Tokyo is excellent for vegetarian food if you
   know where to go.

   📝 PERSONALIZED BECAUSE:
   • Relaxed pace (1-2 major activities per day, not 5)
   • Mix of culture + modern (your screenshot pattern)
   • Vegetarian dining throughout
   • Mid-premium budget (Granbell over Park Hyatt)
   • Activities you actually screenshotted prioritized

   Want me to adjust the pace, swap any days, or dive deeper
   into any part of the plan?"
      │
      ▼
  Profile Updater: records that user is actively planning Tokyo trip
```

**Travel Agent — System Prompt:**

```
You are the Travel Agent for Pool. You plan personalized itineraries
based on the user's screenshot history and profile.

INPUTS YOU RECEIVE:
- User's full travel profile (destinations, hotels, activities, food saved)
- User's general profile (name, food preferences, budget style, personality)
- User's music profile (if relevant — e.g., for mood/vibe of trip)
- The user's query

YOUR RESPONSIBILITIES:
1. Determine where the user wants to go (from screenshot strength + recency)
2. Extract dates, budget, and duration from screenshot signals
3. Build a day-by-day itinerary using THEIR specific saves as anchors
4. Fill gaps with recommendations that match their profile
5. Respect dietary restrictions, budget style, pace preference
6. Explain WHY each choice was made (connect to their profile)

IF NO DESTINATION IS SPECIFIED:
- Pick the destination with highest strength × recency score
- Explain: "Based on your 12 Tokyo screenshots from the last 3 weeks,
  it looks like Tokyo is your next trip. Here's the plan..."

IF MULTIPLE DESTINATIONS ARE CLOSE IN STRENGTH:
- Present top 2-3, let user choose
- "I see Tokyo (12 screenshots) and Bali (4 screenshots).
  Which one should I plan?"

RULES:
- Always anchor itinerary around screenshots the user actually saved
- Never make up restaurants/hotels — use their saves + well-known options
- Always respect dietary restrictions
- If profile is thin, say so: "I don't have much to go on yet..."
- Pace: default to relaxed (2 activities/day) unless user says otherwise
- Include practical info: transit, booking tips, estimated costs
```

---

## 4. Orchestrator (The Router)

The orchestrator is simple. It does NOT solve anything itself. It:
1. Loads the user profile
2. Classifies the query (music / travel / profile question / other)
3. Routes to the right agent
4. Returns the response
5. Triggers profile update after the interaction

```typescript
async function handleQuery(userId: string, query: string): Promise<Response> {

  // 1. Load user profile
  const profile = await loadUserProfile(userId)

  // 2. Classify intent
  const intent = await classifyIntent(query)
  // Returns: "music" | "travel" | "profile" | "general"

  // 3. Route
  let response: string

  switch (intent) {
    case "music":
      response = await musicAgent(query, profile)
      break

    case "travel":
      response = await travelAgent(query, profile)
      break

    case "profile":
      // "What do you know about me?" / "Who am I?"
      response = await profileSummary(profile)
      break

    case "general":
      response = "I'm your music and travel assistant. Ask me to suggest music " +
                 "based on your taste or plan a trip based on your saves!"
      break
  }

  // 4. Update profile from conversation
  await updateProfileFromConversation(userId, query, response)

  return response
}
```

**Intent Classification Prompt:**

```
Classify this user query into exactly one category:

- "music": anything about songs, albums, playlists, artists, music taste,
  listening suggestions, music platforms
- "travel": anything about trips, itineraries, destinations, flights,
  hotels, travel planning
- "profile": user asking about themselves ("what do you know about me",
  "who am I", "what are my interests")
- "general": anything else

Query: "{query}"
Return ONLY the category name, nothing else.
```

---

## 5. Data Model

```typescript
// ── SCREENSHOTS ──

screenshots: {
  id: string
  userId: string
  imageUrl: string
  uploadedAt: number

  // Analysis output
  description: string
  category: "music" | "travel" | "food" | "shopping" | "personal" | "other"
  entities: {
    // Music: { songs, artists, album, playlist, platform }
    // Travel: { destination, hotel, activity, dates, price, airline }
    // Other: { whatever was detected }
  }
  userFacts: Array<{
    fact: string
    value: string
    evidence: string
    confidence: number
  }>
  rawAnalysis: object    // full LLM response

  // Embedding
  textEmbedding: number[]  // for similarity search
}

// ── USER PROFILE ──

userProfile: {
  userId: string

  identity: {
    name: { value, confidence, sources, evidence }
    location: { value, confidence, sources, evidence }
  }

  music: {
    preferredPlatform: { value, confidence, sources }
    genres: Array<{ genre, strength, artistCount }>
    favoriteArtists: Array<{ name, mentions, sources }>
    likedSongs: Array<{ title, artist, source }>
    playlistsSeen: Array<{ name, platform, source }>
    listeningPatterns: {
      moodPreference: string
      energyLevel: string
      languages: string[]
      contextPreferences: object  // e.g., { working: "lo-fi" }
    }
  }

  travel: {
    interests: Array<{
      destination: string
      strength: number
      screenshotCount: number
      lastSeen: number
      details: {
        hotelsSaved: string[]
        activitiesSaved: string[]
        foodSaved: string[]
        datesDetected: string
        budgetSignals: string
      }
    }>
    style: {
      accommodation: string
      food: string
      activities: string
      pace: string
      budget: string
    }
  }

  general: {
    personalitySignals: string[]
    language: string
    foodPreferences: string[]
    budgetStyle: string
  }

  totalScreenshots: number
  lastUpdated: number
}

// ── CONVERSATION HISTORY ──

conversations: {
  id: string
  userId: string
  query: string
  intent: "music" | "travel" | "profile" | "general"
  response: string
  profileFactsExtracted: Array<{ fact, value, confidence }>
  createdAt: number
}
```

---

## 6. Screenshot → Profile Pipeline (Detailed)

Here's exactly how a screenshot becomes profile knowledge:

### Example 1: Spotify Playlist Screenshot

```
INPUT: Screenshot of Spotify showing "Late Night Drive" playlist
       with songs: Do I Wanna Know? (Arctic Monkeys),
       Let It Happen (Tame Impala), The Less I Know The Better (Tame Impala)

VISION ANALYSIS OUTPUT:
{
  description: "Spotify playlist 'Late Night Drive' with indie rock songs",
  category: "music",
  entities: {
    platform: "Spotify",
    playlist_name: "Late Night Drive",
    songs: [
      { title: "Do I Wanna Know?", artist: "Arctic Monkeys" },
      { title: "Let It Happen", artist: "Tame Impala" },
      { title: "The Less I Know The Better", artist: "Tame Impala" }
    ]
  },
  user_facts: [
    { fact: "music_platform", value: "Spotify", evidence: "Spotify app interface visible", confidence: 0.95 },
    { fact: "liked_artist", value: "Arctic Monkeys", evidence: "in user's playlist", confidence: 0.85 },
    { fact: "liked_artist", value: "Tame Impala", evidence: "2 songs in playlist", confidence: 0.9 },
    { fact: "genre_preference", value: "Indie Rock", evidence: "playlist contents", confidence: 0.8 },
    { fact: "listening_mood", value: "late night, chill driving", evidence: "playlist name", confidence: 0.7 }
  ]
}

PROFILE UPDATES:
  music.preferredPlatform:
    Before: null
    After: { value: "Spotify", confidence: 0.95, sources: ["screenshot_33"] }

  music.favoriteArtists:
    Before: [{ name: "Arctic Monkeys", mentions: 4 }]
    After: [{ name: "Arctic Monkeys", mentions: 5 }, { name: "Tame Impala", mentions: 2 }]

  music.genres:
    Before: [{ genre: "Indie Rock", strength: 0.85 }]
    After: [{ genre: "Indie Rock", strength: 0.9 }]  // reinforced

  music.playlistsSeen:
    += { name: "Late Night Drive", platform: "Spotify", source: "screenshot_33" }

  music.listeningPatterns.moodPreference:
    Before: "introspective"
    After: "introspective, late-night drive vibes"
```

### Example 2: Google Flights Screenshot

```
INPUT: Screenshot of Google Flights showing Delhi → Tokyo, April 10-17,
       ₹45,000-55,000 round trip

VISION ANALYSIS OUTPUT:
{
  description: "Google Flights search: Delhi to Tokyo, April 10-17, ₹45-55K",
  category: "travel",
  entities: {
    origin: "Delhi",
    destination: "Tokyo",
    departure: "2026-04-10",
    return: "2026-04-17",
    price_range: "₹45,000 - ₹55,000",
    trip_duration: "7 days"
  },
  user_facts: [
    { fact: "home_city", value: "Delhi", evidence: "flight origin", confidence: 0.85 },
    { fact: "travel_interest", value: "Tokyo", evidence: "searching flights", confidence: 0.95 },
    { fact: "travel_dates", value: "April 10-17, 2026", evidence: "flight search dates", confidence: 0.9 },
    { fact: "travel_budget", value: "₹45-55K for flights", evidence: "price range viewed", confidence: 0.8 }
  ]
}

PROFILE UPDATES:
  identity.location:
    Before: { value: "Delhi", confidence: 0.80, sources: [...] }
    After: { value: "Delhi", confidence: 0.85, sources: [..., "screenshot_67"] }  // reinforced

  travel.interests[Tokyo]:
    Before: { strength: 0.85, screenshotCount: 11 }
    After: {
      strength: 0.9,  // flight search = very high intent signal
      screenshotCount: 12,
      details.datesDetected: "April 10-17, 2026",
      details.budgetSignals: "₹45-55K for flights"
    }
```

---

## 7. Query → Response Pipeline (Detailed)

### Example: "Suggest me some music"

```
[1] LOAD PROFILE
    → Fetch full user profile for this user

[2] CLASSIFY INTENT
    → "music"

[3] PREPARE MUSIC AGENT CONTEXT
    System prompt + profile injection:

    "You are the Music Agent for Pool.

     USER PROFILE:
     Name: Samiksha
     Music Platform: Spotify (confidence: 0.95)
     Top Genres: Indie Rock (0.9), Lo-fi (0.7), Bollywood (0.5)
     Favorite Artists: Arctic Monkeys (5 mentions), Prateek Kuhad (4),
       Tame Impala (3), AP Dhillon (2)
     Mood Preference: introspective, chill, late-night drive vibes
     Energy Level: low-to-medium
     Languages: English, Hindi
     Context: prefers lo-fi while working

     USER QUERY: Suggest me some music

     Give personalized recommendations with Spotify links.
     Mix familiar (70%) and discovery (30%).
     Explain why each pick matches their taste."

[4] LLM GENERATES RESPONSE
    → Personalized picks with links + reasoning

[5] UPDATE PROFILE
    → Orchestrator checks if conversation revealed new facts
    → In this case: no new facts, just a query
    → No profile update needed

[6] STORE CONVERSATION
    → Log query + response for future context
```

### Example: "Plan my itinerary"

```
[1] LOAD PROFILE
    → Full profile including travel section

[2] CLASSIFY INTENT
    → "travel"

[3] DETERMINE DESTINATION (since not specified)
    Travel interests ranked by strength × recency:
    → Tokyo: strength 0.9, 12 screenshots, last seen 5 days ago → SCORE: 0.88
    → Bali: strength 0.5, 4 screenshots, last seen 17 days ago → SCORE: 0.30
    → Pick: Tokyo

[4] PREPARE TRAVEL AGENT CONTEXT
    System prompt + profile + all Tokyo-related screenshot summaries:

    "You are the Travel Agent for Pool.

     USER PROFILE:
     Name: Samiksha
     From: Delhi, India
     Food: Vegetarian, likes Japanese food, Italian, street food
     Budget: Mid-premium
     Travel Style: Relaxed pace, culture + adventure, boutique hotels

     DESTINATION: Tokyo (auto-detected from 12 screenshots)
     DATES: April 10-17, 2026 (from flight search screenshot)
     DURATION: 7 days

     SAVED SCREENSHOTS FOR TOKYO:
     1. Google Flights: Delhi→Tokyo, ₹45-55K, Apr 10-17
     2. Park Hyatt Tokyo hotel page
     3. Shinjuku Granbell Hotel page
     4. Shibuya crossing Instagram reel
     5. Tsukiji Outer Market blog post
     6. TeamLab Borderless screenshot
     7. Ichiran Ramen review
     8. Conveyor belt sushi video
     9. Meiji Shrine photo
     10. Tokyo tower night view
     11. Shinjuku Golden Gai article
     12. Akihabara electronics district

     Build a day-by-day itinerary. Anchor around their saved places.
     Respect: vegetarian diet, relaxed pace, mid-premium budget.
     Include practical details: transit, costs, booking tips."

[5] LLM GENERATES ITINERARY
    → Full 7-day plan personalized to Samiksha

[6] UPDATE PROFILE
    → Record: user is actively planning Tokyo trip (stage: "planning")
    → This will make future Tokyo queries even more contextual

[7] STORE CONVERSATION
    → Log for future reference
```

---

## 8. Tech Stack

| Component | Technology | Why |
|---|---|---|
| **Backend** | Convex (TypeScript) | Real-time reactive DB, serverless, scheduled functions, no separate job queue |
| **AI Framework** | Vercel AI SDK | Runs inside Convex actions, TypeScript native, streaming, tool calling |
| **Vision + LLM** | Gemini 2.0 Flash | Cheap, fast, good multimodal — handles OCR + vision + reasoning in one call |
| **Embeddings** | Voyage AI or Gemini embedding | Text similarity for screenshot search |
| **Object Storage** | Cloudflare R2 | Screenshot images, cheap, no egress fees |
| **Auth** | Clerk or Convex Auth | User sessions |
| **Mobile** | React Native | Cross-platform (or Swift if iOS-only) |

### What We Don't Need (For V1)

- No vector DB (Convex can do basic embedding search; scale later if needed)
- No Redis/BullMQ (Convex scheduler handles background jobs)
- No Neo4j (relational queries are sufficient)
- No separate OCR service (Gemini handles it)
- No price scraping (no shopping agent)
- No push notifications (reactive only)

---

## 9. API Endpoints

```
POST /api/screenshots/upload
  → Upload screenshot image
  → Returns: { screenshotId, status: "processing" }
  → Triggers async: vision analysis → embedding → profile update

GET /api/screenshots
  → List user's screenshots with metadata
  → Supports: category filter, date range, search query

POST /api/agent/query
  → Send a text query to the agent
  → Body: { message: "Suggest me some music" }
  → Returns: { response: "...", intent: "music", profileUpdated: true/false }

GET /api/profile
  → Get user's current profile (what the agent knows about them)
  → Returns: full UserProfile object

POST /api/profile/correct
  → User corrects a profile fact
  → Body: { factKey: "music.preferredPlatform", correctValue: "Apple Music" }
  → Override with confidence: 1.0

GET /api/profile/sources/{factKey}
  → Show which screenshots a specific fact was derived from
  → Returns: array of screenshot thumbnails + evidence text
```

---

## 10. Project Structure

```
pool-agent/
├── convex/
│   ├── schema.ts                  # All table definitions
│   ├── screenshots.ts             # Upload, list, search
│   ├── profile.ts                 # Profile CRUD, update logic
│   ├── agent.ts                   # Query handler (orchestrator)
│   ├── conversations.ts           # Conversation history
│   │
│   ├── agents/
│   │   ├── musicAgent.ts          # Music recommendation logic
│   │   ├── travelAgent.ts         # Itinerary planning logic
│   │   └── profileSummary.ts      # "What do you know about me?"
│   │
│   ├── ingestion/
│   │   ├── analyzeScreenshot.ts   # Vision LLM analysis
│   │   ├── generateEmbedding.ts   # Text embedding
│   │   └── updateProfile.ts       # Extract facts → update profile
│   │
│   ├── lib/
│   │   ├── llm.ts                 # Vercel AI SDK wrapper (Gemini)
│   │   ├── prompts.ts             # All system prompts
│   │   └── profileHelpers.ts      # Confidence scoring, reinforcement
│   │
│   └── crons.ts                   # Scheduled jobs (if any needed)
│
├── app/                           # Mobile app (React Native) or web
│   ├── screens/
│   │   ├── Upload.tsx             # Screenshot upload
│   │   ├── Chat.tsx               # Talk to agent
│   │   ├── Profile.tsx            # "What agent knows about me"
│   │   └── Screenshots.tsx        # Browse all screenshots
│   │
│   └── components/
│       ├── ChatBubble.tsx
│       ├── ScreenshotCard.tsx
│       └── ProfileFactCard.tsx
│
├── AGENT_V1_ARCHITECTURE.md       # This file
└── package.json
```

---

## 11. Build Order (Implementation Roadmap)

### Sprint 1: Foundation (Week 1-2)
```
☐ Convex project setup + schema (screenshots, userProfile, conversations)
☐ Auth setup (Clerk/Convex Auth)
☐ Screenshot upload endpoint + R2 storage
☐ Gemini Flash integration via Vercel AI SDK
☐ Screenshot vision analysis pipeline (upload → analyze → store)
☐ Basic profile creation (empty profile on first screenshot)
```

### Sprint 2: Profile Builder (Week 3-4)
```
☐ Profile update logic (extract facts from analysis → update profile)
☐ Confidence scoring + reinforcement (same fact from multiple screenshots)
☐ Profile fact source tracking (which screenshot taught what)
☐ Profile API endpoints (view profile, correct facts, view sources)
☐ Embedding generation for screenshots
☐ Test: upload 20 screenshots, verify profile is accurate
```

### Sprint 3: Music Agent (Week 5-6)
```
☐ Orchestrator (intent classification + routing)
☐ Music Agent with system prompt + profile injection
☐ Music recommendation generation with platform-specific links
☐ Platform detection logic (from screenshot analysis)
☐ Conversation storage
☐ Profile update from conversations (explicit user statements)
☐ Test: full flow — upload Spotify screenshots → ask for recommendations
```

### Sprint 4: Travel Agent (Week 7-8)
```
☐ Travel Agent with system prompt + profile injection
☐ Destination detection (strength × recency ranking)
☐ Itinerary generation with profile personalization
☐ Date/budget extraction from flight/hotel screenshots
☐ Dietary and style preferences applied to itinerary
☐ Test: upload Tokyo screenshots → "Plan my itinerary" with no destination
```

### Sprint 5: Polish (Week 9-10)
```
☐ "What do you know about me?" profile summary agent
☐ Profile correction flow (user overrides agent inference)
☐ Conversation history display
☐ Screenshot browsing UI (filter by category)
☐ Edge cases: thin profile, contradictions, unknown platform
☐ End-to-end testing with real screenshots
```

---

## 12. What This Does NOT Include (Intentionally)

```
❌ Proactive notifications — agent only responds when asked
❌ Price tracking — no shopping agent
❌ Smart pools / auto-folders — just flat screenshot storage for now
❌ Multi-agent hierarchy — no orchestrator → solver → worker chain
   (each agent is a single LLM call with profile context, not a solver
    that spawns workers)
❌ Memory decay — all screenshots are equal, no forgetting curve
❌ Push notifications — no background "hey, I noticed..."
❌ Permission tiers — no trust escalation system
❌ Web scraping — agents use LLM knowledge, not live web search
```

These can all be layered on later when V1 proves the core loop works:
**Screenshot → Learn → Ask → Get personalized answer.**

---

## 13. Success Criteria for V1

```
✓ Upload 30 music screenshots → agent correctly identifies:
  - Preferred platform (Spotify/YouTube Music/Apple Music)
  - Top 3 genres
  - Top 5 artists
  - Mood preferences

✓ Ask "suggest me music" → get personalized recommendations with
  working links to the correct platform

✓ Upload 15 travel screenshots for Tokyo → agent correctly:
  - Detects Tokyo as top destination
  - Extracts dates from flight screenshots
  - Plans 7-day itinerary using saved places as anchors
  - Respects dietary preferences (vegetarian)
  - Matches travel style (relaxed pace, boutique hotels)

✓ Ask "plan my itinerary" (no destination) → agent picks Tokyo
  and generates a personalized plan

✓ Ask "what do you know about me?" → agent shows accurate profile
  with sources for every fact

✓ Correct a fact ("I actually prefer Apple Music") → profile updates
  immediately, next music suggestion uses Apple Music links
```

---

*This is the V1 architecture. Two agents. Reactive only. Profile-driven. Build this, prove it works, then add more agents and proactive features on top.*
