CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  close REAL,
  entry_price REAL,
  stop_price REAL,
  target1 REAL,
  target2 REAL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(symbol, trade_date, signal_type)
);

CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT PRIMARY KEY,
  entry_date TEXT NOT NULL,
  entry_price REAL NOT NULL,
  stop_price REAL NOT NULL,
  initial_risk REAL NOT NULL,
  target1 REAL NOT NULL,
  target2 REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  remaining_fraction REAL NOT NULL DEFAULT 1.0,
  target1_hit INTEGER NOT NULL DEFAULT 0,
  max_close REAL NOT NULL,
  bars_held INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  PRIMARY KEY(symbol, trade_date)
);
