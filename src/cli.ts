#!/usr/bin/env node

import path from "path";
import { fileURLToPath } from "url";
import inquirer from "inquirer";
import chalk from "chalk";
import { showBanner } from "./banner.js";
import { uploadMenu, viewScreenshots } from "./upload.js";
import { queryAgent } from "./query.js";
import { viewProfile } from "./profile.js";
import { runMusicLinkGenerator } from "./musicLinkMenu.js";
import { KnowledgeStore } from "./knowledge/store.js";
import { blank, log, logDivider } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

const VERSION = "1.0.0";

// ── Help text (built-in instruction manual) ──

const HELP_TEXT = `
${chalk.bold("Pool Agent")} — Screenshot Intelligence CLI  ${chalk.dim(`v${VERSION}`)}

${chalk.underline("USAGE")}
  ${chalk.cyan("pool-agent")}                Launch interactive mode
  ${chalk.cyan("pool-agent")} ${chalk.yellow("--help")}        Show this help message
  ${chalk.cyan("pool-agent")} ${chalk.yellow("--version")}     Show version number

${chalk.underline("DESCRIPTION")}
  Pool Agent analyzes your screenshots using AI to build a personal
  knowledge base. It extracts music, travel, and lifestyle information,
  then lets you query your data through a conversational agent.

${chalk.underline("FEATURES")}
  ${chalk.yellow("Upload Screenshots")}     Add images for AI analysis (OCR + vision)
  ${chalk.yellow("Ask Agent")}              Chat with music & travel agents about your data
  ${chalk.yellow("View Profile")}           See the preferences the agent learned about you
  ${chalk.yellow("Music Link Generator")}   Extract songs from screenshots and get streaming links
  ${chalk.yellow("View Screenshots")}       Browse and manage your uploaded screenshots

${chalk.underline("SETUP")}
  1. Clone the repository and install dependencies:
     ${chalk.dim("$")} npm install

  2. Copy the example env file and add your API keys:
     ${chalk.dim("$")} cp .env.example .env

     Required keys:
       ${chalk.green("GOOGLE_GENERATIVE_AI_API_KEY")}       Gemini API key (${chalk.dim("https://aistudio.google.com/apikey")})

     Optional keys (for travel search):
       ${chalk.green("GOOGLE_CUSTOM_SEARCH_API_KEY")}       Google Custom Search API key
       ${chalk.green("GOOGLE_CUSTOM_SEARCH_ENGINE_ID")}     Custom Search Engine ID

  3. Launch the agent:
     ${chalk.dim("$")} pool-agent

${chalk.underline("HOW IT WORKS")}
  1. ${chalk.bold("Upload")} — Drop screenshots into the agent. It runs OCR and
     vision analysis to extract text, context, and metadata.
  2. ${chalk.bold("Learn")} — The agent builds a knowledge graph of your interests:
     music taste, travel preferences, and lifestyle patterns.
  3. ${chalk.bold("Query")} — Ask natural-language questions. The agent uses your
     profile + knowledge base to give personalized answers.
  4. ${chalk.bold("Discover")} — Get music streaming links, travel suggestions,
     and insights you didn't know were in your screenshots.

${chalk.underline("DATA STORAGE")}
  All data is stored locally in the ${chalk.cyan("data/")} directory:
    ${chalk.dim("data/pool.db")}          SQLite database (screenshots, metadata, profile)
    ${chalk.dim("data/vectors/")}         Vector embeddings for semantic search
    ${chalk.dim("data/screenshots/")}     Uploaded image files

${chalk.underline("EXAMPLES")}
  ${chalk.dim("$")} pool-agent                    # Interactive mode
  ${chalk.dim("$")} pool-agent --help              # Show help
  ${chalk.dim("$")} pool-agent --version           # Show version

${chalk.dim("─────────────────────────────────────────────────────────")}
${chalk.dim("Docs & source:")} https://github.com/samiksha0shukla/pool-experi-agent
`;

// ── CLI argument parsing ──

function handleArgs(): boolean {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return true;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return true;
  }

  return false;
}

// ── Interactive menu ──

async function showMenu(store: KnowledgeStore): Promise<string> {
  const screenshots = store.getAllScreenshots();
  const count = screenshots.length;
  const analyzed = screenshots.filter((s) => s.analyzed).length;

  const statusLine =
    count > 0
      ? chalk.dim(`  ${count} screenshots · ${analyzed} analyzed`)
      : chalk.dim("  No screenshots yet — start by uploading some");

  console.log(statusLine);
  blank();

  const { choice } = await inquirer.prompt<{ choice: string }>([
    {
      type: "list",
      name: "choice",
      message: chalk.hex("#A29BFE")("What would you like to do?"),
      choices: [
        {
          name: `${chalk.yellow("📤")}  Upload Screenshots    ${chalk.dim("Add new screenshots to analyze")}`,
          value: "upload",
        },
        {
          name: `${chalk.hex("#6C5CE7")("💬")}  Ask Agent              ${chalk.dim("Chat with music & travel agent")}`,
          value: "query",
        },
        {
          name: `${chalk.magenta("👤")}  View Profile           ${chalk.dim("See what the agent knows about you")}`,
          value: "profile",
        },
        {
          name: `${chalk.green("🎵")}  Music Link Generator   ${chalk.dim("Get streaming links from a screenshot")}`,
          value: "musiclink",
        },
        {
          name: `${chalk.cyan("🖼️")}   View Screenshots       ${chalk.dim("Browse uploaded screenshots")}`,
          value: "screenshots",
        },
        new inquirer.Separator(chalk.dim("  ─────────────────────────────")),
        {
          name: `${chalk.yellow("❓")}  Help                   ${chalk.dim("Show usage instructions")}`,
          value: "help",
        },
        {
          name: `${chalk.dim("👋")}  Exit`,
          value: "exit",
        },
      ],
      loop: false,
    },
  ]);

  return choice;
}

// ── Main ──

async function main(): Promise<void> {
  // Handle --help / --version before any heavy initialization
  if (handleArgs()) {
    process.exit(0);
  }

  const store = await KnowledgeStore.create(DATA_DIR);

  // Graceful shutdown on Ctrl+C
  process.on("SIGINT", () => {
    store.close();
    blank();
    log("info", chalk.hex("#A29BFE")("Interrupted — goodbye! 👋"));
    blank();
    process.exit(0);
  });

  showBanner();

  while (true) {
    const choice = await showMenu(store);

    switch (choice) {
      case "upload":
        await uploadMenu(store);
        showBanner();
        break;

      case "query":
        await queryAgent(store);
        showBanner();
        break;

      case "profile":
        await viewProfile(store);
        break;

      case "musiclink":
        await runMusicLinkGenerator(store);
        showBanner();
        break;

      case "screenshots":
        await viewScreenshots(store);
        break;

      case "help":
        console.log(HELP_TEXT);
        break;

      case "exit":
        store.close();
        blank();
        log("info", chalk.hex("#A29BFE")("See you later! 👋"));
        blank();
        process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error(chalk.red("\n  Fatal error:"), err.message);
  process.exit(1);
});
