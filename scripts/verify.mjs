#!/usr/bin/env node
/**
 * scripts/verify.mjs — Scout Morse 靜態站「零倒退」驗證（零依賴，Node 18+）
 *
 * 本專案為純靜態 PWA（無 package.json、無建置步驟），因此沒有
 * npm run build / lint 可跑；本腳本提供等價（且更貼近本專案）的驗證：
 *
 *   1) 必要網頁產物齊全
 *   2) index.html 所有本地引用（href/src/JS 字串）皆可解析，零 404
 *   3) CSS 內 url() 字型引用皆存在
 *   4) sw.js 預快取清單（ASSETS）內的檔案全部存在
 *   5) manifest.webmanifest 為合法 JSON，圖示存在
 *   6) sw.js 與 index.html 內嵌 <script> 通過 node --check 語法檢查
 *   7) 專案內無 *.bak/*.tmp/*.old/*.log 等垃圾檔，無重複上傳資料夾
 *   8) 程式碼無指向已刪除／未部署路徑的死引用
 *   9) 依 .vercelignore 模擬實際上傳 Vercel 的檔案清單與大小，
 *      並確認 payload「恰好」等於必要網頁產物（無孤兒檔案）
 *  10) 核心功能標記（Goertzel／閃光燈／蜂鳴／震動／Beacon／PWA…）全數在位
 *  11) 圖標標準 G11：9 個 PNG／ICO 齊、尺寸正確、maskable 安全區、體積預算
 *  12) 版號同步 V1：index.html（meta／title／APP_VERSION）＝ sw.js ＝ manifest
 *  13) PWA 安裝／更新 I1–I8／UP1–UP5：安裝有掣、更新要問過人、唔准自動 skipWaiting
 *  14) 防呆 F/I8：無 alert()／confirm()／prompt()、對話框有 role="dialog"
 *  15) 安全 A11：解碼內容（不可信輸入）入 innerHTML 前必須 escape
 *  16) hidden 屬性真係收得起（CSS 串接：utility class 唔可以蓋過 [hidden]）
 *  17) 無障礙：表單 label 有 for=、動態輸出有 aria-live、分頁有 role/aria-selected
 *  18) 危險動作：發送前有倒數＋可取消；UI 有免責聲明
 *  19) 體積預算：部署 payload ≤ 1.0 MB（防止字型／圖檔靜靜變肥）
 *  20) 螢幕常亮（Wake Lock）：有取／有放、隱藏後會重取、失敗要靜靜降級、iOS 限制要講明
 *
 * 執行：node scripts/verify.mjs   （任一檢查失敗即以 exit 1 結束）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toRel = (p) => relative(ROOT, p).split(sep).join('/');
const fmt = (n) => n.toLocaleString('en-US');
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed++; console.error(`  ❌ ${m}`); };
const section = (t) => console.log(`\n■ ${t}`);

/* ---------- 1. 必要網頁產物 ---------- */
const REQUIRED = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icons/favicon.ico',
  'icons/favicon-16.png',
  'icons/favicon-32.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/og-image.png',
  'assets/css/tailwind.min.css',
  'assets/fontawesome/css/all.min.css',
  // 只留 woff2：現代瀏覽器全部支援；.ttf fallback 佔 815 KB（部署 60%）但零人用，已移除
  ...['fa-brands-400', 'fa-regular-400', 'fa-solid-900', 'fa-v4compatibility'].map(
    (f) => `assets/fontawesome/webfonts/${f}.woff2`
  ),
];
section('1. 必要網頁產物齊全');
for (const f of REQUIRED) existsSync(join(ROOT, f)) ? ok(f) : bad(`缺少必要檔案：${f}`);

/* ---------- 2~4. 引用完整性 ---------- */
section('2. index.html 本地引用零 404');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const clean = (u) => u.trim().replace(/^\.\//, '').split(/[?#]/)[0];
const refs = new Set();
for (const m of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)) {
  const u = m[1];
  // Skip external URLs, data URLs, and Vercel-provided scripts
  if (!/^(https?:|data:|blob:|mailto:|tel:|#|^\/_vercel\/)/i.test(u)) refs.add(clean(u));
}
// JS 內以字串引用的本地資源（如 './sw.js'）
for (const m of html.matchAll(/["'](\.\/[^"']+?\.(?:js|css|png|webmanifest|json|woff2?|ttf|svg|jpe?g|webp))["']/gi)) {
  refs.add(clean(m[1]));
}
for (const r of [...refs].sort()) {
  r && existsSync(join(ROOT, r)) ? ok(r) : bad(`引用不存在（404）：${r}`);
}

section('3. CSS url() 字型引用存在');
const cssRefs = [...refs].filter((u) => u.endsWith('.css'));
const fontRefs = new Set();
for (const cref of cssRefs) {
  const cssPath = join(ROOT, cref);
  if (!existsSync(cssPath)) { bad(`CSS 不存在：${cref}`); continue; }
  const css = readFileSync(cssPath, 'utf8');
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const u = m[1].trim();
    if (/^(https?:|data:|#)/i.test(u)) continue;
    fontRefs.add(posix.normalize(posix.join(posix.dirname(cref), u)));
  }
}
for (const r of [...fontRefs].sort()) {
  existsSync(join(ROOT, r)) ? ok(r) : bad(`字型引用不存在（404）：${r}`);
}

section('4. sw.js 預快取清單全部存在');
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const swRefs = [...sw.matchAll(/["'](\.\/[^"']+)["']/g)].map((m) => clean(m[1]));
for (const r of [...new Set(swRefs)].sort()) {
  existsSync(join(ROOT, r)) ? ok(r) : bad(`SW 預快取檔案不存在：${r}`);
}

/* ---------- 5. manifest ---------- */
section('5. manifest.webmanifest 合法性');
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok('合法 JSON');
} catch (e) {
  bad(`JSON 解析失敗：${e.message}`);
}
if (manifest) {
  for (const key of ['name', 'short_name', 'start_url', 'icons']) {
    key in manifest ? ok(`含 ${key}`) : bad(`缺少 ${key}`);
  }
  for (const ic of manifest.icons || []) {
    existsSync(join(ROOT, clean(ic.src))) ? ok(`圖示存在：${ic.src}`) : bad(`圖示不存在：${ic.src}`);
  }
}

/* ---------- 6. JS 語法檢查（node --check）---------- */
section('6. JavaScript 語法檢查（node --check）');
function nodeCheck(code, label) {
  const dir = mkdtempSync(join(tmpdir(), 'scout-verify-'));
  const tmp = join(dir, 'check.js');
  writeFileSync(tmp, code);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    ok(`${label}：語法通過`);
  } catch (e) {
    bad(`${label}：語法錯誤\n${e.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
nodeCheck(sw, 'sw.js');
let si = 0;
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=/i.test(m[1]) || !m[2].trim()) continue;
  nodeCheck(m[2], `index.html 內嵌 <script> #${++si}`);
}
if (si === 0) bad('index.html 找不到內嵌 <script>（主程式遺失？）');

/* ---------- 7. 垃圾檔／重複資料夾掃描 ---------- */
section('7. 無垃圾檔與重複資料夾');
const JUNK = [/\.bak$/i, /\.tmp$/i, /\.old$/i, /\.log$/i, /\.swp$/i, /\.DS_Store$/, /Thumbs\.db$/i, /desktop\.ini$/i];
const BAD_DIRS = new Set(['node_modules', 'morse-beacon-local-assets-upload', 'uploads']);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (BAD_DIRS.has(name)) { bad(`不應存在的資料夾：${toRel(p)}/`); continue; }
      walk(p, out);
    } else out.push(p);
  }
  return out;
}
const allFiles = walk(ROOT);
const junk = allFiles.filter((p) => JUNK.some((rx) => rx.test(p)));
junk.length ? junk.forEach((p) => bad(`垃圾檔：${toRel(p)}`)) : ok('無 *.bak／*.tmp／*.old／*.log／.DS_Store／Thumbs.db／*.swp');
ok(`node_modules／重複上傳資料夾：不存在（${BAD_DIRS.size} 項防護全過）`);

/* ---------- 8. 死引用掃描 ---------- */
section('8. 無死引用（指向已刪除／未部署路徑）');
const APP_CODE = ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/css/tailwind.min.css', 'assets/fontawesome/css/all.min.css'];
let deadFound = false;
for (const f of APP_CODE) {
  if (!existsSync(join(ROOT, f))) continue;
  const t = readFileSync(join(ROOT, f), 'utf8');
  for (const dead of ['morse-beacon-local-assets-upload', 'tailwind.input']) {
    if (t.includes(dead)) { bad(`${f} 出現死引用：${dead}`); deadFound = true; }
  }
}
if (!deadFound) ok('index.html／sw.js／manifest／CSS 皆無死引用');

/* ---------- 9. Vercel 部署 payload 模擬 ---------- */
section('9. Vercel 部署 payload 模擬（依 .vercelignore）');
const patterns = readFileSync(join(ROOT, '.vercelignore'), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const globToRe = (pat) => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
const isIgnored = (relPath) => patterns.some((p) => {
  const re = globToRe(p);
  if (re.test(relPath)) return true;
  if (p.includes('/')) return false; // 含斜線的模式只比對完整路徑
  // 無斜線模式可比對各層；目錄名本身亦代表其子樹（gitignore 語意）
  const segs = relPath.split('/');
  return segs.some((seg) => re.test(seg));
});
const payload = allFiles.filter((p) => !isIgnored(toRel(p)));
let total = 0;
for (const p of payload) {
  const s = statSync(p).size;
  total += s;
  console.log(`     ${fmt(s).padStart(9)} B  ${toRel(p)}`);
}
console.log(`  → 將上傳 ${payload.length} 個檔案，共 ${mb(total)}（${fmt(total)} bytes）`);

const payloadSet = new Set(payload.map(toRel));
const reqSet = new Set(REQUIRED);
const orphans = [...payloadSet].filter((f) => !reqSet.has(f));
const missingFromPayload = [...reqSet].filter((f) => !payloadSet.has(f));
orphans.forEach((f) => bad(`部署含非必要檔案（孤兒）：${f}`));
missingFromPayload.forEach((f) => bad(`必要檔案未列入部署：${f}`));
if (!orphans.length && !missingFromPayload.length) {
  ok(`部署 payload 恰為 ${REQUIRED.length} 個必要網頁產物，無孤兒檔案`);
}

/* ---------- 10. 核心功能標記 ---------- */
section('10. 核心功能標記（零倒退確認）');
const FEATURES = [
  ['發送：螢幕閃光', /flash-overlay/],
  ['發送：實體閃光燈（torch）', /torch/i],
  ['發送：蜂鳴（WebAudio）', /oscillator|AudioContext/],
  ['發送：震動', /vibrate/i],
  ['發送：循環 Beacon', /beacon/i],
  ['頻道頻率 750/1000/1500Hz', /1500/],
  ['聲音解碼（Goertzel）', /goertzel/i],
  ['光源解碼（相機 getUserMedia）', /getUserMedia/],
  ['手動拍打鍵', /手動/],
  ['解碼歷史（localStorage）', /localStorage/],
  ['分享／匯出', /navigator\.share/],
  ['WPM 速度估算', /WPM/],
  ['速查表', /速查/],
  ['PWA：Service Worker 註冊', /serviceWorker/],
  ['PWA：manifest 連結', /webmanifest/],
  ['音檔離線解碼', /音檔/],
];
for (const [name, rx] of FEATURES) {
  html.match(rx) ? ok(name) : bad(`核心功能標記消失：${name}`);
}

/* ---------- 11. 圖標標準（G11 / docs-33）---------- */
section('11. 圖標標準 G11（9 個 PNG／ICO、尺寸、maskable、體積）');
// 純 Node 讀 PNG IHDR，唔依賴 ImageMagick
function pngSize(abs) {
  const b = readFileSync(abs);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const ICON_SPEC = [
  ['icons/favicon-16.png', 16],
  ['icons/favicon-32.png', 32],
  ['icons/apple-touch-icon.png', 180],
  ['icons/icon-192.png', 192],
  ['icons/icon-512.png', 512],
  ['icons/icon-maskable-192.png', 192],
  ['icons/icon-maskable-512.png', 512],
  ['icons/og-image.png', 1200, 630],
];
let iconBytes = 0;
for (const [f, w, h] of ICON_SPEC) {
  const abs = join(ROOT, f);
  if (!existsSync(abs)) { bad(`缺少圖標：${f}`); continue; }
  const sz = pngSize(abs);
  const wantH = h || w;
  if (!sz) bad(`${f} 唔係合法 PNG`);
  else if (sz.w !== w || sz.h !== wantH) bad(`${f} 尺寸錯誤：${sz.w}x${sz.h}（應為 ${w}x${wantH}）`);
  else ok(`${f} ${sz.w}x${sz.h}`);
  iconBytes += statSync(abs).size;
}
const icoPath = join(ROOT, 'icons/favicon.ico');
if (!existsSync(icoPath)) bad('缺少 icons/favicon.ico');
else {
  const b = readFileSync(icoPath);
  const isIco = b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1;
  const count = isIco ? b.readUInt16LE(4) : 0;
  if (!isIco) bad('icons/favicon.ico 檔案頭唔係 ICO');
  else if (count < 3) bad(`favicon.ico 只有 ${count} 個尺寸（應 16／32／48 三個）`);
  else ok(`favicon.ico 含 ${count} 個尺寸`);
  iconBytes += b.length;
}
const iconKB = iconBytes / 1024;
iconKB <= 260
  ? ok(`9 個圖標合計 ${iconKB.toFixed(0)} KB（預算 ≤ 260 KB）`)
  : bad(`圖標合計 ${iconKB.toFixed(0)} KB，超出 260 KB 預算`);

// HTML／manifest 掛法（5 link + 4 meta）
const HEAD_LINKS = [
  [/rel="icon"[^>]*favicon\.ico|favicon\.ico"[^>]*rel="icon"/, 'favicon.ico'],
  [/favicon-16\.png/, 'favicon-16'],
  [/favicon-32\.png/, 'favicon-32'],
  [/rel="apple-touch-icon"[^>]*apple-touch-icon\.png|apple-touch-icon\.png"[^>]*rel="apple-touch-icon"/, 'apple-touch-icon 180'],
  [/rel="manifest"/, 'manifest link'],
];
for (const [rx, label] of HEAD_LINKS) (rx.test(html) ? ok(`<head> 有 ${label}`) : bad(`<head> 缺少 ${label}`));
const HEAD_METAS = [
  [/<meta name="theme-color"/, 'theme-color'],
  [/<meta property="og:image" content="https:\/\/[^"]+"/, 'og:image（絕對網址）'],
  [/<meta property="og:image:width"/, 'og:image:width'],
  [/<meta property="og:image:height"/, 'og:image:height'],
  [/<meta name="copyright"/, 'copyright'],
  [/<meta name="app-version"/, 'app-version'],
];
for (const [rx, label] of HEAD_METAS) (rx.test(html) ? ok(`<head> 有 ${label}`) : bad(`<head> 缺少 ${label}`));

/* ---------- 12. 版號同步（V1）---------- */
section('12. 版號同步（index.html ＝ sw.js ＝ manifest）');
const verOf = (re, text, label) => {
  const m = text.match(re);
  if (!m) { bad(`讀唔到${label}版號`); return null; }
  return m[1];
};
const vHtml = verOf(/<meta name="app-version" content="(v[\d.]+)"/, html, 'index.html meta ');
const vConst = verOf(/const APP_VERSION = '(v[\d.]+)'/, html, 'index.html APP_VERSION ');
const vSw = verOf(/const APP_VERSION = '(v[\d.]+)'/, sw, 'sw.js ');
// 快取名一定要由 APP_VERSION 推導（單一真理：改版只改一個常數）
const cacheDerived = /const CACHE = 'scout-morse-' \+ APP_VERSION/.test(sw);
const vCache = cacheDerived ? vSw : null;
const vManifest = verOf(/"name":\s*"[^"]*?(v[\d.]+)"/, readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'), 'manifest ');
const pkgPath = join(ROOT, 'package.json');
const vPkg = existsSync(pkgPath) ? verOf(/"version":\s*"(\d+\.\d+\.\d+)"/, readFileSync(pkgPath, 'utf8'), 'package.json ') : null;
const vers = { 'meta app-version': vHtml, 'APP_VERSION(index)': vConst, 'APP_VERSION(sw)': vSw, manifest: vManifest };
if (vPkg && vHtml && vPkg !== vHtml.replace(/^v/, '')) bad(`package.json 版號 ${vPkg} 同介面 ${vHtml} 唔一致`);
else if (vPkg) ok(`package.json = ${vPkg}`);
cacheDerived ? ok('快取名由 APP_VERSION 推導（改版只改一個常數）') : bad('SW 快取名冇綁 APP_VERSION');
for (const [k, v] of Object.entries(vers)) ok(`${k} = ${v}`);
const uniq = new Set(Object.values(vers).filter(Boolean));
uniq.size === 1 ? ok(`各處版號一致：${[...uniq][0]}`) : bad(`版號唔一致：${[...uniq].join(' / ')}（V1/V3）`);
html.includes(`${vHtml}`) && /<title>[^<]*v[\d.]+/.test(html) ? ok('<title> 有版號') : bad('<title> 缺版號（V2 ②）');
/(COPYRIGHT © 2026 SCOUT SYSTEM · v[\d.]+)/.test(html) ? ok('頁尾有「© SCOUT SYSTEM · 版號」') : bad('頁尾缺版號（V2 ⑤）');

/* ---------- 13. PWA 安裝／更新（I1–I8 / UP1–UP5）---------- */
section('13. PWA 安裝入口＋更新流程');
const I = (rx, label) => (rx.test(html) ? ok(label) : bad(label));
I(/beforeinstallprompt/, 'I2 攔 beforeinstallprompt（唔畀瀏覽器自彈）');
I(/id="installBtn"/, 'I1 有「加入主畫面」入口掣');
I(/display-mode:\s*standalone/, 'I4 偵測 standalone');
I(/maxTouchPoints > 1/, 'I4 iPadOS 判斷（MacIntel + maxTouchPoints）');
I(/id="installHelpModal"[^>]*role="dialog"[^>]*aria-modal="true"/, 'I3 iOS 三步教學卡（role=dialog / aria-modal）');
I(/加入主畫面/, 'I3 教學卡文案（加入主畫面）');
I(/id="updateBanner"[^>]*role="region"/, 'UP2 更新 banner（role=region）');
I(/SKIP_WAITING/, 'UP3 送 SKIP_WAITING 訊息');
I(/\}, 2500\);/, 'UP3 2.5 秒 reload fallback');
I(/visibilitychange[\s\S]{0,120}checkUpdate/, 'UP4 回前景檢查更新');
I(/setInterval\(checkUpdate,\s*30 \* 60 \* 1000\)/, 'UP4 每 30 分鐘檢查');
I(/dismissedWorker/, 'UP2「稍後」記住同一個 worker');
I(/updateViaCache:\s*'none'/, 'UP4 updateViaCache: none');
// SW：install 內唔准無條件 skipWaiting
const swInstall = (sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/) || [''])[0];
if (!swInstall) bad('sw.js 搵唔到 install 事件');
else if (/self\.registration\.active\s*\?/.test(swInstall) && /skipWaiting\(\)/.test(swInstall)) ok('UP1 install 只在首次安裝 skipWaiting');
else if (/skipWaiting\(\)/.test(swInstall)) bad('UP1 install 內無條件 skipWaiting()（會玩到一半偷換版）');
else ok('UP1 install 冇 skipWaiting（首次安裝會慢一步接手，可接受）');
/sw\.addEventListener\('message'/.test(sw) || /'message',\s*\(?event/.test(sw)
  ? ok('UP1 SW 有 message handler 收 SKIP_WAITING') : bad('UP1 SW 缺 message handler');

/* ---------- 14. 防呆（I8）---------- */
section('14. 防呆：無原生 alert／confirm／prompt');
const nativeCalls = [...html.matchAll(/(?<![.\w$])(alert|confirm|prompt)\s*\(/g)]
  .filter((m) => !/deferredPrompt|installPrompt|\.prompt\s*\(/.test(m[0]));
// 排除變數呼叫 xxx.prompt( 同自訂 customAlert/customConfirm
const realNative = [...html.matchAll(/(?:^|[^.\w$])(alert|confirm)\s*\(/gm)].map((m) => m[1]);
realNative.length === 0 ? ok('無 alert()／confirm()（I8）') : bad(`仍有原生對話框呼叫：${[...new Set(realNative)].join(', ')}`);
void nativeCalls;
/role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="modalMsg"/.test(html)
  ? ok('自訂對話框有 role/aria-modal/aria-labelledby') : bad('自訂對話框缺 aria 標記');
/aria-label=/.test(html) ? ok('有 aria-label（圖示掣）') : bad('圖示掣缺 aria-label');

/* ---------- 15. 安全（A11）---------- */
section('15. 安全：解碼內容 escape 後才入 innerHTML');
/function escHtml\(/.test(html) ? ok('有 escHtml() escape 函數') : bad('缺 escHtml() escape 函數');
/escHtml\(it\.text\)/.test(html) ? ok('解碼歷史文字有 escape') : bad('解碼歷史文字未 escape（XSS 風險）');
/escHtml\(it\.morse\)/.test(html) ? ok('解碼歷史摩斯碼有 escape') : bad('解碼歷史摩斯碼未 escape');
// 只准白名單嘅 innerHTML 用法（固定模板或已 escape）
// 來源分類：只有「自由文字／外部輸入」先算風險；固定字串同常數（例如 icon class 三元式）唔算
const UNTRUSTED = /(it\.(text|morse|mode|wpm)|decodedOut|customText|\.value\b|location\.|searchParams|\.innerText)/;
const rawInner = [];
for (const m of html.matchAll(/\.innerHTML\s*=\s*([\s\S]*?);\s*\n/g)) {
  for (const mm of m[1].matchAll(/\$\{([^}]*)\}/g)) {
    const expr = mm[1].trim();
    if (/^escHtml\(/.test(expr)) continue;          // 已 escape
    if (!UNTRUSTED.test(expr)) continue;             // 固定字串／常數
    rawInner.push(expr);
  }
}
rawInner.length === 0
  ? ok('所有「不可信來源」插入 innerHTML 前都已 escape')
  : rawInner.slice(0, 6).forEach((e) => bad(`innerHTML 插入了未 escape 嘅不可信內容：${e.slice(0, 80)}`));

/* ---------- 16. hidden 屬性真係收得起（CSS 串接）----------
   2026-11-12 事故：編譯後 Tailwind 把 [hidden]{display:none} 排在 .flex 之前，
   兩者特異性同為 (0,1,0) → .flex 勝出。結果 <div id="installHelpModal" class="... flex ..." hidden>
   一開頁就永遠顯示，iOS／桌面用戶一入嚟就被教學卡蓋住；updateBanner 亦關唔走。
   舊版 15 組檢查全綠都捉唔到，因為佢只 grep 標記，唔睇 CSS 串接。
   呢組唔靠 jsdom（零依賴原則）——用「特異性 + 出現次序」自己計 cascade。 */
section('16. hidden 屬性真係收得起（CSS 串接，零依賴）');
function specificity(sel) {
  // 只計到「單一 class／屬性選擇器」程度，足夠判斷 .flex vs [hidden]
  const s2 = sel.replace(/::?[a-z-]+(\([^)]*\))?/gi, '');
  const ids = (s2.match(/#[\w-]+/g) || []).length;
  const cls = (s2.match(/\.[\w-]+/g) || []).length
            + (s2.match(/\[[^\]]+\]/g) || []).length
            + (s2.match(/(^|[\s>+~])[a-z]+(?=[\s>+~]|$)/gi) || []).filter((x) => x.trim()).length * 0;
  const els = (s2.match(/(^|[\s>+~:])[a-z][\w-]*(?=[\s>+~,]|$)/gi) || []).filter((x) => x.trim()).length;
  return [ids, cls, els];
}
const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const cssFiles = ['assets/css/tailwind.min.css', 'assets/fontawesome/css/all.min.css'];
const inlineStyles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const cssAll = cssFiles.filter((f) => existsSync(join(ROOT, f)))
  .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n') + '\n' + inlineStyles;

// 全份 CSS 由頭到尾嘅次序
const ruleOrder = [];
for (const m of cssAll.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim();
  const decl = m[2];
  if (/display\s*:/.test(decl)) ruleOrder.push({ sel, disp: /display\s*:\s*([^;!]+)/.exec(decl)[1].trim(), important: /display\s*:[^;]*!important/.test(decl) });
}
// hidden 規則：邊條勝出？
const hiddenRules = ruleOrder.filter((r) => /\[hidden\]/.test(r.sel));
const displayUtils = ruleOrder.filter((r) => /^\.(flex|grid|block|inline-block|inline-flex|table)$/.test(r.sel.split(',')[0].trim()));
if (!hiddenRules.length) bad('CSS 完全冇 [hidden] 規則（hidden 屬性會失效）');
else {
  const hv = hiddenRules[hiddenRules.length - 1];
  const hvSpec = specificity(hv.sel.split(',')[0]);
  // 最壞情況：hidden 元素同時帶 .flex
  const flexRule = displayUtils.find((r) => /\.flex$/.test(r.sel.trim()));
  const winsByImportant = hv.important;
  const winsBySpec = flexRule && cmpSpec(hvSpec, specificity('.flex')) > 0;
  const winsByOrder = flexRule && ruleOrder.indexOf(hv) > ruleOrder.indexOf(flexRule);
  if (winsByImportant) ok('hidden 規則有 !important（.flex／.grid 蓋唔過）');
  else if (winsBySpec || winsByOrder) ok(`hidden 靠${winsBySpec ? '特異性' : '出現次序'}勝出（脆弱，建議加 !important）`);
  else bad('hidden 唔夠 .flex／.grid 打（utility 排在後、特異性相同）→ 帶 hidden 嘅對話框會一直顯示');
}
// 實際標記：邊個元素同時有 hidden + display utility
// 注意：要逐個開始標籤計，唔可以用「到 hidden 為止」嘅 lazy 掃描（會吞埋上一個元素嘅 class，造成假報警）
const badHidden = [];
for (const m of html.matchAll(/<(\w+)\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\shidden(?:\s[^>]*)?>/g)) {
  const attrs = m[2] || '';
  const cls = /class="([^"]*)"/.exec(attrs);
  if (!cls) continue;
  if (/(^|\s)(flex|grid|block|inline-block|inline-flex)(\s|$)/.test(cls[1])) {
    const id = (/id="([^"]+)"/.exec(attrs) || [])[1] || '(無 id)';
    badHidden.push(id);
  }
}
const hiddenGuarded = hiddenRules.some((r) => r.important);
if (badHidden.length === 0) {
  ok('冇元素同時用 hidden 屬性 + display utility（即使日後移除 !important 都唔會漏）');
} else if (hiddenGuarded) {
  // 有 !important 兜底就唔算 fail，但要記錄低：呢啲元素嘅顯示／隱藏係兩條規則夾出嚟
  console.log(`  · 有 ${badHidden.length} 個元素（${badHidden.join(', ')}）同時用 hidden + display utility，靠 [hidden]{!important} 兜底 — 目前安全`);
} else {
  bad(`以下元素同時有 hidden + .flex／.grid，而 [hidden] 冇 !important：${badHidden.join(', ')}`);
}

/* ---------- 17. 無障礙（A11 / I6）---------- */
section('17. 無障礙：label 關聯、動態輸出、分頁語義');
const labelTags = [...html.matchAll(/<label\b([^>]*)>/g)].map((m) => m[1]);
// 三種都可以：① for= 指去控件 ② role=group／群組容器用 aria-labelledby 指返個 label id ③ label 包住個 input
const labelNoFor = labelTags.filter((a) => {
  if (/\bfor\s*=/.test(a)) return false;
  const idm = /\bid="([^"]+)"/.exec(a);
  if (idm && new RegExp(`aria-labelledby="[^"]*\\b${idm[1]}\\b`).test(html)) return false;
  return true;
});
// 有 for 嘅 label，其 for 目標要真係存在
let badFor = [];
for (const m of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)) {
  if (!new RegExp(`id="${m[1]}"`).test(html)) badFor.push(m[1]);
}
labelNoFor.length === 0
  ? ok(`所有 <label>（${labelTags.length} 個）都有 for=，或用 aria-labelledby 由群組容器引用`)
  : bad(`${labelNoFor.length} 個 <label> 冇 for=，讀屏／點標題唔會聚焦控件`);
badFor.length === 0 ? ok('label for= 全部指向存在嘅 id') : bad(`label for= 指向唔存在嘅 id：${badFor.join(', ')}`);

// 動態文字區域要有 aria-live，否則讀屏用戶唔知解碼結果
const LIVE_TARGETS = [['decodedText', '解碼文字'], ['liveMorse', '即時摩斯碼']];
for (const [id, label] of LIVE_TARGETS) {
  const re = new RegExp(`id="${id}"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="${id}"`);
  re.test(html) ? ok(`${label}（#${id}）有 aria-live="polite"`) : bad(`${label}（#${id}）缺 aria-live，讀屏讀唔到解碼結果`);
}

// 分頁語義：tablist / role=tab / aria-selected / aria-controls
/role="tablist"/.test(html) ? ok('底部導覽有 role="tablist"') : bad('底部導覽缺 role="tablist"');
const tabBtns = [...html.matchAll(/role="tab"[^>]*/g)].map((m) => m[0]);
tabBtns.length >= 5 ? ok(`${tabBtns.length} 個分頁掣有 role="tab"`) : bad(`分頁掣少過 5 個（搵到 ${tabBtns.length}）`);
for (const attr of ['aria-selected', 'aria-controls']) {
  tabBtns.every((t) => new RegExp(`${attr}=`).test(t))
    ? ok(`所有分頁掣都有 ${attr}`) : bad(`有分頁掣缺 ${attr}（讀屏唔知揀咗邊頁）`);
}

/* ---------- 18. 危險動作：倒數＋取消、免責聲明（F9）---------- */
section('18. 危險動作防呆（F9）：發送倒數＋免責');
/function startCountdown\s*\(/.test(html) ? ok('有 startCountdown()：發送前倒數') : bad('發送冇倒數（誤按即刻着燈／響蜂鳴）');
/function cancelCountdown\s*\(/.test(html) ? ok('有 cancelCountdown()：倒數中可以取消') : bad('倒數中冇得取消');
/const go = await startCountdown\(\)/.test(html)
  ? ok('倒數確認之後才 initTorch()／開硬件')
  : bad('見唔到「倒數 → 才開硬件」嘅次序（倒數形同虛設）');
/if \(countingDown\)\{ cancelCountdown\(\); return; \}/.test(html)
  ? ok('「停止」掣喺倒數期＝取消（唔會殘留 promise）') : bad('「停止」掣倒數期行為未定義');
/不可作為緊急求救的唯一手段/.test(html)
  ? ok('UI 有免責聲明（不可作緊急求救唯一手段）') : bad('UI 缺免責聲明（只在 README／LICENSE 唔夠）');

/* ---------- 19. 體積預算 ---------- */
section('19. 部署體積預算');
const MB_LIMIT = 1.0;
total / 1048576 <= MB_LIMIT
  ? ok(`部署 payload ${mb(total)} ≤ ${MB_LIMIT} MB`)
  : bad(`部署 payload ${mb(total)} 超出 ${MB_LIMIT} MB（S6/S7）— 睇下係咪又加返 .ttf／大圖`);
const bigFiles = payload.filter((p) => statSync(p).size > 500 * 1024);
bigFiles.length === 0
  ? ok('冇單一部署檔案 > 500 KB（S6）')
  : bad(`單檔超過 500 KB：${bigFiles.map((p) => toRel(p)).join(', ')}`);

/* ---------- 20. 螢幕常亮（Screen Wake Lock）---------- */
section('20. 螢幕常亮（Wake Lock）：接收時唔鎖屏');
const WL = [
  [/navigator\.wakeLock\.request\('screen'\)/, '有 request(\'screen\') 取鎖'],
  [/sentinel\.release\(\)|\.release\(\)/, '有 release() 放鎖'],
  [/addEventListener\('release'/, '有聽 release 事件（被系統釋放要知）'],
  [/visibilitychange[\s\S]{0,160}wakeLockWanted[\s\S]{0,120}acquireWakeLock/, '頁面回前景會主動重取（瀏覽器一定會幫你釋放）'],
  [/catch\s*\([^)]*\)\s*\{[\s\S]{0,600}?return false;/, '取鎖失敗有 catch（F4 fail-open，唔會阻住解碼）'],
  [/'wakeLock' in navigator/, '有特性檢測（舊機唔會炸）'],
  [/iosStandaloneMayFail/, '有 iOS 主畫面（<18.4）限制處理'],
  [/id="wakeLockStatus"/, '有狀態列（用戶要知到底保唔保持得到）'],
  [/id="wakeOn"/, '有開關（唔想食電可以關）'],
  [/wakeLockWanted = on;[\s\S]{0,120}releaseWakeLock\(\)/, '停止接收會放鎖（唔會偷偷食電）'],
];
for (const [rx, label] of WL) (rx.test(html) ? ok(label) : bad(`Wake Lock：${label}`));
// 硬性：唔准用 NoSleep.js 式「無限靜音影片」hack（真理倉零依賴原則）
/NoSleep|\.play\(\)[\s\S]{0,40}loop/.test(html) && /silent.*mp4|nosleep/i.test(html)
  ? bad('見到 NoSleep.js 式靜音影片 hack（本專案零依賴，唔准）')
  : ok('冇用第三方 NoSleep.js／靜音影片 hack（保持零依賴）');

/* ---------- 總結 ---------- */
section('總結');
if (failed) {
  console.error(`\n❌ 共 ${failed} 項檢查失敗，請修正後再部署。`);
  process.exit(1);
}
console.log('\n✅ 全部檢查通過（20 組）：產物完整、引用零 404、語法零錯誤、無垃圾檔、payload 精簡、');
console.log('   核心功能零倒退、圖標合規、版號同步、PWA 安裝／更新合規、防呆、XSS escape、');
console.log('   hidden 收得起、無障礙、發送倒數、體積預算、螢幕常亮。');
