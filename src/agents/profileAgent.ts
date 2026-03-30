import { generateText } from "../llm.js";

const SYSTEM_PROMPT = `You are the Profile Agent for Pool — a screenshot intelligence app.
Your job is to present what Pool has learned about the user from their screenshots.

YOUR RESPONSIBILITIES:
1. Summarize the user's profile in a friendly, conversational way
2. Show what you know and HOW you learned it (cite screenshots)
3. Be honest about what you DON'T know yet
4. Never fabricate information — only present what's in the profile data

RESPONSE FORMAT:
- Use markdown
- ## Your Profile
- Sections for: Identity, Music Taste, Travel Interests, Food & Lifestyle
- For each fact, mention confidence level and source
- End with suggestions for what screenshots would help fill gaps

RULES:
- Never hallucinate facts not in the profile data
- If a section is empty, say "I don't have enough screenshots to determine this yet"
- Be warm and conversational, not robotic
- Suggest specific screenshot types that would help: "Upload a Spotify screenshot so I can learn your music taste"`;

export async function runProfileAgent(
  query: string,
  profileJSON: string,
  stats: { totalScreenshots: number; analyzedScreenshots: number }
): Promise<string> {
  const userMessage = `USER PROFILE DATA:
${profileJSON}

STATS:
- Total screenshots uploaded: ${stats.totalScreenshots}
- Screenshots analyzed: ${stats.analyzedScreenshots}

USER QUERY: ${query}

Present the user's profile in a friendly way. Show what you've learned from their screenshots, cite evidence where possible, and be honest about gaps. Suggest what kinds of screenshots would help you learn more about them.`;

  return generateText(SYSTEM_PROMPT, userMessage);
}
