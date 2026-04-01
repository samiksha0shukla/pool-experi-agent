/**
 * Reprocess all unanalyzed screenshots through the vision pipeline.
 * Run: npx tsx src/reprocess.ts
 */

import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { KnowledgeStore } from "./knowledge/store.js";
import { analyzeScreenshot, applyAnalysis } from "./ingestion/analyze.js";
import { updateProfileFromAnalysis } from "./ingestion/profileUpdater.js";
import { isConfigured } from "./llm.js";
import { log, logStep, logDivider, startSpinner, stopSpinner, blank } from "./logger.js";
import type { ScreenshotMeta } from "./knowledge/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

async function reprocess() {
  const store = await KnowledgeStore.create(DATA_DIR);

  if (!isConfigured()) {
    console.error(chalk.red("\n  GOOGLE_GENERATIVE_AI_API_KEY not set in .env\n"));
    process.exit(1);
  }

  const screenshots = store.getAllScreenshots();
  const unanalyzed = screenshots.filter((s) => !s.analyzed);

  blank();
  console.log(chalk.bold.hex("#6C5CE7")("  Reprocessing Unanalyzed Screenshots"));
  blank();
  log("info", `Total: ${screenshots.length}, Unanalyzed: ${unanalyzed.length}`);

  if (unanalyzed.length === 0) {
    log("success", "All screenshots are already analyzed!");
    blank();
    store.close();
    return;
  }

  blank();
  let success = 0;

  for (let i = 0; i < unanalyzed.length; i++) {
    const row = unanalyzed[i]!;

    // Build a ScreenshotMeta from the row for applyAnalysis
    const meta: ScreenshotMeta = {
      id: row.id,
      fileName: row.fileName,
      originalPath: row.originalPath,
      localPath: row.localPath,
      uploadedAt: row.uploadedAt,
      fileSizeKB: row.fileSizeKB,
      analyzed: !!row.analyzed,
    };

    logStep(i + 1, unanalyzed.length, `Analyzing ${chalk.white.bold(row.fileName)}`);

    const spinner = startSpinner("Sending to Gemini Vision...");
    try {
      const analysis = await analyzeScreenshot(row.localPath);

      const appLabel = analysis.sourceApp !== "unknown"
        ? chalk.yellow(analysis.sourceApp)
        : chalk.dim("unknown");
      stopSpinner(spinner, `${chalk.cyan(analysis.category)} from ${appLabel}`);

      // Update screenshot metadata
      const updated = applyAnalysis(meta, analysis);
      store.updateScreenshot(row.id, updated);

      // Index in vector store
      try {
        await store.indexScreenshot(row.id, {
          summary: analysis.summary,
          detailedDescription: analysis.detailedDescription,
          sourceApp: analysis.sourceApp,
          category: analysis.category,
          uploadedAt: row.uploadedAt,
          entities: analysis.entities,
        });
      } catch (err) {
        log("warn", `Vector indexing skipped: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Show summary
      log("info", chalk.dim(analysis.summary));

      // Update profile
      const { factsAdded, factsReinforced } = await updateProfileFromAnalysis(store, row.id, analysis);
      if (factsAdded > 0 || factsReinforced > 0) {
        log("profile", `Profile: ${chalk.green(`+${factsAdded} new`)}, ${chalk.blue(`${factsReinforced} reinforced`)}`);
      }

      // Show facts
      for (const fact of analysis.user_facts) {
        log("brain", `${chalk.dim(fact.fact)}: ${chalk.white(fact.value)} ${chalk.dim(`(${(fact.confidence * 100).toFixed(0)}%)`)}`);
      }

      success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stopSpinner(spinner, `Failed: ${msg}`, false);
    }

    blank();
  }

  logDivider();
  log("success", `Reprocessed ${chalk.bold(String(success))}/${unanalyzed.length} screenshots`);
  blank();

  store.close();
}

reprocess().catch((e) => {
  console.error(chalk.red("\n  Error:"), e.message);
  process.exit(1);
});
