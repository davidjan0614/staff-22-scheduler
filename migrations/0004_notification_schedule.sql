CREATE TABLE notification_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','automatic')),
  lead_days INTEGER NOT NULL DEFAULT 3 CHECK(lead_days BETWEEN 0 AND 30),
  send_time TEXT NOT NULL DEFAULT '09:00',
  reminder_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO notification_settings(id) VALUES(1);
