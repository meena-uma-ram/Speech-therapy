-- TJS Pay. One small practice = one JSON document (billing data only: no diagnoses, goals or session notes).
-- The document is versioned so two changes at once can't overwrite each other.
DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS claims; DROP TABLE IF EXISTS invoices; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS families; DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS practice;
CREATE TABLE practice (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
