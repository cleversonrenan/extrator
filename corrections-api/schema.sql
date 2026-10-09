CREATE TABLE IF NOT EXISTS corrections (
  end_id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  subarea TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correction_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  end_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('UPSERT', 'DELETE')),
  old_region TEXT,
  old_subarea TEXT,
  new_region TEXT,
  new_subarea TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_correction_history_end_id
  ON correction_history(end_id, created_at DESC);

CREATE TABLE IF NOT EXISTS write_limits (
  client_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  write_count INTEGER NOT NULL,
  PRIMARY KEY (client_key, window_start)
);
