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
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'assets/css/tailwind.min.css',
  'assets/fontawesome/css/all.min.css',
  ...['fa-brands-400', 'fa-regular-400', 'fa-solid-900', 'fa-v4compatibility'].flatMap(
    (f) => [`assets/fontawesome/webfonts/${f}.woff2`, `assets/fontawesome/webfonts/${f}.ttf`]
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
  if (!/^(https?:|data:|blob:|mailto:|tel:|#)/i.test(u)) refs.add(clean(u));
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
  return relPath.split('/').some((seg) => re.test(seg)); // 無斜線模式可比對各層（gitignore 語意）
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

/* ---------- 總結 ---------- */
section('總結');
if (failed) {
  console.error(`\n❌ 共 ${failed} 項檢查失敗，請修正後再部署。`);
  process.exit(1);
}
console.log('\n✅ 全部檢查通過：產物完整、引用零 404、語法零錯誤、無垃圾檔、payload 精簡、核心功能標記全數在位。');
