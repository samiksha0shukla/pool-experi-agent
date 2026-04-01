// ══════════════════════════════════════════════════════════════
// KNOWLEDGE STORE — Gemini Embeddings
// ══════════════════════════════════════════════════════════════

import { embed } from "ai";
import { google } from "@ai-sdk/google";

const EMBEDDING_MODEL = google.textEmbeddingModel("gemini-embedding-2-preview");

/**
 * Generate a vector embedding for a text string using Gemini text-embedding-004.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: text,
  });
  return embedding;
}

/**
 * Build the text to embed for a screenshot.
 * Concatenates summary, description, app, category, and entity key-value pairs.
 */
export function buildEmbeddingText(opts: {
  summary?: string | null;
  detailedDescription?: string | null;
  sourceApp?: string | null;
  category?: string | null;
  entities?: Record<string, unknown>;
  ocrText?: string | null;
}): string {
  const parts: string[] = [];

  if (opts.summary) parts.push(opts.summary);
  if (opts.detailedDescription) parts.push(opts.detailedDescription);
  if (opts.sourceApp) parts.push(`App: ${opts.sourceApp}`);
  if (opts.category) parts.push(`Category: ${opts.category}`);

  if (opts.entities) {
    for (const [key, val] of Object.entries(opts.entities)) {
      if (val == null) continue;
      if (typeof val === "string") {
        parts.push(`${key}: ${val}`);
      } else if (Array.isArray(val)) {
        const items = val.map((v) =>
          typeof v === "string" ? v : JSON.stringify(v)
        );
        parts.push(`${key}: ${items.join(", ")}`);
      }
    }
  }

  // Include OCR text (truncated to avoid hitting embedding token limits)
  if (opts.ocrText) {
    const truncated = opts.ocrText.length > 2000
      ? opts.ocrText.slice(0, 2000) + "..."
      : opts.ocrText;
    parts.push(`Visible text: ${truncated}`);
  }

  return parts.join(". ");
}
