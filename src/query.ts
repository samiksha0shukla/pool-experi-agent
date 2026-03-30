/**
 * QUERY HANDLER — The Chat UI
 *
 * This is ONLY the terminal chat interface.
 * All intelligence lives in the orchestrator.
 *
 * query.ts → orchestrator.ts → agents/*.ts
 */

import inquirer from "inquirer";
import chalk from "chalk";
import {
  log,
  logHeader,
  logDivider,
  blank,
} from "./logger.js";
import { saveConversation } from "./store.js";
import { renderToHTML } from "./renderer.js";
import { isConfigured } from "./llm.js";
import { orchestrate } from "./orchestrator.js";

// ── Render markdown-ish response in terminal ──

function renderInTerminal(response: string): void {
  for (const line of response.split("\n")) {
    if (line.startsWith("## ")) {
      console.log(`  ${chalk.bold.hex("#6C5CE7")(line.replace("## ", ""))}`);
    } else if (line.startsWith("### ")) {
      console.log(`  ${chalk.bold.hex("#A29BFE")(line.replace("### ", ""))}`);
    } else if (/^\*\*(.+)\*\*$/.test(line)) {
      console.log(`  ${chalk.bold(line.replace(/\*\*/g, ""))}`);
    } else if (line.startsWith("- ")) {
      console.log(`  ${chalk.cyan("•")} ${line.slice(2)}`);
    } else if (/^\*([^*]+)\*$/.test(line)) {
      console.log(`  ${chalk.dim.italic(line.replace(/\*/g, ""))}`);
    } else if (line.startsWith("---")) {
      logDivider();
    } else if (line.trim() === "") {
      console.log();
    } else {
      console.log(`  ${line}`);
    }
  }
}

// ── Chat loop ──

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

    // ── Delegate everything to the orchestrator ──
    const result = await orchestrate(query);

    blank();
    logDivider();
    blank();

    // ── Display response ──
    renderInTerminal(result.response);
    blank();

    // ── Optional HTML view ──
    const { openHTML } = await inquirer.prompt<{ openHTML: boolean }>([
      {
        type: "confirm",
        name: "openHTML",
        message: chalk.dim("Open response as HTML in browser?"),
        default: false,
      },
    ]);

    if (openHTML) {
      const htmlPath = await renderToHTML(result.response, result.intent, query);
      log("success", `HTML saved: ${chalk.dim(htmlPath)}`);
      try {
        const open = (await import("open")).default;
        await open(htmlPath);
        log("success", "Opened in browser");
      } catch {
        log("warn", `Open manually: ${htmlPath}`);
      }
    }

    // ── Save conversation ──
    await saveConversation({
      id: `conv_${Date.now()}`,
      query,
      intent: result.intent,
      response: result.response,
      timestamp: new Date().toISOString(),
    });

    blank();
  }
}
