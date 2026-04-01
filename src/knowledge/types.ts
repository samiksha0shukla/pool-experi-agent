// ══════════════════════════════════════════════════════════════
// KNOWLEDGE STORE — Shared Types
// ══════════════════════════════════════════════════════════════

/** Input for adding a new fact to the store */
export interface FactInput {
  factType: string;
  factValue: string;
  confidence: number;
  source: string;       // screenshot_id or "conversation"
  evidence?: string;
}

/** A fact row from SQLite (column names match DB snake_case) */
export interface Fact {
  id: number;
  fact_type: string;
  fact_value: string;
  confidence: number;
  source: string;
  evidence: string | null;
  created_at: string;
  updated_at: string;
}

/** A profile key-value entry from SQLite (column names match DB snake_case) */
export interface ProfileKV {
  key: string;
  value: string;
  confidence: number;
  sources_json: string | null;
  updated_at: string;
}

/** A screenshot metadata row from SQLite (column names match DB snake_case) */
export interface ScreenshotRow {
  id: string;
  file_name: string;
  original_path: string;
  local_path: string;
  uploaded_at: string;
  file_size_kb: number;
  analyzed: number;       // 0 or 1 (SQLite boolean)
  analyzed_at: string | null;
  source_app: string | null;
  category: string | null;
  summary: string | null;
  detailed_description: string | null;
  ocr_text: string | null;
}

/** An entity row from SQLite (column names match DB snake_case) */
export interface EntityRow {
  id: number;
  screenshot_id: string;
  entity_type: string;
  entity_value: string;
  extra_json: string | null;
}

/** A conversation row from SQLite */
export interface ConversationRow {
  id: string;
  query: string;
  intent: string;
  response: string;
  timestamp: string;
}

/** Result from Vectra semantic search */
export interface SemanticResult {
  screenshotId: string;
  score: number;
  summary: string | null;
  category: string | null;
  sourceApp: string | null;
}

/** A graph node with its attributes */
export interface GraphNode {
  id: string;
  type: string;
  attrs: Record<string, unknown>;
}

/** Context assembled for an agent */
export interface AgentContext {
  facts: Fact[];
  screenshots: ScreenshotRow[];
  entities: EntityRow[];
  profileKV: ProfileKV[];
  semanticMatches: SemanticResult[];
  graphNeighbors: GraphNode[];
}

/** Result from cross-backend content search */
export interface RelatedContent {
  semanticResults: SemanticResult[];
  graphConnections: GraphNode[];
  relatedFacts: Fact[];
}

/** Screenshot metadata as used during ingestion (superset for compatibility) */
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
  ocrText?: string;
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
