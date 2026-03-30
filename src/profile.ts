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

  // Stats bar
  console.log(
    `  ${chalk.hex("#6C5CE7").bold("Screenshots:")} ${chalk.white(String(screenshots.length))}` +
      `  ${chalk.dim("|")}  ` +
      `${chalk.green("Analyzed:")} ${chalk.white(String(analyzed))}` +
      `  ${chalk.dim("|")}  ` +
      `${chalk.yellow("Pending:")} ${chalk.white(String(pending))}`
  );
  blank();
  logDivider();

  // Identity
  const identity = (profile.identity as Record<string, unknown>) || {};
  blank();
  console.log(`  ${chalk.bold.hex("#6C5CE7")("👤 Identity")}`);
  if (Object.keys(identity).length === 0) {
    console.log(`  ${chalk.dim("   Not yet detected — upload more screenshots")}`);
  } else {
    for (const [key, val] of Object.entries(identity)) {
      const v = val as Record<string, unknown>;
      console.log(
        `  ${chalk.dim("   " + key + ":")} ${chalk.white(String(v.value || "unknown"))}` +
          `  ${chalk.dim(`(${((v.confidence as number) * 100).toFixed(0)}% confidence)`)}`
      );
    }
  }

  // Music
  const music = (profile.music as Record<string, unknown>) || {};
  blank();
  console.log(`  ${chalk.bold.hex("#1DB954")("🎵 Music Profile")}`);
  const platform = music.preferredPlatform as Record<string, unknown> | null;
  if (platform?.value) {
    console.log(
      `  ${chalk.dim("   Platform:")} ${chalk.white(String(platform.value))}` +
        `  ${chalk.dim(`(${((platform.confidence as number) * 100).toFixed(0)}%)`)}`
    );
  } else {
    console.log(`  ${chalk.dim("   Platform: not yet detected")}`);
  }

  const genres = (music.genres as Array<{ genre: string; strength: number }>) || [];
  if (genres.length > 0) {
    console.log(`  ${chalk.dim("   Genres:")}`);
    for (const g of genres.slice(0, 5)) {
      const bar = "█".repeat(Math.round(g.strength * 10));
      const empty = "░".repeat(10 - Math.round(g.strength * 10));
      console.log(
        `  ${chalk.dim("     ")}${chalk.hex("#1DB954")(bar)}${chalk.dim(empty)} ${chalk.white(g.genre)}`
      );
    }
  } else {
    console.log(`  ${chalk.dim("   Genres: not yet detected")}`);
  }

  const artists =
    (music.favoriteArtists as Array<{ name: string; mentions: number }>) || [];
  if (artists.length > 0) {
    console.log(`  ${chalk.dim("   Top Artists:")} ${artists.map((a) => chalk.white(a.name)).join(chalk.dim(", "))}`);
  }

  // Travel
  const travel = (profile.travel as Record<string, unknown>) || {};
  const interests =
    (travel.interests as Array<{ destination: string; strength: number; screenshot_count?: number }>) || [];
  blank();
  console.log(`  ${chalk.bold.hex("#0984E3")("✈️  Travel Profile")}`);
  if (interests.length > 0) {
    console.log(`  ${chalk.dim("   Destinations:")}`);
    for (const d of interests.slice(0, 5)) {
      const bar = "█".repeat(Math.round(d.strength * 10));
      const empty = "░".repeat(10 - Math.round(d.strength * 10));
      console.log(
        `  ${chalk.dim("     ")}${chalk.hex("#0984E3")(bar)}${chalk.dim(empty)} ${chalk.white(d.destination)}` +
          `  ${chalk.dim(`(${d.screenshot_count || 0} screenshots)`)}`
      );
    }
  } else {
    console.log(`  ${chalk.dim("   Destinations: not yet detected")}`);
  }

  const style = (travel.style as Record<string, string>) || {};
  if (Object.keys(style).length > 0) {
    console.log(`  ${chalk.dim("   Style:")}`);
    for (const [key, val] of Object.entries(style)) {
      if (val) console.log(`  ${chalk.dim("     " + key + ":")} ${chalk.white(val)}`);
    }
  }

  blank();
  logDivider();
  log("info", chalk.dim("Upload more screenshots to enrich your profile"));
  blank();
}
