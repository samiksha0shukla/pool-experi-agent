#!/usr/bin/env node

import inquirer from "inquirer";
import chalk from "chalk";
import { showBanner } from "./banner.js";
import { uploadMenu, viewScreenshots } from "./upload.js";
import { queryAgent } from "./query.js";
import { viewProfile } from "./profile.js";
import { initStore, getScreenshots } from "./store.js";
import { blank, log, logDivider } from "./logger.js";

async function showMenu(): Promise<string> {
  const screenshots = await getScreenshots();
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
  await initStore();
  showBanner();

  while (true) {
    const choice = await showMenu();

    switch (choice) {
      case "upload":
        await uploadMenu();
        showBanner();
        break;

      case "query":
        await queryAgent();
        showBanner();
        break;

      case "profile":
        await viewProfile();
        break;

      case "screenshots":
        await viewScreenshots();
        break;

      case "exit":
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
