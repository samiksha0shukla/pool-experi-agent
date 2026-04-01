# Pool Agent CLI — Guide

## How to Run

```bash
# 1. Set up your API key
cp .env.example .env
# Edit .env and add your Gemini API key from https://aistudio.google.com/apikey

# 2. Install dependencies
npm install

# 3. Run
npm start        # Run the CLI
npm run dev      # Run with auto-reload on file changes
```

---

## Project Structure

```
src/
├── cli.ts                      # Entry point — main menu loop
├── banner.ts                   # Gradient ASCII art banner
├── logger.ts                   # Colored logs, spinners, step counters
├── store.ts                    # Local JSON-based data storage
├── llm.ts                      # Vercel AI SDK + Gemini Flash wrapper
├── upload.ts                   # Screenshot upload + auto-analysis
├── query.ts                    # Chat interface with real agent pipeline
├── profile.ts                  # Profile viewer (what agent knows about you)
├── renderer.ts                 # HTML response generator (opens in browser)
│
├── ingestion/
│   ├── analyze.ts              # Vision LLM — screenshot → structured JSON
│   └── profileUpdater.ts       # Extract facts → update user profile
│
└── agents/
    ├── musicAgent.ts           # Music recommendations with platform links
    ├── travelAgent.ts          # Itinerary planning from screenshots
    └── profileAgent.ts         # "What do you know about me?"

data/                           # Auto-created at runtime
├── screenshots/                # Copied screenshot images
├── responses/                  # Generated HTML response files
├── profile.json                # User profile (built from screenshots)
├── screenshots.json            # Screenshot metadata index
└── conversations.json          # Chat history
```

---

## File-by-File Explanation

### `src/cli.ts` — Entry Point

The main loop. Shows the banner, then presents a menu:
- **Upload Screenshots** — add images, each is analyzed by Gemini Vision immediately
- **Ask Agent** — chat with the music/travel agent (real LLM responses)
- **View Profile** — see what the agent has learned about you from screenshots
- **View Screenshots** — table of all uploaded screenshots with analysis status
- **Exit**

After each action, it loops back to the menu.

### `src/llm.ts` — LLM Integration (Vercel AI SDK + Gemini)

The AI brain of the system. Uses **Vercel AI SDK** with the **Google Gemini 2.0 Flash** model. Provides 4 functions:

| Function | What it does |
|---|---|
| `generateText(system, user)` | Text-in → text-out (for agents) |
| `analyzeImage(path, prompt)` | Image + prompt → text (for screenshot analysis) |
| `analyzeImageJSON(path, prompt, schema)` | Image → structured JSON via Zod schema (for ingestion pipeline) |
| `generateJSON(system, user, schema)` | Text → structured JSON via Zod schema (for intent classification) |

All functions use `gemini-2.0-flash`. The API key is read from `.env` (`GOOGLE_GENERATIVE_AI_API_KEY`). If not set, the CLI gracefully degrades with helpful error messages.

### `src/ingestion/analyze.ts` — Screenshot Vision Analysis

The ingestion pipeline. When a screenshot is uploaded, this module sends it to Gemini Vision and gets back structured data:

```
Screenshot image
    │
    ▼
Gemini 2.0 Flash (multimodal)
    │
    ▼
{
  description: "Spotify playlist 'Late Night Drive' with indie rock songs",
  category: "music",              ← one of: music/travel/food/shopping/personal/other
  entities: {
    platform: "Spotify",
    songs: [{ title: "Do I Wanna Know?", artist: "Arctic Monkeys" }],
    playlist_name: "Late Night Drive"
  },
  user_facts: [                   ← facts about the USER extracted from this screenshot
    { fact: "music_platform", value: "Spotify", evidence: "Spotify app visible", confidence: 0.95 },
    { fact: "liked_artist", value: "Arctic Monkeys", evidence: "in playlist", confidence: 0.85 }
  ]
}
```

The prompt instructs Gemini to:
- Only extract what is **VISIBLE** in the screenshot (no guessing)
- Always detect the streaming platform for music screenshots
- Always extract destination/dates/prices for travel screenshots
- Score confidence: 0.9+ = clearly visible, 0.7-0.9 = partially obscured, <0.5 = don't include

Uses `generateObject` from Vercel AI SDK with a Zod schema to guarantee structured output.

### `src/ingestion/profileUpdater.ts` — Profile Builder

Takes the analysis output from `analyze.ts` and incrementally updates the user profile. Two entry points:

**From screenshots** (`updateProfileFromAnalysis`):
- Processes each `user_fact` with confidence > 0.5
- **Identity facts** (name, location) → stored with confidence + source screenshot ID
- **Music facts** (platform, artist, genre) → added to music profile, reinforced if already known
- **Travel facts** (destination) → added to travel interests with strength scoring
- **Food facts** (cuisine) → added to food preferences
- Also enriches domain-specific data from entities (songs, playlists, hotels, activities, dates, prices)

**From conversations** (`updateProfileFromConversation`):
- Catches explicit user statements ("my name is X", "I'm vegetarian")
- User-stated facts get confidence: 1.0 (highest, always overrides inference)

Key behaviors:
- **Reinforcement**: Same fact from multiple screenshots → confidence increases
- **Never removes facts** based on absence
- **Contradictions**: Both values kept, higher confidence wins for display
- Every fact tracks its source screenshot IDs (audit trail)

### `src/agents/musicAgent.ts` — Music Agent

Called when the user asks about music. Receives the full user profile + music-related screenshot summaries. The system prompt instructs it to:

- Analyze the user's music taste from their profile (genres, artists, mood preferences)
- Generate personalized recommendations (not generic top charts)
- Provide real links to the user's **preferred platform** (Spotify/YouTube Music/Apple Music)
- Mix familiar territory (70%) with discovery (30%)
- Explain WHY each pick matches their taste
- Be honest if the profile is thin

### `src/agents/travelAgent.ts` — Travel Agent

Called when the user asks about travel. Receives profile + travel screenshot summaries. The system prompt instructs it to:

- Detect where the user wants to go from their screenshot strength + recency
- If no destination specified → pick the strongest one from their profile
- Build a day-by-day itinerary using their saved places as anchors
- Respect dietary restrictions, budget style, pace preferences
- Include practical details (transit, booking tips, costs)

### `src/agents/profileAgent.ts` — Profile Agent

Called when the user asks "what do you know about me?" Presents the profile in a friendly way with sources cited, and suggests what screenshot types would help fill gaps.

### `src/query.ts` — Chat Orchestrator

The main query pipeline. When you type a question, it runs 7 steps with real-time logs:

```
[1/7] Loading user profile...
      ℹ  Profile loaded — 12 screenshots analyzed
[2/7] Fetching screenshot context...
      ℹ  15 screenshots in store, 12 analyzed
[3/7] Classifying query intent...
      ✔  Intent: 🎵 Music Agent (mentions music taste)
[4/7] Building agent context...
      ℹ  Context: 8 relevant screenshots
[5/7] Generating response...
      ⠋ Agent is thinking...
      ✔  Response generated
[6/7] Checking for new profile facts...
      ℹ  No new facts from this conversation
[7/7] Done
```

**Intent classification**: Uses Gemini Flash via `generateObject` with a Zod schema. Falls back to keyword matching if API is unavailable.

**Agent routing**: Music queries → Music Agent, travel queries → Travel Agent, profile queries → Profile Agent. Each agent gets the full user profile JSON + relevant screenshot summaries.

**Profile update**: After each conversation, checks if the user explicitly stated new facts.

### `src/upload.ts` — Screenshot Upload + Analysis

Two upload modes:
1. **Folder upload** — scan directory for all images
2. **File upload** — comma-separated file paths

**What happens on each upload:**
```
[1/5] Importing screenshot.png
      ✔  ss_1711538400_a3f2b1.png (245.3 KB)
      ⠋ Analyzing screenshot with Gemini Vision...
      ✔  Detected: music — Spotify playlist showing indie rock songs
      👤 Profile updated: +2 new, 1 reinforced
      🧠 music_platform: Spotify (95% — Spotify app visible)
      🧠 liked_artist: Arctic Monkeys (85% — in user's playlist)
```

Each screenshot is:
1. Copied to `data/screenshots/` with unique ID
2. Sent to Gemini Vision for analysis (category, entities, user facts)
3. Analysis results saved to screenshot metadata
4. User profile updated with extracted facts

If the API key isn't configured, upload still works — it just skips the analysis step.

### `src/store.ts` — Data Storage

JSON file-based storage. Functions:
- `saveScreenshot` / `getScreenshots` / `updateScreenshot` — screenshot CRUD
- `getProfile` / `saveProfile` — user profile read/write
- `saveConversation` / `getConversations` — chat history
- `initStore` — creates data directories

### `src/profile.ts` — Profile Viewer

Terminal display with:
- Identity (name, location) with confidence percentages
- Music (platform, genres with strength bar charts, top artists)
- Travel (destinations with strength bars, style preferences)
- Stats bar (total/analyzed/pending counts)

### `src/renderer.ts` — HTML Response Renderer

Converts agent responses to styled dark-themed HTML:
- Color-coded by agent type (green=music, blue=travel, purple=profile)
- Original query displayed at top
- Markdown → HTML rendering
- Auto-opens in default browser

### `src/banner.ts` — ASCII Banner

Gradient "POOL AGENT" ASCII art with agent labels.

### `src/logger.ts` — Logging

Consistent colored terminal output: icons, step counters, spinners, dividers.

---

## How the Pipeline Works End-to-End

### Upload Flow
```
User uploads folder of screenshots
  → Each image is copied + assigned unique ID
  → Gemini Vision analyzes each image (structured JSON output)
  → Entities extracted: songs, artists, platform, destinations, hotels, dates, prices
  → User facts extracted: name, location, music taste, travel interests
  → Profile updated incrementally (confidence scores, reinforcement)
  → All metadata saved to data/screenshots.json
```

### Query Flow
```
User types "suggest me some music"
  → LLM classifies intent → "music"
  → Orchestrator loads user profile + music screenshot summaries
  → Music Agent receives: system prompt + profile JSON + screenshot context
  → Gemini generates personalized response with platform-specific links
  → Profile checks for new facts from conversation
  → Response displayed in terminal + optional HTML view
```

### Profile Building Flow
```
Screenshot 1 (Spotify playlist) → learns: platform=Spotify, genres=[Indie Rock], artists=[Arctic Monkeys]
Screenshot 2 (YouTube Music)    → learns: hmm, also uses YouTube Music (but Spotify has higher confidence)
Screenshot 3 (boarding pass)    → learns: name=Samiksha, location=Delhi
Screenshot 4 (Tokyo flights)    → learns: travel interest=Tokyo, budget=₹45K
Screenshot 5 (Spotify again)    → reinforces: Spotify confidence ↑, adds more artists
User says "I'm vegetarian"     → learns: food preference=vegetarian (confidence 1.0, user-stated)
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `ai` | Vercel AI SDK — unified interface for LLM calls |
| `@ai-sdk/google` | Google Gemini provider for Vercel AI SDK |
| `zod` | Schema validation for structured LLM output |
| `dotenv` | Load API key from .env file |
| `chalk` | Colored terminal text |
| `ora` | Animated spinners |
| `inquirer` | Interactive prompts (menus, inputs) |
| `figlet` | ASCII art text generation |
| `gradient-string` | Color gradients on text |
| `cli-table3` | Formatted tables |
| `glob` | File pattern matching for folder scanning |
| `open` | Open HTML files in default browser |
| `tsx` | Run TypeScript directly without compiling |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Gemini API key from https://aistudio.google.com/apikey |

Without the API key, the CLI still runs but:
- Screenshot uploads skip analysis
- Agent queries show "API key not configured" message
- Profile stays empty
