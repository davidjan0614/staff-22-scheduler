# 22 人排班系統

Cloudflare Workers + D1 上的月底公平值班系統。支援 22 人（可增減）、每月 28 日至月底、早班 08:00–12:30、下午班 12:30–17:00、每班 1 人、年度公平、每月可排／不可排／優先條件、Admin 手動第 2 班、缺額提示、調整紀錄與列印。

## 本機啟動

```bash
npm install
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run worker:dev
```

另一個終端執行 `npm run dev`。請在 `.dev.vars` 設定 `ADMIN_PASSWORD`。

## 部署

1. `npx wrangler d1 create staff-22-scheduler-db`
2. 將回傳的 database_id 寫入 `wrangler.jsonc`
3. `npm run db:migrate:remote`
4. `npx wrangler secret put ADMIN_PASSWORD`
5. `npm run deploy`

排班演算法優先遵守不可排條件，再依年度班次由少至多分配，最後以「優先時段」作加權。同月自動排班不重複；Admin 手動第 2 班時會顯示警告並寫入紀錄。
