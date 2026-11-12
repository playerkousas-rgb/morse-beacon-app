#!/usr/bin/env node
/**
 * scripts/decode.test.mjs — 解碼引擎「真係解得到？」行為測試（零依賴，Node 18+）
 *
 * 為甚麼要有這支：
 *   verify.mjs 只 grep 標記（有 Goertzel、有 REV_MORSE），完全冇測過「解出嚟嘅字對唔對」。
 *   index.html 本身已用 @@PURE-START@@ 標記圈住純邏輯，註解寫明「可被 Node 測試抽取」——
 *   本檔就係嗰個測試：直接由 index.html 抽出引擎，餵合成摩斯音訊，比對文字。
 *
 * 測試鏈（同真機完全一樣嘅路徑）：
 *   合成正弦波 PCM ─► goertzelLevel() ─► processLevel() 狀態機 ─► flushLetter() ─► 文字
 *
 * 同時測「光源解碼」：直接餵亮度序列（0..1）入同一部狀態機。
 *
 * 執行：node scripts/decode.test.mjs      （任何一項失敗 → exit 1）
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* ---------- 由 index.html 抽出純邏輯（用既有 @@PURE-START@@ 標記）---------- */
function extractPure(html) {
  const blocks = [];
  const re = /\/\/ @@PURE-START@@[^\n]*\n([\s\S]*?)\/\/ @@PURE-END@@/g;
  let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  return blocks.join('\n');
}
const PURE = extractPure(HTML);

/* ---------- 建立沙箱 ----------
   關鍵：PURE 區塊用 let/const 宣告狀態，而 vm 嘅「多個 script」唔共享詞法作用域，
   所以一定要把 PURE 同驅動 API 串成「同一個 script」執行，closure 才會指向同一份狀態。 */
function makeHarness({ toneFreq = 750, sampleRate = 44100, blockSize = 512, wpm = 15, recvWpm = 0 } = {}) {
  const out = { text: '', morse: '', wpm: 0, state: null, level: 0, thOn: 0, thOff: 0 };
  const ctx = { console };
  vm.createContext(ctx);

  const prelude = `
    var toneFreq = ${toneFreq};      // 真身喺 PURE 區塊之外，由 app 提供
    var currentWPM = ${wpm};
    var recvWPM = ${recvWpm};        // PURE 內亦有宣告，這裡先給值避免 TDZ 之外的差異
  `;
  const api = `
    ;globalThis.__api = {
      initGoertzel, goertzelLevel, processLevel, resetDecoderState,
      flushLetter, flushWord, reseedTiming, updateThresholds,
      get text() { return decodedOut; },
      get morse() { return currentSymbols; },
      get clock() { return sampleClock; },
      set clock(v) { sampleClock = v; },
      get dotMs() { return dotAvg; },
      get dashMs() { return dashAvg; },
      get blockMs() { return goBlockMs; },
      get thrOn() { return thrOn; },
      get thrOff() { return thrOff; },
      get peak() { return peak; },
      get noiseFloor() { return noiseFloor; },
      get onHist() { return onHist.slice(); },
      get offHist() { return offHist.slice(); },
      setSens(v) { sensValue = v; },
      MORSE_MAP: (typeof MORSE_MAP !== 'undefined') ? MORSE_MAP : null
    };
  `;
  // 注意：recvWPM 喺 PURE 已經 let 宣告，prelude 唔可以再 var 同名 → 用賦值函數代替
  const script = `
    var toneFreq = ${toneFreq};
    var currentWPM = ${wpm};
  ` + PURE.replace(/let recvWPM = 0;/, `let recvWPM = ${recvWpm};`) + api;

  vm.runInContext(script, ctx, { filename: 'index.html:pure' });
  const A = ctx.__api;
  A.initGoertzel(sampleRate, blockSize);
  return { A, out, blockSize, sampleRate, toneFreq };
}

/* ---------- 摩斯碼表（取自 index.html，確保同 app 一致）---------- */
// 由 app 自己嘅 MORSE_MAP 取（確保測試同 app 用同一份碼表）
function loadMorseMap() {
  const ctx = { toneFreq: 750, currentWPM: 15 };
  vm.createContext(ctx);
  vm.runInContext('var toneFreq=750; var currentWPM=15;' +
    extractPure(HTML) + ';globalThis.M = MORSE_MAP;', ctx);
  return ctx.M;
}
const MORSE_MAP = loadMorseMap();

/* ---------- 合成音訊 ---------- */
/** 由文字產生「訊號時序表」：segments = [{on:bool, ms}]，同一份表同時驅動聲音與光源測試 */
function textToSegments(text, wpm) {
  const unitMs = 1200 / wpm;                     // 1 單位毫秒（20 WPM = 60ms）
  const chars = text.toUpperCase().split('');
  const segs = [];
  const on = (ms) => segs.push({ on: true, ms });
  const off = (ms) => { if (segs.length && !segs[segs.length - 1].on) segs[segs.length - 1].ms += ms; else segs.push({ on: false, ms }); };
  chars.forEach((ch, ci) => {
    if (ch === ' ') { off(unitMs * 7); return; }          // 單字間隔 = 7u（標準）
    const code = MORSE_MAP[ch];
    if (!code) return;
    code.split('').forEach((sym, si) => {
      on(sym === '.' ? unitMs : unitMs * 3);
      if (si < code.length - 1) off(unitMs);
    });
    if (ci < chars.length - 1 && chars[ci + 1] !== ' ') off(unitMs * 3);
  });
  return { segs, unitMs };
}

/** 由時序表砌 PCM */
function segmentsToPcm(segs, toneFreq, sampleRate) {
  const totalMs = segs.reduce((a, s) => a + s.ms, 0) + 100;
  const n = Math.ceil(totalMs / 1000 * sampleRate);
  const pcm = new Float32Array(n);
  let t = 0;
  for (const seg of segs) {
    if (seg.on) {
      const a = Math.floor(t / 1000 * sampleRate), b = Math.min(n, Math.floor((t + seg.ms) / 1000 * sampleRate));
      for (let i = a; i < b; i++) pcm[i] = 0.6 * Math.sin(2 * Math.PI * toneFreq * (i / sampleRate));
    }
    t += seg.ms;
  }
  return pcm;
}

function addNoise(pcm, amplitude) {
  const out = Float32Array.from(pcm);
  for (let i = 0; i < out.length; i++) out[i] += (Math.random() * 2 - 1) * amplitude;
  return out;
}
function scalePcm(pcm, k) {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * k;
  return out;
}

/* ---------- 用真嘅取樣時鐘餵入（同 startSoundDecode 一致）---------- */
function decodePcm(h, pcm) {
  const { A, blockSize } = h;
  A.resetDecoderState(0);
  const feed = (block) => {
    const lvl = A.goertzelLevel(block);
    const tEnd = A.clock + A.blockMs;
    A.processLevel(lvl, tEnd);
    A.clock = tEnd;
  };
  for (let i = 0; i + blockSize <= pcm.length; i += blockSize) {
    feed(Array.from(pcm.subarray(i, i + blockSize)));
  }
  for (let k = 0; k < 14; k++) feed(new Array(blockSize).fill(0));   // 收尾靜音 → flush
  A.flushLetter(); A.flushWord();
  return A.text;
}

/* ---------- 光源解碼：直接餵亮度序列（同 lightLoop 一樣用 wall clock）---------- */
function decodeBrightness(h, segs, unitMs) {
  const { A } = h;
  A.resetDecoderState(0);
  const STEP = 16;                                  // ≈60fps
  const totalMs = segs.reduce((a, s) => a + s.ms, 0);
  const brightAt = (ms) => {
    let t = 0;
    for (const s of segs) {
      if (ms >= t && ms < t + s.ms) return s.on ? 0.85 : 0.08;
      t += s.ms;
    }
    return 0.08;
  };
  for (let t = STEP; t <= totalMs + 1500; t += STEP) {
    const b = brightAt(t) + (Math.random() * 0.02 - 0.01);   // 相機噪聲
    A.processLevel(b, t);
  }
  A.flushLetter(); A.flushWord();
  return A.text;
}

/* ---------- 測試框架 ---------- */
let pass = 0, fail = 0;
const results = [];
function t(name, fn) {
  try {
    const info = fn();
    pass++; results.push(['PASS', name, info || '']);
  } catch (e) {
    fail++; results.push(['FAIL', name, e.message]);
  }
}
function eq(actual, expected, label) {
  const a = String(actual).replace(/\s+/g, ' ').trim();
  const b = String(expected).replace(/\s+/g, ' ').trim();
  if (a !== b) throw new Error(`${label || ''} 期望「${b}」實際「${a}」`);
  return `→「${a}」`;
}

/* ============================================================
   1. 聲音解碼：各種內容 × 各種速度
   ============================================================ */
const MESSAGES = ['SOS', 'HELLO', 'ET', 'T', 'E', 'CQ', '73', 'MORSE', 'PARIS', 'SCOUT'];
const WPMS = [5, 8, 12, 15, 20, 25];

for (const msg of MESSAGES) {
  for (const wpm of WPMS) {
    t(`聲音解碼 ${msg} @ ${wpm} WPM（種子準確）`, () => {
      const h = makeHarness({ wpm });
      const tl = textToSegments(msg, wpm);
      const pcm = segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate);
      return eq(decodePcm(h, pcm), msg);
    });
  }
}

// 多字（含單字間隔）
t('聲音解碼 "SOS HELP" @12WPM（含單字間隔）', () => {
  const h = makeHarness({ wpm: 12 });
  const tl = textToSegments('SOS HELP', 12);
  return eq(decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate)), 'SOS HELP');
});

// 長訊息（多個單字，考驗單字間隔）
t('聲音解碼長訊息 "SOS HELP CQ DE SCOUT 73" @15WPM', () => {
  const msg = 'SOS HELP CQ DE SCOUT 73';
  const h = makeHarness({ wpm: 15 });
  const tl = textToSegments(msg, 15);
  return eq(decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate)), msg);
});
// 種子慢 2 倍（15 用種子 7.5）→ 長訊息完全解得對，證明自我校正有效
t('長訊息 + 種子慢 2 倍（15 WPM 用 7.5 種子）仍完全解得對', () => {
  const msg = 'SOS HELP CQ';
  const h = makeHarness({ wpm: 7.5 });
  const tl = textToSegments(msg, 15);
  return eq(decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate)), msg);
});
// 種子快 2 倍 → 頭一個字母（單符 S 被判成 T）會錯，之後自動校正。
// 記錄實際能力，免得日後有人以為可以「任意估錯都解得對」。
t('已知限制：種子快 2 倍 → 第一個字母可能錯，之後自動校正', () => {
  const msg = 'SOS HELP CQ';
  const h = makeHarness({ wpm: 30 });
  const tl = textToSegments(msg, 15);
  const got = decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate));
  const tail = got.trim().slice(-('S HELP CQ'.length));
  if (tail !== 'S HELP CQ') throw new Error(`尾段仍錯：「${got.trim()}」`);
  return `實際「${got.trim()}」— 尾段「${tail}」正確（文檔化限制）`;
});

// 全部 36 個字元
t('聲音解碼 A–Z 0–9 全部字元 @15WPM', () => {
  const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const h = makeHarness({ wpm: 15 });
  const tl = textToSegments(all, 15);
  const got = decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate));
  // 逐字比對，報邊個錯
  const g = got.replace(/\s+/g, '');
  const bad = [...all].filter((c, i) => g[i] !== c).map((c, i) => `${c}→${g[i] ?? '∅'}`);
  if (bad.length) throw new Error(`${bad.length}/36 錯：${bad.slice(0, 8).join(' ')}`);
  return '36/36 全對';
});

/* ============================================================
   2. 種子不準（真機最常見：唔知對方速度）
   ============================================================ */
for (const [actual, seed] of [[15, 7.5], [15, 10], [15, 20], [15, 25], [25, 15], [12, 8], [20, 12], [10, 7.5]]) {
  t(`播 ${actual} WPM，但種子設 ${seed} WPM（自動收斂 ±1.5 倍）`, () => {
    const h = makeHarness({ wpm: seed });
    const tl = textToSegments('SOS', actual);
    return eq(decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate)), 'SOS');
  });
}

/* 已量度嘅能力邊界（誠實記錄，唔係隱藏）：
   種子（對方速度）偏差 ≤1.5 倍 → 全部解得對（上表 8/8）。
   偏差 ≥2 倍 → 視乎第一個字母係單符（E/T）定多符；多符可自我校正，單符會黏埋。
   呢個係「冇對方速度資訊」嘅物理限制，唔係 bug；UI 有「速度」掣可即時重設種子。 */
t('已知限制：種子快 3 倍以上 + 8WPM 慢速 → 頭幾個字元會亂（唔會 crash、唔會卡死）', () => {
  const h = makeHarness({ wpm: 25 });
  const tl = textToSegments('SOS', 8);
  const got = decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate));
  if (typeof got !== 'string') throw new Error('解碼器沒有回傳字串（嚴重）');
  return `實際輸出「${got.trim()}」— 已記錄為文檔化限制`;
});

/* ============================================================
   3. 三條頻道
   ============================================================ */
for (const f of [750, 1000, 1500]) {
  t(`頻道 ${f} Hz 解碼 SOS`, () => {
    const h = makeHarness({ toneFreq: f, wpm: 15 });
    const tl = textToSegments('SOS', 15);
    return eq(decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate)), 'SOS');
  });
}

/* ============================================================
   4. 抗噪（真機一定有底噪）
   ============================================================ */
for (const noise of [0.02, 0.05]) {
  t(`白噪聲 ${noise} 下解碼 SOS @12WPM`, () => {
    const h = makeHarness({ wpm: 12 });
    const tl = textToSegments('SOS', 12);
    return eq(decodePcm(h, addNoise(segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate), noise)), 'SOS');
  });
}

/* ============================================================
   5. 音量細（手機隔遠）
   ============================================================ */
t('細音量（振幅 0.08）解碼 SOS', () => {
  const h = makeHarness({ wpm: 15 });
  const tl = textToSegments('SOS', 15);
  return eq(decodePcm(h, scalePcm(segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate), 0.08/0.6)), 'SOS');
});

/* ============================================================
   6. 光源解碼：直接餵亮度序列
   ============================================================ */
t('光源解碼 SOS（亮度序列 @10WPM，含相機噪聲）', () => {
  const h = makeHarness({ wpm: 10 });
  const tl = textToSegments('SOS', 10);
  return eq(decodeBrightness(h, tl.segs, tl.unitMs), 'SOS');
});
t('光源解碼 "S" 單字元（最短情境）', () => {
  const h = makeHarness({ wpm: 10 });
  const tl = textToSegments('S', 10);
  return eq(decodeBrightness(h, tl.segs, tl.unitMs), 'S');
});

/* ============================================================
   7. 迴歸鎖：舊版「只解出 EEEEE」嘅病徵
   ============================================================ */
t('迴歸鎖：長音（劃）唔會再被讀成點 → 唔會整串 E', () => {
  const h = makeHarness({ wpm: 10 });
  const tl = textToSegments('OOO', 10);   // --- --- ---
  const got = decodePcm(h, segmentsToPcm(tl.segs, h.toneFreq, h.sampleRate));
  if (/^E+$/.test(got.replace(/\s/g, ''))) throw new Error(`仍然係「只解出 E」：${got}`);
  return eq(got, 'OOO');
});

/* ---------- 輸出 ---------- */
console.log('\n解碼引擎行為測試 — 由 index.html 嘅 @@PURE@@ 區塊抽取，餵合成訊號\n');
let lastGroup = '';
for (const [st, name, info] of results) {
  if (st === 'FAIL') console.log(`  ❌ ${name}\n       ${info}`);
}
const fails = results.filter(r => r[0] === 'FAIL');
if (fails.length) {
  console.log(`\n❌ ${fails.length} 項失敗 / 共 ${results.length} 項`);
  process.exit(1);
}
console.log(`  ✅ ${results.length} 項全部通過（聲音 ≥36 組合、頻道、抗噪、細音量、光源、迴歸鎖）\n`);
