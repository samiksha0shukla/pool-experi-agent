import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");
const RESPONSES_DIR = path.join(DATA_DIR, "responses");
const PROFILE_PATH = path.join(DATA_DIR, "profile.json");
const SCREENSHOTS_META_PATH = path.join(DATA_DIR, "screenshots.json");
const CONVERSATIONS_PATH = path.join(DATA_DIR, "conversations.json");

export interface ScreenshotMeta {
  id: string;
  fileName: string;
  originalPath: string;
  localPath: string;
  uploadedAt: string;
  category?: string;
  description?: string;
  entities?: Record<string, unknown>;
  analyzed: boolean;
}

export interface Conversation {
  id: string;
  query: string;
  intent: string;
  response: string;
  timestamp: string;
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(RESPONSES_DIR, { recursive: true });
}

async function readJSON<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ── Screenshots ──

export async function getScreenshots(): Promise<ScreenshotMeta[]> {
  return readJSON<ScreenshotMeta[]>(SCREENSHOTS_META_PATH, []);
}

export async function saveScreenshot(meta: ScreenshotMeta): Promise<void> {
  const screenshots = await getScreenshots();
  screenshots.push(meta);
  await writeJSON(SCREENSHOTS_META_PATH, screenshots);
}

export async function updateScreenshot(id: string, updates: Partial<ScreenshotMeta>): Promise<void> {
  const screenshots = await getScreenshots();
  const index = screenshots.findIndex((s) => s.id === id);
  if (index !== -1) {
    screenshots[index] = { ...screenshots[index], ...updates };
    await writeJSON(SCREENSHOTS_META_PATH, screenshots);
  }
}

export async function getScreenshotsDir(): Promise<string> {
  await ensureDirs();
  return SCREENSHOTS_DIR;
}

// ── Profile ──

export async function getProfile(): Promise<Record<string, unknown>> {
  return readJSON<Record<string, unknown>>(PROFILE_PATH, {
    identity: {},
    music: { genres: [], favoriteArtists: [], preferredPlatform: null },
    travel: { interests: [], style: {} },
    general: {},
    totalScreenshots: 0,
    lastUpdated: null,
  });
}

export async function saveProfile(profile: Record<string, unknown>): Promise<void> {
  await writeJSON(PROFILE_PATH, profile);
}

// ── Conversations ──

export async function getConversations(): Promise<Conversation[]> {
  return readJSON<Conversation[]>(CONVERSATIONS_PATH, []);
}

export async function saveConversation(convo: Conversation): Promise<void> {
  const convos = await getConversations();
  convos.push(convo);
  await writeJSON(CONVERSATIONS_PATH, convos);
}

// ── Responses (HTML) ──

export function getResponsesDir(): string {
  return RESPONSES_DIR;
}

// ── Init ──

export async function initStore(): Promise<void> {
  await ensureDirs();
}

export { SCREENSHOTS_DIR, RESPONSES_DIR, DATA_DIR };
