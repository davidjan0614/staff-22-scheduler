-- Additive migration: preserve all existing employees, conditions and schedules.
ALTER TABLE employees ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN sms_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN notification_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE availability ADD COLUMN blocked_shifts TEXT NOT NULL DEFAULT '[]';
CREATE TABLE recurring_conditions (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  shift TEXT NOT NULL CHECK(shift IN ('morning','afternoon')),
  PRIMARY KEY(employee_id,weekday,shift)
);
CREATE TABLE sms_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES schedules(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  work_date TEXT NOT NULL,
  shift TEXT NOT NULL,
  phone TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending',
  provider_id TEXT,
  error TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sms_month ON sms_notifications(work_date);
