export interface RetrievedCitation {
  id: string;
  source: string;
  format: string;
  section: string;
  source_type: string;
  text: string;
  ingested_at: string;
  similarity: number;
}

export interface FarmContext {
  farm_name: string;
  region: string;
  latitude: number;
  longitude: number;
  farm_size_ha: number;
  primary_crops: string;
  soil_type: string;
  soil_ph: number;
  irrigation_type: string;
  currency: string;
}

export type FlowUiMode = "default" | "whatsapp_buttons" | "whatsapp_list";

export interface SessionFlowState {
  mode:
    | "idle"
    | "register"
    | "about"
    | "topics_hub"
    | "faq"
    | "crop_flow"
    | "smart_advisor"
    | "general_ai";
  step?: string;
  crop_submode?: "problem" | "guide";
  category_filter?: string;
  category_page?: number;
  faq_page?: number;
  pending_general_topic_id?: string;
  gov_region_id?: string;
  pending_fuzzy_governorate?: string;
  pending_fuzzy_detail?: string;
  pending_fuzzy_plant_id?: string;
  return_to_review?: boolean;
  selected_plant_id?: string;
  selected_plant_name?: string;
  is_other_plant?: boolean;
  advisor_context?: {
    accumulated_notes: string[];
    turns_asked: number;
    recommended_plant_ids?: string[];
  };
}

export interface EvaluationMetricsOverview {
  active_users_count: number;
  total_messages_count: number;
  voice_messages_count: number;
  registered_farms_count: number;
  satisfaction_rate_pct: number;
  total_ratings: number;
  thumbs_up: number;
  thumbs_down: number;
  retention_rate_pct: number;
  retained_users_count: number;
  avg_latency_ms: number;
  channels_breakdown: {
    whatsapp: number;
    messenger: number;
    widget: number;
  };
}

export interface ChatMessageRecord {
  message_id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  citations: RetrievedCitation[];
  latency_ms: number;
  model_used?: string;
  quick_replies?: string[];
  ui_mode?: FlowUiMode;
  image_base64?: string;
  image_mime?: string;
  is_voice?: boolean;
  audio_url?: string;
  created_at: string;
}

export interface SessionRecord {
  session_id: string;
  channel: "widget" | "whatsapp" | "messenger";
  external_user_id: string;
  profile_name: string;
  farm_context: FarmContext;
  flow_state?: SessionFlowState;
  messages: ChatMessageRecord[];
  created_at: string;
  updated_at: string;
}

export interface SessionSummaryItem {
  session_id: string;
  channel: "widget" | "whatsapp" | "messenger";
  external_user_id: string;
  profile_name: string;
  farm_context: FarmContext;
  message_count: number;
  last_message: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocumentInfo {
  source: string;
  format: string;
  source_type: string;
  chunk_count: number;
  ingested_at: string;
  size_bytes: number;
  sample_sections: string[];
}

export interface KnowledgeOverview {
  collection_name: string;
  total_chunks: number;
  embedded_chunks: number;
  embedding_dimension: number;
  embedding_model: string;
  generation_model: string;
  documents: KnowledgeDocumentInfo[];
}

export interface FeedbackItem {
  feedback_id: string;
  message_id: string;
  session_id: string;
  channel: string;
  rating: 1 | -1;
  category: string;
  comment: string;
  query_text: string;
  assistant_text: string;
  retrieved_sources: string[];
  promoted_to_rag: boolean;
  promoted_note?: string;
  created_at: string;
}

export interface FeedbackOverview {
  summary: {
    total_ratings: number;
    thumbs_up: number;
    thumbs_down: number;
    approval_rate_pct: number;
    promoted_golden_chunks: number;
  };
  source_audit: Array<{
    source: string;
    thumbs_up: number;
    thumbs_down: number;
  }>;
  items: FeedbackItem[];
}

export interface WebhookLogEntry {
  id: string;
  channel: "whatsapp" | "messenger" | "widget";
  method: "GET" | "POST";
  endpoint: string;
  status_code: number;
  sender_id: string;
  inbound_preview: string;
  outbound_preview: string;
  raw_inbound: unknown;
  raw_outbound: unknown;
  latency_ms: number;
  created_at: string;
}

export interface PythonSourceFile {
  path: string;
  language: string;
  content: string;
  size_bytes: number;
}

export interface PlantDatabaseItem {
  id: string;
  name: string;
  raw_name: string;
  category: string;
  importance: string;
  environment: string;
  seeds_and_nursery: string;
  agricultural_practices: string;
  irrigation: string;
  fertilization: string;
  pest_and_disease_control: string;
  harvest: string;
  post_harvest: string;
  extra_notes: string;
}

export interface GovernorateItem {
  id: string;
  name: string;
  region_id: string;
  region_label: string;
}

export interface MemberRegistrationRecord {
  registration_id: string;
  session_id: string;
  channel: "whatsapp" | "messenger" | "widget";
  full_name: string;
  phone: string;
  phone_e164?: string;
  governorate: string;
  location: string;
  land_and_irrigation: string;
  crops: string;
  support_needed?: string;
  created_at: string;
}

export interface SheetTabPreview {
  sheet_name: string;
  row_count: number;
  columns: string[];
  sample_rows: Record<string, string>[];
}

export interface ConnectedGoogleSheet {
  spreadsheet_id: string;
  title: string;
  url: string;
  auth_mode: "oauth_api" | "public_link" | "builtin_demo";
  tabs: SheetTabPreview[];
  rows_indexed: number;
  synced_at: string;
}
