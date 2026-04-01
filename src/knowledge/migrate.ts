/**
 * MIGRATION SCRIPT
 *
 * Reads existing JSON files (screenshots.json, profile.json, conversations.json)
 * and populates the new knowledge store (SQLite + Vectra + Graphology).
 *
 * Run: npx tsx src/knowledge/migrate.ts
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { KnowledgeStore } from "./store.js";
import type { ScreenshotMeta } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");

interface OldConversation {
  id: string;
  query: string;
  intent: string;
  response: string;
  timestamp: string;
}

interface OldProfileFact {
  value: string;
  confidence: number;
  sources: string[];
  evidence: string;
}

interface OldProfile {
  identity: Record<string, OldProfileFact | undefined>;
  music: {
    preferredPlatform: OldProfileFact | null;
    genres: Array<{ genre: string; strength: number; artistCount: number }>;
    favoriteArtists: Array<{ name: string; mentions: number; sources: string[] }>;
    likedSongs: Array<{ title: string; artist: string; source: string }>;
    playlistsSeen: Array<{ name: string; platform: string; source: string }>;
    listeningPatterns: {
      moodPreference: string | null;
      energyLevel: string | null;
      languages: string[];
      contextPreferences: Record<string, string>;
    };
  };
  travel: {
    interests: Array<{
      destination: string;
      strength: number;
      screenshotCount: number;
      lastSeen: string;
      details: {
        hotelsSaved: string[];
        activitiesSaved: string[];
        foodSaved: string[];
        datesDetected: string[];
        budgetSignals: string[];
      };
    }>;
    style: {
      accommodation: string | null;
      food: string | null;
      activities: string | null;
      pace: string | null;
      budget: string | null;
    };
  };
  general: {
    personalitySignals: string[];
    language: string | null;
    foodPreferences: string[];
    budgetStyle: string | null;
  };
  totalScreenshots: number;
  lastUpdated: string | null;
  profileVersion: number;
}

async function readJSON<T>(filePath: string): Promise<T | null> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function migrate() {
  console.log(chalk.bold.hex("#6C5CE7")("\n  Pool Knowledge Store Migration\n"));

  const store = await KnowledgeStore.create(DATA_DIR);
  let totalMigrated = 0;

  // ── 1. Migrate screenshots ──
  console.log(chalk.cyan("  [1/4] Migrating screenshots..."));
  const screenshots = await readJSON<ScreenshotMeta[]>(path.join(DATA_DIR, "screenshots.json"));
  if (screenshots && screenshots.length > 0) {
    for (const ss of screenshots) {
      store.saveScreenshot(ss);

      // Build graph nodes for analyzed screenshots
      if (ss.analyzed && ss.entities) {
        store.graph.addScreenshot(ss.id, {
          category: ss.category,
          sourceApp: ss.sourceApp,
          summary: ss.summary,
        });

        // Index entities in graph
        const entities = ss.entities;
        if (entities.artists) {
          for (const artist of entities.artists) {
            store.graph.addEntityFromScreenshot(ss.id, "artist", artist);
          }
        }
        if (entities.genres) {
          for (const genre of entities.genres) {
            store.graph.addEntityFromScreenshot(ss.id, "genre", genre);
          }
        }
        if (entities.destination) {
          store.graph.addEntityFromScreenshot(ss.id, "destination", entities.destination);
        }
        if (entities.hotel) {
          store.graph.addEntityFromScreenshot(ss.id, "hotel", entities.hotel);
          if (entities.destination) {
            store.graph.addEntityRelation("destination", entities.destination, "hotel", entities.hotel, "HAS_HOTEL");
          }
        }
        if (entities.platform) {
          store.graph.addEntityFromScreenshot(ss.id, "platform", entities.platform);
        }
        if (entities.cuisine) {
          store.graph.addEntityFromScreenshot(ss.id, "cuisine", entities.cuisine);
        }
        if (entities.songs) {
          for (const song of entities.songs) {
            if (song.title) {
              store.graph.addEntityFromScreenshot(ss.id, "song", song.title, { artist: song.artist });
              if (song.artist) {
                store.graph.addEntityRelation("song", song.title, "artist", song.artist, "BELONGS_TO");
              }
            }
          }
        }

        // Index in vector store
        try {
          await store.indexScreenshot(ss.id, {
            summary: ss.summary ?? null,
            detailedDescription: ss.detailedDescription ?? null,
            sourceApp: ss.sourceApp ?? null,
            category: ss.category ?? null,
            uploadedAt: ss.uploadedAt,
            entities: ss.entities,
          });
        } catch (err) {
          console.log(chalk.yellow(`    Vector indexing failed for ${ss.id}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }

      totalMigrated++;
    }
    console.log(chalk.green(`    ✓ ${screenshots.length} screenshots migrated`));
  } else {
    console.log(chalk.dim("    No screenshots.json found or empty"));
  }

  // ── 2. Migrate profile ──
  console.log(chalk.cyan("  [2/4] Migrating profile..."));
  const profile = await readJSON<OldProfile>(path.join(DATA_DIR, "profile.json"));
  if (profile) {
    let factCount = 0;

    // Identity
    for (const [key, fact] of Object.entries(profile.identity)) {
      if (fact) {
        store.addFact({
          factType: key.replace(/_alt$/, ""),
          factValue: fact.value,
          confidence: fact.confidence,
          source: fact.sources[0] || "migration",
          evidence: fact.evidence,
        });
        store.setProfileValue(`identity.${key}`, fact.value, fact.confidence, fact.sources);
        factCount++;
      }
    }

    // Music platform
    if (profile.music.preferredPlatform) {
      const p = profile.music.preferredPlatform;
      store.addFact({ factType: "music_platform", factValue: p.value, confidence: p.confidence, source: p.sources[0] || "migration", evidence: p.evidence });
      store.setProfileValue("music.preferredPlatform", p.value, p.confidence, p.sources);
      factCount++;
    }

    // Artists
    for (const artist of profile.music.favoriteArtists) {
      for (const source of artist.sources) {
        store.addFact({ factType: "liked_artist", factValue: artist.name, confidence: Math.min(1.0, 0.5 + artist.mentions * 0.1), source, evidence: "migrated from profile" });
      }
      factCount++;
    }

    // Genres
    for (const genre of profile.music.genres) {
      store.addFact({ factType: "genre", factValue: genre.genre, confidence: genre.strength, source: "migration", evidence: "migrated from profile" });
      factCount++;
    }

    // Songs
    for (const song of profile.music.likedSongs) {
      store.addFact({ factType: "liked_song", factValue: `${song.title} - ${song.artist}`, confidence: 0.7, source: song.source, evidence: "migrated from profile" });
      factCount++;
    }

    // Playlists
    for (const playlist of profile.music.playlistsSeen) {
      store.addFact({ factType: "playlist", factValue: playlist.name, confidence: 0.6, source: playlist.source, evidence: `Playlist on ${playlist.platform}` });
      factCount++;
    }

    // Listening patterns
    const lp = profile.music.listeningPatterns;
    if (lp.moodPreference) store.setProfileValue("music.moodPreference", lp.moodPreference);
    if (lp.energyLevel) store.setProfileValue("music.energyLevel", lp.energyLevel);
    for (const lang of lp.languages) {
      store.addFact({ factType: "language", factValue: lang, confidence: 0.8, source: "migration", evidence: "migrated from profile" });
    }
    for (const [ctx, pref] of Object.entries(lp.contextPreferences)) {
      store.setProfileValue(`music.context.${ctx}`, pref);
    }

    // Travel interests
    for (const interest of profile.travel.interests) {
      store.addFact({ factType: "travel_interest", factValue: interest.destination, confidence: interest.strength, source: "migration", evidence: "migrated from profile" });
      // Travel details
      const prefix = `travel.detail.${interest.destination.toLowerCase()}`;
      if (interest.details.hotelsSaved.length > 0) store.setProfileValue(`${prefix}.hotels`, interest.details.hotelsSaved.join(", "));
      if (interest.details.activitiesSaved.length > 0) store.setProfileValue(`${prefix}.activities`, interest.details.activitiesSaved.join(", "));
      if (interest.details.foodSaved.length > 0) store.setProfileValue(`${prefix}.restaurants`, interest.details.foodSaved.join(", "));
      if (interest.details.datesDetected.length > 0) store.setProfileValue(`${prefix}.dates`, interest.details.datesDetected.join(", "));
      if (interest.details.budgetSignals.length > 0) store.setProfileValue(`${prefix}.budget`, interest.details.budgetSignals.join(", "));
      factCount++;
    }

    // Travel style
    const style = profile.travel.style;
    if (style.accommodation) store.setProfileValue("travel.style.accommodation", style.accommodation);
    if (style.food) store.setProfileValue("travel.style.food", style.food);
    if (style.activities) store.setProfileValue("travel.style.activities", style.activities);
    if (style.pace) store.setProfileValue("travel.style.pace", style.pace);
    if (style.budget) store.setProfileValue("travel.style.budget", style.budget);

    // General
    if (profile.general.language) store.setProfileValue("general.language", profile.general.language);
    if (profile.general.budgetStyle) store.setProfileValue("general.budgetStyle", profile.general.budgetStyle);
    if (profile.general.personalitySignals.length > 0) {
      store.setProfileValue("general.personalitySignals", profile.general.personalitySignals.join(", "));
    }
    for (const pref of profile.general.foodPreferences) {
      store.addFact({ factType: "food_preference", factValue: pref, confidence: 0.7, source: "migration", evidence: "migrated from profile" });
      factCount++;
    }

    // Meta
    store.sqlite.setMeta("version", String(profile.profileVersion));
    store.sqlite.setMeta("total_screenshots", String(profile.totalScreenshots));
    store.sqlite.setMeta("last_updated", profile.lastUpdated || "");

    console.log(chalk.green(`    ✓ ${factCount} facts migrated from profile`));
  } else {
    console.log(chalk.dim("    No profile.json found"));
  }

  // ── 3. Migrate conversations ──
  console.log(chalk.cyan("  [3/4] Migrating conversations..."));
  const conversations = await readJSON<OldConversation[]>(path.join(DATA_DIR, "conversations.json"));
  if (conversations && conversations.length > 0) {
    for (const convo of conversations) {
      store.saveConversation(convo);
    }
    console.log(chalk.green(`    ✓ ${conversations.length} conversations migrated`));
  } else {
    console.log(chalk.dim("    No conversations.json found or empty"));
  }

  // ── 4. Persist graph ──
  console.log(chalk.cyan("  [4/4] Persisting knowledge graph..."));
  await store.persistGraph();
  console.log(chalk.green(`    ✓ Graph saved (${store.graph.nodeCount} nodes, ${store.graph.edgeCount} edges)`));

  // ── 5. Delete old JSON files ──
  console.log(chalk.cyan("\n  Cleaning up old JSON files..."));
  const filesToDelete = [
    path.join(DATA_DIR, "screenshots.json"),
    path.join(DATA_DIR, "profile.json"),
    path.join(DATA_DIR, "conversations.json"),
  ];
  for (const file of filesToDelete) {
    try {
      await fs.unlink(file);
      console.log(chalk.dim(`    Deleted ${path.basename(file)}`));
    } catch {
      // File doesn't exist, that's fine
    }
  }

  // Delete meta directory
  try {
    const metaDir = path.join(DATA_DIR, "screenshots", "meta");
    const metaFiles = await fs.readdir(metaDir);
    for (const f of metaFiles) {
      await fs.unlink(path.join(metaDir, f));
    }
    await fs.rmdir(metaDir);
    console.log(chalk.dim("    Deleted screenshots/meta/"));
  } catch {
    // Directory doesn't exist
  }

  store.close();

  console.log(chalk.bold.green(`\n  ✓ Migration complete! ${totalMigrated} screenshots processed.\n`));
  console.log(chalk.dim("  New storage locations:"));
  console.log(chalk.dim(`    SQLite:  data/pool.db`));
  console.log(chalk.dim(`    Vectors: data/vectors/`));
  console.log(chalk.dim(`    Graph:   data/graph.json\n`));
}

migrate().catch((e) => {
  console.error(chalk.red("\n  Migration failed:"), e.message);
  console.error(e.stack);
  process.exit(1);
});
