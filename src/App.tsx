import "./conditions.css";
import { Conditions } from "./Conditions";
import { Notifications } from "./Notifications";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Users,
  History,
  Printer,
  LogOut,
  RefreshCw,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Settings2,
  BookOpen,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import type {
  MonthData,
  Employee,
  Shift,
  AvailabilityStatus,
  Assignment,
} from "../shared/types";
import { SCHEDULING_RULES } from "../shared/rules";
const now = new Date();
const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const shifts = SCHEDULING_RULES.shifts;
export default function App() {
  const [logged, setLogged] = useState(!!api.token());
  const [month, setMonth] = useState(defaultMonth);
  const [data, setData] = useState<MonthData | null>(null);
  const [tab, setTab] = useState<
    "schedule" | "conditions" | "people" | "sms" | "audit" | "rules"
  >("schedule");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const canLeave = () =>
    !hasChanges || window.confirm("尚有未儲存的條件，要放棄修改嗎？");
  const load = async () => {
    setBusy(true);
    try {
      setData(await api.month(month));
    } catch (e) {
      setMessage((e as Error).message);
      if (!api.token()) setLogged(false);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (logged) load();
  }, [logged, month]);
  if (!logged) return <Login onDone={() => setLogged(true)} />;
  const missing = data?.assignments.filter((x) => !x.employee_id).length || 0;
  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      setMessage(ok);
      return { ok: true, message: ok };
    } catch (e) {
      setMessage((e as Error).message);
      return { ok: false, message: (e as Error).message };
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="brand-mark">彥宏大</div>
          <div>
            <h1>人員排班中心</h1>
            <p>月底值班 · 年度公平分配</p>
          </div>
        </div>
        <button
          className="icon-btn"
          aria-label="登出"
          onClick={() => {
            if (!canLeave()) return;
            api.logout();
            setLogged(false);
          }}
        >
          <LogOut size={20} />
        </button>
      </header>
      <main>
        <section className="hero">
          <div>
            <span className="eyebrow">排班期間</span>
            <div className="month-line">
              <input
                aria-label="排班月份"
                type="month"
                value={month}
                onChange={(e) => {
                  if (e.target.value && canLeave()) {
                    setData(null);
                    setMonth(e.target.value);
                  }
                }}
              />
              <span>28 日至月底</span>
            </div>
          </div>
          <button
            className="primary"
            disabled={busy || hasChanges}
            onClick={() =>
              act(() => api.generate(month), "已依年度公平與個人條件完成排班")
            }
          >
            <RefreshCw size={18} className={busy ? "spin" : ""} />
            自動公平排班
          </button>
        </section>
        <section className="stats">
          <Stat
            label="啟用人員"
            value={data?.employees.filter((e) => e.active).length || 0}
            suffix="人"
          />
          <Stat
            label="本月班次"
            value={data?.assignments.filter((e) => e.employee_id).length || 0}
            suffix="班"
          />
          <Stat
            label="待處理缺額"
            value={missing}
            suffix="班"
            alert={missing > 0}
          />
        </section>
        {message && (
          <div className="notice" role="status">
            {message.includes("錯") || message.includes("失敗") ? (
              <AlertTriangle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
            <span>{message}</span>
          </div>
        )}
        <nav className="tabs" aria-label="功能選單">
          <Tab
            active={tab === "schedule"}
            onClick={() => {
              if (canLeave()) setTab("schedule");
            }}
            icon={<CalendarDays />}
            label="班表"
          />
          <Tab
            active={tab === "conditions"}
            onClick={() => {
              if (canLeave()) setTab("conditions");
            }}
            icon={<CalendarDays />}
            label="不可排時段"
          />
          <Tab
            active={tab === "sms"}
            onClick={() => {
              if (canLeave()) setTab("sms");
            }}
            icon={<CheckCircle2 />}
            label="簡訊通知"
          />
          <Tab
            active={tab === "people"}
            onClick={() => {
              if (canLeave()) setTab("people");
            }}
            icon={<Users />}
            label="人員資料"
          />
          <Tab
            active={tab === "audit"}
            onClick={() => {
              if (canLeave()) setTab("audit");
            }}
            icon={<History />}
            label="調整紀錄"
          />
          <Tab
            active={tab === "rules"}
            onClick={() => {
              if (canLeave()) setTab("rules");
            }}
            icon={<BookOpen />}
            label="排班規則"
          />
        </nav>
        {tab === "schedule" && (
          <Schedule
            data={data}
            busy={busy}
            onAssign={(d, s, id) =>
              act(
                () => api.assign({ work_date: d, shift: s, employee_id: id }),
                "班表已更新",
              )
            }
          />
        )}{" "}
        {tab === "conditions" && data && (
          <Conditions
            key={month}
            data={data}
            month={month}
            onSaved={load}
            onDirtyChange={setHasChanges}
          />
        )}{" "}
        {tab === "sms" && data && (
          <Notifications key={month} month={month} data={data} />
        )}{" "}
        {tab === "people" && <People data={data} month={month} onAct={act} />}{" "}
        {tab === "audit" && <Audit data={data} />}{" "}
        {tab === "rules" && <Rules />}{" "}
      </main>
      <button className="print-fab" onClick={() => window.print()}>
        <Printer size={18} />
        列印／存成 PDF
      </button>
    </div>
  );
}
function Login({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState("");
  const [e, setE] = useState("");
  const [b, setB] = useState(false);
  return (
    <div className="login">
      <form
        onSubmit={async (x) => {
          x.preventDefault();
          setB(true);
          try {
            await api.login(p);
            onDone();
          } catch (err) {
            setE((err as Error).message);
          } finally {
            setB(false);
          }
        }}
      >
        <div className="brand-mark large">彥宏大</div>
        <h1>人員排班中心</h1>
        <p>管理員登入後可排班與調整人員條件</p>
        <label>
          管理密碼
          <input
            type="password"
            value={p}
            onChange={(x) => setP(x.target.value)}
            required
            autoFocus
          />
        </label>
        {e && <div className="error">{e}</div>}
        <button className="primary full" disabled={b}>
          {b ? "登入中…" : "登入管理中心"}
        </button>
      </form>
    </div>
  );
}
function Stat({
  label,
  value,
  suffix,
  alert = false,
}: {
  label: string;
  value: number;
  suffix: string;
  alert?: boolean;
}) {
  return (
    <article className={alert ? "stat alert" : "stat"}>
      <span>{label}</span>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
    </article>
  );
}
function Tab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
}) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
function Schedule({
  data,
  busy,
  onAssign,
}: {
  data: MonthData | null;
  busy: boolean;
  onAssign: (d: string, s: Shift, id: number | null) => void;
}) {
  const dates = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of data?.assignments || []) {
      const arr = m.get(a.work_date) || [];
      arr.push(a);
      m.set(a.work_date, arr);
    }
    return [...m.entries()].sort();
  }, [data]);
  if (!dates.length)
    return (
      <Empty
        icon={<CalendarDays />}
        title="尚未建立本月班表"
        text="按「自動公平排班」，系統會先遵守不可排條件，再依年度次數分配。"
      />
    );
  return (
    <section className="schedule">
      <div className="section-head">
        <div>
          <h2>月底值班表</h2>
          <p>點選姓名可由 Admin 手動換人；重複第 2 班會顯示提醒。</p>
        </div>
        <button className="secondary" onClick={() => window.print()}>
          <Printer size={17} />
          列印
        </button>
      </div>
      <div className="schedule-grid">
        {dates.map(([date, items]) => (
          <article className="day-card" key={date}>
            <div className="date">
              <strong>
                {new Date(`${date}T12:00:00`).toLocaleDateString("zh-TW", {
                  month: "long",
                  day: "numeric",
                })}
              </strong>
              <span>
                {new Date(`${date}T12:00:00`).toLocaleDateString("zh-TW", {
                  weekday: "short",
                })}
              </span>
            </div>
            {shifts.map((s) => {
              const a = items.find((x) => x.shift === s.id);
              return (
                <div className="shift" key={s.id}>
                  <div>
                    <b>{s.label}</b>
                    <small>{s.time}</small>
                  </div>
                  <select
                    aria-label={`${date} ${s.label}人員`}
                    disabled={busy}
                    value={a?.employee_id || ""}
                    onChange={(e) =>
                      onAssign(
                        date,
                        s.id,
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  >
                    <option value="">缺額待安排</option>
                    {data!.employees
                      .filter((e) => e.active)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}（年度 {e.annualCount || 0}）
                        </option>
                      ))}
                  </select>
                  {a?.warning && (
                    <p className="warning">
                      <AlertTriangle size={15} />
                      {a.warning}
                    </p>
                  )}
                </div>
              );
            })}
          </article>
        ))}
      </div>
    </section>
  );
}
function People({
  data,
  month,
  onAct,
}: {
  data: MonthData | null;
  month: string;
  onAct: (
    f: () => Promise<unknown>,
    m: string,
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  const [name, setName] = useState("");
  const [selectedId, setSelected] = useState<number | null>(null);
  const selected = data?.employees.find((e) => e.id === selectedId) || null;
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>人員資料與手機通知</h2>
          <p>點人員設定姓名、手機與通知開關；整月條件請到「不可排時段」。</p>
        </div>
        <form
          className="add"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onAct(() => api.addEmployee(name), "已新增人員");
            setName("");
          }}
        >
          <input
            aria-label="新員工姓名"
            placeholder="輸入姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="secondary">
            <Plus size={17} />
            新增
          </button>
        </form>
      </div>
      <div className="people-grid">
        {data?.employees.map((e) => (
          <button
            key={e.id}
            className={`person ${!e.active ? "inactive" : ""}`}
            onClick={() => setSelected(e.id)}
          >
            <span className="avatar">{e.name.slice(0, 1)}</span>
            <span>
              <b>{e.name}</b>
              <small>
                {e.active ? "可排班" : "已停用"} · 年度 {e.annualCount || 0} 班
              </small>
            </span>
            <Settings2 size={18} />
          </button>
        ))}
      </div>
      {selected && (
        <PersonDialog
          employee={selected}
          month={month}
          data={data!}
          close={() => setSelected(null)}
          onAct={onAct}
        />
      )}
    </section>
  );
}
function PersonDialog({
  employee,
  month,
  data,
  close,
  onAct,
}: {
  employee: Employee;
  month: string;
  data: MonthData;
  close: () => void;
  onAct: (
    f: () => Promise<unknown>,
    m: string,
  ) => Promise<{ ok: boolean; message: string }>;
}) {
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  async function perform(fn: () => Promise<unknown>, text: string) {
    setSaving(true);
    try {
      const result = await onAct(fn, text);
      setFeedback(result.message);
    } finally {
      setSaving(false);
    }
  }
  const [newName, setNewName] = useState(employee.name);
  const [phone, setPhone] = useState(employee.phone || "");
  const [sms, setSms] = useState(!!employee.sms_enabled);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const dates = Array.from(
    { length: last - 27 },
    (_, i) => `${month}-${String(i + 28).padStart(2, "0")}`,
  );
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${employee.name}排班條件`}
      >
        <div className="dialog-head">
          <div>
            <h3>{employee.name}</h3>
            <p>個人資料與本月優先班別</p>
          </div>
          <button
            className="secondary"
            onClick={() =>
              perform(
                () =>
                  api.updateEmployee(employee.id, { active: !employee.active }),
                employee.active ? "已停用人員" : "已重新啟用",
              )
            }
          >
            {employee.active ? "停用" : "啟用"}
          </button>
        </div>
        {feedback && (
          <p className="notice" role="status">
            {feedback}
          </p>
        )}
        <fieldset className="bare" disabled={saving}>
          <form
            className="rename"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim())
                perform(
                  () =>
                    api.updateEmployee(employee.id, {
                      name: newName.trim(),
                      phone,
                      sms_enabled: sms,
                    }),
                  "人員資料已更新",
                );
            }}
          >
            <label>
              員工姓名
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label>
              手機號碼
              <input
                type="tel"
                autoComplete="tel"
                placeholder="0912345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="approval">
              <input
                type="checkbox"
                checked={sms}
                onChange={(e) => setSms(e.target.checked)}
              />
              開啟手機簡訊通知
            </label>
            <button className="secondary">儲存人員資料</button>
          </form>
          {dates.map((date) => {
            const a = data.availability.find(
              (x) => x.employee_id === employee.id && x.work_date === date,
            );
            return (
              <div className="condition" key={date}>
                <b>{Number(date.slice(-2))} 日</b>
                <select
                  aria-label={`${date} 日期條件`}
                  value={a?.status || "available"}
                  onChange={(e) =>
                    perform(
                      () =>
                        api.availability({
                          employee_id: employee.id,
                          work_date: date,
                          status: e.target.value as AvailabilityStatus,
                          preferred_shift:
                            e.target.value === "preferred"
                              ? a?.preferred_shift || "morning"
                              : null,
                          note: a?.note || "",
                          blocked_shifts:
                            e.target.value === "unavailable"
                              ? ["morning", "afternoon"]
                              : [],
                        }),
                      "條件已儲存",
                    )
                  }
                >
                  <option value="available">可排</option>
                  <option value="unavailable">不可排</option>
                  <option value="preferred">優先</option>
                </select>
                {a?.status === "preferred" && (
                  <select
                    value={a.preferred_shift || "morning"}
                    onChange={(e) =>
                      perform(
                        () =>
                          api.availability({
                            ...a,
                            preferred_shift: e.target.value as Shift,
                          }),
                        "優先時段已儲存",
                      )
                    }
                  >
                    <option value="morning">早班</option>
                    <option value="afternoon">下午班</option>
                  </select>
                )}
              </div>
            );
          })}
        </fieldset>
        <button className="primary full" onClick={close}>
          完成
        </button>
      </div>
    </div>
  );
}
function Audit({ data }: { data: MonthData | null }) {
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>最近調整紀錄</h2>
          <p>自動排班、手動換人與人員狀態異動都保留紀錄。</p>
        </div>
      </div>
      <div className="audit">
        {data?.audit.map((a) => (
          <article key={a.id}>
            <span className="audit-dot" />
            <div>
              <b>{a.action}</b>
              <p>{a.detail}</p>
              <small>
                {new Date(a.created_at + "Z").toLocaleString("zh-TW")}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
function Rules() {
  return (
    <section className="rules-page">
      <div className="rules-intro">
        <div className="rules-icon">
          <ShieldCheck />
        </div>
        <div>
          <span className="eyebrow">公開透明</span>
          <h2>自動公平排班規則</h2>
          <p>
            這一頁說明系統實際採用的排班順序。規則與演算法共用同一份設定，未來調整程式時應同步更新此處。
          </p>
        </div>
        <span className="version">
          規則 V{SCHEDULING_RULES.version}
          <small>生效日 {SCHEDULING_RULES.effectiveDate}</small>
        </span>
      </div>
      <div className="rule-summary">
        <div>
          <span>排班日期</span>
          <strong>每月 {SCHEDULING_RULES.startDay} 日至月底</strong>
        </div>
        {SCHEDULING_RULES.shifts.map((s) => (
          <div key={s.id}>
            <span>{s.label}</span>
            <strong>{s.time} · 1 人</strong>
          </div>
        ))}
      </div>
      <ol className="rule-list">
        {SCHEDULING_RULES.principles.map((rule, index) => (
          <li key={rule.title}>
            <span>{index + 1}</span>
            <div>
              <h3>{rule.title}</h3>
              <p>{rule.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="rules-note">
        <AlertTriangle />
        <div>
          <b>重要原則</b>
          <p>
            公平不會優先於「不可排」條件。若條件互相衝突，系統留下缺額交由 Admin
            處理，不會私自改變員工設定。
          </p>
        </div>
      </div>
    </section>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
