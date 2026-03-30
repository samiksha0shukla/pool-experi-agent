import chalk from "chalk";
import { blank, log, logHeader, logDivider } from "./logger.js";
import { getProfile, getScreenshots } from "./store.js";

export async function viewProfile(): Promise<void> {
  const profile = await getProfile();
  const screenshots = await getScreenshots();

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
      `${chalk.dim("v" + profile.profileVersion)}`
  );
  blank();
  logDivider();

  // ── Identity ──
  blank();
  console.log(`  ${chalk.bold.hex("#6C5CE7")("👤 Identity")}`);
  const { identity } = profile;
  const identityKeys = Object.keys(identity).filter((k) => identity[k]);
  if (identityKeys.length === 0) {
    console.log(`  ${chalk.dim("   Not yet detected — upload boarding passes, tickets, or profile screenshots")}`);
  } else {
    for (const key of identityKeys) {
      const f = identity[key]!;
      const conf = (f.confidence * 100).toFixed(0);
      const srcCount = f.sources.length;
      console.log(
        `  ${chalk.dim("   " + key + ":")} ${chalk.white.bold(f.value)}` +
          `  ${chalk.dim(`(${conf}% · ${srcCount} source${srcCount > 1 ? "s" : ""})`)}`
      );
    }
  }

  // ── Music ──
  const { music } = profile;
  blank();
  console.log(`  ${chalk.bold.hex("#1DB954")("🎵 Music Profile")}`);

  // Platform
  if (music.preferredPlatform?.value) {
    const p = music.preferredPlatform;
    console.log(
      `  ${chalk.dim("   Platform:")} ${chalk.white.bold(p.value)}` +
        `  ${chalk.dim(`(${(p.confidence * 100).toFixed(0)}% · ${p.sources.length} source${p.sources.length > 1 ? "s" : ""})`)}`
    );
  } else {
    console.log(`  ${chalk.dim("   Platform: not yet detected")}`);
  }

  // Genres
  if (music.genres.length > 0) {
    console.log(`  ${chalk.dim("   Genres:")}`);
    const sorted = [...music.genres].sort((a, b) => b.strength - a.strength);
    for (const g of sorted.slice(0, 6)) {
      const barLen = Math.round(g.strength * 10);
      const bar = "█".repeat(barLen);
      const empty = "░".repeat(10 - barLen);
      console.log(
        `  ${chalk.dim("     ")}${chalk.hex("#1DB954")(bar)}${chalk.dim(empty)} ${chalk.white(g.genre)} ${chalk.dim(`(${g.artistCount} artist${g.artistCount > 1 ? "s" : ""})`)}`
      );
    }
  } else {
    console.log(`  ${chalk.dim("   Genres: not yet detected")}`);
  }

  // Artists
  if (music.favoriteArtists.length > 0) {
    const sorted = [...music.favoriteArtists].sort((a, b) => b.mentions - a.mentions);
    const top = sorted.slice(0, 8);
    console.log(
      `  ${chalk.dim("   Top Artists:")} ${top.map((a) => `${chalk.white(a.name)} ${chalk.dim(`(×${a.mentions})`)}`).join(chalk.dim(", "))}`
    );
  }

  // Songs
  if (music.likedSongs.length > 0) {
    console.log(`  ${chalk.dim("   Songs seen:")} ${chalk.white(String(music.likedSongs.length))} tracks`);
  }

  // Playlists
  if (music.playlistsSeen.length > 0) {
    console.log(
      `  ${chalk.dim("   Playlists:")} ${music.playlistsSeen.map((p) => chalk.white(p.name)).join(chalk.dim(", "))}`
    );
  }

  // Listening patterns
  const lp = music.listeningPatterns;
  if (lp.moodPreference || lp.energyLevel || lp.languages.length > 0) {
    console.log(`  ${chalk.dim("   Patterns:")}`);
    if (lp.moodPreference) console.log(`  ${chalk.dim("     Mood:")} ${chalk.white(lp.moodPreference)}`);
    if (lp.energyLevel) console.log(`  ${chalk.dim("     Energy:")} ${chalk.white(lp.energyLevel)}`);
    if (lp.languages.length > 0) console.log(`  ${chalk.dim("     Languages:")} ${chalk.white(lp.languages.join(", "))}`);
    const contexts = Object.entries(lp.contextPreferences);
    if (contexts.length > 0) {
      for (const [ctx, pref] of contexts) {
        console.log(`  ${chalk.dim(`     While ${ctx}:`)} ${chalk.white(pref)}`);
      }
    }
  }

  // ── Travel ──
  const { travel } = profile;
  blank();
  console.log(`  ${chalk.bold.hex("#0984E3")("✈️  Travel Profile")}`);

  if (travel.interests.length > 0) {
    console.log(`  ${chalk.dim("   Destinations:")}`);
    const sorted = [...travel.interests].sort((a, b) => b.strength - a.strength);
    for (const d of sorted.slice(0, 6)) {
      const barLen = Math.round(d.strength * 10);
      const bar = "█".repeat(barLen);
      const empty = "░".repeat(10 - barLen);
      console.log(
        `  ${chalk.dim("     ")}${chalk.hex("#0984E3")(bar)}${chalk.dim(empty)} ${chalk.white.bold(d.destination)}` +
          `  ${chalk.dim(`(${d.screenshotCount} screenshot${d.screenshotCount > 1 ? "s" : ""})`)}`
      );
      // Show details if rich
      const det = d.details;
      const parts: string[] = [];
      if (det.hotelsSaved.length > 0) parts.push(`${det.hotelsSaved.length} hotel${det.hotelsSaved.length > 1 ? "s" : ""}`);
      if (det.activitiesSaved.length > 0) parts.push(`${det.activitiesSaved.length} activit${det.activitiesSaved.length > 1 ? "ies" : "y"}`);
      if (det.datesDetected.length > 0) parts.push(`dates: ${det.datesDetected[0]}`);
      if (det.budgetSignals.length > 0) parts.push(`budget: ${det.budgetSignals[0]}`);
      if (parts.length > 0) {
        console.log(`  ${chalk.dim("           " + parts.join(" · "))}`);
      }
    }
  } else {
    console.log(`  ${chalk.dim("   Destinations: not yet detected")}`);
  }

  // Travel style
  const style = travel.style;
  const styleEntries = Object.entries(style).filter(([, v]) => v !== null);
  if (styleEntries.length > 0) {
    console.log(`  ${chalk.dim("   Style:")}`);
    for (const [key, val] of styleEntries) {
      console.log(`  ${chalk.dim("     " + key + ":")} ${chalk.white(val!)}`);
    }
  }

  // ── General ──
  const { general } = profile;
  blank();
  console.log(`  ${chalk.bold.hex("#A29BFE")("🌐 General")}`);

  if (general.language) {
    console.log(`  ${chalk.dim("   Language:")} ${chalk.white(general.language)}`);
  }
  if (general.foodPreferences.length > 0) {
    console.log(`  ${chalk.dim("   Food:")} ${chalk.white(general.foodPreferences.join(", "))}`);
  }
  if (general.budgetStyle) {
    console.log(`  ${chalk.dim("   Budget:")} ${chalk.white(general.budgetStyle)}`);
  }
  if (general.personalitySignals.length > 0) {
    console.log(`  ${chalk.dim("   Signals:")} ${chalk.white(general.personalitySignals.join(", "))}`);
  }

  if (!general.language && general.foodPreferences.length === 0 && !general.budgetStyle && general.personalitySignals.length === 0) {
    console.log(`  ${chalk.dim("   Not enough data yet — keep uploading screenshots")}`);
  }

  blank();
  logDivider();
  log("info", chalk.dim(`Profile version ${profile.profileVersion} · Last updated: ${profile.lastUpdated || "never"}`));
  blank();
}
