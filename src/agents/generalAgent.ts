/**
 * GENERAL AGENT — Handles queries outside music/travel/profile
 *
 * Uses semantic search on the knowledge store to answer screenshot-related
 * questions that aren't music or travel specific.
 *
 * Also handles greetings, general Q&A, and Pool app explanation.
 */

import { generateText, generateTextWithSearch, type ChatMessage } from "../llm.js";
import type { KnowledgeStore } from "../knowledge/store.js";

const SYSTEM_PROMPT = `You are Pool Agent — a helpful AI assistant embedded inside Pool, a screenshot intelligence app.

Your PRIMARY specialties are music recommendations and travel planning (based on user screenshots), but you're also capable of answering general questions.

WHEN TO ANSWER DIRECTLY:
- Greetings and casual chat ("hey", "how are you", "thanks")
- Simple factual questions ("what's the capital of Japan", "how many km in a mile")
- Quick explanations ("what is a REST API", "explain machine learning briefly")
- Math ("what's 15% of 230")
- General advice ("how to stay productive", "tips for public speaking")
- Anything a helpful assistant should be able to answer

SCREENSHOT-BASED QUESTIONS:
When the user asks about their screenshots (e.g., "what was that app I was looking at?", "show me what I saved"),
you will receive semantic search results from their screenshot library. Use these to answer accurately.
Always cite which screenshot/app the information came from.

HOW TO ANSWER:
- Be concise and direct — don't overexplain
- Use markdown for structure when helpful (headers, bullet points)
- Keep answers short unless the question clearly needs depth
- Be warm and natural, not robotic

WHAT YOU KNOW ABOUT YOURSELF:
- You are Pool Agent, part of the Pool app
- Pool analyzes user screenshots to learn about them (music taste, travel interests, food preferences)
- You have two specialist agents: Music Agent (recommends songs/albums with platform links) and Travel Agent (plans personalized itineraries)
- If someone asks what you can do, mention all three: music, travel, and general questions
- If someone asks a question that would be BETTER answered by the music or travel agent, suggest they rephrase: "Try asking me something like 'suggest me music' or 'plan my trip' for more personalized answers!"

RULES:
- Never refuse to answer a reasonable general question
- Don't say "I can only help with music and travel" — you CAN help with general stuff
- Keep it brief — 2-5 sentences for simple questions, more only if needed
- If the question is about music or travel specifically, still answer it but mention the specialized agents could do better`;

/**
 * Build general context from the knowledge store.
 */
async function buildGeneralContext(store: KnowledgeStore, query: string): Promise<string> {
  const parts: string[] = [];

  // Basic user info
  const name = store.getTopFact("name");
  const location = store.getTopFact("location");
  const language = store.getProfileValue("general.language");
  if (name) parts.push(`User: ${name}`);
  if (location) parts.push(`Location: ${location}`);
  if (language) parts.push(`Language: ${language.value}`);

  // Semantic search for screenshot-related queries
  const semanticResults = await store.semanticSearch(query, { limit: 5 });
  if (semanticResults.length > 0) {
    parts.push("\nRELEVANT SCREENSHOTS (from semantic search):");
    for (const result of semanticResults) {
      if (result.score > 0.3) { // Only include reasonably relevant results
        const screenshot = store.getScreenshot(result.screenshotId);
        const desc = screenshot?.detailedDescription || result.summary || "No description";
        const app = result.sourceApp || "unknown app";
        parts.push(`  - [${app}] ${desc} (relevance: ${(result.score * 100).toFixed(0)}%)`);

        // Include entities from this screenshot
        const entities = store.getEntitiesByScreenshot(result.screenshotId);
        if (entities.length > 0) {
          parts.push(`    Entities: ${entities.map((e) => `${e.entityType}=${e.entityValue}`).join(", ")}`);
        }
      }
    }
  }

  if (parts.length === 0) parts.push("No user context available yet.");
  return parts.join("\n");
}

export async function runGeneralQuery(
  query: string,
  store: KnowledgeStore,
  chatHistory?: ChatMessage[],
  useSearch?: boolean
): Promise<string> {
  const userContext = await buildGeneralContext(store, query);
  const prompt = SYSTEM_PROMPT + `\n\nCONTEXT ABOUT THE USER:\n${userContext}`;

  if (useSearch) {
    return generateTextWithSearch(prompt, query, chatHistory);
  }
  return generateText(prompt, query, chatHistory);
}
