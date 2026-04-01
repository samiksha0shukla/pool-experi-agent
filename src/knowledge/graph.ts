// ══════════════════════════════════════════════════════════════
// KNOWLEDGE STORE — Graphology Knowledge Graph
// ══════════════════════════════════════════════════════════════

import GraphDefault from "graphology";
import fs from "fs/promises";
import type { GraphNode } from "./types.js";

// Handle CJS/ESM interop — graphology may export default differently
const Graph = (GraphDefault as any).default ?? GraphDefault;

interface NodeAttrs {
  type: string;
  [key: string]: unknown;
}

interface EdgeAttrs {
  type: string;
  [key: string]: unknown;
}

export class KnowledgeGraph {
  private graph: any;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.graph = new Graph({ multi: false, type: "directed" });
  }

  /** Load graph from disk, or start fresh if file doesn't exist. */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, "utf-8");
      const serialized = JSON.parse(data);
      this.graph = Graph.from(serialized);
    } catch {
      // File doesn't exist or is invalid — start fresh
      this.graph = new Graph({ multi: false, type: "directed" });
      this.ensureUserNode();
    }
  }

  /** Persist graph to disk as JSON. */
  async persist(): Promise<void> {
    const serialized = this.graph.export();
    await fs.writeFile(this.filePath, JSON.stringify(serialized, null, 2), "utf-8");
  }

  /** Ensure the central user node exists. */
  private ensureUserNode(): void {
    if (!this.graph.hasNode("user:self")) {
      this.graph.addNode("user:self", { type: "user" });
    }
  }

  // ── Node Operations ──────────────────────────────────────

  addNode(id: string, type: string, attrs?: Record<string, unknown>): void {
    if (this.graph.hasNode(id)) {
      this.graph.mergeNodeAttributes(id, { type, ...attrs });
    } else {
      this.graph.addNode(id, { type, ...attrs });
    }
  }

  hasNode(id: string): boolean {
    return this.graph.hasNode(id);
  }

  getNode(id: string): GraphNode | null {
    if (!this.graph.hasNode(id)) return null;
    const attrs = this.graph.getNodeAttributes(id);
    return { id, type: attrs.type, attrs };
  }

  // ── Edge Operations ──────────────────────────────────────

  addEdge(from: string, to: string, type: string, attrs?: Record<string, unknown>): void {
    // Ensure both nodes exist
    if (!this.graph.hasNode(from)) return;
    if (!this.graph.hasNode(to)) return;

    const edgeKey = `${from}->${type}->${to}`;
    if (this.graph.hasEdge(edgeKey)) {
      this.graph.mergeEdgeAttributes(edgeKey, { type, ...attrs });
    } else {
      this.graph.addEdgeWithKey(edgeKey, from, to, { type, ...attrs });
    }
  }

  hasEdge(from: string, to: string, type: string): boolean {
    const edgeKey = `${from}->${type}->${to}`;
    return this.graph.hasEdge(edgeKey);
  }

  // ── Query Operations ─────────────────────────────────────

  /** Get all neighbors of a node, optionally filtered by edge type. */
  getNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    if (!this.graph.hasNode(nodeId)) return [];

    const neighbors: GraphNode[] = [];
    this.graph.forEachOutEdge(nodeId, (_edge: any, edgeAttrs: any, _source: any, target: any, _sourceAttrs: any, targetAttrs: any) => {
      if (edgeType && edgeAttrs.type !== edgeType) return;
      neighbors.push({
        id: target,
        type: targetAttrs.type,
        attrs: targetAttrs,
      });
    });

    // Also check incoming edges
    this.graph.forEachInEdge(nodeId, (_edge: any, edgeAttrs: any, source: any, _target: any, sourceAttrs: any) => {
      if (edgeType && edgeAttrs.type !== edgeType) return;
      neighbors.push({
        id: source,
        type: sourceAttrs.type,
        attrs: sourceAttrs,
      });
    });

    return neighbors;
  }

  /** Get all screenshot IDs related to an entity value. */
  getRelatedScreenshots(entityNodeId: string): string[] {
    if (!this.graph.hasNode(entityNodeId)) return [];

    const screenshotIds: string[] = [];

    // Find screenshots that CONTAIN this entity
    this.graph.forEachInEdge(entityNodeId, (_edge: any, edgeAttrs: any, source: any, _target: any, sourceAttrs: any) => {
      if (edgeAttrs.type === "CONTAINS" && sourceAttrs.type === "screenshot") {
        screenshotIds.push(source);
      }
    });

    return screenshotIds;
  }

  /** Get all entities the user is connected to. */
  getUserConnections(edgeType?: string): GraphNode[] {
    return this.getNeighbors("user:self", edgeType);
  }

  /** Get all nodes of a specific type. */
  getNodesByType(type: string): GraphNode[] {
    const nodes: GraphNode[] = [];
    this.graph.forEachNode((id: any, attrs: any) => {
      if (attrs.type === type) {
        nodes.push({ id, type: attrs.type, attrs });
      }
    });
    return nodes;
  }

  // ── Graph Building Helpers ───────────────────────────────

  /** Add a screenshot and its relationship to the user. */
  addScreenshot(screenshotId: string, attrs?: Record<string, unknown>): void {
    const nodeId = `ss:${screenshotId}`;
    this.addNode(nodeId, "screenshot", attrs);
    this.ensureUserNode();
    this.addEdge("user:self", nodeId, "UPLOADED");
  }

  /** Add an entity extracted from a screenshot. */
  addEntityFromScreenshot(
    screenshotId: string,
    entityType: string,
    entityValue: string,
    attrs?: Record<string, unknown>
  ): void {
    const entityNodeId = `${entityType}:${entityValue.toLowerCase()}`;
    const ssNodeId = `ss:${screenshotId}`;

    this.addNode(entityNodeId, entityType, { name: entityValue, ...attrs });

    // Screenshot CONTAINS entity
    if (this.hasNode(ssNodeId)) {
      this.addEdge(ssNodeId, entityNodeId, "CONTAINS");
    }

    // User relationship based on entity type
    this.ensureUserNode();
    const userEdgeMap: Record<string, string> = {
      artist: "LISTENS_TO",
      destination: "INTERESTED_IN",
      genre: "PREFERS",
      platform: "PREFERS",
      cuisine: "PREFERS",
    };

    const userEdgeType = userEdgeMap[entityType];
    if (userEdgeType) {
      this.addEdge("user:self", entityNodeId, userEdgeType);
    }
  }

  /** Add relationship between entities (e.g., song → artist, artist → genre). */
  addEntityRelation(
    fromType: string,
    fromValue: string,
    toType: string,
    toValue: string,
    edgeType: string
  ): void {
    const fromId = `${fromType}:${fromValue.toLowerCase()}`;
    const toId = `${toType}:${toValue.toLowerCase()}`;

    this.addNode(fromId, fromType, { name: fromValue });
    this.addNode(toId, toType, { name: toValue });
    this.addEdge(fromId, toId, edgeType);
  }

  // ── Stats ────────────────────────────────────────────────

  get nodeCount(): number {
    return this.graph.order;
  }

  get edgeCount(): number {
    return this.graph.size;
  }
}
