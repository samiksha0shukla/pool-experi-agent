// ══════════════════════════════════════════════════════════════
// KNOWLEDGE STORE — Unified API
// ══════════════════════════════════════════════════════════════

import path from "path";
import fs from "fs/promises";
import { SQLiteStore } from "./sqlite.js";
import { VectorStore } from "./vectors.js";
import { KnowledgeGraph } from "./graph.js";
import type {
  ScreenshotMeta,
  ScreenshotRow,
  EntityRow,
  Fact,
  FactInput,
  ProfileKV,
  ConversationRow,
  SemanticResult,
  GraphNode,
  AgentContext,
  RelatedContent,
} from "./types.js";

export class KnowledgeStore {
  readonly sqlite: SQLiteStore;
  readonly vectors: VectorStore;
  readonly graph: KnowledgeGraph;
  private dataDir: string;
  private screenshotsDir: string;

  private constructor(
    dataDir: string,
    sqlite: SQLiteStore,
    vectors: VectorStore,
    graph: KnowledgeGraph
  ) {
    this.dataDir = dataDir;
    this.screenshotsDir = path.join(dataDir, "screenshots");
    this.sqlite = sqlite;
    this.vectors = vectors;
    this.graph = graph;
  }

  /** Create and initialize a KnowledgeStore instance. */
  static async create(dataDir: string): Promise<KnowledgeStore> {
    // Ensure directories exist
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(path.join(dataDir, "screenshots"), { recursive: true });
    await fs.mkdir(path.join(dataDir, "vectors"), { recursive: true });
    await fs.mkdir(path.join(dataDir, "responses"), { recursive: true });

    const sqlite = new SQLiteStore(path.join(dataDir, "pool.db"));
    const vectors = new VectorStore(path.join(dataDir, "vectors"));
    const graph = new KnowledgeGraph(path.join(dataDir, "graph.json"));

    await vectors.init();
    await graph.load();

    return new KnowledgeStore(dataDir, sqlite, vectors, graph);
  }

  close(): void {
    this.sqlite.close();
  }

  // ══════════════════════════════════════════════════════════
  // SCREENSHOTS (SQLite)
  // ══════════════════════════════════════════════════════════

  saveScreenshot(meta: ScreenshotMeta): void {
    this.sqlite.saveScreenshot(meta);
  }

  updateScreenshot(id: string, updates: Partial<ScreenshotMeta>): void {
    this.sqlite.updateScreenshot(id, updates);
  }

  getScreenshot(id: string): ScreenshotRow | null {
    return this.sqlite.getScreenshot(id);
  }

  getAllScreenshots(): ScreenshotRow[] {
    return this.sqlite.getAllScreenshots();
  }

  getScreenshotsByCategory(category: string): ScreenshotRow[] {
    return this.sqlite.getScreenshotsByCategory(category);
  }

  getAnalyzedScreenshots(): ScreenshotRow[] {
    return this.sqlite.getAnalyzedScreenshots();
  }

  getUnanalyzedScreenshots(): ScreenshotRow[] {
    return this.sqlite.getUnanalyzedScreenshots();
  }

  getScreenshotsDir(): string {
    return this.screenshotsDir;
  }

  getEntitiesByScreenshot(screenshotId: string): EntityRow[] {
    return this.sqlite.getEntitiesByScreenshot(screenshotId);
  }

  getEntitiesByType(entityType: string): EntityRow[] {
    return this.sqlite.getEntitiesByType(entityType);
  }

  // ══════════════════════════════════════════════════════════
  // FACTS (SQLite)
  // ══════════════════════════════════════════════════════════

  addFact(input: FactInput): void {
    this.sqlite.addFact(input);
  }

  reinforceFact(factType: string, factValue: string, source: string): void {
    this.sqlite.reinforceFact(factType, factValue, source);
  }

  getFactsByType(factType: string): Fact[] {
    return this.sqlite.getFactsByType(factType);
  }

  getTopFact(factType: string): string | null {
    return this.sqlite.getTopFact(factType);
  }

  getAllFacts(): Fact[] {
    return this.sqlite.getAllFacts();
  }

  // ══════════════════════════════════════════════════════════
  // PROFILE KV (SQLite)
  // ══════════════════════════════════════════════════════════

  setProfileValue(key: string, value: string, confidence = 1.0, sources?: string[]): void {
    this.sqlite.setProfileValue(key, value, confidence, sources);
  }

  getProfileValue(key: string): ProfileKV | null {
    return this.sqlite.getProfileValue(key);
  }

  getProfileSection(prefix: string): ProfileKV[] {
    return this.sqlite.getProfileSection(prefix);
  }

  getProfileMeta(): { version: number; totalScreenshots: number; lastUpdated: string } {
    return {
      version: parseInt(this.sqlite.getMeta("version") ?? "0", 10),
      totalScreenshots: parseInt(this.sqlite.getMeta("total_screenshots") ?? "0", 10),
      lastUpdated: this.sqlite.getMeta("last_updated") ?? "",
    };
  }

  incrementProfileVersion(): number {
    return this.sqlite.incrementProfileVersion();
  }

  // ══════════════════════════════════════════════════════════
  // CONVERSATIONS (SQLite)
  // ══════════════════════════════════════════════════════════

  saveConversation(convo: ConversationRow): void {
    this.sqlite.saveConversation(convo);
  }

  getRecentConversations(limit = 5): ConversationRow[] {
    return this.sqlite.getRecentConversations(limit);
  }

  // ══════════════════════════════════════════════════════════
  // VECTORS (Vectra)
  // ══════════════════════════════════════════════════════════

  async indexScreenshot(
    screenshotId: string,
    opts: {
      summary?: string | null;
      detailedDescription?: string | null;
      sourceApp?: string | null;
      category?: string | null;
      uploadedAt?: string;
      entities?: Record<string, unknown>;
      ocrText?: string | null;
    }
  ): Promise<void> {
    await this.vectors.indexScreenshot(screenshotId, opts);
  }

  async semanticSearch(
    query: string,
    opts?: { category?: string; limit?: number }
  ): Promise<SemanticResult[]> {
    return this.vectors.semanticSearch(query, opts);
  }

  // ══════════════════════════════════════════════════════════
  // GRAPH (Graphology)
  // ══════════════════════════════════════════════════════════

  addNode(id: string, type: string, attrs?: Record<string, unknown>): void {
    this.graph.addNode(id, type, attrs);
  }

  addEdge(from: string, to: string, type: string, attrs?: Record<string, unknown>): void {
    this.graph.addEdge(from, to, type, attrs);
  }

  getNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    return this.graph.getNeighbors(nodeId, edgeType);
  }

  getRelatedScreenshots(entityNodeId: string): string[] {
    return this.graph.getRelatedScreenshots(entityNodeId);
  }

  async persistGraph(): Promise<void> {
    await this.graph.persist();
  }

  // ══════════════════════════════════════════════════════════
  // COMPOSITE QUERIES (cross-backend)
  // ══════════════════════════════════════════════════════════

  /**
   * Assemble context for a specific agent type.
   * Each agent gets relevant facts, screenshots, entities, profile KV,
   * and optionally semantic matches and graph neighbors.
   */
  async getContextForAgent(
    intent: "music" | "travel" | "profile" | "general",
    query?: string
  ): Promise<AgentContext> {
    let facts: Fact[] = [];
    let screenshots: ScreenshotRow[] = [];
    let entities: EntityRow[] = [];
    let profileKV: ProfileKV[] = [];
    let semanticMatches: SemanticResult[] = [];
    let graphNeighbors: GraphNode[] = [];

    switch (intent) {
      case "music":
        facts = [
          ...this.sqlite.getFactsByType("liked_artist"),
          ...this.sqlite.getFactsByType("genre"),
          ...this.sqlite.getFactsByType("music_platform"),
          ...this.sqlite.getFactsByType("liked_song"),
        ];
        screenshots = this.sqlite.getScreenshotsByCategory("music");
        entities = [
          ...this.sqlite.getEntitiesByType("artists"),
          ...this.sqlite.getEntitiesByType("songs"),
          ...this.sqlite.getEntitiesByType("genres"),
          ...this.sqlite.getEntitiesByType("platform"),
          ...this.sqlite.getEntitiesByType("playlistName"),
          ...this.sqlite.getEntitiesByType("album"),
        ];
        profileKV = this.sqlite.getProfileSection("music.");
        graphNeighbors = this.graph.getUserConnections("LISTENS_TO");
        if (query) {
          semanticMatches = await this.vectors.semanticSearch(query, { category: "music", limit: 5 });
        }
        break;

      case "travel":
        facts = [
          ...this.sqlite.getFactsByType("travel_interest"),
          ...this.sqlite.getFactsByType("destination"),
          ...this.sqlite.getFactsByType("location"),
          ...this.sqlite.getFactsByType("home_city"),
        ];
        screenshots = this.sqlite.getScreenshotsByCategory("travel");
        entities = [
          ...this.sqlite.getEntitiesByType("destination"),
          ...this.sqlite.getEntitiesByType("hotel"),
          ...this.sqlite.getEntitiesByType("airline"),
          ...this.sqlite.getEntitiesByType("dates"),
          ...this.sqlite.getEntitiesByType("price"),
          ...this.sqlite.getEntitiesByType("activity"),
        ];
        profileKV = this.sqlite.getProfileSection("travel.");
        graphNeighbors = this.graph.getUserConnections("INTERESTED_IN");
        if (query) {
          semanticMatches = await this.vectors.semanticSearch(query, { category: "travel", limit: 5 });
        }
        break;

      case "profile":
        facts = this.sqlite.getAllFacts();
        screenshots = this.sqlite.getAllScreenshots();
        entities = this.sqlite.getAllEntities();
        profileKV = this.sqlite.getAllProfileKV();
        break;

      case "general":
        facts = [
          ...this.sqlite.getFactsByType("name"),
          ...this.sqlite.getFactsByType("location"),
          ...this.sqlite.getFactsByType("language"),
          ...this.sqlite.getFactsByType("food_preference"),
        ];
        profileKV = [
          ...this.sqlite.getProfileSection("general."),
          ...this.sqlite.getProfileSection("identity."),
        ];
        if (query) {
          semanticMatches = await this.vectors.semanticSearch(query, { limit: 5 });
        }
        break;
    }

    return { facts, screenshots, entities, profileKV, semanticMatches, graphNeighbors };
  }

  /**
   * Find content related to a query across all backends.
   */
  async findRelatedContent(query: string, category?: string): Promise<RelatedContent> {
    const opts: { category?: string; limit?: number } = { limit: 5 };
    if (category) opts.category = category;
    const semanticResults = await this.vectors.semanticSearch(query, opts);

    // Find graph connections for entities mentioned in top results
    const graphConnections: GraphNode[] = [];
    for (const result of semanticResults) {
      const entities = this.sqlite.getEntitiesByScreenshot(result.screenshotId);
      for (const entity of entities) {
        const nodeId = `${entity.entity_type}:${entity.entity_value.toLowerCase()}`;
        const neighbors = this.graph.getNeighbors(nodeId);
        graphConnections.push(...neighbors);
      }
    }

    // Find related facts
    const relatedFacts: Fact[] = [];
    for (const result of semanticResults) {
      const entities = this.sqlite.getEntitiesByScreenshot(result.screenshotId);
      for (const entity of entities) {
        const facts = this.sqlite.getFactsByType(entity.entity_type);
        relatedFacts.push(...facts);
      }
    }

    // Deduplicate
    const seenFacts = new Set<number>();
    const uniqueFacts = relatedFacts.filter((f) => {
      if (seenFacts.has(f.id)) return false;
      seenFacts.add(f.id);
      return true;
    });

    const seenNodes = new Set<string>();
    const uniqueConnections = graphConnections.filter((n) => {
      if (seenNodes.has(n.id)) return false;
      seenNodes.add(n.id);
      return true;
    });

    return {
      semanticResults,
      graphConnections: uniqueConnections,
      relatedFacts: uniqueFacts,
    };
  }

  // ══════════════════════════════════════════════════════════
  // MISC
  // ══════════════════════════════════════════════════════════

  getResponsesDir(): string {
    return path.join(this.dataDir, "responses");
  }

  getDataDir(): string {
    return this.dataDir;
  }
}

// Re-export types for convenience
export type {
  ScreenshotMeta,
  ScreenshotRow,
  EntityRow,
  Fact,
  FactInput,
  ProfileKV,
  ConversationRow,
  SemanticResult,
  GraphNode,
  AgentContext,
  RelatedContent,
} from "./types.js";
