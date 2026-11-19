import { Hono } from "hono";
import { validMonth } from "../shared/availability";
import { SCHEDULING_RULES } from "../shared/rules";
import type { NotificationSettings, SmsPreview, Shift } from "../shared/types";

export type SmsBindings = {
  DB: D1Database;
  SMS_ENABLED?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  PUBLIC_BASE_URL?: string;
};
type Row = {
  id: number;
  employee_id: number;
  work_date: string;
  shift: Shift;
  name: string;
  phone: string;
  sms_enabled: number;
  active: number;
  updated_at: string;
  notification_version: number;
};
export async function digest(value: unknown) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function config(env: SmsBindings) {
  let base = "";
  try {
    const url = new URL(env.PUBLIC_BASE_URL || "");
    if (url.protocol === "https:" && !url.username && !url.password)
      base = url.origin;
  } catch {}
  const ready =
    env.SMS_ENABLED === "true" &&
    !!env.TWILIO_ACCOUNT_SID &&
    !!env.TWILIO_AUTH_TOKEN &&
    !!env.TWILIO_FROM &&
    !!base;
  return {
    ready,
    base,
    reason: ready
      ? "已啟用簡訊服務，發送會依服務商計費。"
      : "簡訊尚未啟用：需先設定服務帳號、發送號碼及網站網址。現在不會發送或產生費用。",
  };
}
async function notificationSettings(env: SmsBindings): Promise<NotificationSettings> {
  return (await env.DB.prepare(
    "SELECT mode,lead_days,send_time,reminder_enabled FROM notification_settings WHERE id=1",
  ).first<NotificationSettings>()) || {mode:"manual",lead_days:3,send_time:"09:00",reminder_enabled:1};
}
function scheduledAt(workDate: string, settings: NotificationSettings) {
  const at = new Date(`${workDate}T${settings.send_time}:00+08:00`);
  at.setUTCDate(at.getUTCDate() - settings.lead_days);
  return at.toISOString();
}
export async function previewSms(
  env: SmsBindings,
  month: string,
): Promise<SmsPreview> {
  const settings = await notificationSettings(env);
  const rows = await env.DB.prepare(
    `SELECT s.*,e.name,e.phone,e.sms_enabled,e.active FROM schedules s JOIN employees e ON e.id=s.employee_id WHERE s.work_date LIKE ? ORDER BY s.work_date,s.shift`,
  )
    .bind(`${month}-%`)
    .all<Row>();
  const history = await env.DB.prepare(
    "SELECT id,employee_id,work_date,shift,status,confirmed_at,created_at,error,fingerprint FROM sms_notifications WHERE work_date LIKE ? ORDER BY id DESC",
  )
    .bind(`${month}-%`)
    .all<any>();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const items = await Promise.all(
    rows.results.map(async (row) => {
      const fingerprint = await digest([
        row.id,
        row.employee_id,
        row.work_date,
        row.shift,
        row.notification_version,
        row.phone,
      ]);
      const old = history.results.find((h) => h.fingerprint === fingerprint);
      const shift = SCHEDULING_RULES.shifts.find((s) => s.id === row.shift)!;
      const body = `【人員值班通知】${row.name}，您排定 ${row.work_date} ${shift.label} ${shift.time} 值班。請開啟連結確認：`;
      const state = old
        ? old.confirmed_at
          ? "confirmed"
          : old.status
        : !row.active
          ? "inactive"
          : !/^\+8869\d{8}$/.test(row.phone)
            ? "missing_phone"
            : !row.sms_enabled
              ? "disabled"
              : row.work_date < today
                ? "past"
                : "ready";
      return {
        assignment_id: row.id,
        assignment_version: row.notification_version,
        employee_id: row.employee_id,
        name: row.name,
        phone: row.phone,
        work_date: row.work_date,
        shift: row.shift,
        body,
        state,
        fingerprint,
        scheduled_at: scheduledAt(row.work_date, settings),
      };
    }),
  );
  const c = config(env);
  return {
    ready: c.ready,
    reason: c.reason,
    revision: await digest(items),
    items,
    history: history.results.map(({ fingerprint, ...h }) => h),
    settings,
  };
}
export const smsAdmin = new Hono<{ Bindings: SmsBindings }>();
smsAdmin.get("/settings/current", async (c) => c.json(await notificationSettings(c.env)));
smsAdmin.put("/settings/current", async (c) => {
  const b = await c.req.json<NotificationSettings>();
  if (!['manual','automatic'].includes(b.mode) || !Number.isInteger(b.lead_days) || b.lead_days < 0 || b.lead_days > 30 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.send_time))
    return c.json({error:'通知設定格式錯誤'},400);
  await c.env.DB.prepare("UPDATE notification_settings SET mode=?,lead_days=?,send_time=?,reminder_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=1")
    .bind(b.mode,b.lead_days,b.send_time,Number(!!b.reminder_enabled)).run();
  await c.env.DB.prepare("INSERT INTO audit_logs(action,detail) VALUES(?,?)").bind('更新通知排程',`${b.mode==='automatic'?'自動':'手動'} · 提前 ${b.lead_days} 天 ${b.send_time}`).run();
  return c.json({ok:true});
});
smsAdmin.get("/:month", async (c) => {
  const month = c.req.param("month");
  if (!validMonth(month)) return c.json({ error: "月份格式錯誤" }, 400);
  return c.json(await previewSms(c.env, month));
});
smsAdmin.post("/:month/send", async (c) => {
  const month = c.req.param("month");
  if (!validMonth(month)) return c.json({ error: "月份格式錯誤" }, 400);
  const b = await c.req.json<{ revision: string; due_before?: string }>();
  const preview = await previewSms(c.env, month);
  if (!preview.ready) return c.json({ error: preview.reason }, 503);
  if (b.revision !== preview.revision)
    return c.json({ error: "班表或通知狀態已變更，請重新預覽後再發送。" }, 409);
  let accepted = 0,
    failed = 0;
  for (const item of preview.items.filter((i) => i.state === "ready" && (!b.due_before || i.scheduled_at <= b.due_before))) {
    const token = crypto.randomUUID().replaceAll("-", "");
    const body = item.body + `${config(c.env).base}/confirm/${token}`;
    // Claim before the external request; uncertain requests are never automatically retried.
    const result = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO sms_notifications(assignment_id,employee_id,work_date,shift,phone,fingerprint,token,body) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM schedules s JOIN employees e ON e.id=s.employee_id WHERE s.id=? AND s.employee_id=? AND e.phone=? AND s.notification_version=? AND e.sms_enabled=1 AND e.active=1)`,
    )
      .bind(
        item.assignment_id,
        item.employee_id,
        item.work_date,
        item.shift,
        item.phone,
        item.fingerprint,
        token,
        body,
        item.assignment_id,
        item.employee_id,
        item.phone,
        item.assignment_version,
      )
      .run();
    if (!result.meta.changes) continue;
    let status = "unknown",
      providerId: string | null = null,
      error: string | null = "結果不明，請先向服務商查詢，勿重複發送。";
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.env.TWILIO_ACCOUNT_SID!)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${c.env.TWILIO_ACCOUNT_SID}:${c.env.TWILIO_AUTH_TOKEN}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: item.phone,
            From: c.env.TWILIO_FROM!,
            Body: body,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const payload = (await response.json()) as {
        sid?: string;
        status?: string;
        code?: number;
      };
      if (response.ok && payload.sid) {
        status = "accepted";
        providerId = payload.sid;
        error = null;
        accepted++;
      } else if (response.status >= 400 && response.status < 500) {
        status = "failed";
        error = `服務商拒絕請求（${payload.code || response.status}），請檢查帳號及號碼。`;
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
    await c.env.DB.prepare(
      "UPDATE sms_notifications SET status=?,provider_id=?,error=? WHERE token=?",
    )
      .bind(status, providerId, error, token)
      .run();
  }
  await c.env.DB.prepare("INSERT INTO audit_logs(action,detail) VALUES(?,?)")
    .bind(
      "發送值班簡訊",
      `${month}：服務商受理 ${accepted} 筆，失敗或待查 ${failed} 筆`,
    )
    .run();
  return c.json({ accepted, failed });
});
export async function runScheduledNotifications(env: SmsBindings, scheduledTime = Date.now()) {
  const settings = await notificationSettings(env);
  if (settings.mode !== 'automatic' || !config(env).ready) return;
  const now = new Date(scheduledTime);
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  const value=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  if (`${value('hour')}:${value('minute')}` !== settings.send_time) return;
  const taipeiDate=`${value('year')}-${value('month')}-${value('day')}`;
  const base=new Date(`${taipeiDate}T12:00:00+08:00`);
  const months=new Set<string>();
  for(let offset=0;offset<=settings.lead_days+35;offset+=settings.lead_days+1){const d=new Date(base);d.setUTCDate(d.getUTCDate()+offset);months.add(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(d));}
  for(const month of months){
    const preview=await previewSms(env,month);
    if(!preview.items.some(i=>i.state==='ready'&&i.scheduled_at<=now.toISOString())) continue;
    await smsAdmin.request(`/${month}/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:preview.revision,due_before:now.toISOString()})},env);
  }
}
// Poll authenticated provider status rather than trusting unsigned delivery callbacks.
smsAdmin.post("/:month/refresh", async (c) => {
  const month = c.req.param("month");
  if (!validMonth(month)) return c.json({ error: "月份格式錯誤" }, 400);
  if (!config(c.env).ready) return c.json({ error: "簡訊服務尚未啟用" }, 503);
  const rows = await c.env.DB.prepare(
    "SELECT id,provider_id FROM sms_notifications WHERE work_date LIKE ? AND provider_id IS NOT NULL AND status IN ('accepted','sent','queued','sending') LIMIT 50",
  )
    .bind(`${month}-%`)
    .all<{ id: number; provider_id: string }>();
  for (const row of rows.results) {
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.env.TWILIO_ACCOUNT_SID!)}/Messages/${encodeURIComponent(row.provider_id)}.json`,
        {
          headers: {
            Authorization: `Basic ${btoa(`${c.env.TWILIO_ACCOUNT_SID}:${c.env.TWILIO_AUTH_TOKEN}`)}`,
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (res.ok) {
        const p = (await res.json()) as { status: string };
        if (
          [
            "queued",
            "sending",
            "sent",
            "delivered",
            "undelivered",
            "failed",
            "accepted",
          ].includes(p.status)
        )
          await c.env.DB.prepare(
            "UPDATE sms_notifications SET status=? WHERE id=?",
          )
            .bind(p.status, row.id)
            .run();
      }
    } catch {
      /* Keep previous status when the provider cannot be reached. */
    }
  }
  return c.json({ ok: true });
});
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
export const smsPublic = new Hono<{ Bindings: SmsBindings }>();
smsPublic.use("*", async (c, next) => {
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  );
  await next();
});
smsPublic.on(["GET", "POST"], "/:token", async (c) => {
  const token = c.req.param("token");
  const row = /^[a-f0-9]{32}$/.test(token)
    ? await c.env.DB.prepare(
        `SELECT n.*,s.employee_id current_employee,s.notification_version assignment_version,e.phone current_phone,e.active,e.sms_enabled FROM sms_notifications n JOIN schedules s ON s.id=n.assignment_id JOIN employees e ON e.id=n.employee_id WHERE n.token=?`,
      )
        .bind(token)
        .first<any>()
    : null;
  let valid = !!row;
  if (row) {
    const fingerprint = await digest([
      row.assignment_id,
      row.current_employee,
      row.work_date,
      row.shift,
      row.assignment_version,
      row.current_phone,
    ]);
    valid =
      row.fingerprint === fingerprint && !!row.active && !!row.sms_enabled;
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (row && row.work_date < today) valid = false;
  if (valid && c.req.method === "POST") {
    // The link must be followed by a button press; scanners doing GET cannot confirm a shift.
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return c.text("不允許的來源", 403);
    await c.env.DB.prepare(
      "UPDATE sms_notifications SET confirmed_at=COALESCE(confirmed_at,CURRENT_TIMESTAMP) WHERE token=?",
    )
      .bind(token)
      .run();
  }
  const confirmed = valid && (row.confirmed_at || c.req.method === "POST");
  const title = !valid
    ? "此通知已失效"
    : confirmed
      ? "已確認值班"
      : "請確認您的值班";
  const detail = valid
    ? `${row.work_date} ${SCHEDULING_RULES.shifts.find((s) => s.id === row.shift)?.label || ""}`
    : "班表可能已調整或日期已過，請向排班管理員確認。";
  return c.html(
    `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#f5f4ef;padding:24px;color:#17231c}main{max-width:440px;margin:10vh auto;background:white;padding:28px;border-radius:20px}button{background:#1f6b45;color:white;border:0;border-radius:12px;padding:16px;width:100%;font-size:18px}p{line-height:1.7}</style><main><p>人員值班通知</p><h1>${title}</h1><p>${escape(detail)}</p>${valid && !confirmed ? '<p>確認後，排班管理員就能知道您已收到通知。</p><form method="post"><button>我已確認值班</button></form>' : ""}</main></html>`,
  );
});
