import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Availability, RecurringCondition } from "../shared/types";
import {
  blockedShifts,
  validMonth,
  validWorkDate,
} from "../shared/availability";
import { digest } from "./sms";

type Bindings = { DB: D1Database };
export const conditions = new Hono<{ Bindings: Bindings }>();
conditions.use(
  "*",
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) =>
      c.json({ error: "一次修改的內容過多，請分人員或月份儲存。" }, 413),
  }),
);
const validScope = (s: string) => validMonth(s) || /^[1-9]\d{3}$/.test(s);
async function read(db: D1Database, scope: string) {
  const a = await db
    .prepare(
      "SELECT employee_id,work_date,status,preferred_shift,note,blocked_shifts FROM availability WHERE work_date LIKE ? ORDER BY work_date,employee_id",
    )
    .bind(`${scope}-%`)
    .all<Availability>();
  const r = await db
    .prepare(
      "SELECT * FROM recurring_conditions ORDER BY employee_id,weekday,shift",
    )
    .all<RecurringCondition>();
  return {
    availability: a.results,
    recurring: r.results,
    revision: await digest([a.results, r.results]),
  };
}
conditions.get("/:scope", async (c) => {
  const scope = c.req.param("scope");
  if (!validScope(scope)) return c.json({ error: "日期範圍錯誤" }, 400);
  return c.json(await read(c.env.DB, scope));
});
conditions.put("/:scope", async (c) => {
  const scope = c.req.param("scope");
  if (!validScope(scope)) return c.json({ error: "日期範圍錯誤" }, 400);
  const b = await c.req.json<{ revision: string; items: Availability[] }>();
  if (!Array.isArray(b.items) || !b.items.length)
    return c.json({ error: "請至少選擇一筆條件" }, 400);
  const ids = new Set<string>();
  for (const a of b.items) {
    const key = `${a.employee_id}:${a.work_date}`;
    if (
      !Number.isInteger(a.employee_id) ||
      !validWorkDate(a.work_date) ||
      !a.work_date.startsWith(scope + "-") ||
      !["available", "unavailable", "preferred"].includes(a.status) ||
      !Array.isArray(a.blocked_shifts) ||
      a.blocked_shifts.some((s) => !["morning", "afternoon"].includes(s)) ||
      (a.preferred_shift !== null &&
        !["morning", "afternoon"].includes(a.preferred_shift)) ||
      typeof a.note !== "string" ||
      a.note.length > 1000 ||
      ids.has(key)
    )
      return c.json({ error: "條件資料格式錯誤" }, 400);
    ids.add(key);
  }
  const current = await read(c.env.DB, scope);
  if (current.revision !== b.revision)
    return c.json({ error: "條件已由其他操作更新，請重新載入後再儲存。" }, 409);
  const employees = await c.env.DB.prepare("SELECT id FROM employees").all<{
    id: number;
  }>();
  if (
    b.items.some((a) => !employees.results.some((e) => e.id === a.employee_id))
  )
    return c.json({ error: "找不到人員" }, 400);
  // One SQL statement for the whole submission: adding staff must not increase
  // the statement count or hit the former 100-date limit.
  const statements = [
    c.env.DB.prepare(
      `
    INSERT INTO availability(employee_id,work_date,status,preferred_shift,note,blocked_shifts)
    SELECT json_extract(value,'$.employee_id'),json_extract(value,'$.work_date'),
           json_extract(value,'$.status'),json_extract(value,'$.preferred_shift'),
           json_extract(value,'$.note'),json_extract(value,'$.blocked_shifts')
    FROM json_each(?) WHERE 1
    ON CONFLICT(employee_id,work_date) DO UPDATE SET status=excluded.status,
      preferred_shift=excluded.preferred_shift,note=excluded.note,blocked_shifts=excluded.blocked_shifts
  `,
    ).bind(
      JSON.stringify(
        b.items.map((a) => ({ ...a, blocked_shifts: blockedShifts(a) })),
      ),
    ),
  ];
  statements.push(
    c.env.DB.prepare("INSERT INTO audit_logs(action,detail) VALUES(?,?)").bind(
      "批次設定不可排時段",
      `${scope}：${b.items.length} 筆日期條件`,
    ),
  );
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});
export const recurring = new Hono<{ Bindings: Bindings }>();
recurring.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { items } = await c.req.json<{ items: RecurringCondition[] }>();
  if (
    !Number.isInteger(id) ||
    !Array.isArray(items) ||
    items.length > 14 ||
    items.some(
      (r) =>
        !Number.isInteger(r.weekday) ||
        r.weekday < 0 ||
        r.weekday > 6 ||
        !["morning", "afternoon"].includes(r.shift),
    ) ||
    new Set(items.map((r) => `${r.weekday}:${r.shift}`)).size !== items.length
  )
    return c.json({ error: "固定條件格式錯誤" }, 400);
  if (
    !(await c.env.DB.prepare("SELECT id FROM employees WHERE id=?")
      .bind(id)
      .first())
  )
    return c.json({ error: "找不到人員" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM recurring_conditions WHERE employee_id=?",
    ).bind(id),
    ...items.map((r) =>
      c.env.DB.prepare(
        "INSERT INTO recurring_conditions(employee_id,weekday,shift) VALUES(?,?,?)",
      ).bind(id, r.weekday, r.shift),
    ),
    c.env.DB.prepare("INSERT INTO audit_logs(action,detail) VALUES(?,?)").bind(
      "更新固定不可排時段",
      `員工 #${id}`,
    ),
  ]);
  return c.json({ ok: true });
});
