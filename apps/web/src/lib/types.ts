export type Components = {
  taste: number | null;
  overlap: number | null;
  local: number | null;
  momentum: number | null;
  sponsor: number | null;
};

export type Metrics = {
  taste_rank?: number | null;
  taste_n?: number | null;
  taste_affinity?: number | null;
  taste_top_pct?: number | null;
  overlap_shared?: number | null;
  overlap_of?: number | null;
  overlap_pct?: number | null;
  local_affinity_rank?: number | null;
  local_top_pct?: number | null;
  local_city?: string | null;
  momentum_rel?: number | null;
  momentum_pct?: number | null;
  sponsor_findings?: number | null;
  momentum_flat?: boolean;
  popularity_pctl?: number | null;
};

export type Why = { text: string; evidence: string; source?: string };

export type SharedTaste = { tag_id: string; name: string; crowd: number; brand: number };

export type Overlap = {
  available?: boolean;
  reason?: string;
  shared_count?: number;
  of?: number;
  ratio?: number;
  shared?: SharedTaste[];
  crowd_top?: { tag_id: string; name: string; count: number }[];
  brand_top?: { tag_id: string; name: string; count: number }[];
  brand_fan_artists?: { id: string; name: string; affinity?: number }[];
};

export type Local = {
  available?: boolean;
  city?: string | null;
  city_affinity_rank?: number;
  top_pct?: number;
  national_hotspots?: { area: string; affinity_rank: number }[];
  address?: string;
};

export type Trend = {
  available?: boolean;
  flat?: boolean;
  points?: number;
  level?: number;
  rel_change?: number | null;
  series?: { d: string; v: number }[];
};

export type SponsorActivity = {
  status?: string;
  summary?: string;
  count?: number;
  findings?: { event: string; year: string; kind: string; source_title: string; source_domain: string; url: string }[];
  partnerships_page?: string | null;
  citations?: { title: string; url: string }[];
};

export type BrandMatch = {
  id: string;
  qloo_entity_id: string;
  name: string;
  category: string;
  category_key: string;
  logo_url?: string | null;
  description?: string | null;
  shelf: "natural" | "hidden" | "local" | "check";
  fit: number;
  components: Components;
  metrics: Metrics;
  why: Why[];
  overlap: Overlap;
  local: Local;
  trend: Trend;
  sponsor_activity: SponsorActivity;
  start_here: { activation?: string; reason?: string; partnerships_page?: string };
  saved?: boolean;
  hidden?: boolean;
  is_existing?: boolean;
  verdict?: string;
  verdict_reasons?: string[];
};

export type Candidate = {
  qloo_entity_id: string;
  name: string;
  source: "discovered" | "user";
  logo_url?: string | null;
  category_key?: string;
  excluded_reason?: string | null;
};

export type RankingRow = {
  qloo_entity_id: string;
  name: string;
  source: string;
  logo_url?: string | null;
  category_key: string;
  rank_position: number | null;
  rank_score: number | null;
  metrics: Metrics;
  components: Components;
  slot_score: number;
  shared: string[];
};

export type Slot = {
  id: string;
  event_id: string;
  name: string;
  category_key: string;
  tier_label?: string | null;
  order: number;
  candidates: Candidate[];
  ranking: RankingRow[];
  winner_id?: string | null;
  too_close: boolean;
  margin?: number | null;
  rationale: { bullets?: Why[] };
  ranked_without_qloo_rank?: boolean;
  ranked_at?: string | null;
};

export type FingerprintItem = { id: string; name: string; affinity?: number | null; image?: string | null; description?: string | null };

export type CrowdProfile = {
  fingerprint: Record<string, FingerprintItem[]>;
  demographics: { age?: Record<string, number>; gender?: Record<string, number>; note?: string };
  tags: { id: string; name: string; count: number; kind: string }[];
  summary?: string | null;
  evidence?: { cited_ids?: string[]; signals?: { id: string; name: string; type?: string }[] };
};

export type CrowdSignal = {
  id: string;
  raw_text: string;
  qloo_entity_id?: string | null;
  entity_type?: string | null;
  display_name?: string | null;
  image_url?: string | null;
  status: string;
};

export type Run = {
  id: string;
  event_id: string;
  status: "running" | "done" | "error" | "interrupted";
  stage: number;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
};

export type EventFull = {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  type_label: string;
  city?: string | null;
  country?: string | null;
  dates?: string | null;
  attendance?: number | null;
  age_bands: string[];
  exclude_categories: string[];
  existing_sponsors: string[];
  is_sample: boolean;
  tagline?: string | null;
  latest_run_id?: string | null;
  editable: boolean;
  crowd_signals: CrowdSignal[];
  run: Run | null;
  last_run: Run | null;
  crowd: CrowdProfile | null;
  matches: BrandMatch[];
  slots: Slot[];
  checks: BrandMatch[];
  llm_only: { suggestions: { brand: string; category: string; reason: string }[]; model?: string } | null;
  top_brands: { name: string; logo_url?: string | null; fit: number }[];
  signals: string[];
};

export type EventCard = Pick<
  EventFull,
  "id" | "name" | "type" | "type_label" | "city" | "attendance" | "is_sample" | "tagline" | "top_brands" | "signals" | "latest_run_id" | "dates"
>;

export type RunEvt = {
  seq: number;
  stage: number;
  kind: "stage_start" | "tool_call" | "tool_result" | "insight" | "partial" | "stage_done" | "error" | "done" | "result" | "progress" | "warning";
  tool?: string;
  summary: string;
  data?: unknown;
  ts?: number;
};

export type ResolveResult = {
  status: "resolved" | "needs_input" | "unmatched" | "error";
  candidates: { id: string; name: string; type?: string | null; popularity?: number | null; description?: string | null; image?: string | null; release_year?: number | null }[];
  message?: string;
};
