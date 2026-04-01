/**
 * MUSIC LINK GENERATOR — CLI menu
 *
 * User uploads a music screenshot (or picks an existing one),
 * gets back two links:
 *   1. Link on the original platform (from the screenshot)
 *   2. Link on their preferred listening platform (auto-detected)
 */

import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import {
  log,
  logHeader,
  logDivider,
  startSpinner,
  stopSpinner,
  blank,
} from "./logger.js";
import type { KnowledgeStore } from "./knowledge/store.js";
import type { ScreenshotMeta } from "./knowledge/types.js";
import { analyzeScreenshot, applyAnalysis } from "./ingestion/analyze.js";
import { updateProfileFromAnalysis } from "./ingestion/profileUpdater.js";
import { isConfigured } from "./llm.js";
import { findMusicLink, detectPreferredPlatform } from "./agents/musicLinkFinder.js";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"];

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function generateId(): string {
  return `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runMusicLinkGenerator(store: KnowledgeStore): Promise<void> {
  blank();
  logHeader("Music Link Generator");

  if (!isConfigured()) {
    log("warn", "API key not configured — cannot extract music links");
    blank();
    return;
  }

  // Show detected preferred platform
  const preferred = detectPreferredPlatform(store);
  if (preferred) {
    log("info", `Your listening platform: ${chalk.green.bold(preferred)}`);
  } else {
    log("info", chalk.dim("No preferred platform detected yet — upload more music screenshots to auto-detect"));
  }

  // Show auto-extract setting
  const autoSetting = store.getProfileValue("music.autoExtractLinks");
  const autoEnabled = !autoSetting || autoSetting.value !== "off";
  log("info", `Auto-extract on upload: ${autoEnabled ? chalk.green("ON") : chalk.red("OFF")}`);
  blank();

  const { source } = await inquirer.prompt<{ source: string }>([
    {
      type: "list",
      name: "source",
      message: chalk.hex("#A29BFE")("What would you like to do?"),
      choices: [
        {
          name: `${chalk.yellow("📄")} Upload a new screenshot`,
          value: "new",
        },
        {
          name: `${chalk.cyan("🖼️")}  Pick from existing music screenshots`,
          value: "existing",
        },
        {
          name: `${chalk.hex("#A29BFE")("⚙️")}  Toggle auto-extract on upload ${chalk.dim(`(currently ${autoEnabled ? "ON" : "OFF"})`)}`,
          value: "settings",
        },
        {
          name: `${chalk.dim("← Back to menu")}`,
          value: "back",
        },
      ],
    },
  ]);

  if (source === "back") return;

  if (source === "settings") {
    const newValue = autoEnabled ? "off" : "on";
    store.setProfileValue("music.autoExtractLinks", newValue, 1.0);
    log("success", `Auto-extract on upload: ${newValue === "on" ? chalk.green("ON") : chalk.red("OFF")}`);
    blank();
    // Re-show menu
    return runMusicLinkGenerator(store);
  }

  if (source === "new") {
    await handleNewScreenshot(store);
  } else {
    await handleExistingScreenshot(store);
  }
}

async function handleNewScreenshot(store: KnowledgeStore): Promise<void> {
  const { filePath } = await inquirer.prompt<{ filePath: string }>([
    {
      type: "input",
      name: "filePath",
      message: chalk.hex("#A29BFE")("Enter screenshot file path:"),
      validate: async (input: string) => {
        const resolved = path.resolve(input.trim());
        try {
          const stat = await fs.stat(resolved);
          if (!stat.isFile()) return "Not a file";
          if (!isImageFile(resolved)) return "Not an image file";
          return true;
        } catch {
          return "File does not exist";
        }
      },
    },
  ]);

  const resolved = path.resolve(filePath.trim());
  const destDir = store.getScreenshotsDir();
  const ext = path.extname(resolved);
  const fileName = `${generateId()}${ext}`;
  const localPath = path.join(destDir, fileName);

  await fs.copyFile(resolved, localPath);
  const fileStat = await fs.stat(resolved);

  const meta: ScreenshotMeta = {
    id: fileName.replace(ext, ""),
    fileName,
    originalPath: resolved,
    localPath,
    uploadedAt: new Date().toISOString(),
    fileSizeKB: parseFloat((fileStat.size / 1024).toFixed(1)),
    analyzed: false,
  };

  store.saveScreenshot(meta);

  // Analyze the screenshot first
  const analyzeSpinner = startSpinner("Analyzing screenshot...");
  try {
    const result = await analyzeScreenshot(localPath);
    const { analysis, ocrText } = result;

    const updated = applyAnalysis(meta, result);
    store.updateScreenshot(meta.id, updated);

    stopSpinner(analyzeSpinner, `${chalk.cyan(analysis.category)} from ${chalk.yellow(analysis.sourceApp)}`);

    // Index + profile update
    try {
      await store.indexScreenshot(meta.id, {
        summary: analysis.summary,
        detailedDescription: analysis.detailedDescription,
        sourceApp: analysis.sourceApp,
        category: analysis.category,
        uploadedAt: meta.uploadedAt,
        entities: analysis.entities,
        ocrText,
      });
    } catch { /* skip vector indexing errors */ }

    await updateProfileFromAnalysis(store, meta.id, analysis);

    if (analysis.category !== "music") {
      blank();
      log("warn", "This doesn't look like a music screenshot. Music link extraction works best with music app screenshots.");
      log("info", chalk.dim(`Detected category: ${analysis.category}, source: ${analysis.sourceApp}`));
      blank();

      const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
        {
          type: "confirm",
          name: "proceed",
          message: "Try to extract music link anyway?",
          default: false,
        },
      ]);

      if (!proceed) return;
    }
  } catch (err) {
    stopSpinner(analyzeSpinner, `Analysis failed: ${err instanceof Error ? err.message : String(err)}`, false);
    return;
  }

  // Find the music link — separate try/catch so analysis errors don't swallow link errors
  await findAndDisplayLinks(meta.id, store);
}

async function handleExistingScreenshot(store: KnowledgeStore): Promise<void> {
  const musicScreenshots = store.getScreenshotsByCategory("music");

  if (musicScreenshots.length === 0) {
    log("info", "No music screenshots found. Upload some music screenshots first.");
    blank();
    return;
  }

  const choices = musicScreenshots.slice(0, 20).map((ss, i) => {
    const app = ss.source_app ? chalk.yellow(ss.source_app) : chalk.dim("unknown");
    const summary = ss.summary ? ss.summary.slice(0, 40) : "No summary";
    // Check if we already have a music link
    const existingLinks = store.getMusicLinksByScreenshot(ss.id);
    const hasLink = existingLinks.length > 0 ? chalk.green(" [has link]") : "";
    return {
      name: `${chalk.dim(`${i + 1}.`)} ${app} — ${chalk.white(summary)}${hasLink}`,
      value: ss.id,
    };
  });

  choices.push({
    name: chalk.dim("← Back"),
    value: "back",
  });

  const { screenshotId } = await inquirer.prompt<{ screenshotId: string }>([
    {
      type: "list",
      name: "screenshotId",
      message: chalk.hex("#A29BFE")("Pick a music screenshot:"),
      choices,
      loop: false,
    },
  ]);

  if (screenshotId === "back") return;

  await findAndDisplayLinks(screenshotId, store);
}

async function findAndDisplayLinks(screenshotId: string, store: KnowledgeStore): Promise<void> {
  blank();
  const spinner = startSpinner("Extracting song info and finding links...");

  try {
    const screenshot = store.getScreenshot(screenshotId);
    if (!screenshot) {
      stopSpinner(spinner, "Screenshot not found", false);
      return;
    }

    const result = await findMusicLink(screenshot, store, true);
    stopSpinner(spinner, "Done");

    blank();
    logDivider();
    blank();

    // Display song info
    console.log(`  ${chalk.bold.hex("#6C5CE7")("Song Information")}`);
    blank();
    console.log(`  ${chalk.dim("Title:")}   ${chalk.white.bold(result.songInfo.song_title)}`);
    console.log(`  ${chalk.dim("Artist:")}  ${chalk.white(result.songInfo.artist)}`);
    if (result.songInfo.album) {
      console.log(`  ${chalk.dim("Album:")}   ${chalk.white(result.songInfo.album)}`);
    }
    console.log(`  ${chalk.dim("Platform:")} ${chalk.yellow(result.sourcePlatform)}`);
    blank();

    // Display links
    console.log(`  ${chalk.bold.hex("#6C5CE7")("Streaming Links")}`);
    blank();

    if (result.sourceUrl) {
      console.log(`  ${chalk.green("1.")} ${chalk.bold("Original platform")} ${chalk.dim(`(${result.sourcePlatform})`)}`);
      console.log(`     ${chalk.underline.cyan(result.sourceUrl)}`);
    } else {
      console.log(`  ${chalk.red("1.")} ${chalk.bold("Original platform")} ${chalk.dim(`(${result.sourcePlatform})`)}`);
      console.log(`     ${chalk.dim("No link found")}`);
    }

    blank();

    if (result.preferredPlatform && result.preferredPlatform !== result.sourcePlatform) {
      if (result.preferredUrl) {
        console.log(`  ${chalk.green("2.")} ${chalk.bold("Your platform")} ${chalk.dim(`(${result.preferredPlatform})`)}`);
        console.log(`     ${chalk.underline.cyan(result.preferredUrl)}`);
      } else {
        console.log(`  ${chalk.red("2.")} ${chalk.bold("Your platform")} ${chalk.dim(`(${result.preferredPlatform})`)}`);
        console.log(`     ${chalk.dim("No link found on this platform")}`);
      }
    } else if (!result.preferredPlatform) {
      console.log(`  ${chalk.dim("2.")} ${chalk.dim("Preferred platform not detected — upload more music screenshots")}`);
    } else {
      console.log(`  ${chalk.dim("2.")} ${chalk.dim("Same as original platform — no cross-platform link needed")}`);
    }

    blank();
    logDivider();
    blank();
  } catch (err) {
    stopSpinner(spinner, `Failed: ${err instanceof Error ? err.message : String(err)}`, false);
    blank();
  }

  // Pause so the user can see the results before banner clears the screen
  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: chalk.dim("Press Enter to go back to menu..."),
    },
  ]);
}
