/**
 * Reprocess all unanalyzed screenshots through the vision pipeline.
 * Run: npx tsx src/reprocess.ts
 */

import chalk from "chalk";
import { initStore, getScreenshots, updateScreenshot } from "./store.js";
import { analyzeScreenshot, applyAnalysis } from "./ingestion/analyze.js";
import { updateProfileFromAnalysis } from "./ingestion/profileUpdater.js";
import { isConfigured } from "./llm.js";
import { log, logStep, logDivider, startSpinner, stopSpinner, blank } from "./logger.js";

async function reprocess() {
  await initStore();

  if (!isConfigured()) {
    console.error(chalk.red("\n  GOOGLE_GENERATIVE_AI_API_KEY not set in .env\n"));
    process.exit(1);
  }

  const screenshots = await getScreenshots();
  const unanalyzed = screenshots.filter((s) => !s.analyzed);

  blank();
  console.log(chalk.bold.hex("#6C5CE7")("  Reprocessing Unanalyzed Screenshots"));
  blank();
  log("info", `Total: ${screenshots.length}, Unanalyzed: ${unanalyzed.length}`);

  if (unanalyzed.length === 0) {
    log("success", "All screenshots are already analyzed!");
    blank();
    return;
  }

  blank();
  let success = 0;

  for (let i = 0; i < unanalyzed.length; i++) {
    const meta = unanalyzed[i];
    logStep(i + 1, unanalyzed.length, `Analyzing ${chalk.white.bold(meta.fileName)}`);

    const spinner = startSpinner("Sending to Gemini Vision...");
    try {
      const analysis = await analyzeScreenshot(meta.localPath);

      const appLabel = analysis.sourceApp !== "unknown"
        ? chalk.yellow(analysis.sourceApp)
        : chalk.dim("unknown");
      stopSpinner(spinner, `${chalk.cyan(analysis.category)} from ${appLabel}`);

      // Update screenshot metadata
      const updated = applyAnalysis(meta, analysis);
      await updateScreenshot(meta.id, {
        analyzed: updated.analyzed,
        analyzedAt: updated.analyzedAt,
        sourceApp: updated.sourceApp,
        category: updated.category,
        summary: updated.summary,
        detailedDescription: updated.detailedDescription,
        entities: updated.entities,
        userFacts: updated.userFacts,
      });

      // Show summary
      log("info", chalk.dim(analysis.summary));

      // Update profile
      const { factsAdded, factsReinforced } = await updateProfileFromAnalysis(meta.id, analysis);
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
}

reprocess().catch((e) => {
  console.error(chalk.red("\n  Error:"), e.message);
  process.exit(1);
});
