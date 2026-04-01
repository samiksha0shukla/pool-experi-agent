# Pool Agent CLI

Screenshot intelligence agent — analyze screenshots with AI to discover music, plan travel, and build your personal profile.

## Prerequisites

- **Node.js 18+** — [Download here](https://nodejs.org)
- **Gemini API Key** (free) — [Get one here](https://aistudio.google.com/apikey)

## Setup

```bash
# 1. Clone the repo
git clone git@github.com:samiksha0shukla/pool-experi-agent.git
cd pool-experi-agent

# 2. Install dependencies
npm install

# 3. Configure your API key
cp .env.example .env
```

Open `.env` and paste your Gemini API key:

```
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

### Optional keys (for travel search features)

```
GOOGLE_CUSTOM_SEARCH_API_KEY=your_key_here
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=your_engine_id_here
```

Get these from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and [Programmable Search Engine](https://programmablesearchengine.google.com/).

## Run

```bash
npm start
```

### Install globally (optional)

```bash
npm install -g .
pool-agent    # now works from anywhere
```

## What it does

| Feature | Description |
|---------|-------------|
| **Upload Screenshots** | Analyze screenshots with OCR + AI vision |
| **Ask Agent** | Chat with AI that knows your data — music, travel, and general queries |
| **View Profile** | See what the agent has learned about you |
| **Music Link Generator** | Upload a music screenshot, get the exact streaming link |
| **View Screenshots** | Browse all uploaded screenshots and their analysis |

Supported image formats: PNG, JPG, JPEG, WebP, GIF, BMP

## How data is stored

All data stays on your machine. No cloud, no account needed.

```
data/
├── pool.db         # SQLite — facts, profile, conversations
├── vectors/        # Semantic search embeddings
├── graph.json      # Knowledge graph (entity relationships)
└── screenshots/    # Your uploaded images
```

To reset everything, delete the `data/` folder and restart.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `GOOGLE_GENERATIVE_AI_API_KEY not set` | Make sure `.env` exists with your key |
| Screenshots not analyzed | Check file format and API key quota |
| Database errors | Run `npm run migrate` |
| Agent gives generic answers | Upload more screenshots — it learns from your data |

## License

ISC
