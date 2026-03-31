import { generateText as aiGenerateText, generateObject, type CoreTool } from "ai";
import { google } from "@ai-sdk/google";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const MODEL_ID = "gemini-2.0-flash";

function checkApiKey() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY not set.\n\n" +
        "Create a .env file with:\n" +
        "  GOOGLE_GENERATIVE_AI_API_KEY=your_key_here\n\n" +
        "Get a key at: https://aistudio.google.com/apikey"
    );
  }
}

function getModel() {
  checkApiKey();
  return google(MODEL_ID);
}

function getSearchModel() {
  checkApiKey();
  return google(MODEL_ID, { useSearchGrounding: true });
}

// ── Message type for conversation history ──

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Date injection — every LLM call gets the real date ──

function withDate(systemPrompt: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `CURRENT DATE: Today is ${dateStr}. Tomorrow is ${tomorrowStr}.\n\n${systemPrompt}`;
}

// ── Text generation (with optional conversation history) ──

export async function generateText(
  systemPrompt: string,
  userMessage: string,
  history?: ChatMessage[]
): Promise<string> {
  const system = withDate(systemPrompt);

  if (history && history.length > 0) {
    const messages = [
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: userMessage },
    ];
    const { text } = await aiGenerateText({
      model: getModel(),
      system,
      messages,
    });
    return text;
  }

  const { text } = await aiGenerateText({
    model: getModel(),
    system,
    prompt: userMessage,
  });
  return text;
}

// ── Vision analysis (image → text) ──

export async function analyzeImage(
  imagePath: string,
  prompt: string
): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
  };
  const mimeType = mimeMap[ext] || "image/jpeg";

  const { text } = await aiGenerateText({
    model: getModel(),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: imageBuffer, mimeType },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  return text;
}

// ── Vision analysis (image → structured JSON) ──

export async function analyzeImageJSON<T>(
  imagePath: string,
  prompt: string,
  schema: z.ZodType<T>
): Promise<T> {
  const imageBuffer = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
  };
  const mimeType = mimeMap[ext] || "image/jpeg";

  const { object } = await generateObject({
    model: getModel(),
    schema,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: imageBuffer, mimeType },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  return object;
}

// ── Text → structured JSON ──

export async function generateJSON<T>(
  systemPrompt: string,
  userMessage: string,
  schema: z.ZodType<T>
): Promise<T> {
  const { object } = await generateObject({
    model: getModel(),
    system: withDate(systemPrompt),
    prompt: userMessage,
    schema,
  });
  return object;
}

// ── Text generation with Google Search grounding (real-time data) ──

export async function generateTextWithSearch(
  systemPrompt: string,
  userMessage: string,
  history?: ChatMessage[]
): Promise<string> {
  const system = withDate(systemPrompt);

  if (history && history.length > 0) {
    const messages = [
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: userMessage },
    ];
    const { text } = await aiGenerateText({
      model: getSearchModel(),
      system,
      messages,
    });
    return text;
  }

  const { text } = await aiGenerateText({
    model: getSearchModel(),
    system,
    prompt: userMessage,
  });
  return text;
}

// ── Text generation with tool calling ──

export async function generateTextWithTools(
  systemPrompt: string,
  userMessage: string,
  tools: Record<string, CoreTool>,
  history?: ChatMessage[],
  maxSteps = 5
): Promise<string> {
  const system = withDate(systemPrompt);
  const messages = history
    ? [
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: userMessage },
      ]
    : [{ role: "user" as const, content: userMessage }];

  const { text } = await aiGenerateText({
    model: getModel(),
    system,
    tools,
    maxSteps,
    messages,
  });
  return text;
}

// ── Check if API key is configured ──

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}
