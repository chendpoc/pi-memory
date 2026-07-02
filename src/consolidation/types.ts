export type ConsolidationStatus = "pending" | "processing" | "done" | "skipped" | "failed";

export interface PendingSession {
  session_id: string;
  session_file: string;
  cwd: string;
  git_root: string | null;
  project_hash: string | null;
  parent_session_id: string | null;
  parent_session_file: string | null;
  user_turn_count: number;
  ended_at: string;
  status: ConsolidationStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stage1Output {
  session_id: string;
  session_file: string;
  source_mtime_ms: number;
  generated_at: string;
  raw_memory: string;
  rollout_summary: string;
  scope: string;
  status: ConsolidationStatus;
  selected_for_phase2: boolean;
  usage_count: number;
  last_usage: string | null;
  error_message: string | null;
}

export interface JobReport {
  session_id: string;
  enqueued: boolean;
  action: "created" | "updated" | "skipped";
  status: ConsolidationStatus;
  reason?: string;
  now: string;
}

export interface ConsolidationStatusReport {
  pending: number;
  processing: number;
  done: number;
  skipped: number;
  failed: number;
  stage1Count: number;
  lastGeneratedAt: string | null;
  lastUpdatedAt: string | null;
}
