PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('github', 'upload')),
  source_identity TEXT NOT NULL,
  source_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'analyzing', 'failed')),
  latest_graph_key TEXT,
  latest_graph_digest TEXT,
  dashboard_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, source_type, source_identity)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('full', 'incremental', 'review')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed')),
  phase TEXT NOT NULL,
  progress INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  error TEXT,
  github_run_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(project_id, source_version, mode, status);

CREATE TABLE IF NOT EXISTS graph_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  artifact_key TEXT NOT NULL,
  digest TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_versions_project ON graph_versions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  expected_size_bytes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'expired', 'rejected')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
