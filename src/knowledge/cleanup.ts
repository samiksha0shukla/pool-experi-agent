/**
 * One-time cleanup: remove invalid name/location facts from the store.
 * Run: npx tsx src/knowledge/cleanup.ts
 */
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "..", "data", "pool.db");

const NOT_A_NAME = new Set([
  "thinking", "planning", "looking", "going", "trying", "wanting",
  "searching", "checking", "browsing", "visiting", "booking",
  "interested", "excited", "wondering", "considering", "hoping",
  "currently", "actually", "really", "just", "also", "still",
  "not", "very", "so", "too", "here", "there", "back",
  "the", "this", "that", "from", "into", "with", "about",
  "good", "fine", "okay", "sure", "done", "new", "happy",
  "hungry", "tired", "busy", "free", "home", "based",
]);

const db = new Database(DB_PATH);

// Find and remove bad name facts
const nameFacts = db.prepare("SELECT * FROM facts WHERE fact_type = 'name'").all() as Array<{ id: number; fact_value: string }>;
let removed = 0;

for (const fact of nameFacts) {
  const words = fact.fact_value.toLowerCase().split(/\s+/);
  const isBad = words.some((w) => NOT_A_NAME.has(w)) ||
    /\b(of|to|at|in|on|for|the|and|or)\s*$/i.test(fact.fact_value);

  if (isBad) {
    console.log(`  Removing bad name fact: "${fact.fact_value}" (id: ${fact.id})`);
    db.prepare("DELETE FROM facts WHERE id = ?").run(fact.id);
    removed++;
  }
}

// Clean up profile_kv entries that reference bad names
const nameKV = db.prepare("SELECT * FROM profile_kv WHERE key LIKE 'identity.name%'").all() as Array<{ key: string; value: string }>;
for (const kv of nameKV) {
  const words = kv.value.toLowerCase().split(/\s+/);
  const isBad = words.some((w) => NOT_A_NAME.has(w)) ||
    /\b(of|to|at|in|on|for|the|and|or)\s*$/i.test(kv.value);

  if (isBad) {
    console.log(`  Removing bad profile KV: ${kv.key} = "${kv.value}"`);
    db.prepare("DELETE FROM profile_kv WHERE key = ?").run(kv.key);
    removed++;
  }
}

// Set the best remaining name as primary (if any)
const remaining = db.prepare("SELECT * FROM facts WHERE fact_type = 'name' ORDER BY confidence DESC LIMIT 1").get() as { fact_value: string; confidence: number } | undefined;
if (remaining) {
  db.prepare("INSERT OR REPLACE INTO profile_kv (key, value, confidence, updated_at) VALUES ('identity.name', ?, ?, datetime('now'))").run(remaining.fact_value, remaining.confidence);
  console.log(`  Primary name set to: "${remaining.fact_value}"`);
}

db.close();

if (removed > 0) {
  console.log(`\n  ✅ Cleaned up ${removed} bad entries`);
} else {
  console.log(`\n  ✅ No bad entries found — data is clean`);
}
