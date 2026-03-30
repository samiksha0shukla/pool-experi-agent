import inquirer from "inquirer";
import chalk from "chalk";
import {
  log,
  logStep,
  logHeader,
  logDivider,
  startSpinner,
  stopSpinner,
  blank,
} from "./logger.js";
import {
  getProfile,
  getScreenshots,
  saveConversation,
  type ScreenshotMeta,
} from "./store.js";
import { renderToHTML } from "./renderer.js";
import { isConfigured, generateJSON } from "./llm.js";
import { runMusicAgent } from "./agents/musicAgent.js";
import { runTravelAgent } from "./agents/travelAgent.js";
import { runProfileAgent } from "./agents/profileAgent.js";
import { updateProfileFromConversation } from "./ingestion/profileUpdater.js";
import { z } from "zod";

// ── Intent classification via LLM ──

const IntentSchema = z.object({
  intent: z.enum(["music", "travel", "profile", "general"]),
  reasoning: z.string(),
});

async function classifyIntent(query: string): Promise<{ intent: string; reasoning: string }> {
  if (!isConfigured()) {
    return classifyIntentFallback(query);
  }

  try {
    return await generateJSON(
      `You classify user queries into exactly one category.
Categories:
- "music": songs, albums, playlists, artists, music taste, listening suggestions, concerts, music platforms
- "travel": trips, itineraries, destinations, flights, hotels, travel planning, vacation, sightseeing
- "profile": user asking about themselves — "what do you know about me", "who am I", "my interests", "my profile"
- "general": anything else, greetings, help requests, or ambiguous

Return the category and a brief reasoning.`,
      `Query: "${query}"`,
      IntentSchema
    );
  } catch {
    return classifyIntentFallback(query);
  }
}

function classifyIntentFallback(query: string): { intent: string; reasoning: string } {
  const q = query.toLowerCase();
  if (/music|song|album|playlist|listen|artist|genre|spotify|concert/i.test(q)) {
    return { intent: "music", reasoning: "keyword match" };
  }
  if (/travel|trip|itinerary|visit|flight|hotel|plan.*trip|destination|vacation/i.test(q)) {
    return { intent: "travel", reasoning: "keyword match" };
  }
  if (/who am i|about me|my profile|know about|my interest/i.test(q)) {
    return { intent: "profile", reasoning: "keyword match" };
  }
  return { intent: "general", reasoning: "no match" };
}

// ── Build context summaries from screenshots ──

function buildScreenshotSummaries(
  screenshots: ScreenshotMeta[],
  category?: string
): string {
  const analyzed = screenshots.filter((s) => s.analyzed);
  const filtered = category
    ? analyzed.filter((s) => s.category === category)
    : analyzed;

  if (filtered.length === 0) return "";

  return filtered
    .map((s, i) => {
      const entities = s.entities ? JSON.stringify(s.entities) : "none";
      return `[${i + 1}] ${s.description || "No description"} (category: ${s.category || "unknown"}, entities: ${entities})`;
    })
    .join("\n");
}

function formatProfileForAgent(profile: Record<string, unknown>): string {
  return JSON.stringify(profile, null, 2);
}

// ── Main pipeline ──

async function runPipeline(query: string): Promise<{ intent: string; response: string }> {
  const totalSteps = 7;

  // Step 1: Load profile
  logStep(1, totalSteps, chalk.hex("#6C5CE7")("Loading user profile..."));
  const profile = await getProfile();
  const totalScreenshots = (profile.totalScreenshots as number) || 0;
  log("info", `Profile loaded — ${totalScreenshots} screenshots analyzed`);

  // Step 2: Load screenshots
  logStep(2, totalSteps, chalk.hex("#A29BFE")("Fetching screenshot context..."));
  const screenshots = await getScreenshots();
  const analyzedCount = screenshots.filter((s) => s.analyzed).length;
  log("info", `${screenshots.length} screenshots in store, ${analyzedCount} analyzed`);

  // Step 3: Classify intent
  logStep(3, totalSteps, chalk.hex("#74B9FF")("Classifying query intent..."));
  const { intent, reasoning } = await classifyIntent(query);
  const intentLabel =
    intent === "music"
      ? chalk.green("🎵 Music Agent")
      : intent === "travel"
        ? chalk.blue("✈️  Travel Agent")
        : intent === "profile"
          ? chalk.magenta("👤 Profile Agent")
          : chalk.dim("💬 General");
  log("success", `Intent: ${intentLabel} ${chalk.dim(`(${reasoning})`)}`);

  // Step 4: Build context
  logStep(4, totalSteps, chalk.hex("#0984E3")("Building agent context..."));
  const profileJSON = formatProfileForAgent(profile);
  const relevantCategory = intent === "music" ? "music" : intent === "travel" ? "travel" : undefined;
  const summaries = buildScreenshotSummaries(screenshots, relevantCategory);
  const allSummaries = buildScreenshotSummaries(screenshots);
  log("info", `Context: ${summaries ? summaries.split("\n").length + " relevant screenshots" : "no domain screenshots"}`);

  // Step 5: Route to agent
  logStep(5, totalSteps, chalk.hex("#6C5CE7")("Generating response..."));
  let response: string;

  if (!isConfigured()) {
    response = getUnconfiguredResponse(intent, query, screenshots.length);
  } else {
    const spinner = startSpinner("Agent is thinking...");
    try {
      switch (intent) {
        case "music":
          response = await runMusicAgent(query, profileJSON, summaries || allSummaries);
          break;
        case "travel":
          response = await runTravelAgent(query, profileJSON, summaries || allSummaries);
          break;
        case "profile":
          response = await runProfileAgent(query, profileJSON, {
            totalScreenshots: screenshots.length,
            analyzedScreenshots: analyzedCount,
          });
          break;
        default:
          response = getGeneralResponse(query);
          break;
      }
      stopSpinner(spinner, "Response generated");
    } catch (err) {
      stopSpinner(spinner, "Agent error", false);
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `Agent failed: ${chalk.dim(msg)}`);
      response = `## Error\n\nThe agent encountered an error while processing your query.\n\n**Error:** ${msg}\n\nPlease try again or check your API key configuration.`;
    }
  }

  // Step 6: Update profile from conversation
  logStep(6, totalSteps, chalk.hex("#A29BFE")("Checking for new profile facts..."));
  try {
    const factsUpdated = await updateProfileFromConversation(query, response);
    if (factsUpdated > 0) {
      log("success", `${factsUpdated} new fact(s) extracted from conversation`);
    } else {
      log("info", "No new facts from this conversation");
    }
  } catch {
    log("info", "No new facts from this conversation");
  }

  // Step 7: Done
  logStep(7, totalSteps, chalk.hex("#74B9FF")("Done"));

  return { intent, response };
}

function getUnconfiguredResponse(intent: string, query: string, screenshotCount: number): string {
  return `## API Key Not Configured

To use the ${intent} agent, you need to set up your Gemini API key.

**Steps:**
1. Get a free API key at: https://aistudio.google.com/apikey
2. Create a \`.env\` file in the project root
3. Add: \`GOOGLE_GENERATIVE_AI_API_KEY=your_key_here\`
4. Restart the CLI

You have ${screenshotCount} screenshots uploaded. Once configured, I'll be able to analyze them and answer: "${query}"`;
}

function getGeneralResponse(query: string): string {
  return `## Pool Agent

I'm your **Music** and **Travel** assistant. Here's what I can do:

- 🎵 **Music:** "Suggest me some music", "What kind of music do I like?", "Find songs like Arctic Monkeys"
- ✈️ **Travel:** "Plan my itinerary", "Where should I travel?", "Build me a Tokyo trip"
- 👤 **Profile:** "What do you know about me?", "Who am I?"

Your query "${query}" didn't clearly match music or travel. Try rephrasing, or ask me one of the above!`;
}

// ── Chat interface ──

export async function queryAgent(): Promise<void> {
  blank();
  logHeader("Ask Pool Agent");

  if (!isConfigured()) {
    log("warn", chalk.yellow("API key not configured — responses will be limited"));
    log("info", chalk.dim("Set GOOGLE_GENERATIVE_AI_API_KEY in .env to enable full agent"));
  }

  log("info", chalk.dim("Type your question. Type 'back' to return to menu."));
  blank();

  while (true) {
    const { query } = await inquirer.prompt<{ query: string }>([
      {
        type: "input",
        name: "query",
        message: chalk.hex("#6C5CE7").bold("you →"),
        validate: (input: string) => (input.trim() ? true : "Please type something"),
      },
    ]);

    if (query.trim().toLowerCase() === "back") break;

    blank();
    logDivider();
    log("brain", chalk.bold("Processing query..."));
    blank();

    const { intent, response } = await runPipeline(query);

    blank();
    logDivider();
    blank();

    // Render response in terminal
    const lines = response.split("\n");
    for (const line of lines) {
      if (line.startsWith("## ")) {
        console.log(`  ${chalk.bold.hex("#6C5CE7")(line.replace("## ", ""))}`);
      } else if (line.startsWith("### ")) {
        console.log(`  ${chalk.bold.hex("#A29BFE")(line.replace("### ", ""))}`);
      } else if (line.startsWith("**") && line.endsWith("**")) {
        console.log(`  ${chalk.bold(line.replace(/\*\*/g, ""))}`);
      } else if (line.startsWith("- ")) {
        console.log(`  ${chalk.cyan("•")} ${line.slice(2)}`);
      } else if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
        console.log(`  ${chalk.dim.italic(line.replace(/\*/g, ""))}`);
      } else if (line.startsWith("---")) {
        logDivider();
      } else if (line.trim() === "") {
        console.log();
      } else {
        console.log(`  ${line}`);
      }
    }

    blank();

    // Offer HTML view
    const { openHTML } = await inquirer.prompt<{ openHTML: boolean }>([
      {
        type: "confirm",
        name: "openHTML",
        message: chalk.dim("Open response as HTML in browser?"),
        default: false,
      },
    ]);

    if (openHTML) {
      const htmlPath = await renderToHTML(response, intent, query);
      log("success", `HTML saved: ${chalk.dim(htmlPath)}`);
      try {
        const open = (await import("open")).default;
        await open(htmlPath);
        log("success", "Opened in browser");
      } catch {
        log("warn", `Open manually: ${htmlPath}`);
      }
    }

    // Save conversation
    await saveConversation({
      id: `conv_${Date.now()}`,
      query,
      intent,
      response,
      timestamp: new Date().toISOString(),
    });

    blank();
  }
}
