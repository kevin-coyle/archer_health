-- Glucose readings from LibreView exports
CREATE TABLE IF NOT EXISTS glucose_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  libre_reading REAL NOT NULL,
  alphatrak_reading REAL,
  trend TEXT,
  source TEXT DEFAULT 'manual',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(timestamp, source)
);

-- Insulin doses
CREATE TABLE IF NOT EXISTS insulin_doses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  meal_time TEXT CHECK(meal_time IN ('morning', 'evening')),
  dose_units REAL NOT NULL,
  insulin_type TEXT DEFAULT 'ProZinc',
  libre_reading REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Interventions (honey, emergency food)
CREATE TABLE IF NOT EXISTS interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  intervention_type TEXT CHECK(intervention_type IN ('honey', 'food', 'emergency')),
  amount TEXT,
  libre_reading REAL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for fast time-range queries
CREATE INDEX IF NOT EXISTS idx_glucose_timestamp ON glucose_readings(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_insulin_timestamp ON insulin_doses(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_interventions_timestamp ON interventions(timestamp DESC);
