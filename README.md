# 每日英語單字 · Daily English Vocab

純靜態英語學習網站：支援**單字**與**生活情境句子**，含閃卡（Flashcard）與測驗（Quiz）。介面為繁體中文，內容為英文。適合外國人／自學者練習日常生活詞彙與口語。

## 如何開啟

### 方法一：直接雙擊 `index.html`（建議）

單字與句子資料已內嵌，用 Chrome / Edge / Safari 直接開啟即可。

### 方法二：本機 HTTP 伺服器

```bash
cd daily-english-vocab
python3 -m http.server 8080
```

然後在瀏覽器開啟：<http://127.0.0.1:8080/>

## 功能說明

### 內容切換：單字｜句子 📑

- 頁首可在 **單字** 與 **句子** 之間切換。
- **單字**：既有分類篩選、閃卡、看圖選英文字測驗。
- **句子**：依生活情境練習口語例句（約每情境 100 句）。

### 單字 · 分類篩選 📂

- 頂部可選擇**分類**（居家、飲食、購物、動物…）或「全部」。單字分類含 `animals`（動物）等；篩選下拉選單由 `CATEGORY_ZH` 與資料自動重建。
- 閃卡與測驗都會只從選定分類抽題；切換分類會重置閃卡紀錄，並重新開始測驗。

### 句子 · 情境篩選 💬

情境（`scene` key → 顯示名稱）：

| key | 名稱 |
|-----|------|
| school | 學校 |
| office | 公司／職場 |
| restaurant | 餐廳 |
| station | 車站 |
| shopping | 購物 |
| home | 居家 |
| hospital | 醫院／診所 |

- 可選「全部」或單一情境；約 **7 × 100 = 700** 句自然中階口語英文＋繁中對譯。
- **閃卡**：英文句子為主、中文在下；**發音**（`speechSynthesis` en-US，略慢）；上一個／下一個（歷史堆疊）。
- **測驗**（輕量）：看中文，從 3 個英文句子中選正確答案；可聽發音；題數 20／50／100。

### 閃卡模式 🃏

- 單字：隨機抽詞（盡量避免連續重複），顯示英文、繁中、圖／emoji。
- 句子：隨機抽句，顯示情境標籤與整句。
- **發音**／「自動發音」；快捷鍵：`N` 下一個、`B` / `←` 上一個、`空白鍵` 發音（閃卡）。

### 測驗模式 ✅

- 可選題數：**20 / 50 / 100**（預設 50）。
- **單字**：看圖選英文；可先聽發音。
- **句子**：看中文選英文句子；可先聽發音。
- 答對 → 下一題；答錯可再試一次；連續錯兩次顯示正解並計錯。

## 圖片與發音注意事項

- **圖片**（僅單字）：資料內含 `image`（Pollinations URL）與 `emoji`；需網路。失敗時改顯示彩色底＋大 emoji。
- **發音**：Web Speech API；Chrome / Edge / Safari 通常可用。句子模式語速略慢以便跟讀。

## 檔案結構

```
daily-english-vocab/
├── index.html
├── css/styles.css
├── js/app.js           # 單字邏輯＋用量埋點＋內容切換
├── js/sentences.js     # 句子閃卡／測驗
├── data/words.json | words.js
├── data/sentences.json | sentences.js
├── scripts/gen_sentences.py
├── api/                # 用量分析 API（獨立）
└── README.md
```

前端為純靜態，**無需建置**。GitHub Pages 只託管靜態檔。

## 用量分析（本機 API）

前端 fire-and-forget：`session_start`、`mode_enter`（僅 **flashcard｜quiz**，且在**單字**內容下）、`session_end`。  
句子模式**不會**送出無效的 `mode_enter`（避免 API `Literal` 422）。API 掛掉不影響學習。

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- 預設 API：`http://127.0.0.1:8000`
- 自訂：`window.VOCAB_ANALYTICS_API` 或 `localStorage.vocab_analytics_api`
- 詳見 [`api/README.md`](api/README.md)

## 資料欄位

- 單字：`{ id, word, zh, emoji, category, image }`（約 1300+，含動物等分類）
- 句子：`{ id, scene, en, zh }`（約 700）
