# Scout Morse 發訊器

摩斯密碼發送與接收解碼 PWA（可安裝成 App，免上架）。

## 功能

- 📡 **發送**：螢幕閃光 / 實體閃光燈 / 蜂鳴 / 震動，可循環發送（Beacon）並自訂間隔
- 🎙️ **聲音解碼**：Goertzel 演算法精準鎖頻
- 💡 **光源解碼**：後鏡頭偵測閃光
- ✋ **手動拍打鍵**：按住手動打摩斯、即時解碼
- 📻 **頻道頻率**：750 / 1000 / 1500Hz，發送與接收同步
- 📤 分享 / 匯出解碼結果、解碼歷史、速查表、音檔離線解碼

## 部署

上傳 `index.html`、`manifest.webmanifest`、`sw.js`、`icon-192.png`、`icon-512.png`、`icon-512-maskable.png` 與 `assets/` 到 GitHub，再以 Vercel 自動部署即可。詳見 `部署說明.md`。

> 專案已內建 `.vercelignore`：Vercel 部署只會上傳必要網頁產物（文件、`.git`、`node_modules`、備份檔等一律排除），不會佔用多餘的儲存空間配額。

## 版權

COPYRIGHT © 2026 SCOUT SYSTEM
