import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");
const SCREENSHOTS_META_DIR = path.join(DATA_DIR, "screenshots", "meta");
const RESPONSES_DIR = path.join(DATA_DIR, "responses");
const PROFILE_PATH = path.join(DATA_DIR, "profile.json");
const SCREENSHOTS_INDEX_PATH = path.join(DATA_DIR, "screenshots.json");
const CONVERSATIONS_PATH = path.join(DATA_DIR, "conversations.json");

// ══════════════════════════════════════════════════════════════
// SCREENSHOT METADATA
// ══════════════════════════════════════════════════════════════

export interface ScreenshotMeta {
  id: string;
  fileName: string;
  originalPath: string;
  localPath: string;
  uploadedAt: string;
  fileSizeKB: number;

  analyzed: boolean;
  analyzedAt?: string;
  sourceApp?: string;
  category?: string;
  summary?: string;
  detailedDescription?: string;
  entities?: {
    platform?: string;
    songs?: Array<{ title: string; artist: string }>;
    artists?: string[];
    album?: string;
    playlistName?: string;
    genres?: string[];
    destination?: string;
    hotel?: string;
    airline?: string;
    dates?: string;
    price?: string;
    activity?: string;
    restaurant?: string;
    cuisine?: string;
    [key: string]: unknown;
  };
  userFacts?: Array<{
    fact: string;
    value: string;
    evidence: string;
    confidence: number;
  }>;
}

// ══════════════════════════════════════════════════════════════
// USER PROFILE — matches AGENT_V1_ARCHITECTURE.md exactly
// ══════════════════════════════════════════════════════════════

export interface ProfileFact {
  value: string;
  confidence: number;
  sources: string[];       // screenshot IDs or "conversation"
  evidence: string;
}

export interface GenreEntry {
  genre: string;
  strength: number;        // 0-1, increases with more evidence
  artistCount: number;
}

export interface ArtistEntry {
  name: string;
  mentions: number;
  sources: string[];
}

export interface SongEntry {
  title: string;
  artist: string;
  source: string;
}

export interface PlaylistEntry {
  name: string;
  platform: string;
  source: string;
}

export interface ListeningPatterns {
  moodPreference: string | null;        // "chill, introspective"
  energyLevel: string | null;           // "low-to-medium"
  languages: string[];                  // ["English", "Hindi"]
  contextPreferences: Record<string, string>;  // { working: "lo-fi" }
}

export interface TravelDetails {
  hotelsSaved: string[];
  activitiesSaved: string[];
  foodSaved: string[];
  datesDetected: string[];
  budgetSignals: string[];
}

export interface TravelInterest {
  destination: string;
  strength: number;
  screenshotCount: number;
  lastSeen: string;
  details: TravelDetails;
}

export interface TravelStyle {
  accommodation: string | null;
  food: string | null;
  activities: string | null;
  pace: string | null;
  budget: string | null;
}

export interface UserProfile {
  // ── Identity ──
  identity: {
    name?: ProfileFact;
    location?: ProfileFact;
    [key: string]: ProfileFact | undefined;
  };

  // ── Music ──
  music: {
    preferredPlatform: ProfileFact | null;
    genres: GenreEntry[];
    favoriteArtists: ArtistEntry[];
    likedSongs: SongEntry[];
    playlistsSeen: PlaylistEntry[];
    listeningPatterns: ListeningPatterns;
  };

  // ── Travel ──
  travel: {
    interests: TravelInterest[];
    style: TravelStyle;
  };

  // ── General ──
  general: {
    personalitySignals: string[];
    language: string | null;
    foodPreferences: string[];
    budgetStyle: string | null;
  };

  // ── Meta ──
  totalScreenshots: number;
  lastUpdated: string | null;
  profileVersion: number;
}

const DEFAULT_PROFILE: UserProfile = {
  identity: {},
  music: {
    preferredPlatform: null,
    genres: [],
    favoriteArtists: [],
    likedSongs: [],
    playlistsSeen: [],
    listeningPatterns: {
      moodPreference: null,
      energyLevel: null,
      languages: [],
      contextPreferences: {},
    },
  },
  travel: {
    interests: [],
    style: {
      accommodation: null,
      food: null,
      activities: null,
      pace: null,
      budget: null,
    },
  },
  general: {
    personalitySignals: [],
    language: null,
    foodPreferences: [],
    budgetStyle: null,
  },
  totalScreenshots: 0,
  lastUpdated: null,
  profileVersion: 0,
};

// ══════════════════════════════════════════════════════════════
// CONVERSATION
// ══════════════════════════════════════════════════════════════

export interface Conversation {
  id: string;
  query: string;
  intent: string;
  response: string;
  timestamp: string;
}

// ══════════════════════════════════════════════════════════════
// JSON HELPERS
// ══════════════════════════════════════════════════════════════

async function ensureDirs(): Promise<void> {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOTS_META_DIR, { recursive: true });
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

// ══════════════════════════════════════════════════════════════
// SCREENSHOTS STORE
// ══════════════════════════════════════════════════════════════

export async function getScreenshots(): Promise<ScreenshotMeta[]> {
  return readJSON<ScreenshotMeta[]>(SCREENSHOTS_INDEX_PATH, []);
}

export async function saveScreenshot(meta: ScreenshotMeta): Promise<void> {
  const screenshots = await getScreenshots();
  screenshots.push(meta);
  await writeJSON(SCREENSHOTS_INDEX_PATH, screenshots);
  await writeScreenshotMeta(meta);
}

export async function updateScreenshot(id: string, updates: Partial<ScreenshotMeta>): Promise<void> {
  const screenshots = await getScreenshots();
  const index = screenshots.findIndex((s) => s.id === id);
  if (index === -1) return;
  screenshots[index] = { ...screenshots[index], ...updates };
  await writeJSON(SCREENSHOTS_INDEX_PATH, screenshots);
  await writeScreenshotMeta(screenshots[index]);
}

async function writeScreenshotMeta(meta: ScreenshotMeta): Promise<void> {
  await ensureDirs();
  const metaPath = path.join(SCREENSHOTS_META_DIR, `${meta.id}.json`);
  await writeJSON(metaPath, meta);
}

export async function getScreenshotMeta(id: string): Promise<ScreenshotMeta | null> {
  const metaPath = path.join(SCREENSHOTS_META_DIR, `${id}.json`);
  try {
    const data = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(data) as ScreenshotMeta;
  } catch {
    return null;
  }
}

export async function getScreenshotsDir(): Promise<string> {
  await ensureDirs();
  return SCREENSHOTS_DIR;
}

// ══════════════════════════════════════════════════════════════
// PROFILE STORE
// ══════════════════════════════════════════════════════════════

export async function getProfile(): Promise<UserProfile> {
  const raw = await readJSON<Partial<UserProfile>>(PROFILE_PATH, {});
  // Deep merge with defaults so missing fields get filled
  return mergeWithDefaults(raw);
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await writeJSON(PROFILE_PATH, profile);
}

function mergeWithDefaults(raw: Partial<UserProfile>): UserProfile {
  const d = DEFAULT_PROFILE;
  return {
    identity: raw.identity ?? { ...d.identity },
    music: {
      preferredPlatform: raw.music?.preferredPlatform ?? d.music.preferredPlatform,
      genres: raw.music?.genres ?? [...d.music.genres],
      favoriteArtists: raw.music?.favoriteArtists ?? [...d.music.favoriteArtists],
      likedSongs: raw.music?.likedSongs ?? [...d.music.likedSongs],
      playlistsSeen: raw.music?.playlistsSeen ?? [...d.music.playlistsSeen],
      listeningPatterns: {
        moodPreference: raw.music?.listeningPatterns?.moodPreference ?? d.music.listeningPatterns.moodPreference,
        energyLevel: raw.music?.listeningPatterns?.energyLevel ?? d.music.listeningPatterns.energyLevel,
        languages: raw.music?.listeningPatterns?.languages ?? [...d.music.listeningPatterns.languages],
        contextPreferences: raw.music?.listeningPatterns?.contextPreferences ?? { ...d.music.listeningPatterns.contextPreferences },
      },
    },
    travel: {
      interests: raw.travel?.interests ?? [...d.travel.interests],
      style: {
        accommodation: raw.travel?.style?.accommodation ?? d.travel.style.accommodation,
        food: raw.travel?.style?.food ?? d.travel.style.food,
        activities: raw.travel?.style?.activities ?? d.travel.style.activities,
        pace: raw.travel?.style?.pace ?? d.travel.style.pace,
        budget: raw.travel?.style?.budget ?? d.travel.style.budget,
      },
    },
    general: {
      personalitySignals: raw.general?.personalitySignals ?? [...d.general.personalitySignals],
      language: raw.general?.language ?? d.general.language,
      foodPreferences: raw.general?.foodPreferences ?? [...d.general.foodPreferences],
      budgetStyle: raw.general?.budgetStyle ?? d.general.budgetStyle,
    },
    totalScreenshots: raw.totalScreenshots ?? d.totalScreenshots,
    lastUpdated: raw.lastUpdated ?? d.lastUpdated,
    profileVersion: raw.profileVersion ?? d.profileVersion,
  };
}

// ══════════════════════════════════════════════════════════════
// CONVERSATIONS STORE
// ══════════════════════════════════════════════════════════════

export async function getConversations(): Promise<Conversation[]> {
  return readJSON<Conversation[]>(CONVERSATIONS_PATH, []);
}

export async function saveConversation(convo: Conversation): Promise<void> {
  const convos = await getConversations();
  convos.push(convo);
  await writeJSON(CONVERSATIONS_PATH, convos);
}

export async function getRecentConversations(limit = 5): Promise<Conversation[]> {
  const convos = await getConversations();
  return convos.slice(-limit);
}

// ══════════════════════════════════════════════════════════════
// MISC
// ══════════════════════════════════════════════════════════════

export function getResponsesDir(): string {
  return RESPONSES_DIR;
}

export async function initStore(): Promise<void> {
  await ensureDirs();
}

export { SCREENSHOTS_DIR, SCREENSHOTS_META_DIR, RESPONSES_DIR, DATA_DIR };
