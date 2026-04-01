import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import { glob } from "glob";
import {
  log,
  logStep,
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

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"];

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function generateId(): string {
  return `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function copyScreenshot(
  sourcePath: string,
  destDir: string
): Promise<{ fileName: string; localPath: string }> {
  const ext = path.extname(sourcePath);
  const fileName = `${generateId()}${ext}`;
  const localPath = path.join(destDir, fileName);
  await fs.copyFile(sourcePath, localPath);
  return { fileName, localPath };
}

// ── Analyze a single screenshot ──

async function analyzeAndUpdate(store: KnowledgeStore, meta: ScreenshotMeta): Promise<void> {
  if (!isConfigured()) {
    log("warn", "Skipping analysis — API key not configured");
    return;
  }

  const spinner = startSpinner("Analyzing screenshot with Gemini Vision...");
  try {
    const analysis = await analyzeScreenshot(meta.localPath);

    const appLabel = analysis.sourceApp !== "unknown"
      ? chalk.yellow(analysis.sourceApp)
      : chalk.dim("unknown app");
    stopSpinner(
      spinner,
      `${chalk.cyan(analysis.category)} from ${appLabel} — ${chalk.dim(analysis.summary.slice(0, 50))}`
    );

    // Update screenshot metadata with ALL analysis fields
    const updated = applyAnalysis(meta, analysis);
    store.updateScreenshot(meta.id, updated);

    // Show detailed description
    log("info", chalk.dim(analysis.detailedDescription.slice(0, 120) + (analysis.detailedDescription.length > 120 ? "..." : "")));

    // Index in vector store for semantic search
    try {
      await store.indexScreenshot(meta.id, {
        summary: analysis.summary,
        detailedDescription: analysis.detailedDescription,
        sourceApp: analysis.sourceApp,
        category: analysis.category,
        uploadedAt: meta.uploadedAt,
        entities: analysis.entities,
      });
    } catch (err) {
      log("warn", `Vector indexing skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Update user profile
    const { factsAdded, factsReinforced } = await updateProfileFromAnalysis(store, meta.id, analysis);
    if (factsAdded > 0 || factsReinforced > 0) {
      log("profile", `Profile updated: ${chalk.green(`+${factsAdded} new`)}, ${chalk.blue(`${factsReinforced} reinforced`)}`);
    }

    // Show extracted user facts
    if (analysis.user_facts.length > 0) {
      for (const fact of analysis.user_facts) {
        log("brain", `${chalk.dim(fact.fact)}: ${chalk.white(fact.value)} ${chalk.dim(`(${(fact.confidence * 100).toFixed(0)}% — ${fact.evidence})`)}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stopSpinner(spinner, `Analysis failed: ${msg}`, false);
  }
}

// ── Upload from folder ──

async function uploadFromFolder(store: KnowledgeStore): Promise<void> {
  const { folderPath } = await inquirer.prompt<{ folderPath: string }>([
    {
      type: "input",
      name: "folderPath",
      message: chalk.hex("#A29BFE")("Enter folder path containing screenshots:"),
      validate: async (input: string) => {
        const resolved = path.resolve(input.trim());
        try {
          const stat = await fs.stat(resolved);
          if (!stat.isDirectory()) return "Not a directory";
          return true;
        } catch {
          return "Folder does not exist";
        }
      },
    },
  ]);

  const resolved = path.resolve(folderPath.trim());
  const spinner = startSpinner("Scanning folder for images...");

  const allFiles = await glob("**/*", { cwd: resolved, absolute: true, nodir: true });
  const imageFiles = allFiles.filter(isImageFile);

  if (imageFiles.length === 0) {
    stopSpinner(spinner, "No image files found in folder", false);
    return;
  }

  stopSpinner(spinner, `Found ${imageFiles.length} screenshot(s)`);
  blank();

  const destDir = store.getScreenshotsDir();
  const total = imageFiles.length;
  let success = 0;

  logHeader("Uploading Screenshots");

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i]!;
    const baseName = path.basename(file);

    logStep(i + 1, total, `Importing ${chalk.white.bold(baseName)}`);

    try {
      const { fileName, localPath } = await copyScreenshot(file, destDir);
      const fileStat = await fs.stat(file);
      const sizeKB = (fileStat.size / 1024).toFixed(1);

      const meta: ScreenshotMeta = {
        id: fileName.replace(path.extname(fileName), ""),
        fileName,
        originalPath: file,
        localPath,
        uploadedAt: new Date().toISOString(),
        fileSizeKB: parseFloat(sizeKB),
        analyzed: false,
      };

      store.saveScreenshot(meta);
      log("success", `${chalk.dim(fileName)} ${chalk.dim(`(${sizeKB} KB)`)}`);

      // Run vision analysis
      await analyzeAndUpdate(store, meta);

      success++;
    } catch (err) {
      log("error", `Failed to import ${baseName}: ${err}`);
    }

    blank();
  }

  logDivider();
  log("success", `Uploaded and analyzed ${chalk.bold(String(success))}/${total} screenshots`);
  log("info", `Stored in: ${chalk.dim(destDir)}`);
  blank();
}

// ── Upload single / multiple files ──

async function uploadFiles(store: KnowledgeStore): Promise<void> {
  const { filePaths } = await inquirer.prompt<{ filePaths: string }>([
    {
      type: "input",
      name: "filePaths",
      message: chalk.hex("#A29BFE")(
        "Enter file path(s) (comma-separated for multiple):"
      ),
      validate: (input: string) => {
        if (!input.trim()) return "Please enter at least one file path";
        return true;
      },
    },
  ]);

  const paths = filePaths
    .split(",")
    .map((p) => path.resolve(p.trim()))
    .filter(Boolean);

  const destDir = store.getScreenshotsDir();
  const total = paths.length;
  let success = 0;

  blank();
  logHeader("Uploading Screenshots");

  for (let i = 0; i < paths.length; i++) {
    const file = paths[i]!;
    const baseName = path.basename(file);

    logStep(i + 1, total, `Processing ${chalk.white.bold(baseName)}`);

    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) {
        log("error", `${baseName} is not a file`);
        continue;
      }

      if (!isImageFile(file)) {
        log("warn", `${baseName} is not an image file — skipped`);
        continue;
      }

      const { fileName, localPath } = await copyScreenshot(file, destDir);
      const sizeKB = (stat.size / 1024).toFixed(1);

      const meta: ScreenshotMeta = {
        id: fileName.replace(path.extname(fileName), ""),
        fileName,
        originalPath: file,
        localPath,
        uploadedAt: new Date().toISOString(),
        fileSizeKB: parseFloat(sizeKB),
        analyzed: false,
      };

      store.saveScreenshot(meta);
      log("success", `${chalk.dim(fileName)} ${chalk.dim(`(${sizeKB} KB)`)}`);

      // Run vision analysis
      await analyzeAndUpdate(store, meta);

      success++;
    } catch {
      log("error", `File not found: ${baseName}`);
    }

    blank();
  }

  logDivider();
  log("success", `Uploaded and analyzed ${chalk.bold(String(success))}/${total} screenshots`);
  blank();
}

// ── View uploaded screenshots ──

export async function viewScreenshots(store: KnowledgeStore): Promise<void> {
  const screenshots = store.getAllScreenshots();

  blank();
  logHeader("Your Screenshots");

  if (screenshots.length === 0) {
    log("info", "No screenshots uploaded yet. Use 'Upload Screenshots' to add some.");
    blank();
    return;
  }

  const Table = (await import("cli-table3")).default;
  const table = new Table({
    head: [
      chalk.hex("#6C5CE7")("#"),
      chalk.hex("#6C5CE7")("File"),
      chalk.hex("#6C5CE7")("Source App"),
      chalk.hex("#6C5CE7")("Category"),
      chalk.hex("#6C5CE7")("Summary"),
    ],
    style: { head: [], border: ["dim"] },
    colWidths: [5, 25, 16, 10, 30],
  });

  screenshots.forEach((s, i) => {
    table.push([
      chalk.dim(String(i + 1)),
      chalk.white(path.basename(s.originalPath).slice(0, 23)),
      s.sourceApp ? chalk.yellow(s.sourceApp) : chalk.dim("—"),
      s.category ? chalk.cyan(s.category) : chalk.dim("pending"),
      s.summary ? chalk.dim(s.summary.slice(0, 28)) : chalk.dim(s.analyzed ? "—" : "pending"),
    ]);
  });

  console.log(table.toString());
  blank();
  log("info", `Total: ${chalk.bold(String(screenshots.length))} screenshots`);
  blank();
}

// ── Main upload menu ──

export async function uploadMenu(store: KnowledgeStore): Promise<void> {
  const { uploadType } = await inquirer.prompt<{ uploadType: string }>([
    {
      type: "list",
      name: "uploadType",
      message: chalk.hex("#A29BFE")("How would you like to upload?"),
      choices: [
        {
          name: `${chalk.yellow("📁")} Upload from folder ${chalk.dim("(all images in a directory)")}`,
          value: "folder",
        },
        {
          name: `${chalk.cyan("📄")} Upload specific file(s) ${chalk.dim("(one or more paths)")}`,
          value: "files",
        },
        {
          name: `${chalk.dim("← Back to menu")}`,
          value: "back",
        },
      ],
    },
  ]);

  switch (uploadType) {
    case "folder":
      await uploadFromFolder(store);
      break;
    case "files":
      await uploadFiles(store);
      break;
    case "back":
      break;
  }
}
