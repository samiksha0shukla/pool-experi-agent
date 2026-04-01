/**
 * INTEGRATION TEST — Knowledge Store
 *
 * Tests all three backends: SQLite, Vectra, Graphology
 * Run: npx tsx src/knowledge/test.ts
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { KnowledgeStore } from "./store.js";
import type { ScreenshotMeta } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(__dirname, "..", "..", "data", "_test_knowledge");

let store: KnowledgeStore;
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════
// TEST: Store creation
// ══════════════════════════════════════════════════════════════

async function testStoreCreation() {
  console.log("\n📦 Store Creation");
  store = await KnowledgeStore.create(TEST_DIR);
  assert(store !== null, "KnowledgeStore.create() returns instance");

  // Check directories were created
  const dbExists = await fs.stat(path.join(TEST_DIR, "pool.db")).then(() => true).catch(() => false);
  assert(dbExists, "pool.db created");

  const vectorsDir = await fs.stat(path.join(TEST_DIR, "vectors")).then((s) => s.isDirectory()).catch(() => false);
  assert(vectorsDir, "vectors/ directory created");

  const screenshotsDir = await fs.stat(path.join(TEST_DIR, "screenshots")).then((s) => s.isDirectory()).catch(() => false);
  assert(screenshotsDir, "screenshots/ directory created");

  const responsesDir = await fs.stat(path.join(TEST_DIR, "responses")).then((s) => s.isDirectory()).catch(() => false);
  assert(responsesDir, "responses/ directory created");
}

// ══════════════════════════════════════════════════════════════
// TEST: SQLite — Screenshots
// ══════════════════════════════════════════════════════════════

async function testScreenshots() {
  console.log("\n📸 SQLite: Screenshots");

  const meta: ScreenshotMeta = {
    id: "ss_test_001",
    fileName: "ss_test_001.png",
    originalPath: "/tmp/test.png",
    localPath: path.join(TEST_DIR, "screenshots", "ss_test_001.png"),
    uploadedAt: new Date().toISOString(),
    fileSizeKB: 1234.5,
    analyzed: false,
  };

  store.saveScreenshot(meta);
  const all = store.getAllScreenshots();
  assert(all.length === 1, "saveScreenshot + getAllScreenshots: 1 screenshot");
  assert(all[0]!.id === "ss_test_001", "Screenshot ID matches");
  assert(all[0]!.analyzed === 0, "analyzed = 0 (false)");

  // Update with analysis
  store.updateScreenshot("ss_test_001", {
    analyzed: true,
    analyzedAt: new Date().toISOString(),
    sourceApp: "Spotify",
    category: "music",
    summary: "Spotify playlist with indie rock songs",
    detailedDescription: "A screenshot of a Spotify playlist featuring indie rock artists.",
    ocrText: "Liked Songs · 342 songs\nArctic Monkeys - Do I Wanna Know?\nTame Impala - The Less I Know The Better",
    entities: {
      platform: "Spotify",
      artists: ["Arctic Monkeys", "Tame Impala"],
      genres: ["indie rock"],
    },
  });

  const updated = store.getScreenshot("ss_test_001");
  assert(updated !== null, "getScreenshot returns updated row");
  assert(updated!.analyzed === 1, "analyzed = 1 after update");
  assert(updated!.source_app === "Spotify", "sourceApp = Spotify");
  assert(updated!.category === "music", "category = music");
  assert(updated!.ocr_text !== null, "ocrText stored");
  assert(updated!.ocr_text!.includes("Arctic Monkeys"), "ocrText contains expected text");

  // Test getScreenshotsByCategory
  const musicScreenshots = store.getScreenshotsByCategory("music");
  assert(musicScreenshots.length === 1, "getScreenshotsByCategory('music') = 1");

  const travelScreenshots = store.getScreenshotsByCategory("travel");
  assert(travelScreenshots.length === 0, "getScreenshotsByCategory('travel') = 0");

  // Add a second screenshot
  const meta2: ScreenshotMeta = {
    id: "ss_test_002",
    fileName: "ss_test_002.png",
    originalPath: "/tmp/test2.png",
    localPath: path.join(TEST_DIR, "screenshots", "ss_test_002.png"),
    uploadedAt: new Date().toISOString(),
    fileSizeKB: 2345.6,
    analyzed: true,
    analyzedAt: new Date().toISOString(),
    sourceApp: "Google Flights",
    category: "travel",
    summary: "Google Flights: BLR to LIS for $258",
    detailedDescription: "Flight search results on Google Flights from Bengaluru to Lisbon.",
    ocrText: "Google Flights\nBengaluru (BLR) → Lisbon (LIS)\nMay 7, 2026\nAir India $258",
    entities: {
      origin: "Bengaluru",
      destination: "Lisbon",
      airline: "Air India",
      price: "$258",
    },
  };
  store.saveScreenshot(meta2);

  assert(store.getAllScreenshots().length === 2, "Total screenshots = 2");
  assert(store.getAnalyzedScreenshots().length === 2, "Analyzed screenshots = 2");
  assert(store.getScreenshotsByCategory("travel").length === 1, "Travel screenshots = 1");
}

// ══════════════════════════════════════════════════════════════
// TEST: SQLite — Entities
// ══════════════════════════════════════════════════════════════

async function testEntities() {
  console.log("\n🏷️  SQLite: Entities");

  const entities = store.getEntitiesByScreenshot("ss_test_001");
  assert(entities.length > 0, "Entities saved for ss_test_001");

  const artistEntities = store.getEntitiesByType("artists");
  assert(artistEntities.length >= 2, "Artist entities extracted (Arctic Monkeys + Tame Impala)");

  const platformEntities = store.getEntitiesByType("platform");
  assert(platformEntities.length >= 1, "Platform entity extracted (Spotify)");

  // Travel screenshot entities
  const travelEntities = store.getEntitiesByScreenshot("ss_test_002");
  assert(travelEntities.length > 0, "Entities saved for travel screenshot");

  const destEntities = store.getEntitiesByType("destination");
  assert(destEntities.some((e) => e.entity_value === "Lisbon"), "Destination 'Lisbon' found");
}

// ══════════════════════════════════════════════════════════════
// TEST: SQLite — Facts
// ══════════════════════════════════════════════════════════════

async function testFacts() {
  console.log("\n📝 SQLite: Facts");

  store.addFact({ factType: "name", factValue: "Samiksha", confidence: 0.9, source: "ss_test_001", evidence: "name on profile" });
  store.addFact({ factType: "location", factValue: "Bengaluru", confidence: 0.8, source: "ss_test_002", evidence: "flight origin city" });
  store.addFact({ factType: "liked_artist", factValue: "Arctic Monkeys", confidence: 0.85, source: "ss_test_001", evidence: "in playlist" });
  store.addFact({ factType: "liked_artist", factValue: "Tame Impala", confidence: 0.8, source: "ss_test_001", evidence: "in playlist" });
  store.addFact({ factType: "genre", factValue: "indie rock", confidence: 0.7, source: "ss_test_001" });
  store.addFact({ factType: "travel_interest", factValue: "Lisbon", confidence: 0.6, source: "ss_test_002", evidence: "flight search destination" });

  const allFacts = store.getAllFacts();
  assert(allFacts.length >= 6, `getAllFacts() returns ${allFacts.length} facts (≥6)`);

  const nameFacts = store.getFactsByType("name");
  assert(nameFacts.length === 1, "1 name fact");
  assert(nameFacts[0]!.fact_value === "Samiksha", "name = Samiksha");

  const artists = store.getFactsByType("liked_artist");
  assert(artists.length === 2, "2 artist facts");

  const topName = store.getTopFact("name");
  assert(topName === "Samiksha", "getTopFact('name') = Samiksha");

  const topLocation = store.getTopFact("location");
  assert(topLocation === "Bengaluru", "getTopFact('location') = Bengaluru");

  // Test reinforcement
  store.reinforceFact("liked_artist", "Arctic Monkeys", "ss_test_002");
  const reinforced = store.getFactsByType("liked_artist");
  const am = reinforced.find((f) => f.fact_value === "Arctic Monkeys");
  assert(am !== undefined && am.confidence > 0.85, "reinforceFact increases confidence");

  // Test UPSERT conflict handling
  store.addFact({ factType: "name", factValue: "Samiksha", confidence: 0.95, source: "ss_test_001", evidence: "name confirmed" });
  const nameAfter = store.getFactsByType("name");
  assert(nameAfter[0]!.confidence >= 0.9, "addFact UPSERT keeps higher confidence");
}

// ══════════════════════════════════════════════════════════════
// TEST: SQLite — Profile KV
// ══════════════════════════════════════════════════════════════

async function testProfileKV() {
  console.log("\n🔑 SQLite: Profile KV");

  store.setProfileValue("music.preferredPlatform", "Spotify", 0.95, ["ss_test_001"]);
  store.setProfileValue("music.moodPreference", "chill, introspective");
  store.setProfileValue("music.energyLevel", "medium");
  store.setProfileValue("identity.name", "Samiksha", 0.9, ["ss_test_001"]);
  store.setProfileValue("travel.style.budget", "mid-range");
  store.setProfileValue("general.personalitySignals", "music enthusiast, travel-oriented");

  const platform = store.getProfileValue("music.preferredPlatform");
  assert(platform !== null, "getProfileValue returns value");
  assert(platform!.value === "Spotify", "platform = Spotify");
  assert(platform!.confidence === 0.95, "platform confidence = 0.95");

  // Test getProfileSection
  const musicKV = store.getProfileSection("music.");
  assert(musicKV.length >= 3, `getProfileSection('music.') returns ${musicKV.length} entries (≥3)`);

  const travelKV = store.getProfileSection("travel.");
  assert(travelKV.length >= 1, "getProfileSection('travel.') returns entries");

  // Test overwrite
  store.setProfileValue("music.preferredPlatform", "YouTube Music", 1.0, ["conversation"]);
  const updated = store.getProfileValue("music.preferredPlatform");
  assert(updated!.value === "YouTube Music", "setProfileValue overwrites on conflict");
  assert(updated!.confidence === 1.0, "Updated confidence = 1.0");

  // Profile meta
  store.incrementProfileVersion();
  const meta = store.getProfileMeta();
  assert(meta.version >= 1, `Profile version = ${meta.version}`);
  assert(meta.totalScreenshots >= 2, `Total screenshots = ${meta.totalScreenshots}`);
}

// ══════════════════════════════════════════════════════════════
// TEST: SQLite — Conversations
// ══════════════════════════════════════════════════════════════

async function testConversations() {
  console.log("\n💬 SQLite: Conversations");

  store.saveConversation({
    id: "conv_001",
    query: "suggest me some music",
    intent: "music",
    response: "Based on your taste...",
    timestamp: new Date().toISOString(),
  });
  store.saveConversation({
    id: "conv_002",
    query: "where am I planning to go?",
    intent: "travel",
    response: "You're looking at Lisbon...",
    timestamp: new Date().toISOString(),
  });

  const recent = store.getRecentConversations(5);
  assert(recent.length === 2, "2 conversations saved");
  assert(recent[0]!.intent === "travel", "Most recent conversation is travel (DESC order)");
}

// ══════════════════════════════════════════════════════════════
// TEST: Graphology
// ══════════════════════════════════════════════════════════════

async function testGraph() {
  console.log("\n🔗 Graphology: Knowledge Graph");

  // Add screenshot with entities
  store.graph.addScreenshot("ss_test_001", { category: "music", sourceApp: "Spotify" });
  store.graph.addEntityFromScreenshot("ss_test_001", "artist", "Arctic Monkeys");
  store.graph.addEntityFromScreenshot("ss_test_001", "artist", "Tame Impala");
  store.graph.addEntityFromScreenshot("ss_test_001", "genre", "indie rock");
  store.graph.addEntityFromScreenshot("ss_test_001", "platform", "Spotify");
  store.graph.addEntityRelation("artist", "Arctic Monkeys", "genre", "indie rock", "IN_GENRE");
  store.graph.addEntityRelation("artist", "Tame Impala", "genre", "indie rock", "IN_GENRE");

  store.graph.addScreenshot("ss_test_002", { category: "travel", sourceApp: "Google Flights" });
  store.graph.addEntityFromScreenshot("ss_test_002", "destination", "Lisbon");
  store.graph.addEntityFromScreenshot("ss_test_002", "airline", "Air India");

  assert(store.graph.nodeCount > 0, `Graph has ${store.graph.nodeCount} nodes`);
  assert(store.graph.edgeCount > 0, `Graph has ${store.graph.edgeCount} edges`);

  // Test hasNode
  assert(store.graph.hasNode("user:self"), "user:self node exists");
  assert(store.graph.hasNode("artist:arctic monkeys"), "artist:arctic monkeys node exists");
  assert(store.graph.hasNode("destination:lisbon"), "destination:lisbon node exists");

  // Test user connections
  const userArtists = store.graph.getUserConnections("LISTENS_TO");
  assert(userArtists.length === 2, `User LISTENS_TO ${userArtists.length} artists (expected 2)`);

  const userDestinations = store.graph.getUserConnections("INTERESTED_IN");
  assert(userDestinations.length === 1, `User INTERESTED_IN ${userDestinations.length} destinations (expected 1)`);

  // Test getRelatedScreenshots
  const relatedToAM = store.graph.getRelatedScreenshots("artist:arctic monkeys");
  assert(relatedToAM.length >= 1, "Arctic Monkeys related to ≥1 screenshot");

  // Test getNodesByType
  const allArtists = store.graph.getNodesByType("artist");
  assert(allArtists.length === 2, "2 artist nodes in graph");

  // Test persistence
  await store.persistGraph();
  const graphFile = path.join(TEST_DIR, "graph.json");
  const graphExists = await fs.stat(graphFile).then(() => true).catch(() => false);
  assert(graphExists, "graph.json persisted to disk");

  const graphData = JSON.parse(await fs.readFile(graphFile, "utf-8"));
  assert(graphData.nodes && graphData.nodes.length > 0, "graph.json contains nodes");
  assert(graphData.edges && graphData.edges.length > 0, "graph.json contains edges");

  // Test reload
  const store2 = await KnowledgeStore.create(TEST_DIR);
  assert(store2.graph.nodeCount === store.graph.nodeCount, "Graph reloaded with same node count");
  assert(store2.graph.edgeCount === store.graph.edgeCount, "Graph reloaded with same edge count");
  store2.close();
}

// ══════════════════════════════════════════════════════════════
// TEST: Vectra (no API key needed for index creation)
// ══════════════════════════════════════════════════════════════

async function testVectra() {
  console.log("\n🔍 Vectra: Vector Store");

  const vectorsDir = path.join(TEST_DIR, "vectors");
  const indexExists = await fs.stat(vectorsDir).then((s) => s.isDirectory()).catch(() => false);
  assert(indexExists, "vectors/ directory exists");

  // Check index was created
  const indexFile = await fs.readdir(vectorsDir);
  assert(indexFile.length > 0, `Vector index has files: ${indexFile.join(", ")}`);

  // We can't test actual embedding/search without API key, but verify the store methods exist
  assert(typeof store.indexScreenshot === "function", "store.indexScreenshot method exists");
  assert(typeof store.semanticSearch === "function", "store.semanticSearch method exists");
}

// ══════════════════════════════════════════════════════════════
// TEST: Composite queries
// ══════════════════════════════════════════════════════════════

async function testCompositeQueries() {
  console.log("\n🔄 Composite: getContextForAgent");

  // Music context
  const musicCtx = await store.getContextForAgent("music");
  assert(musicCtx.facts.length > 0, "Music context has facts");
  assert(musicCtx.screenshots.length > 0, "Music context has screenshots");
  assert(musicCtx.profileKV.length > 0, "Music context has profile KV");

  // Travel context
  const travelCtx = await store.getContextForAgent("travel");
  assert(travelCtx.facts.length > 0, "Travel context has facts");
  assert(travelCtx.screenshots.length > 0, "Travel context has screenshots");

  // Profile context
  const profileCtx = await store.getContextForAgent("profile");
  assert(profileCtx.facts.length >= 6, `Profile context has all facts (${profileCtx.facts.length})`);
  assert(profileCtx.screenshots.length === 2, "Profile context has all screenshots");
  assert(profileCtx.profileKV.length > 0, "Profile context has profile KV");

  // General context
  const generalCtx = await store.getContextForAgent("general");
  assert(generalCtx.facts.length > 0, "General context has identity facts");
  assert(generalCtx.profileKV.length > 0, "General context has general/identity KV");
}

// ══════════════════════════════════════════════════════════════
// TEST: Import chains — verify all modules load without error
// ══════════════════════════════════════════════════════════════

async function testImports() {
  console.log("\n📦 Import Chains");

  try {
    await import("./types.js");
    assert(true, "knowledge/types.ts imports OK");
  } catch (e: any) { assert(false, `knowledge/types.ts: ${e.message}`); }

  try {
    await import("./sqlite.js");
    assert(true, "knowledge/sqlite.ts imports OK");
  } catch (e: any) { assert(false, `knowledge/sqlite.ts: ${e.message}`); }

  try {
    await import("./embeddings.js");
    assert(true, "knowledge/embeddings.ts imports OK");
  } catch (e: any) { assert(false, `knowledge/embeddings.ts: ${e.message}`); }

  try {
    await import("./vectors.js");
    assert(true, "knowledge/vectors.ts imports OK");
  } catch (e: any) { assert(false, `knowledge/vectors.ts: ${e.message}`); }

  try {
    await import("./graph.js");
    assert(true, "knowledge/graph.ts imports OK");
  } catch (e: any) { assert(false, `knowledge/graph.ts: ${e.message}`); }

  try {
    await import("./store.js");
    assert(true, "knowledge/store.ts imports OK");
  } catch (e: any) { assert(false, `knowledge/store.ts: ${e.message}`); }

  try {
    await import("../ingestion/analyze.js");
    assert(true, "ingestion/analyze.ts imports OK");
  } catch (e: any) { assert(false, `ingestion/analyze.ts: ${e.message}`); }

  try {
    await import("../ingestion/profileUpdater.js");
    assert(true, "ingestion/profileUpdater.ts imports OK");
  } catch (e: any) { assert(false, `ingestion/profileUpdater.ts: ${e.message}`); }

  try {
    await import("../orchestrator.js");
    assert(true, "orchestrator.ts imports OK");
  } catch (e: any) { assert(false, `orchestrator.ts: ${e.message}`); }

  try {
    await import("../agents/musicAgent.js");
    assert(true, "agents/musicAgent.ts imports OK");
  } catch (e: any) { assert(false, `agents/musicAgent.ts: ${e.message}`); }

  try {
    await import("../agents/travelAgent.js");
    assert(true, "agents/travelAgent.ts imports OK");
  } catch (e: any) { assert(false, `agents/travelAgent.ts: ${e.message}`); }

  try {
    await import("../agents/generalAgent.js");
    assert(true, "agents/generalAgent.ts imports OK");
  } catch (e: any) { assert(false, `agents/generalAgent.ts: ${e.message}`); }

  try {
    await import("../agents/profileAgent.js");
    assert(true, "agents/profileAgent.ts imports OK");
  } catch (e: any) { assert(false, `agents/profileAgent.ts: ${e.message}`); }

  try {
    await import("../upload.js");
    assert(true, "upload.ts imports OK");
  } catch (e: any) { assert(false, `upload.ts: ${e.message}`); }

  try {
    await import("../query.js");
    assert(true, "query.ts imports OK");
  } catch (e: any) { assert(false, `query.ts: ${e.message}`); }

  try {
    await import("../profile.js");
    assert(true, "profile.ts imports OK");
  } catch (e: any) { assert(false, `profile.ts: ${e.message}`); }

  try {
    await import("../renderer.js");
    assert(true, "renderer.ts imports OK");
  } catch (e: any) { assert(false, `renderer.ts: ${e.message}`); }
}

// ══════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Pool Knowledge Store — Integration Tests");
  console.log("═══════════════════════════════════════════");

  await cleanup();

  try {
    await testStoreCreation();
    await testScreenshots();
    await testEntities();
    await testFacts();
    await testProfileKV();
    await testConversations();
    await testGraph();
    await testVectra();
    await testCompositeQueries();
    await testImports();
  } catch (err: any) {
    console.error(`\n💥 FATAL: ${err.message}`);
    console.error(err.stack);
    failed++;
  } finally {
    if (store) store.close();
    await cleanup();
  }

  console.log("\n═══════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
