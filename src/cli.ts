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
          name: `${chalk.dim("👋")}  Exit`,
          value: "exit",
        },
      ],
      loop: false,
    },
  ]);

  return choice;
}

async function main(): Promise<void> {
  const store = await KnowledgeStore.create(DATA_DIR);
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
