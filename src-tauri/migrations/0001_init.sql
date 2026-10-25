CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_incidents_updated ON incidents(updated_at DESC);
CREATE TABLE incident_fields (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  state TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (incident_id, field)
);
CREATE TABLE workflow_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE workflow_sessions (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE session_answers (
  session_id TEXT NOT NULL REFERENCES workflow_sessions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  option_id TEXT,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (session_id, node_id)
);
CREATE TABLE incident_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX idx_events_incident ON incident_events(incident_id, id);
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
