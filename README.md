# Scout Morse 發訊器 v5.3.0

摩斯密碼發送與接收解碼 **PWA**（可「加到主畫面」當 App 用，免上架）。純靜態、零依賴、離線可用。

COPYRIGHT © 2026 SCOUT SYSTEM · 授權見 [LICENSE](LICENSE)

> **免責**：本 App 只作童軍訓練、興趣與輔助通訊之用，**不可作為緊急求救的唯一手段**。
> 遇上真正危急情況，請立即致電 **999**（香港）或當地緊急服務。

---

## 1. 功能

| 模組 | 內容 |
|---|---|
| 📡 發送 | **3 秒倒數確認（可取消）**→ 螢幕閃光 / 實體閃光燈（torch）/ 蜂鳴 / 震動；可循環發送（Beacon）＋自訂間隔 |
| 🎙️ 聲音解碼 | Goertzel 單頻鎖頻，V5 引擎（取樣時鐘計時＋雙門檻磁滯） |
| 💡 光源解碼 | 後鏡頭偵測畫面中央亮度變化 |
| ✋ 手動電報拍鍵 | 短按＝點、長按＝劃；支援全螢幕拍發、鍵盤空白鍵、退格／空格／結算 |
| 🎮 聽力特訓遊戲 | 8 關卡 × 3 難度，連勝計分 |
| 📻 頻道頻率 | 750 / 1000 / 1500 Hz，收發同步 |
| 📤 分享／匯出 | 解碼結果複製、原生分享 |
| 📚 速查表 / 音檔離線解碼 | 點 A–Z、0–9 發聲；上傳錄音離線解碼 |
| 📱 PWA | 安裝入口（Android 系統對話框／iOS 三步教學卡）＋「立即更新／稍後」版本提示 |
| ☀️ 螢幕常亮 | 接收時向系統申請 Wake Lock，長時解碼唔會中途鎖屏；接收頁可一鍵關閉 |
| ♿ 無障礙 | 所有表單 label 有 `for`／chips 有 `role=group`；解碼結果 `aria-live`；分頁 `role=tab`＋`aria-selected` |

## 2. 檔案

```
index.html              # 主程式（單頁，所有功能在內）
manifest.webmanifest    # PWA 設定（4 個 icon：any 192/512、maskable 192/512）
sw.js                   # Service Worker（APP_VERSION 為唯一版號來源）
icons/                  # 9 個 PNG／ICO（favicon 16/32/48、apple-touch 180、192、512、maskable 192/512、og-image）
assets/css/             # Tailwind（已編譯）
assets/fontawesome/     # Font Awesome Free 6（本地 woff2，離線用；已移除 815 KB 無人用嘅 .ttf）
vercel.json             # CSP／安全 header／快取政策／region
scripts/verify.mjs      # 零依賴驗證（19 組檢查，等同 npm run check）
```

部署：`vercel.json` 已設定；Vercel 上傳 **18 個檔案 ≈ 0.70 MB**（`.vercelignore` 已擋走文件、CI、`.git`）。
詳見 [`部署說明.md`](部署說明.md)。

## 3. 本機驗證

```bash
node scripts/verify.mjs          # 靜態驗證 19 組（或 npm run check）
node scripts/decode.test.mjs     # 解碼引擎行為測試 83 項（或 npm run test:decode）
npm test                         # 兩支一齊跑
```

**為甚麼要第二支**：`verify.mjs` 只驗標記在唔在（有 Goertzel、有 REV_MORSE），
驗唔到「解出嚟嘅字對唔對」。`decode.test.mjs` 由 `@@PURE-START@@` 區塊抽出引擎，
用合成正弦波餵 Goertzel→狀態機，比對文字。**種子準確時 48 條組合 100% 全對**；
亦已記錄「種子估錯 ≥2 倍」時的真實輸出（見 §5）。

20 組檢查：

1. 必要網頁產物齊全
2. `index.html` 本地引用零 404
3. CSS `url()` 字型引用存在
4. `sw.js` 預快取清單全部存在
5. `manifest.webmanifest` 合法、圖示存在
6. `sw.js` 與內嵌 `<script>` 通過 `node --check`
7. 無垃圾檔／重複資料夾
8. 無死引用
9. 依 `.vercelignore` 模擬部署 payload，確認**恰為**必要產物（無孤兒）
10. 核心功能標記零倒退
11. **圖標標準**：9 個檔案、PNG IHDR 驗尺寸、favicon.ico 三尺寸、合計 ≤260 KB
12. **版號同步**：`index.html`（meta／`APP_VERSION`）＝ `sw.js` ＝ `manifest` ＝ `package.json`
13. **PWA 安裝／更新**：`beforeinstallprompt` 有攔、更新 banner、`SKIP_WAITING`、2.5 秒 fallback、30 分鐘檢查、`install` 內唔准無條件 `skipWaiting()`
14. **防呆**：零 `alert()`／`confirm()`／`prompt()`，對話框有 `role`／`aria-modal`
15. **安全**：解碼內容（不可信輸入）入 `innerHTML` 前必須 escape
16. **`hidden` 真係收得起**：自己計 CSS 特異性＋出現次序，並掃「同時有 `hidden` + `.flex`」嘅元素
17. **無障礙**：`label` 有 `for=`（或群組 `aria-labelledby`）、動態輸出有 `aria-live`、分頁有 `role=tab`／`aria-selected`／`aria-controls`
18. **危險動作**：發送前倒數＋可取消、倒數後才開硬件、UI 有免責聲明
19. **體積預算**：payload ≤ 1.0 MB、無單檔 > 500 KB
20. **螢幕常亮（Wake Lock）**：有取／有放、頁面隱藏後會重取、失敗要靜靜降級（唔准阻住解碼）、iOS 主畫面限制要有處理、唔准用 NoSleep.js 式 hack

CI：`.github/workflows/verify.yml`（Actions 已釘 commit SHA）每次 push／PR／每週一跑同一條。

> **為甚麼有第 16 組**：v5.1.0 的 15 組全部通過，但 App 其實一開頁就壞 ——
> `[hidden]{display:none}`（特異性 0,1,0）在編譯後排在 `.flex`（同樣 0,1,0）之前，
> 令「加到主畫面」教學卡永遠顯示。**標記齊 ≠ 行為對**，所以新增檢查直接驗 CSS 串接。

## 4. 改版流程（唔好漏步）

1. 升版號：`package.json`、`index.html`（`<meta name="app-version">`、`<title>`、`APP_VERSION`、頁尾、更新內容清單）、`manifest.webmanifest`、`sw.js` 的 `APP_VERSION`（快取名自動跟隨）。
2. 跑 `node scripts/verify.mjs`，19 組全綠。
3. **行為煙霧測試**（可選但建議）：本輪用 jsdom 跑過 20 項 —— 教學卡收得起、Tab 轉頁＋hash、倒數可取消、取消後唔會偷偷發送、XSS 無效、零執行期錯誤。
4. 真機驗收（PWA 唔可以用模擬器代替）：Android Chrome 與 iPhone Safari 各一次 —— 安裝 → 由主畫面開（確認全螢幕）→ 斷網開（確認離線可用）。
5. 舊版頁面應出現「有新版本可用」banner；按「立即更新」後自動 reload，解碼歷史與遊戲進度保留。

## 5. 已知限制（誠實講）

- **實體閃光燈**：iPhone 需 iOS 17.4+ **Safari**；iOS 上 Chrome／Edge／Firefox 都係 WebKit，一樣要「分享 → 加入主畫面」。桌面瀏覽器無 torch。
- **iOS 冇 `beforeinstallprompt`**：所以一律出教學卡，唔會「一鍵安裝」。
- **只用 `woff2` 字型**：2016 年後嘅瀏覽器全部支援；真係要支援 IE11 級數（唔可能，因為 App 用咗 ES2020＋Service Worker）才需要 `ttf`。
- **免責**：摩斯通訊只屬練習／輔助，唔可以當緊急求救嘅唯一手段（UI 已有提示）。
- 相機、咪高峰需要 HTTPS 與用戶授權；首次使用會跳權限請求。
- 本 App 冇後端、冇帳號、冇追蹤；分析只有 Vercel Web Analytics／Speed Insights（匿名字段）。
- **解碼速度種子**：若不知對方速度而估錯 ≥2 倍，第一個字母可能解錯（之後會自動校正）。
  UI 已提示：揀接近的「對方速度」，或撳「速度」掣即時重新校正。
- **螢幕常亮（Wake Lock）**：Chrome/Edge 84+、Safari 16.4+、Firefox 126+。
  ⚠️ iOS 16.4–18.3 的「已加到主畫面」模式**無效**（WebKit 已知問題，18.4 才修）；
  這種情況 App 會在接收頁即時標明，並請你手動把「設定 → 螢幕與亮度 → 自動鎖定」調長。
- **未做英文介面**：真理倉 `docs/44` 嘅 L 系列只適用於 2026-11-08 之後新開嘅 app，本 app 屬豁免；建議下次大版補。

## 6. 版權與第三方

- 本專案：COPYRIGHT © 2026 SCOUT SYSTEM — 條款見 [LICENSE](LICENSE)（可自由使用／改作，須保留版權標示，不得移除）。
- Tailwind CSS（MIT）、Font Awesome Free 6（CC BY 4.0 / SIL OFL 1.1 / MIT）。
