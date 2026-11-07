import { useEffect, useState } from "react";
import type { MonthData, SmsPreview } from "../shared/types";
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
    [message, setMessage] = useState("");
  async function load() {
    setPreview(await request<SmsPreview>(`/api/sms/${month}`));
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
            先確認班表與手機號碼，再由管理員發送。排班或換人不會自動發出簡訊。
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => act(load)}>
          重新預覽
        </button>
      </div>
      {preview && (
        <>
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
                      {status[item.state] || item.state}
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
