PRAGMA foreign_keys = ON;
CREATE TABLE employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE availability (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE, work_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('available','unavailable','preferred')), preferred_shift TEXT CHECK(preferred_shift IN ('morning','afternoon',NULL)), note TEXT NOT NULL DEFAULT '', UNIQUE(employee_id,work_date));
CREATE TABLE schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, work_date TEXT NOT NULL, shift TEXT NOT NULL CHECK(shift IN ('morning','afternoon')), employee_id INTEGER REFERENCES employees(id), source TEXT NOT NULL CHECK(source IN ('auto','manual')), warning TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(work_date,shift));
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
CREATE INDEX idx_availability_date ON availability(work_date);
CREATE INDEX idx_schedules_date ON schedules(work_date);
CREATE INDEX idx_schedules_employee ON schedules(employee_id);
