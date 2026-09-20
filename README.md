# 每日英語單字 · Daily English Vocab

純靜態英語單字學習網站：閃卡（Flashcard）與測驗（Quiz）。介面為繁體中文，單字本身為英文。適合外國人／自學者練習日常生活詞彙。

## 如何開啟

### 方法一：直接雙擊 `index.html`（建議）

單字資料已內嵌，用 Chrome / Edge / Safari 直接開啟即可。

### 方法二：本機 HTTP 伺服器

```bash
cd daily-english-vocab
python3 -m http.server 8080
```

然後在瀏覽器開啟：<http://127.0.0.1:8080/>

## 功能說明

### 分類篩選 📂

- 頂部可選擇**分類**（居家、飲食、購物…）或「全部」。
- 閃卡與測驗都會只從選定分類抽題；切換分類會重置閃卡紀錄，並重新開始測驗。

### 閃卡模式 🃏

- 從目前分類（或全部）約 1000+ 個日常生活英文單字中**隨機**抽出一個（盡量避免連續重複）。
- 顯示：英文單字、繁體中文釋義、說明圖（或 emoji 後備）。
- **發音**：點「發音」使用瀏覽器 `speechSynthesis`（`en-US`）。可勾選「自動發音」。
- 「上一個單字」可回到先前看過的詞；快捷鍵：`N` 下一個、`B` / `←` 上一個、`空白鍵` 發音（閃卡模式）。

### 測驗模式 ✅

- 可選題數：**20 / 50 / 100**（預設 50）。變更題數或分類會重新開始測驗。
- 每題顯示**一張圖**，從**剛好 3 個**英文選項中選出正確答案（干擾項優先同分類）。
- **答對** → 進入下一題。
- **答錯**：同一題可再試一次；**連續錯兩次**則顯示正確答案並跳到下一題（計為答錯）。
- 完成後顯示結果：答對數、答錯數、正確率，以及「共完成 N 題」。
- 可按「重新開始測驗」。

## 圖片與發音注意事項

- **圖片**：資料內含 `image`（Pollinations 免費示意圖 URL）與 `emoji`。需**網路**才能載入遠端圖；若載入失敗會自動改顯示彩色底＋大 emoji（`onerror` 後備）。
- **發音**：需瀏覽器支援 Web Speech API；Chrome / Edge / Safari 通常可用。首次可能需等系統語音清單載入。

## 檔案結構

```
daily-english-vocab/
├── index.html          # 主頁（閃卡＋測驗）
├── css/styles.css
├── js/app.js           # 前端邏輯＋用量埋點
├── data/words.json     # 單字資料（id, word, zh, emoji, category, image）
├── api/                # 用量分析 API（獨立執行，非 Pages）
│   ├── main.py
│   ├── requirements.txt
│   └── README.md
└── README.md
```

前端為純靜態，**無需建置**。GitHub Pages **只託管靜態檔**；用量分析 API 需另行本機或伺服器執行。


## 用量分析（本機 API）

前端會以 fire-and-forget 方式回報：`session_start`、`mode_enter`（flashcard｜quiz）、`session_end`（`pagehide` beacon）。API 掛掉不影響學習功能。

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- 預設 API：`http://127.0.0.1:8000`
- 統計：`GET /stats`（獨立 session 數、平均 session／閃卡／測驗時長）
- 自訂位址：設定 `window.VOCAB_ANALYTICS_API` 或 `localStorage.vocab_analytics_api`
- 詳見 [`api/README.md`](api/README.md)

## 單字資料

- 約 1000+ 筆日常生活詞彙（居家、飲食、購物、交通、天氣、健康、工作、旅行等）。
- 欄位：`{ id, word, zh, emoji, category, image }`。
