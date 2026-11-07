import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import app from "./index";
import {
  datesInMonth,
  isBlocked,
  normalizePhone,
  validWorkDate,
} from "../shared/availability";
import { generateSchedule } from "./scheduler";

// Exercise the real migrations and API SQL against SQLite, including D1 batch rollback.
let sqlite: DatabaseSync, env: any;
function statement(sql: string, args: unknown[] = []): any {
  return {
    sql,
    args,
    bind(...values: unknown[]) {
      return statement(sql, values);
    },
    async all() {
      return {
        results: sqlite.prepare(sql).all(...(args as any)),
        success: true,
      };
    },
    async first() {
      return sqlite.prepare(sql).get(...(args as any)) || null;
    },
    async run() {
      const r = sqlite.prepare(sql).run(...(args as any));
      return {
        success: true,
        meta: {
          changes: Number(r.changes),
          last_row_id: Number(r.lastInsertRowid),
        },
      };
    },
  };
}
const call = (path: string, method = "GET", body?: unknown) =>
  app.request(
    `https://scheduler.test${path}`,
    {
      method,
      headers: {
        Authorization: "Bearer test-session",
        "Content-Type": "application/json",
        Origin: "https://scheduler.test",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
const json = async (path: string) => {
  const res = await call(path);
  expect(res.status).toBe(200);
  return res.json() as Promise<any>;
};
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_seed_22_employees.sql",
    "0003_availability_sms.sql",
  ])
    sqlite.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    );
  sqlite.exec("INSERT INTO sessions VALUES('test-session','2999-01-01');");
  const db = {
    prepare: statement,
    async batch(statements: any[]) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const s of statements) result.push(await s.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  env = {
    DB: db,
    SMS_ENABLED: "false",
    ADMIN_PASSWORD: "local-only",
    SESSION_TTL_HOURS: "12",
    PUBLIC_BASE_URL: "https://scheduler.test",
  };
});
afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("月底條件與備份相容性", () => {
  it("遷移保留 22 人，手機通知預設關閉", async () => {
    const data = await json("/api/month/2026-11");
    expect(data.employees).toHaveLength(22);
    expect(
      data.employees.every((e: any) => e.phone === "" && e.sms_enabled === 0),
    ).toBe(true);
  });
  it("處理閏年及無效日期", () => {
    expect(datesInMonth("2028-02")).toHaveLength(2);
    expect(validWorkDate("2026-02-29")).toBe(false);
    expect(validWorkDate("2026-11-27")).toBe(false);
  });
  it("台灣手機格式標準化，拒絕無效號碼", () => {
    expect(normalizePhone("0912-345-678")).toBe("+886912345678");
    expect(() => normalizePhone("1234")).toThrow();
    expect(normalizePhone("")).toBe("");
  });
  it("早下午班分別受限，固定星期可由個別日期覆寫", () => {
    const fixed = [{ employee_id: 1, weekday: 6, shift: "morning" as const }];
    expect(isBlocked(1, "2026-11-28", "morning", [], fixed)).toBe(true);
    expect(isBlocked(1, "2026-11-28", "afternoon", [], fixed)).toBe(false);
    const a = [
      {
        employee_id: 1,
        work_date: "2026-11-28",
        status: "available" as const,
        preferred_shift: null,
        note: "",
        blocked_shifts: [],
      },
    ];
    expect(isBlocked(1, "2026-11-28", "morning", a, fixed)).toBe(false);
    const e = [{ id: 1, name: "測試", active: 1, note: "" }];
    const result = generateSchedule("2026-11", e, [], [], fixed);
    expect(
      result.find((r) => r.work_date === "2026-11-28" && r.shift === "morning")
        ?.employee_id,
    ).toBeNull();
  });
  it("批次儲存並拒絕舊預覽覆蓋或月份外資料", async () => {
    const snapshot = await json("/api/conditions/2026-11");
    const items = [
      {
        employee_id: 1,
        work_date: "2026-11-28",
        status: "available",
        preferred_shift: null,
        note: "保留備註",
        blocked_shifts: ["morning"],
      },
    ];
    expect(
      (
        await call("/api/conditions/2026-11", "PUT", {
          revision: snapshot.revision,
          items,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/conditions/2026-11", "PUT", {
          revision: snapshot.revision,
          items,
        })
      ).status,
    ).toBe(409);
    const latest = await json("/api/conditions/2026-11");
    expect(latest.availability[0].note).toBe("保留備註");
    items[0].work_date = "2026-12-28";
    expect(
      (
        await call("/api/conditions/2026-11", "PUT", {
          revision: latest.revision,
          items,
        })
      ).status,
    ).toBe(400);
  });
  it("全年一次儲存且 31 日不會出現在 2 月", async () => {
    const snapshot = await json("/api/conditions/2027");
    const items = Array.from({ length: 12 }, (_, i) =>
      datesInMonth(`2027-${String(i + 1).padStart(2, "0")}`),
    )
      .flat()
      .map((work_date) => ({
        employee_id: 1,
        work_date,
        status: "available",
        preferred_shift: null,
        note: "",
        blocked_shifts: [],
      }));
    expect(
      (
        await call("/api/conditions/2027", "PUT", {
          revision: snapshot.revision,
          items,
        })
      ).status,
    ).toBe(200);
    expect((await json("/api/conditions/2027-02")).availability).toHaveLength(
      1,
    );
  });
  it("固定條件寫入後自動排班避開，不覆蓋手動班", async () => {
    expect(
      (
        await call("/api/recurring/1", "PUT", {
          items: [{ weekday: 6, shift: "morning" }],
        })
      ).status,
    ).toBe(200);
    await call("/api/schedules/assignment", "PUT", {
      work_date: "2026-11-28",
      shift: "afternoon",
      employee_id: 22,
    });
    await call("/api/schedules/generate", "POST", { month: "2026-11" });
    const result = await json("/api/month/2026-11");
    expect(
      result.assignments.find(
        (a: any) => a.work_date === "2026-11-28" && a.shift === "morning",
      ).employee_id,
    ).not.toBe(1);
    expect(
      result.assignments.find(
        (a: any) => a.work_date === "2026-11-28" && a.shift === "afternoon",
      ).employee_id,
    ).toBe(22);
  });
  it("未登入不可讀取手機或通知紀錄", async () => {
    const res = await app.request(
      "https://scheduler.test/api/sms/2026-11",
      {},
      env,
    );
    expect(res.status).toBe(401);
  });
});

async function readySms() {
  env.SMS_ENABLED = "true";
  env.TWILIO_ACCOUNT_SID = "AC-test";
  env.TWILIO_AUTH_TOKEN = "test";
  env.TWILIO_FROM = "+15005550006";
  await call("/api/employees/1", "PATCH", {
    phone: "0912345678",
    sms_enabled: true,
  });
  await call("/api/schedules/assignment", "PUT", {
    work_date: "2027-11-28",
    shift: "morning",
    employee_id: 1,
  });
  return json("/api/sms/2027-11");
}
describe("簡訊發送與本人確認", () => {
  it("未設定服務時禁止發送，不呼叫外部服務", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (await call("/api/sms/2027-11/send", "POST", { revision: "" })).status,
    ).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("必須有手機才能開啟通知，清空手機會關閉通知", async () => {
    expect(
      (await call("/api/employees/1", "PATCH", { sms_enabled: true })).status,
    ).toBe(400);
    await readySms();
    await call("/api/employees/1", "PATCH", { phone: "" });
    const data = await json("/api/month/2027-11");
    expect(data.employees.find((e: any) => e.id === 1).sms_enabled).toBe(0);
  });
  it("同一份預覽重複送出只發一次，GET 不會代替本人確認", async () => {
    const p = await readySms();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ sid: "SM-test", status: "queued" }), {
          status: 201,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const res = await call("/api/sms/2027-11/send", "POST", {
      revision: p.revision,
    });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (await call("/api/sms/2027-11/send", "POST", { revision: p.revision }))
        .status,
    ).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
    const n = sqlite.prepare("SELECT * FROM sms_notifications").get() as any;
    expect((await call(`/confirm/${n.token}`)).status).toBe(200);
    expect(
      (
        sqlite
          .prepare("SELECT confirmed_at FROM sms_notifications")
          .get() as any
      ).confirmed_at,
    ).toBeNull();
    await call(`/confirm/${n.token}`, "POST");
    expect(
      (
        sqlite
          .prepare("SELECT confirmed_at FROM sms_notifications")
          .get() as any
      ).confirmed_at,
    ).not.toBeNull();
  });
  it("換班後舊連結失效，換回原人員仍不恢復舊連結", async () => {
    const p = await readySms();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ sid: "SM-test" }), { status: 201 }),
        ),
    );
    await call("/api/sms/2027-11/send", "POST", { revision: p.revision });
    const n = sqlite
      .prepare("SELECT token FROM sms_notifications")
      .get() as any;
    await call("/api/schedules/assignment", "PUT", {
      work_date: "2027-11-28",
      shift: "morning",
      employee_id: 2,
    });
    await call("/api/schedules/assignment", "PUT", {
      work_date: "2027-11-28",
      shift: "morning",
      employee_id: 1,
    });
    expect(await (await call(`/confirm/${n.token}`, "POST")).text()).toContain(
      "此通知已失效",
    );
    expect(
      (
        sqlite
          .prepare("SELECT confirmed_at FROM sms_notifications")
          .get() as any
      ).confirmed_at,
    ).toBeNull();
  });
  it("外部發送逾時保留待查狀態，避免重複扣費", async () => {
    const p = await readySms();
    const fetch = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetch);
    await call("/api/sms/2027-11/send", "POST", { revision: p.revision });
    expect((await json("/api/sms/2027-11")).items[0].state).toBe("unknown");
    const next = await json("/api/sms/2027-11");
    await call("/api/sms/2027-11/send", "POST", { revision: next.revision });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("班表預覽後換人，不會誤傳給原人員", async () => {
    const p = await readySms();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await call("/api/schedules/assignment", "PUT", {
      work_date: "2027-11-28",
      shift: "morning",
      employee_id: 2,
    });
    expect(
      (await call("/api/sms/2027-11/send", "POST", { revision: p.revision }))
        .status,
    ).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
});
