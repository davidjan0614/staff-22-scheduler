import { useEffect, useState } from "react";
import type { MonthData, NotificationSettings, SmsPreview } from "../shared/types";
import { request } from "./api";
const status: Record<string, string> = {
  ready: "待通知",
  missing_phone: "未填手機",
  disabled: "未開啟通知",
  inactive: "人員已停用",
  past: "日期已過",
  sending: "發送處理中",
  accepted: "服務商已受理",
  queued: "服務商排隊中",
  sent: "已發送，未證實送達",
  delivered: "已送達，尚未確認",
  undelivered: "無法送達",
  failed: "發送失敗",
  unknown: "結果不明，需查詢",
  confirmed: "已確認值班",
};
export function Notifications({
  month,
  data,
}: {
  month: string;
  data: MonthData;
}) {
  const [preview, setPreview] = useState<SmsPreview | null>(null),
    [busy, setBusy] = useState(false),
    [approved, setApproved] = useState(false),
    [settings, setSettings] = useState<NotificationSettings | null>(null),
    [message, setMessage] = useState("");
  async function load() {
    const next=await request<SmsPreview>(`/api/sms/${month}`);
    setPreview(next); setSettings(next.settings);
    setApproved(false);
  }
  useEffect(() => {
    setPreview(null);
    load().catch((e) => setMessage(e.message));
  }, [month, data]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const count = preview?.items.filter((i) => i.state === "ready").length || 0;
  return (
    <section>
      <div className="section-head">
        <div>
          <h2>手機簡訊通知</h2>
          <p>
            可由管理員手動發送，或設定提前天數與時間自動排程；班表換人後會重新計算。
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => act(load)}>
          重新預覽
        </button>
      </div>
      {preview && (
        <>
          {settings && <div className="notification-settings">
            <div className="section-head"><div><h3>通知發送時間</h3><p>系統會依每一班日期計算，班表換人後自動重新計算。</p></div><span className={`mode-badge ${settings.mode}`}>{settings.mode==='automatic'?'自動排程':'管理員手動'}</span></div>
            <div className="settings-grid">
              <label>發送方式<select value={settings.mode} onChange={e=>setSettings({...settings,mode:e.target.value as NotificationSettings['mode']})}><option value="automatic">自動排程發送</option><option value="manual">管理員確認後發送</option></select></label>
              <label>提前天數<select value={settings.lead_days} onChange={e=>setSettings({...settings,lead_days:Number(e.target.value)})}><option value={3}>提前 3 天</option><option value={5}>提前 5 天</option><option value={7}>提前 7 天</option><option value={1}>提前 1 天</option><option value={0}>當天</option></select></label>
              <label>發送時間<input type="time" value={settings.send_time} onChange={e=>setSettings({...settings,send_time:e.target.value})}/></label>
              <button className="primary" disabled={busy} onClick={()=>act(async()=>{await request('/api/sms/settings/current',{method:'PUT',body:JSON.stringify(settings)});await load();setMessage('通知排程設定已儲存')})}>儲存通知設定</button>
            </div>
            <p className="schedule-explain">{settings.mode==='automatic'?`將在每班值勤前 ${settings.lead_days} 天 ${settings.send_time} 自動發送；簡訊服務未啟用時不會扣費或發送。`:'目前不會自動發送，必須由管理員核對後按下發送。'}</p>
          </div>}
          <div className="notice" role="status">
            {preview.reason}
          </div>
          <p className="hint">
            待通知 {count}{" "}
            班。手機號碼與通知開關請到「人員資料」設定。相同班次不會重複發送；換人後舊確認連結會失效。
          </p>
          <div className="notification-list">
            {preview.items.length ? (
              preview.items.map((item) => (
                <article key={item.assignment_id}>
                  <div className="section-head">
                    <b>
                      {item.name} · {item.work_date} ·{" "}
                      {item.shift === "morning" ? "早班" : "下午班"}
                    </b>
                    <span className="badge">
                      {item.state==='ready'&&settings?.mode==='automatic'?'已排程':status[item.state] || item.state}
                    </span>
                  </div>
                  <p>
                    手機：
                    {item.phone
                      ? item.phone.replace(
                          /(\+886\d{2})\d{4}(\d{3})/,
                          "$1****$2",
                        )
                      : "尚未填寫"}
                  </p>
                  <p className="planned-time">預計發送：{new Date(item.scheduled_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}</p>
                  <blockquote>{item.body}［個人值班確認連結］</blockquote>
                </article>
              ))
            ) : (
              <p>本月尚未安排班次，請先建立班表。</p>
            )}
          </div>
          <div className="copy-panel">
            <h3>確認發送</h3>
            <p>
              長訊息可能分成多則計費，實際費用由簡訊服務商決定。服務商受理、手機送達與本人確認是不同狀態。
            </p>
            <label className="approval">
              <input
                type="checkbox"
                checked={approved}
                disabled={!preview.ready || !count || busy}
                onChange={(e) => setApproved(e.target.checked)}
              />
              我已核對班表與收件人，同意發送 {count} 班的付費簡訊。
            </label>
            <button
              className="primary"
              disabled={!preview.ready || !count || !approved || busy}
              onClick={() =>
                act(async () => {
                  const r = await request<{ accepted: number; failed: number }>(
                    `/api/sms/${month}/send`,
                    {
                      method: "POST",
                      body: JSON.stringify({ revision: preview.revision }),
                    },
                  );
                  await load();
                  setMessage(
                    `服務商受理 ${r.accepted} 筆，失敗或結果待查 ${r.failed} 筆。`,
                  );
                })
              }
            >
              {busy ? "處理中…" : `發送 ${count} 班通知`}
            </button>
          </div>
          <div className="section-head">
            <div>
              <h3>發送與確認紀錄</h3>
              <p>發送失敗或結果不明時，請先查詢服務商，避免重複扣費。</p>
            </div>
            <button
              className="secondary"
              disabled={!preview.ready || busy}
              onClick={() =>
                act(async () => {
                  await request(`/api/sms/${month}/refresh`, {
                    method: "POST",
                  });
                  await load();
                })
              }
            >
              查詢送達狀態
            </button>
          </div>
          <div className="notification-list">
            {preview.history.length ? (
              preview.history.map((h) => (
                <article key={h.id}>
                  <b>
                    {data.employees.find((e) => e.id === h.employee_id)?.name ||
                      "原人員"}{" "}
                    · {h.work_date} ·{" "}
                    {h.shift === "morning" ? "早班" : "下午班"}
                  </b>
                  <p>
                    {h.confirmed_at
                      ? "本人已確認（原通知）"
                      : status[h.status] || h.status}{" "}
                    · {new Date(h.created_at + "Z").toLocaleString("zh-TW")}
                  </p>
                  {h.error && <p>{h.error}</p>}
                </article>
              ))
            ) : (
              <p>尚無發送紀錄。</p>
            )}
          </div>
        </>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
