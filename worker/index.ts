import { Hono } from "hono";
import { cors } from "hono/cors";
import { conditions, recurring } from "./conditions";
import { smsAdmin, smsPublic, type SmsBindings } from "./sms";
import {
  blockedShifts,
  normalizePhone,
  validMonth,
  validWorkDate,
} from "../shared/availability";
import { generateSchedule } from "./scheduler";
import type {
  Availability,
  Employee,
  Assignment,
  RecurringCondition,
} from "../shared/types";

type Bindings = SmsBindings & {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_TTL_HOURS: string;
};
const app = new Hono<{ Bindings: Bindings }>();
app.use("/api/*", cors());
app.route("/confirm", smsPublic);
app.get("/api/health", (c) =>
  c.json({ ok: true, time: new Date().toISOString() }),
);
app.post("/api/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  if (!c.env.ADMIN_PASSWORD || password !== c.env.ADMIN_PASSWORD)
    return c.json({ error: "密碼錯誤" }, 401);
  const token = crypto.randomUUID();
  const hours = Number(c.env.SESSION_TTL_HOURS || 12);
  const expires = new Date(Date.now() + hours * 3600000).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions(token,expires_at) VALUES(?,?)")
    .bind(token, expires)
    .run();
  return c.json({ token, expires });
});
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path === "/api/login")
    return next();
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "請先登入" }, 401);
  const session = await c.env.DB.prepare(
    "SELECT token FROM sessions WHERE token=? AND expires_at>?",
  )
    .bind(token, new Date().toISOString())
    .first();
  if (!session) return c.json({ error: "登入已過期" }, 401);
  return next();
});
app.get("/api/month/:month", async (c) => {
  const month = c.req.param("month");
  if (!validMonth(month)) return c.json({ error: "月份格式錯誤" }, 400);
  const year = month.slice(0, 4);
  const [employees, availability, assignments, audit, recurringRows] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT e.*,COALESCE(COUNT(s.id),0) annualCount FROM employees e LEFT JOIN schedules s ON s.employee_id=e.id AND substr(s.work_date,1,4)=? GROUP BY e.id ORDER BY e.active DESC,e.id`,
      )
        .bind(year)
        .all<Employee>(),
      c.env.DB.prepare(
        "SELECT * FROM availability WHERE work_date LIKE ? ORDER BY work_date",
      )
        .bind(`${month}-%`)
        .all<Availability>(),
      c.env.DB.prepare(
        "SELECT s.*,e.name employee_name FROM schedules s LEFT JOIN employees e ON e.id=s.employee_id WHERE s.work_date LIKE ? ORDER BY s.work_date,s.shift DESC",
      )
        .bind(`${month}-%`)
        .all<Assignment>(),
      c.env.DB.prepare(
        "SELECT * FROM audit_logs ORDER BY id DESC LIMIT 20",
      ).all(),
      c.env.DB.prepare(
        "SELECT * FROM recurring_conditions",
      ).all<RecurringCondition>(),
    ]);
  return c.json({
    employees: employees.results,
    availability: availability.results,
    assignments: assignments.results,
    audit: audit.results,
    recurring: recurringRows.results,
  });
});
app.post("/api/employees", async (c) => {
  const b = await c.req.json<{ name: string; note?: string }>();
  if (!b.name?.trim()) return c.json({ error: "姓名必填" }, 400);
  const r = await c.env.DB.prepare(
    "INSERT INTO employees(name,note) VALUES(?,?)",
  )
    .bind(b.name.trim(), b.note || "")
    .run();
  await log(c, "新增員工", b.name.trim());
  return c.json({ id: r.meta.last_row_id }, 201);
});
app.patch("/api/employees/:id", async (c) => {
  const b = await c.req.json<{
    name?: string;
    note?: string;
    active?: boolean;
    phone?: string;
    sms_enabled?: boolean;
  }>();
  let phone: string | null = null;
  try {
    if (b.phone !== undefined) phone = normalizePhone(b.phone);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  if (b.name !== undefined && !b.name.trim())
    return c.json({ error: "姓名必填" }, 400);
  if (b.sms_enabled === true) {
    const e = await c.env.DB.prepare("SELECT phone FROM employees WHERE id=?")
      .bind(c.req.param("id"))
      .first<{ phone: string }>();
    if (!(phone ?? e?.phone)) return c.json({ error: "請先填寫手機號碼" }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE employees SET name=COALESCE(?,name),note=COALESCE(?,note),active=COALESCE(?,active),phone=COALESCE(?,phone),sms_enabled=CASE WHEN ?='' THEN 0 ELSE COALESCE(?,sms_enabled) END,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
  )
    .bind(
      b.name ?? null,
      b.note ?? null,
      b.active === undefined ? null : Number(b.active),
      phone,
      phone,
      b.sms_enabled === undefined ? null : Number(b.sms_enabled),
      c.req.param("id"),
    )
    .run();
  await log(c, "更新員工", `員工 #${c.req.param("id")}`);
  return c.json({ ok: true });
});
app.route("/api/conditions", conditions);
app.route("/api/recurring", recurring);
app.route("/api/sms", smsAdmin);
app.put("/api/availability", async (c) => {
  const b = await c.req.json<Availability>();
  if (
    !validWorkDate(b.work_date) ||
    !Number.isInteger(b.employee_id) ||
    !["available", "unavailable", "preferred"].includes(b.status) ||
    (b.preferred_shift !== null &&
      !["morning", "afternoon"].includes(b.preferred_shift))
  )
    return c.json({ error: "條件格式錯誤" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO availability(employee_id,work_date,status,preferred_shift,note,blocked_shifts) VALUES(?,?,?,?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET status=excluded.status,preferred_shift=excluded.preferred_shift,note=excluded.note,blocked_shifts=excluded.blocked_shifts`,
  )
    .bind(
      b.employee_id,
      b.work_date,
      b.status,
      b.preferred_shift,
      b.note || "",
      JSON.stringify(blockedShifts(b)),
    )
    .run();
  return c.json({ ok: true });
});
app.post("/api/schedules/generate", async (c) => {
  const { month } = await c.req.json<{ month: string }>();
  if (!validMonth(month)) return c.json({ error: "月份格式錯誤" }, 400);
  const year = month.slice(0, 4);
  const [er, ar, sr, rr] = await Promise.all([
    c.env.DB.prepare(
      `SELECT e.*,COALESCE(COUNT(s.id),0) annualCount FROM employees e LEFT JOIN schedules s ON s.employee_id=e.id AND substr(s.work_date,1,4)=? GROUP BY e.id`,
    )
      .bind(year)
      .all<Employee>(),
    c.env.DB.prepare("SELECT * FROM availability WHERE work_date LIKE ?")
      .bind(`${month}-%`)
      .all<Availability>(),
    c.env.DB.prepare("SELECT * FROM schedules WHERE work_date LIKE ?")
      .bind(`${month}-%`)
      .all<Assignment>(),
    c.env.DB.prepare(
      "SELECT * FROM recurring_conditions",
    ).all<RecurringCondition>(),
  ]);
  const generated = generateSchedule(
    month,
    er.results,
    ar.results,
    sr.results,
    rr.results,
  );
  const batch = generated
    .filter((x) => x.source === "auto")
    .map((x) =>
      c.env.DB.prepare(
        `INSERT INTO schedules(work_date,shift,employee_id,source,warning) VALUES(?,?,?,?,?) ON CONFLICT(work_date,shift) DO UPDATE SET employee_id=excluded.employee_id,source='auto',warning=excluded.warning,notification_version=schedules.notification_version+CASE WHEN schedules.employee_id IS NOT excluded.employee_id THEN 1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP WHERE schedules.source='auto'`,
      ).bind(x.work_date, x.shift, x.employee_id, "auto", x.warning || null),
    );
  if (batch.length) await c.env.DB.batch(batch);
  await log(c, "自動排班", month);
  return c.json({ assignments: generated });
});
app.put("/api/schedules/assignment", async (c) => {
  const b = await c.req.json<{
    work_date: string;
    shift: string;
    employee_id: number | null;
  }>();
  if (
    !validWorkDate(b.work_date) ||
    !["morning", "afternoon"].includes(b.shift) ||
    (b.employee_id !== null && !Number.isInteger(b.employee_id))
  )
    return c.json({ error: "班次格式錯誤" }, 400);
  let warning: string | null = null;
  if (b.employee_id) {
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) count FROM schedules WHERE work_date LIKE ? AND employee_id=? AND NOT(work_date=? AND shift=?)",
    )
      .bind(`${b.work_date.slice(0, 7)}-%`, b.employee_id, b.work_date, b.shift)
      .first<{ count: number }>();
    if ((count?.count || 0) >= 1)
      warning = "同一人本月已排班，此為 Admin 特殊第 2 班";
  }
  await c.env.DB.prepare(
    `INSERT INTO schedules(work_date,shift,employee_id,source,warning) VALUES(?,?,?,?,?) ON CONFLICT(work_date,shift) DO UPDATE SET employee_id=excluded.employee_id,source='manual',warning=excluded.warning,notification_version=schedules.notification_version+CASE WHEN schedules.employee_id IS NOT excluded.employee_id THEN 1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP`,
  )
    .bind(b.work_date, b.shift, b.employee_id, "manual", warning)
    .run();
  await log(
    c,
    "手動調整",
    `${b.work_date} ${b.shift} → 員工 #${b.employee_id ?? "缺額"}${warning ? "（第 2 班）" : ""}`,
  );
  return c.json({ ok: true, warning });
});
async function log(c: any, action: string, detail: string) {
  await c.env.DB.prepare("INSERT INTO audit_logs(action,detail) VALUES(?,?)")
    .bind(action, detail)
    .run();
}
export default app;
