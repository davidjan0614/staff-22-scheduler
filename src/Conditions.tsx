import { useEffect, useState } from "react";
import type {
  Availability,
  Employee,
  MonthData,
  RecurringCondition,
  Shift,
} from "../shared/types";
import { datesInMonth, isBlocked, validMonth } from "../shared/availability";
import { request } from "./api";

type Snapshot = {
  availability: Availability[];
  recurring: RecurringCondition[];
  revision: string;
};
const shifts: Shift[] = ["morning", "afternoon"];
const labels = { morning: "早班", afternoon: "下午班" };
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
const key = (id: number, date: string, shift: Shift) =>
  `${id}:${date}:${shift}`;
const save = (scope: string, snapshot: Snapshot, items: Availability[]) =>
  request(`/api/conditions/${scope}`, {
    method: "PUT",
    body: JSON.stringify({ revision: snapshot.revision, items }),
  });

export function Conditions({
  data,
  month,
  onSaved,
  onDirtyChange,
}: {
  data: MonthData;
  month: string;
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [mode, setMode] = useState<"month" | "year">("month");
  const [hasChanges, setHasChanges] = useState(false);
  function reportDirty(value: boolean) {
    setHasChanges(value);
    onDirtyChange(value);
  }
  function changeMode(value: "month" | "year") {
    if (hasChanges && !window.confirm("尚有未儲存的修改，要放棄修改嗎？"))
      return;
    setMode(value);
  }
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>不可排時段</h2>
          <p>
            勾選代表「不能排班」。未填寫不等於已確認有空；儲存後才會套用到排班。
          </p>
        </div>
        <div className="segmented">
          <button
            className={mode === "month" ? "selected" : ""}
            onClick={() => changeMode("month")}
          >
            當月人員總覽
          </button>
          <button
            className={mode === "year" ? "selected" : ""}
            onClick={() => changeMode("year")}
          >
            個人全年／固定條件
          </button>
        </div>
      </div>
      {mode === "month" ? (
        <Monthly
          key={month}
          data={data}
          month={month}
          onSaved={onSaved}
          onDirtyChange={reportDirty}
        />
      ) : (
        <Annual
          data={data}
          year={month.slice(0, 4)}
          onSaved={onSaved}
          onDirtyChange={reportDirty}
        />
      )}
    </section>
  );
}

function Monthly({
  data,
  month,
  onSaved,
  onDirtyChange,
}: {
  data: MonthData;
  month: string;
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [draft, setDraft] = useState<Record<string, boolean>>({}),
    [dirty, setDirty] = useState<Set<number>>(new Set()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [target, setTarget] = useState(""),
    [copy, setCopy] = useState<{
      snapshot: Snapshot;
      items: Availability[];
      existing: number;
      skipped: number;
    } | null>(null);
  const employees = data.employees.filter((e) => e.active),
    dates = datesInMonth(month);
  async function load() {
    const s = await request<Snapshot>(`/api/conditions/${month}`);
    setSnapshot(s);
    setDraft({});
    setDirty(new Set());
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [month]);
  useEffect(() => {
    if (!dirty.size) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty.size]);
  useEffect(() => {
    onDirtyChange(dirty.size > 0);
    return () => onDirtyChange(false);
  }, [dirty.size]);
  const blocked = (id: number, date: string, shift: Shift) =>
    draft[key(id, date, shift)] ??
    isBlocked(
      id,
      date,
      shift,
      snapshot?.availability || [],
      snapshot?.recurring || [],
    );
  function toggle(id: number, date: string, shift: Shift) {
    setDraft((d) => ({
      ...d,
      [key(id, date, shift)]: !blocked(id, date, shift),
    }));
    setDirty((d) => new Set([...d, id]));
    setCopy(null);
  }
  const itemsFor = (ids: Set<number>): Availability[] =>
    employees
      .filter((e) => ids.has(e.id))
      .flatMap((e) =>
        dates.map((work_date) => {
          const old = snapshot!.availability.find(
            (a) => a.employee_id === e.id && a.work_date === work_date,
          );
          const blocked_shifts = shifts.filter((s) =>
            blocked(e.id, work_date, s),
          );
          return {
            employee_id: e.id,
            work_date,
            status:
              blocked_shifts.length === 2
                ? "unavailable"
                : old?.status === "preferred"
                  ? "preferred"
                  : "available",
            preferred_shift: old?.preferred_shift || null,
            note: old?.note || "",
            blocked_shifts,
          };
        }),
      );
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepareCopy() {
    if (!validMonth(target) || target === month)
      throw new Error("請選擇不同的目標月份");
    if (dirty.size) throw new Error("請先儲存本月修改，再複製");
    const next = await request<Snapshot>(`/api/conditions/${target}`),
      targetDates = datesInMonth(target);
    const source = itemsFor(
      new Set(
        employees
          .filter((e) =>
            dates.every((d) =>
              snapshot!.availability.some(
                (a) => a.employee_id === e.id && a.work_date === d,
              ),
            ),
          )
          .map((e) => e.id),
      ),
    );
    const items = source
      .map((a) => ({ ...a, work_date: `${target}-${a.work_date.slice(-2)}` }))
      .filter((a) => targetDates.includes(a.work_date));
    if (!items.length)
      throw new Error("本月還沒有已確認的完整人員條件，請先勾選並儲存。");
    setCopy({
      snapshot: next,
      items,
      existing: items.filter((a) =>
        next.availability.some(
          (b) => b.employee_id === a.employee_id && b.work_date === a.work_date,
        ),
      ).length,
      skipped: source.length - items.length,
    });
  }
  if (!snapshot) return <p role="status">{message || "正在載入條件…"}</p>;
  const pending = employees.filter(
    (e) =>
      !dates.every((d) =>
        snapshot.availability.some(
          (a) => a.employee_id === e.id && a.work_date === d,
        ),
      ),
  ).length;
  return (
    <>
      <div className="condition-summary">
        <b>
          {month} · {employees.length} 人 · {dates.length * 2} 個時段
        </b>
        <span>尚未確認 {pending} 人</span>
        <span>已修改 {dirty.size} 人</span>
      </div>
      <p className="hint">
        固定條件先帶入；當月儲存的設定優先。原有「優先班別」會保留，可到「人員資料」調整。
      </p>
      <fieldset disabled={busy} className="bare">
        <div className="table-scroll">
          <table className="availability-table">
            <thead>
              <tr>
                <th scope="col">人員</th>
                {dates.map((date) => (
                  <th scope="col" key={date} colSpan={2}>
                    {dayLabel(date)}
                  </th>
                ))}
                <th scope="col">確認狀態</th>
              </tr>
              <tr>
                <th scope="col">勾選＝不能排</th>
                {dates.flatMap((date) =>
                  shifts.map((s) => (
                    <th scope="col" key={date + s}>
                      {labels[s]}
                    </th>
                  )),
                )}
                <th scope="col">
                  <button
                    className="text-button"
                    onClick={() =>
                      setDirty(new Set(employees.map((e) => e.id)))
                    }
                  >
                    確認全部目前設定
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const confirmed = dates.every((d) =>
                  snapshot.availability.some(
                    (a) => a.employee_id === e.id && a.work_date === d,
                  ),
                );
                return (
                  <tr key={e.id}>
                    <th scope="row">{e.name}</th>
                    {dates.flatMap((date) =>
                      shifts.map((shift) => (
                        <td
                          key={date + shift}
                          className={
                            blocked(e.id, date, shift) ? "blocked" : ""
                          }
                        >
                          <label className="check-cell">
                            <input
                              type="checkbox"
                              aria-label={`${e.name} ${date} ${labels[shift]}不能排`}
                              checked={blocked(e.id, date, shift)}
                              onChange={() => toggle(e.id, date, shift)}
                            />
                            <span>
                              {blocked(e.id, date, shift) ? "不可排" : "可排"}
                            </span>
                          </label>
                        </td>
                      )),
                    )}
                    <td>
                      {dirty.has(e.id) ? (
                        <span className="badge pending">待儲存</span>
                      ) : confirmed ? (
                        <span className="badge">已確認</span>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() => setDirty((d) => new Set([...d, e.id]))}
                        >
                          確認目前設定
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="save-bar">
          <span>只有按下儲存，修改才會生效。</span>
          <button
            className="primary"
            disabled={!dirty.size || busy}
            onClick={() =>
              perform(async () => {
                await save(month, snapshot, itemsFor(dirty));
                await load();
                await onSaved();
                setMessage("本月不可排時段已儲存。");
              })
            }
          >
            {busy ? "處理中…" : `儲存 ${dirty.size} 人的設定`}
          </button>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => perform(load)}
        >
          放棄修改／重新載入
        </button>
        <div className="copy-panel">
          <h3>將已確認的條件複製到其他月份</h3>
          <p>
            依相同日期複製，例如 28
            日早班。目標月份不存在的日期會略過；不會複製尚未確認的人員。
          </p>
          <div className="inline-fields">
            <label>
              目標月份
              <input
                aria-label="複製目標月份"
                type="month"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setCopy(null);
                }}
              />
            </label>
            <button className="secondary" onClick={() => perform(prepareCopy)}>
              預覽複製
            </button>
          </div>
          {copy && (
            <div role="status">
              <p>
                將複製 {copy.items.length} 筆日期條件到 {target}；其中{" "}
                {copy.existing} 筆會覆蓋既有設定，略過 {copy.skipped}{" "}
                筆不存在的日期。
              </p>
              <button
                className="primary"
                onClick={() =>
                  perform(async () => {
                    await save(target, copy.snapshot, copy.items);
                    setCopy(null);
                    setMessage(`已將條件複製到 ${target}。`);
                  })
                }
              >
                確認複製到 {target}
              </button>
            </div>
          )}
        </div>
      </fieldset>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  );
}

function Annual({
  data,
  year,
  onSaved,
  onDirtyChange,
}: {
  data: MonthData;
  year: string;
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [id, setId] = useState(
      data.employees.find((e) => e.active)?.id || data.employees[0]?.id || 0,
    ),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [draft, setDraft] = useState<Record<string, boolean>>({}),
    [fixed, setFixed] = useState<RecurringCondition[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(false),
    [fixedDirty, setFixedDirty] = useState(false);
  const dates = Array.from({ length: 12 }, (_, i) =>
    datesInMonth(`${year}-${String(i + 1).padStart(2, "0")}`),
  );
  async function load() {
    const s = await request<Snapshot>(`/api/conditions/${year}`);
    setSnapshot(s);
    setDraft({});
    setFixed(s.recurring.filter((r) => r.employee_id === id));
    setDirty(false);
    setFixedDirty(false);
  }
  useEffect(() => {
    setSnapshot(null);
    load().catch((e) => setMessage(e.message));
  }, [year, id]);
  useEffect(() => {
    onDirtyChange(dirty || fixedDirty);
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    if (dirty || fixedDirty) window.addEventListener("beforeunload", handler);
    return () => {
      onDirtyChange(false);
      window.removeEventListener("beforeunload", handler);
    };
  }, [dirty, fixedDirty]);
  const blocked = (date: string, shift: Shift) =>
    draft[key(id, date, shift)] ??
    isBlocked(
      id,
      date,
      shift,
      snapshot?.availability || [],
      snapshot?.recurring || [],
    );
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label className="inline-fields">
        選擇人員
        <select
          aria-label="全年條件人員"
          value={id}
          disabled={busy || dirty || fixedDirty}
          onChange={(e) => setId(Number(e.target.value))}
        >
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {!e.active ? "（已停用）" : ""}
            </option>
          ))}
        </select>
        <span>{year} 年 · 勾選不能排的時段</span>
      </label>
      {snapshot ? (
        <fieldset className="bare" disabled={busy}>
          <div className="annual-grid">
            {dates.map((days, i) => (
              <article className="annual-card" key={i}>
                <h3>{i + 1} 月</h3>
                {days.map((date) => (
                  <div className="annual-day" key={date}>
                    <b>{dayLabel(date)}</b>
                    {shifts.map((shift) => (
                      <label key={shift}>
                        <input
                          type="checkbox"
                          aria-label={`${date} ${labels[shift]}不能排`}
                          checked={blocked(date, shift)}
                          onChange={() => {
                            setDraft((d) => ({
                              ...d,
                              [key(id, date, shift)]: !blocked(date, shift),
                            }));
                            setDirty(true);
                          }}
                        />
                        {labels[shift]}
                      </label>
                    ))}
                  </div>
                ))}
              </article>
            ))}
          </div>
          <div className="save-bar">
            <span>
              儲存會確認此人全年的日期條件。{dirty ? "有尚未儲存的修改。" : ""}
            </span>
            <button
              className="primary"
              onClick={() =>
                perform(async () => {
                  await save(
                    year,
                    snapshot,
                    dates.flat().map((work_date) => {
                      const old = snapshot.availability.find(
                          (a) =>
                            a.employee_id === id && a.work_date === work_date,
                        ),
                        blocked_shifts = shifts.filter((s) =>
                          blocked(work_date, s),
                        );
                      return {
                        employee_id: id,
                        work_date,
                        status:
                          blocked_shifts.length === 2
                            ? "unavailable"
                            : old?.status === "preferred"
                              ? "preferred"
                              : "available",
                        preferred_shift: old?.preferred_shift || null,
                        note: old?.note || "",
                        blocked_shifts,
                      };
                    }),
                  );
                  await load();
                  await onSaved();
                  setMessage("此人全年條件已儲存。");
                })
              }
            >
              儲存全年條件
            </button>
            <button className="secondary" onClick={() => perform(load)}>
              放棄修改／重新載入
            </button>
          </div>
          <div className="copy-panel">
            <h3>每月固定不能排的星期</h3>
            <p>
              只在每月 28
              日至月底生效。已儲存的個別日期優先，不會被固定條件覆蓋。
            </p>
            <div className="weekday-grid">
              {["日", "一", "二", "三", "四", "五", "六"].map(
                (day, weekday) => (
                  <div key={day}>
                    <b>週{day}</b>
                    {shifts.map((shift) => (
                      <label key={shift}>
                        <input
                          type="checkbox"
                          checked={fixed.some(
                            (r) => r.weekday === weekday && r.shift === shift,
                          )}
                          onChange={(e) => {
                            setFixedDirty(true);
                            setFixed((r) =>
                              e.target.checked
                                ? [...r, { employee_id: id, weekday, shift }]
                                : r.filter(
                                    (x) =>
                                      !(
                                        x.weekday === weekday &&
                                        x.shift === shift
                                      ),
                                  ),
                            );
                          }}
                        />
                        {labels[shift]}
                      </label>
                    ))}
                  </div>
                ),
              )}
            </div>
            <button
              className="secondary"
              disabled={dirty || !fixedDirty}
              onClick={() =>
                perform(async () => {
                  await request(`/api/recurring/${id}`, {
                    method: "PUT",
                    body: JSON.stringify({ items: fixed }),
                  });
                  await load();
                  await onSaved();
                  setMessage("固定條件已儲存；已確認的日期維持個別設定。");
                })
              }
            >
              儲存固定條件
            </button>
            {dirty && <p>請先儲存或放棄上方的全年修改。</p>}
          </div>
        </fieldset>
      ) : (
        <p>載入中…</p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  );
}
