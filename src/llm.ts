import { generateText as aiGenerateText, generateObject } from "ai";
import { google } from "@ai-sdk/google";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const MODEL_ID = "gemini-2.0-flash";

function getModel() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY not set.\n\n" +
        "Create a .env file with:\n" +
        "  GOOGLE_GENERATIVE_AI_API_KEY=your_key_here\n\n" +
        "Get a key at: https://aistudio.google.com/apikey"
    );
  }
  return google(MODEL_ID);
}

// ── Text generation ──

export async function generateText(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const { text } = await aiGenerateText({
    model: getModel(),
    system: systemPrompt,
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
    system: systemPrompt,
    prompt: userMessage,
    schema,
  });
  return object;
}

// ── Check if API key is configured ──

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}
