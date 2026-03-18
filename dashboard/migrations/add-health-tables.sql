CREATE TABLE IF NOT EXISTS health_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_name TEXT NOT NULL,
  date TEXT NOT NULL,
  qty REAL,
  units TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_metrics_name_date ON health_metrics(metric_name, date DESC);
CREATE INDEX IF NOT EXISTS idx_health_metrics_date ON health_metrics(date DESC);

CREATE TABLE IF NOT EXISTS health_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT,
  duration REAL,
  calories REAL,
  distance REAL,
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_workouts_start ON health_workouts(start DESC);
