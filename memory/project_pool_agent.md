---
name: Pool App - Screenshot Intelligence Agent
description: User is building Pool, a screenshot app with an AI agent that detects user interests/intents from screenshots, organizes them into smart folders, tracks prices, plans itineraries, and builds a user profile — all from screenshot analysis alone.
type: project
---

Samiksha is building **Pool**, a screenshot-based intelligence app. The core idea: upload screenshots and an AI agent analyzes them to understand the user's life, interests, and intentions.

Key capabilities planned:
- Vision-based screenshot analysis (category, entities, intent)
- Brain-like memory system (retention, decay, recall)
- Auto-clustering screenshots into "pools" (smart folders)
- Proactive actions: calendar events, price tracking, itinerary planning
- User profile built purely from screenshot evidence (anti-hallucination)
- Zero-context queries ("plan my trip" without specifying where)

**Current focus (V1):** Stripped down to two reactive agents only — Music Agent + Travel Agent. No proactive features, no pools, no multi-agent hierarchy. Simple: screenshot → learn profile → answer queries. User wants to prove the core loop first, then layer complexity.

**Why:** Samiksha wants to build an agent that truly understands users through their screenshots — like a second brain.

**How to apply:** V1 architecture is in AGENT_V1_ARCHITECTURE.md. Full vision docs are POOL_ARCHITECTURE.md, POOL_DEFINITIVE_ARCHITECTURE.md, pool-agent-v2-architecture.md. Tech stack (V1): Convex + Vercel AI SDK + Gemini Flash + Voyage AI + Cloudflare R2.
