// ══════════════════════════════════════════════════════════════
// KNOWLEDGE STORE — Vectra Vector Index
// ══════════════════════════════════════════════════════════════

import { LocalIndex } from "vectra";
import { getEmbedding, buildEmbeddingText } from "./embeddings.js";
import type { SemanticResult } from "./types.js";
import type { MetadataTypes } from "vectra/lib/types.js";

interface ScreenshotVectorMeta extends Record<string, MetadataTypes> {
  screenshot_id: string;
  category: string;
  source_app: string;
  uploaded_at: string;
  summary: string;
}

export class VectorStore {
  private index: LocalIndex<ScreenshotVectorMeta>;
  private ready = false;

  constructor(folderPath: string) {
    this.index = new LocalIndex<ScreenshotVectorMeta>(folderPath);
  }

  async init(): Promise<void> {
    const exists = await this.index.isIndexCreated();
    if (!exists) {
      await this.index.createIndex();
    }
    this.ready = true;
  }

  /**
   * Index a screenshot's content for semantic search.
   * Generates an embedding and upserts into the local vector index.
   */
  async indexScreenshot(
    screenshotId: string,
    opts: {
      summary?: string | null;
      detailedDescription?: string | null;
      sourceApp?: string | null;
      category?: string | null;
      uploadedAt?: string;
      entities?: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!this.ready) await this.init();

    const text = buildEmbeddingText(opts);
    if (!text) return;

    const vector = await getEmbedding(text);

    await this.index.upsertItem({
      id: screenshotId,
      vector,
      metadata: {
        screenshot_id: screenshotId,
        category: opts.category ?? "other",
        source_app: opts.sourceApp ?? "unknown",
        uploaded_at: opts.uploadedAt ?? new Date().toISOString(),
        summary: opts.summary ?? "",
      },
    });
  }

  /**
   * Semantic search across indexed screenshots.
   * Returns top results sorted by similarity score.
   */
  async semanticSearch(
    query: string,
    opts?: { category?: string; limit?: number }
  ): Promise<SemanticResult[]> {
    if (!this.ready) await this.init();

    const limit = opts?.limit ?? 5;
    const vector = await getEmbedding(query);

    const filter = opts?.category
      ? { category: { $eq: opts.category } }
      : undefined;

    const results = await this.index.queryItems<ScreenshotVectorMeta>(
      vector,
      query,
      limit,
      filter
    );

    return results.map((r) => ({
      screenshotId: r.item.metadata.screenshot_id,
      score: r.score,
      summary: r.item.metadata.summary || null,
      category: r.item.metadata.category || null,
      sourceApp: r.item.metadata.source_app || null,
    }));
  }

  /**
   * Delete a screenshot from the vector index.
   */
  async deleteScreenshot(screenshotId: string): Promise<void> {
    if (!this.ready) await this.init();
    await this.index.deleteItem(screenshotId);
  }
}
