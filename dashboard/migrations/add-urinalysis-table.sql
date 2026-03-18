-- Urinalysis dipstick results
CREATE TABLE IF NOT EXISTS urinalysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  glucose TEXT,
  ketones TEXT,
  ph REAL,
  specific_gravity REAL,
  protein TEXT,
  blood TEXT,
  leukocytes TEXT,
  nitrite TEXT,
  bilirubin TEXT,
  urobilinogen TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_urinalysis_timestamp ON urinalysis(timestamp DESC);
