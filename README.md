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

### 閃卡模式 🃏

- 從約 1000+ 個日常生活英文單字中**隨機**抽出一個（盡量避免連續重複）。
- 顯示：英文單字、繁體中文釋義、說明圖（或 emoji 後備）。
- **發音**：點「發音」使用瀏覽器 `speechSynthesis`（`en-US`）。可勾選「自動發音」。
- 快捷鍵：`N` 下一個、`空白鍵` 發音（閃卡模式）。

### 測驗模式 ✅

- 每題顯示**一張圖**，從**剛好 3 個**英文選項中選出正確答案。
- **答對** → 進入下一題。
- **答錯**：同一題可再試一次；**連續錯兩次**則顯示正確答案並跳到下一題（計為答錯）。
- 完成 **100 題**後顯示結果：答對數、答錯數（兩次錯誤後跳過的題數）、正確率。
- 可按「重新開始測驗」。

## 圖片與發音注意事項

- **圖片**：資料內含 `image`（Pollinations 免費示意圖 URL）與 `emoji`。需**網路**才能載入遠端圖；若載入失敗會自動改顯示彩色底＋大 emoji（`onerror` 後備）。
- **發音**：需瀏覽器支援 Web Speech API；Chrome / Edge / Safari 通常可用。首次可能需等系統語音清單載入。

## 檔案結構

```
daily-english-vocab/
├── index.html          # 主頁（閃卡＋測驗）
├── css/styles.css
├── js/app.js
├── data/words.json     # 單字資料（id, word, zh, emoji, category, image）
└── README.md
```

無需建置步驟、無後端。不依賴 git remote / CloudAgent。

## 單字資料

- 約 1000+ 筆日常生活詞彙（居家、飲食、購物、交通、天氣、健康、工作、旅行等）。
- 欄位：`{ id, word, zh, emoji, category, image }`。
