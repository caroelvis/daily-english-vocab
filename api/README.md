# Usage Analytics API

輕量 FastAPI 服務：接收前端埋點事件，以 SQLite 儲存，並提供簡單統計。

## 端點

| Method | Path | 說明 |
|--------|------|------|
| `POST` | `/events` | 寫入一筆或多筆事件 |
| `GET` | `/stats` | 彙總統計 |
| `GET` | `/health` | 健康檢查 |

### 事件格式

單筆：

```json
{
  "session_id": "uuid-or-random-string",
  "event": "session_start | mode_enter | session_end",
  "mode": "flashcard | quiz",
  "ts": 1720000000000
}
```

`mode` 在 `mode_enter` 時必填；`ts` 為客戶端毫秒時間戳。

批次：`{ "events": [ ... ] }`。

### `/stats` 回傳

- `unique_sessions`：不重複 `session_id` 數
- `avg_session_duration_sec`：各 session 的 `session_end − session_start`（缺則用首末事件）平均值（秒）
- `avg_flashcard_time_sec`：每次進入閃卡模式到切換／結束的時段平均值（秒）
- `avg_quiz_time_sec`：同上，測驗模式

## 本機執行

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

API 預設：<http://127.0.0.1:8000>  
文件：<http://127.0.0.1:8000/docs>

資料庫檔案：`api/analytics.db`（執行後自動建立）。

## CORS

允許 `localhost` / `127.0.0.1`（任意埠）以及 `*.github.io`，方便本機與 GitHub Pages 靜態站呼叫。

## 注意

GitHub Pages **只託管靜態前端**；此 API 需自行部署（本機、VPS、或任意可跑 Python 的主機）。前端可透過 `window.VOCAB_ANALYTICS_API` 或 `localStorage.vocab_analytics_api` 指定 API 位址。
