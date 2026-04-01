import chalk from "chalk";
import { blank, log, logHeader, logDivider } from "./logger.js";
import type { KnowledgeStore } from "./knowledge/store.js";

export async function viewProfile(store: KnowledgeStore): Promise<void> {
  const screenshots = store.getAllScreenshots();
  const meta = store.getProfileMeta();

  blank();
  logHeader("Your Profile");

  if (screenshots.length === 0) {
    log("info", "No screenshots uploaded yet. Upload some to build your profile.");
    blank();
    return;
  }

  const analyzed = screenshots.filter((s) => s.analyzed).length;
  const pending = screenshots.length - analyzed;

  // ── Stats ──
  console.log(
    `  ${chalk.hex("#6C5CE7").bold("Screenshots:")} ${chalk.white(String(screenshots.length))}` +
      `  ${chalk.dim("|")}  ` +
      `${chalk.green("Analyzed:")} ${chalk.white(String(analyzed))}` +
      `  ${chalk.dim("|")}  ` +
      `${chalk.yellow("Pending:")} ${chalk.white(String(pending))}` +
      `  ${chalk.dim("|")}  ` +
      `${chalk.dim("v" + meta.version)}`
  );
  blank();
  logDivider();

  // ── Identity ──
  blank();
  console.log(`  ${chalk.bold.hex("#6C5CE7")("👤 Identity")}`);
  const nameFacts = store.getFactsByType("name");
  const locationFacts = store.getFactsByType("location");
  if (nameFacts.length === 0 && locationFacts.length === 0) {
    console.log(`  ${chalk.dim("   Not yet detected — upload boarding passes, tickets, or profile screenshots")}`);
  } else {
    for (const f of nameFacts) {
      const conf = (f.confidence * 100).toFixed(0);
      console.log(
        `  ${chalk.dim("   name:")} ${chalk.white.bold(f.fact_value)}` +
          `  ${chalk.dim(`(${conf}% · source: ${f.source})`)}`
      );
    }
    for (const f of locationFacts) {
      const conf = (f.confidence * 100).toFixed(0);
      console.log(
        `  ${chalk.dim("   location:")} ${chalk.white.bold(f.fact_value)}` +
          `  ${chalk.dim(`(${conf}% · source: ${f.source})`)}`
      );
    }
  }

  // ── Music ──
  blank();
  console.log(`  ${chalk.bold.hex("#1DB954")("🎵 Music Profile")}`);

  const platform = store.getProfileValue("music.preferredPlatform");
  if (platform) {
    console.log(
      `  ${chalk.dim("   Platform:")} ${chalk.white.bold(platform.value)}` +
        `  ${chalk.dim(`(${(platform.confidence * 100).toFixed(0)}%)`)}`
    );
  } else {
    console.log(`  ${chalk.dim("   Platform: not yet detected")}`);
  }

  const genres = store.getFactsByType("genre");
  if (genres.length > 0) {
    console.log(`  ${chalk.dim("   Genres:")}`);
    for (const g of genres.slice(0, 6)) {
      const barLen = Math.round(g.confidence * 10);
      const bar = "█".repeat(barLen);
      const empty = "░".repeat(10 - barLen);
      console.log(
        `  ${chalk.dim("     ")}${chalk.hex("#1DB954")(bar)}${chalk.dim(empty)} ${chalk.white(g.fact_value)}`
      );
    }
  } else {
    console.log(`  ${chalk.dim("   Genres: not yet detected")}`);
  }

  const artists = store.getFactsByType("liked_artist");
  if (artists.length > 0) {
    const top = artists.slice(0, 8);
    console.log(
      `  ${chalk.dim("   Top Artists:")} ${top.map((a) => `${chalk.white(a.fact_value)} ${chalk.dim(`(${(a.confidence * 100).toFixed(0)}%)`)}`).join(chalk.dim(", "))}`
    );
  }

  const songs = store.getFactsByType("liked_song");
  if (songs.length > 0) {
    console.log(`  ${chalk.dim("   Songs seen:")} ${chalk.white(String(songs.length))} tracks`);
  }

  const playlists = store.getFactsByType("playlist");
  if (playlists.length > 0) {
    console.log(
      `  ${chalk.dim("   Playlists:")} ${playlists.map((p) => chalk.white(p.fact_value)).join(chalk.dim(", "))}`
    );
  }

  const mood = store.getProfileValue("music.moodPreference");
  const energy = store.getProfileValue("music.energyLevel");
  const langFacts = store.getFactsByType("language");
  if (mood || energy || langFacts.length > 0) {
    console.log(`  ${chalk.dim("   Patterns:")}`);
    if (mood) console.log(`  ${chalk.dim("     Mood:")} ${chalk.white(mood.value)}`);
    if (energy) console.log(`  ${chalk.dim("     Energy:")} ${chalk.white(energy.value)}`);
    if (langFacts.length > 0) console.log(`  ${chalk.dim("     Languages:")} ${chalk.white(langFacts.map((l) => l.fact_value).join(", "))}`);
  }

  // ── Travel ──
  blank();
  console.log(`  ${chalk.bold.hex("#0984E3")("✈️  Travel Profile")}`);

  const destinations = store.getFactsByType("travel_interest");
  if (destinations.length > 0) {
    console.log(`  ${chalk.dim("   Destinations:")}`);
    for (const d of destinations.slice(0, 6)) {
      const barLen = Math.round(d.confidence * 10);
      const bar = "█".repeat(barLen);
      const empty = "░".repeat(10 - barLen);
      console.log(
        `  ${chalk.dim("     ")}${chalk.hex("#0984E3")(bar)}${chalk.dim(empty)} ${chalk.white.bold(d.fact_value)}`
      );
      // Show details
      const prefix = `travel.detail.${d.fact_value.toLowerCase()}`;
      const details = store.getProfileSection(prefix);
      if (details.length > 0) {
        const parts = details.map((det) => `${det.key.replace(`${prefix}.`, "")}: ${det.value}`);
        console.log(`  ${chalk.dim("           " + parts.join(" · "))}`);
      }
    }
  } else {
    console.log(`  ${chalk.dim("   Destinations: not yet detected")}`);
  }

  const styleKV = store.getProfileSection("travel.style.");
  if (styleKV.length > 0) {
    console.log(`  ${chalk.dim("   Style:")}`);
    for (const s of styleKV) {
      console.log(`  ${chalk.dim("     " + s.key.replace("travel.style.", "") + ":")} ${chalk.white(s.value)}`);
    }
  }

  // ── General ──
  blank();
  console.log(`  ${chalk.bold.hex("#A29BFE")("🌐 General")}`);

  const language = store.getProfileValue("general.language");
  const foodPrefs = store.getFactsByType("food_preference");
  const budget = store.getProfileValue("general.budgetStyle");
  const personality = store.getProfileValue("general.personalitySignals");

  if (language) console.log(`  ${chalk.dim("   Language:")} ${chalk.white(language.value)}`);
  if (foodPrefs.length > 0) console.log(`  ${chalk.dim("   Food:")} ${chalk.white(foodPrefs.map((f) => f.fact_value).join(", "))}`);
  if (budget) console.log(`  ${chalk.dim("   Budget:")} ${chalk.white(budget.value)}`);
  if (personality) console.log(`  ${chalk.dim("   Signals:")} ${chalk.white(personality.value)}`);

  if (!language && foodPrefs.length === 0 && !budget && !personality) {
    console.log(`  ${chalk.dim("   Not enough data yet — keep uploading screenshots")}`);
  }

  // ── Knowledge Graph Stats ──
  blank();
  console.log(`  ${chalk.bold.hex("#E17055")("🔗 Knowledge Graph")}`);
  console.log(`  ${chalk.dim("   Nodes:")} ${chalk.white(String(store.graph.nodeCount))}`);
  console.log(`  ${chalk.dim("   Edges:")} ${chalk.white(String(store.graph.edgeCount))}`);

  blank();
  logDivider();
  log("info", chalk.dim(`Profile version ${meta.version} · Last updated: ${meta.lastUpdated || "never"}`));
  blank();
}
