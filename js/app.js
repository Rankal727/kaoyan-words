/* 考研英语一高频词记背 PWA 主逻辑 */
"use strict";

/* ---------------- 数据文件 ----------------
 * core   ：首屏必需（单词 + 释义，按词频排序），约 97KB
 * detail ：补充释义 / 词形 / 真题原句，后台惰性加载，约 1MB
 * 改词库时 DATA_VER 与 tools/split_data.py 的 VERSION 一起递增，
 * 文件名随之变化，旧缓存自动失效。
 */
const DATA_VER = 1;
const CORE_URL = `data/core.v${DATA_VER}.txt`;
const CDN_BASE = "https://cdn.jsdelivr.net/gh/Rankal727/kaoyan-words@main/";
/* ---------------- 全局状态 ---------------- */
let WORDS = [];            // 词库（按词频排序，r = 下标 + 1）
let WORD_MAP = new Map();  // w -> 词条
let SCOPE = [];            // 当前词库范围
let CARDS = new Map();     // w -> card（缓存）
let DETAIL = null;         // 已加载的补充数据
let coreVer = DATA_VER;    // 实际生效的词库版本（离线可能退回旧版）
let PROV = null;
let coreReady = false;     // 首屏词库是否就绪
let dataError = false;

const NEW_MIN = 10, NEW_MAX = 200, NEW_STEP = 5;
const clampNew = (n) => Math.min(NEW_MAX, Math.max(NEW_MIN, Math.round((Number(n) || 30) / NEW_STEP) * NEW_STEP));

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("gwc-settings") || "{}"); } catch (e) { /* 损坏则用默认值 */ }
  const s = Object.assign({ dailyNew: 30, scope: "high", audio: true, theme: "auto" }, saved);
  s.dailyNew = clampNew(s.dailyNew);   // 旧版本存过 100 的上限，这里统一放行到 200
  return s;
}
const settings = loadSettings();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* 源数据中句号后可能缺空格（如 2022.That），渲染前轻修复 */
const fmtSent = (s) => esc(String(s).replace(/([.!?])([A-Z][a-z])/g, "$1 $2"));

function saveSettings() { localStorage.setItem("gwc-settings", JSON.stringify(settings)); }
function toast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), ms);
}

/* ---------------- 初始化 ---------------- */
const ICON_SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function effectiveTheme() {
  if (settings.theme !== "auto") return settings.theme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme() {
  const mode = settings.theme;
  if (mode === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", effectiveTheme() === "dark" ? "#131519" : "#f6f6f4");
  const btn = $("btn-theme");
  if (btn) btn.innerHTML = effectiveTheme() === "dark" ? ICON_SUN : ICON_MOON;
  document.querySelectorAll("#theme-seg button").forEach((b) =>
    b.classList.toggle("active", b.dataset.themeMode === mode)
  );
}

async function init() {
  applyTheme();
  bindTabs();
  bindToday();
  bindLearn();
  bindDict();
  bindStatsView();
  bindSettings();
  showView("today");      // 先渲染页面骨架，不等词库
  registerSW();
  loadProvenance();

  const coreTask = loadCore().then((rows) => {
    applyCore(rows);
    coreReady = true;
  });
  await reloadCards();
  refreshToday();         // 卡片数据已就绪，先把待复习/已学填上
  try {
    await coreTask;
  } catch (e) {
    setDataError();
    return;
  }
  refreshToday();
  if (!$("view-dict").hidden) renderDict();
  // 详情（例句/词形）延后一点再拉，优先保证首屏和今日页
  setTimeout(() => loadDetail().catch(() => {}), 30);
}

function registerSW() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // 新版本接管后自动刷新一次，让新代码立即生效；学习中途不打断
    if (hadController && !S.active) location.reload();
  });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

async function reloadCards() {
  const arr = await DB.cards.toArray();
  CARDS = new Map(arr.map((c) => [c.w, normalizeCard(c)]));
}

function applyCore(rows) {
  WORDS = new Array(rows.length);
  WORD_MAP = new Map();
  for (let i = 0; i < rows.length; i++) {
    const w = rows[i][0], m = rows[i][1] || "";
    const it = { w, m, r: i + 1, t: i < 2000 ? "高频" : i < 4000 ? "中频" : "低频", _l: w.toLowerCase() };
    WORDS[i] = it;
    WORD_MAP.set(w, it);
  }
  if (DETAIL) mergeDetail();
  applyScope();
  const allBtn = document.querySelector('#scope-seg button[data-scope="all"]');
  if (allBtn) allBtn.textContent = `全量 ${WORDS.length}`;
}

function applyScope() {
  SCOPE = settings.scope === "high" ? WORDS.filter((w) => w.r <= 2000) : WORDS;
}

/* ---------------- 词库数据加载 ---------------- */
function fetchText(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(url, { signal: ctl.signal })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .finally(() => clearTimeout(timer));
}

/** 先走 jsDelivr（国内访问 GitHub Pages 常只有几 KB/s），失败再回源本站 */
async function fetchData(path, timeoutMs) {
  const cdn = CDN_BASE + path;
  const sources = navigator.onLine === false ? [path] : [cdn, path];
  let lastErr = null;
  for (let i = 0; i < sources.length; i++) {
    try {
      return await fetchText(sources[i], i === 0 && sources.length > 1 ? timeoutMs : Math.max(timeoutMs, 30000));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("词库加载失败");
}

function parseCore(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const i = line.indexOf("\t");
    rows.push(i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)]);
  }
  return rows;
}

async function loadCore() {
  const cached = await kvGet("core");
  if (cached && Array.isArray(cached.rows) && cached.rows.length) {
    if (cached.ver === DATA_VER) return cached.rows;
    try {
      const rows = parseCore(await fetchData(CORE_URL, 8000));
      kvPut("core", { ver: DATA_VER, rows });
      return rows;
    } catch (e) {
      coreVer = cached.ver;      // 离线时退回上次的词库，总比打不开好
      return cached.rows;
    }
  }
  const rows = parseCore(await fetchData(CORE_URL, 4000));
  kvPut("core", { ver: DATA_VER, rows });
  return rows;
}

let detailPromise = null;
function loadDetail() {
  if (DETAIL) return Promise.resolve(DETAIL);
  if (!detailPromise) {
    detailPromise = (async () => {
      let rec = await kvGet("detail");
      if (!rec || rec.ver !== coreVer || !Array.isArray(rec.d)) {
        const obj = JSON.parse(await fetchData(`data/detail.v${coreVer}.json`, 25000));
        rec = { ver: coreVer, l: obj.l || [], c: obj.c || [], s: obj.s || [], d: obj.d || [] };
        kvPut("detail", rec);
      }
      DETAIL = rec;
      mergeDetail();
      return DETAIL;
    })().catch((e) => {
      detailPromise = null;   // 失败后允许下次重试
      throw e;
    });
  }
  return detailPromise;
}

function mergeDetail() {
  const labels = DETAIL.l, pool = DETAIL.s, rows = DETAIL.d, cats = DETAIL.c || [];
  for (let i = 0; i < WORDS.length; i++) {
    const rec = rows[i];
    if (!rec) continue;
    const it = WORDS[i];
    if (rec[0]) it.md = rec[0];
    if (rec[1]) it.fo = rec[1].map(([f, k]) => [f, labels[k] || ""]);
    if (rec[2]) it.var = rec[2];
    if (rec[3]) it.ex = rec[3].map((k) => pool[k]).filter(Boolean);
    if (rec[4]) it.f = rec[4];
    if (rec[5] !== undefined && rec[5] !== null) it.cat = cats[rec[5]];
  }
}

function loadProvenance() {
  fetch("data/provenance.json")
    .then((r) => r.json())
    .then((p) => { PROV = p; renderAbout(); })
    .catch(() => renderAbout());
}

function setDataError() {
  dataError = true;
  const btn = $("btn-start");
  btn.disabled = false;
  btn.textContent = "词库加载失败 · 点此重试";
}

async function retryLoad() {
  dataError = false;
  const btn = $("btn-start");
  btn.disabled = true;
  btn.textContent = "正在重新加载…";
  try {
    applyCore(await loadCore());
    coreReady = true;
    refreshToday();
    loadDetail().catch(() => {});
  } catch (e) {
    setDataError();
  }
}

/* ---------------- 视图切换 ---------------- */
const VIEWS = ["today", "learn", "dict", "stats", "settings"];
function showView(name) {
  for (const v of VIEWS) $("view-" + v).hidden = v !== name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $("tabbar").style.display = name === "learn" ? "none" : "";
  if (name === "today") refreshToday();
  if (name === "dict") renderDict();
  if (name === "stats") renderStats();
}
function bindTabs() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => showView(t.dataset.view))
  );
}

/* ---------------- 今日页 ---------------- */
function setGreeting() {
  const h = new Date().getHours();
  $("greeting").textContent =
    h < 6 ? "夜深了" : h < 12 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  const wd = "日一二三四五六"[new Date().getDay()];
  const d = new Date();
  $("today-date").textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${wd} · 继续加油`;
}

let todaySeq = 0;   // 多次刷新并发时，只让最后一次写回界面，避免旧结果盖新结果
async function refreshToday() {
  const seq = ++todaySeq;
  setGreeting();
  const now = Date.now();
  const log = (await DB.logs.get(todayKey())) || { n: 0, r: 0 };
  if (seq !== todaySeq) return;

  let due = 0, learned = 0, masteredScope = 0;
  for (const c of CARDS.values()) {
    const it = WORD_MAP.get(c.w);
    if (!it || (settings.scope === "high" && it.r > 2000)) continue;
    learned++;
    if (c.due.getTime() <= now) due++;
    if (c.state === FState.Review && c.stability >= 21) masteredScope++;
  }
  let fresh = 0;
  if (coreReady) for (const x of SCOPE) if (!CARDS.has(x.w)) fresh++;
  const remainNew = Math.max(0, settings.dailyNew - (log.n || 0));

  $("stat-due").textContent = due;
  $("stat-new").textContent = coreReady ? Math.min(remainNew, fresh) : "—";
  $("stat-learned").textContent = learned;

  const totalTask = coreReady ? Math.min(remainNew, fresh) + due : 0;
  const doneTotal = (log.n || 0) + (log.r || 0);
  const pct = totalTask > 0
    ? Math.min(100, Math.round((doneTotal / totalTask) * 100))
    : (doneTotal > 0 ? 100 : 0);
  $("day-ring").style.background = `conic-gradient(var(--accent) ${pct}%, var(--card-2) 0)`;
  $("ring-pct").textContent = pct + "%";
  $("today-done").hidden = !(coreReady && totalTask === 0 && doneTotal > 0);

  const btn = $("btn-start");
  if (!coreReady) {
    btn.disabled = !dataError;
    btn.textContent = dataError ? "词库加载失败 · 点此重试" : "词库加载中…";
  } else {
    btn.disabled = false;
    btn.textContent = totalTask === 0 ? "自由加练 10 词" : `开始学习 · ${totalTask} 词`;
  }

  const covTotal = settings.scope === "high" ? 2000 : WORDS.length || 1;
  const cov = coreReady ? Math.round((masteredScope / covTotal) * 100) : 0;
  $("coverage-bar").style.width = cov + "%";
  $("coverage-caption").textContent =
    `已掌握 ${masteredScope} / ${settings.scope === "high" ? "高频 2000" : "全量 " + WORDS.length} 词（间隔 ≥ 21 天视为掌握）`;

  // 最近 367 天打卡一次批量读取：连续打卡 + 本周条
  const keys = [];
  for (let i = 0; i <= 366; i++) keys.push(dateKeyOffset(-i));
  const recs = await DB.logs.bulkGet(keys);
  if (seq !== todaySeq) return;
  let streak = 0;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (rec && (rec.n + rec.r) > 0) streak++;
    else if (i === 0) continue; // 今天还没学不打断，从昨天起算
    else break;
  }
  $("streak-badge").textContent = "🔥 " + streak + " 天";

  const strip = $("week-strip");
  strip.innerHTML = "";
  const wdNames = ["日", "一", "二", "三", "四", "五", "六"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const rec = recs[i];
    const div = document.createElement("div");
    div.className = "week-day" + (rec && (rec.n + rec.r) > 0 ? " done" : "") + (i === 0 ? " today" : "");
    div.innerHTML = `<div class="wd">${wdNames[d.getDay()]}</div><div class="dot">${rec && (rec.n + rec.r) > 0 ? "✓" : d.getDate()}</div>`;
    strip.appendChild(div);
  }
}

function bindToday() {
  $("btn-start").addEventListener("click", startSession);
  $("btn-theme").addEventListener("click", () => {
    settings.theme = effectiveTheme() === "dark" ? "light" : "dark";
    saveSettings(); applyTheme();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}

/* ---------------- 学习会话 ---------------- */
const S = { queue: [], idx: 0, isNew: [], nNew: 0, nRev: 0, revealed: false, active: false, current: null };

async function startSession() {
  if (!coreReady) {
    if (dataError) retryLoad();
    else toast("词库还在加载，请稍候");
    return;
  }
  const now = Date.now();
  const log = await DB.logs.get(todayKey()) || { n: 0, r: 0 };
  const remainNew = Math.max(0, settings.dailyNew - (log.n || 0));

  const dueWords = [];
  for (const x of SCOPE) {
    const c = CARDS.get(x.w);
    if (c && c.due.getTime() <= now) dueWords.push(x.w);
  }
  const introduced = new Set(CARDS.keys());
  const freshWords = [];
  if (remainNew > 0) {  // 剩余新词为 0 时不再收集，交给自由加练分支
    for (const x of SCOPE) {
      if (!introduced.has(x.w)) { freshWords.push(x.w); if (freshWords.length >= remainNew) break; }
    }
  }

  if (dueWords.length + freshWords.length === 0) {
    // 自由加练：优先提前背未学的新词，不足 10 个再用掌握最弱的已学词补足
    const pool = [];
    for (const x of SCOPE) {
      if (pool.length >= 10) break;
      if (!introduced.has(x.w)) pool.push(x.w);
    }
    if (pool.length < 10) {
      const learned = SCOPE.filter((x) => CARDS.has(x.w) && !pool.includes(x.w))
        .sort((a, b) => (CARDS.get(a.w).stability || 0) - (CARDS.get(b.w).stability || 0));
      for (const x of learned) {
        if (pool.length >= 10) break;
        pool.push(x.w);
      }
    }
    if (!pool.length) { toast("当前范围没有可学的词，先完成首轮吧"); return; }
    S.queue = pool;
    S.isNew = pool.map((w) => !introduced.has(w));
  } else {
    S.queue = dueWords.concat(freshWords);
    S.isNew = S.queue.map((_, i) => i >= dueWords.length);
  }
  S.idx = 0; S.nNew = 0; S.nRev = 0; S.active = true;
  $("learn-summary").hidden = true;
  $("learn-card").hidden = false;
  $("btn-show").hidden = false;
  showView("learn");
  renderCard();
}

function renderCard() {
  const w = S.queue[S.idx];
  const item = WORD_MAP.get(w);
  S.current = item;
  S.revealed = false;
  $("learn-word").textContent = item.w;
  $("learn-phonetic").textContent = "";
  $("learn-reveal").hidden = true;
  $("btn-show").hidden = false;
  $("rate-row").hidden = true;
  $("rate-hint").hidden = true;
  $("learn-progress").style.width = (S.idx / S.queue.length) * 100 + "%";
  $("learn-count").textContent = `${S.idx}/${S.queue.length}`;
  $("learn-card").classList.remove("swipe-out");
  showPhonetic(item.w);
}

function renderReveal(it) {
  let html = esc(it.m);
  if (it.md) html += `<span class="detail">${esc(it.md)}</span>`;
  $("learn-meaning").innerHTML = html;
  $("learn-forms").innerHTML = (it.fo || [])
    .map(([f, lab]) => `<span class="form-chip"><b>${esc(f)}</b> ${esc(lab)}</span>`).join("");
  $("learn-example").innerHTML = it.ex && it.ex.length
    ? `${fmtSent(it.ex[0][0])}<span class="src">—— 真题原句 · ${esc(it.ex[0][1])}</span>`
    : "";
}

function revealCard() {
  if (S.revealed || !S.current) return;
  S.revealed = true;
  renderReveal(S.current);
  $("learn-reveal").hidden = false;
  $("btn-show").hidden = true;
  $("rate-row").hidden = false;
  $("rate-hint").hidden = false;
  $("learn-count").textContent = `${S.idx + 1}/${S.queue.length}`;
  // 释义已可见，例句/词形等详情到达后原地补全
  if (!DETAIL) {
    const w = S.current.w;
    loadDetail()
      .then(() => { if (S.revealed && S.current && S.current.w === w) renderReveal(S.current); })
      .catch(() => {});
  }
}

async function rateCard(name) {
  if (!S.revealed || !S.active) return;
  S.active = false;
  const w = S.queue[S.idx];
  const next = await rateWord(w, name, S.isNew[S.idx]);
  CARDS.set(w, normalizeCard(next));
  if (S.isNew[S.idx]) S.nNew++; else S.nRev++;
  $("learn-card").classList.add("swipe-out");
  setTimeout(() => {
    S.idx++;
    if (S.idx >= S.queue.length) {
      showSummary();
    } else {
      S.active = true;
      renderCard();
    }
  }, 170);
}

function showSummary() {
  $("learn-card").hidden = true;
  $("btn-show").hidden = true;
  $("rate-row").hidden = true;
  $("rate-hint").hidden = true;
  $("learn-progress").style.width = "100%";
  $("learn-count").textContent = `${S.queue.length}/${S.queue.length}`;
  $("sum-detail").innerHTML =
    `本次完成 <b>${S.queue.length}</b> 词<br>新学 ${S.nNew} · 复习 ${S.nRev}`;
  $("learn-summary").hidden = false;
}

function bindLearn() {
  $("btn-show").addEventListener("click", revealCard);
  $("learn-card").addEventListener("click", (e) => {
    if (!S.revealed && !e.target.closest("#learn-sound")) revealCard();
  });
  document.querySelectorAll(".btn-rate").forEach((b) =>
    b.addEventListener("click", () => rateCard(b.dataset.rate))
  );
  $("learn-sound").addEventListener("click", (e) => {
    e.stopPropagation();
    if (S.current) playSound(S.current.w);
  });
  $("btn-sum-back").addEventListener("click", () => { showView("today"); });
  $("btn-learn-exit").addEventListener("click", () => {
    if (S.idx > 0 || !S.active) { showView("today"); return; }
    if (confirm("退出本次学习？")) showView("today");
  });
}

/* ---------------- 词库页 ---------------- */
const D = { q: "", filter: "all", list: [], rowH: 70, detailWord: null };

function bindDict() {
  const input = $("dict-search");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { D.q = input.value.trim().toLowerCase(); renderDict(); }, 150);
  });
  document.querySelectorAll("#dict-filters .chip").forEach((c) =>
    c.addEventListener("click", () => {
      document.querySelectorAll("#dict-filters .chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      D.filter = c.dataset.filter;
      renderDict();
    })
  );
  $("dict-scroll").addEventListener("scroll", () => renderDictWindow());
  $("dict-window").addEventListener("click", (e) => {
    const row = e.target.closest(".dict-row");
    if (row) openDetail(row.dataset.w);
  });
  $("detail-mask").addEventListener("click", (e) => {
    if (e.target === $("detail-mask")) $("detail-mask").hidden = true;
  });
}

function renderDict() {
  if (!coreReady) {
    D.list = [];
    $("dict-count").textContent = dataError ? "词库加载失败，请回到今日页重试" : "词库加载中…";
    $("dict-spacer").style.height = "0";
    $("dict-window").innerHTML = "";
    return;
  }
  const q = D.q;
  let list = SCOPE;
  if (D.filter === "learned") list = list.filter((x) => CARDS.has(x.w));
  else if (D.filter === "unlearned") list = list.filter((x) => !CARDS.has(x.w));
  else if (D.filter !== "all") list = list.filter((x) => x.t === D.filter);

  if (q) {
    const starts = [], contains = [];
    for (const x of list) {
      if (x._l.startsWith(q)) starts.push(x);
      else if (x._l.includes(q) || (x.m && x.m.includes(q))) contains.push(x);
    }
    list = starts.concat(contains);
  }
  D.list = list;
  $("dict-count").textContent = `${list.length} 词 · 范围：${settings.scope === "high" ? "高频 2000" : "全量 " + WORDS.length}`;
  const spacer = $("dict-spacer");
  spacer.style.height = list.length * D.rowH + "px";
  $("dict-scroll").scrollTop = 0;
  renderDictWindow();
}

function renderDictWindow() {
  const scroll = $("dict-scroll");
  const start = Math.max(0, Math.floor(scroll.scrollTop / D.rowH) - 6);
  const end = Math.min(D.list.length, start + Math.ceil(scroll.clientHeight / D.rowH) + 12);
  const win = $("dict-window");
  win.style.transform = `translateY(${start * D.rowH}px)`;
  let html = "";
  for (let i = start; i < end; i++) {
    const x = D.list[i];
    const st = cardStatusText(CARDS.get(x.w));
    html += `<div class="dict-row" data-w="${esc(x.w)}" style="height:${D.rowH - 6}px">
      <span class="dw">${esc(x.w)}</span>
      <span class="dm">${esc(x.m)}</span>
      <span class="badge${x.t}">${x.t}</span>
      <span class="status-dot ${st.cls}"></span>
    </div>`;
  }
  win.innerHTML = html;
}

function openDetail(w) {
  const it = WORD_MAP.get(w);
  if (!it) return;
  D.detailWord = w;
  renderDetail(it);
  $("detail-mask").hidden = false;
  if (!DETAIL) {
    loadDetail()
      .then(() => { if (D.detailWord === w && !$("detail-mask").hidden) renderDetail(it); })
      .catch(() => {});
  }
}

function renderDetail(it) {
  const w = it.w;
  const card = CARDS.get(w);
  const st = cardStatusText(card);
  const sheet = $("detail-sheet");
  const keepTop = sheet.scrollTop;
  let html = `
    <div class="sheet-handle"></div>
    <div class="word-line">
      <span class="word">${esc(it.w)}</span>
      <button class="icon-btn sound" id="detail-sound" aria-label="发音">
        <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
      </button>
    </div>
    <div class="meta">
      <span class="meta-tag hl">#${it.r}</span>
      ${it.f ? `<span class="meta-tag">真题出现 ${it.f} 次</span>` : ""}
      <span class="meta-tag">${it.t}词</span>
      ${it.cat ? `<span class="meta-tag">${esc(it.cat)}</span>` : ""}
    </div>
    <div class="sec"><div class="sec-title">释义</div>
      <div class="sec-body">${esc(it.m)}${it.md ? `<span class="alt">${esc(it.md)}</span>` : ""}</div>
    </div>`;
  if (it.fo && it.fo.length) {
    html += `<div class="sec"><div class="sec-title">词形变化</div>
      <div class="forms">${it.fo.map(([f, lab]) => `<span class="form-chip"><b>${esc(f)}</b> ${esc(lab)}</span>`).join("")}</div></div>`;
  }
  if (it.var) html += `<div class="sec"><div class="sec-title">其他拼写</div><div>${esc(it.var)}</div></div>`;
  if (it.ex && it.ex.length) {
    html += `<div class="sec"><div class="sec-title">真题原句</div>` +
      it.ex.map(([s, src]) => `<div class="ex-item">${fmtSent(s)}<span class="src">—— ${esc(src)}</span></div>`).join("") +
      `</div>`;
  }
  html += `<div class="status-line"><span class="status-text">学习状态：${st.text}</span>
    ${card ? `<button class="btn-small" id="detail-reset">重置进度</button>` : ""}</div>`;
  sheet.innerHTML = html;
  sheet.scrollTop = keepTop;
  $("detail-sound").addEventListener("click", () => playSound(w));
  const rb = $("detail-reset");
  if (rb) rb.addEventListener("click", async () => {
    if (!confirm(`重置「${w}」的学习进度？`)) return;
    await resetWord(w);
    await reloadCards();
    $("detail-mask").hidden = true;
    renderDict();
    toast("已重置");
  });
}

/* ---------------- 统计页 ---------------- */
function bindStatsView() {}

async function renderStats() {
  await reloadCards();
  const logs = await DB.logs.toArray();
  let learned = 0, mastered = 0;
  for (const c of CARDS.values()) {
    learned++;
    if (c.state === FState.Review && c.stability >= 21) mastered++;
  }
  const reviews = logs.reduce((s, l) => s + (l.r || 0), 0);
  const days = logs.filter((l) => (l.n || 0) + (l.r || 0) > 0).length;
  $("s-learned").textContent = learned;
  $("s-mastered").textContent = mastered;
  $("s-reviews").textContent = reviews;
  $("s-days").textContent = days;

  const logMap = new Map(logs.map((l) => [l.date, l]));
  // 14 天柱状
  const chart = $("chart14");
  chart.innerHTML = "";
  let max = 1;
  const cols = [];
  for (let i = 13; i >= 0; i--) {
    const k = dateKeyOffset(-i);
    const rec = logMap.get(k) || { n: 0, r: 0 };
    max = Math.max(max, rec.n + rec.r);
    cols.push({ k, n: rec.n || 0, r: rec.r || 0 });
  }
  for (const c of cols) {
    const div = document.createElement("div");
    div.className = "c14-col";
    div.innerHTML = `<div class="c14-new" style="height:${(c.n / max) * 84}px"></div>
      <div class="c14-rev" style="height:${(c.r / max) * 84}px"></div>
      <div class="c14-label">${Number(c.k.slice(8))}</div>`;
    chart.appendChild(div);
  }
  // 90 天热力（13 列 × 7 行，按周纵排）
  const hm = $("heatmap");
  hm.innerHTML = "";
  const today = new Date();
  const daysBack = 89;
  const endOffset = today.getDay(); // 本周已过几天，让最后一列对齐
  for (let col = 0; col < 13; col++) {
    for (let row = 0; row < 7; row++) {
      // 从最后一列最后一行(今天)往回数
      const back = (12 - col) * 7 + (6 - row);
      const cell = document.createElement("div");
      if (back > daysBack + endOffset || back < 0) { cell.className = "hm-cell"; cell.style.visibility = "hidden"; }
      else {
        const k = dateKeyOffset(-back);
        const rec = logMap.get(k);
        const v = rec ? (rec.n || 0) + (rec.r || 0) : 0;
        cell.className = "hm-cell" + (v === 0 ? "" : v < 10 ? " l1" : v < 30 ? " l2" : " l3");
        cell.title = `${k}: ${v}`;
      }
      hm.appendChild(cell);
    }
  }
}

/* ---------------- 设置页 ---------------- */
function bindSettings() {
  document.querySelectorAll("#theme-seg button").forEach((b) => {
    b.addEventListener("click", () => {
      settings.theme = b.dataset.themeMode;
      saveSettings(); applyTheme();
    });
  });
  const nv = $("new-value");
  const presets = document.querySelectorAll("#new-presets .chip");
  const syncNew = () => {
    nv.textContent = settings.dailyNew;
    presets.forEach((c) => c.classList.toggle("active", Number(c.dataset.n) === settings.dailyNew));
    saveSettings();
  };
  $("new-minus").addEventListener("click", () => { settings.dailyNew = clampNew(settings.dailyNew - NEW_STEP); syncNew(); });
  $("new-plus").addEventListener("click", () => { settings.dailyNew = clampNew(settings.dailyNew + NEW_STEP); syncNew(); });
  presets.forEach((c) => c.addEventListener("click", () => {
    settings.dailyNew = clampNew(Number(c.dataset.n));
    syncNew();
  }));
  settings.dailyNew = clampNew(settings.dailyNew);
  syncNew();

  document.querySelectorAll("#scope-seg button").forEach((b) => {
    b.classList.toggle("active", b.dataset.scope === settings.scope);
    b.addEventListener("click", () => {
      settings.scope = b.dataset.scope;
      document.querySelectorAll("#scope-seg button").forEach((x) => x.classList.toggle("active", x === b));
      saveSettings(); applyScope();
      toast("词库范围已切换");
      if (coreReady && !$("view-dict").hidden) renderDict();
      if (coreReady) refreshToday();
    });
  });

  const at = $("audio-toggle");
  at.checked = settings.audio;
  at.addEventListener("change", () => { settings.audio = at.checked; saveSettings(); });

  $("btn-export").addEventListener("click", async () => {
    const data = {
      app: "gwc-kaoyan", version: 1, exportedAt: new Date().toISOString(),
      settings: settings,
      cards: await DB.cards.toArray(),
      logs: await DB.logs.toArray(),
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kaoyan-words-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出");
  });

  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "gwc-kaoyan" || !Array.isArray(data.cards)) throw new Error("格式不符");
      if (!confirm(`将覆盖当前学习数据（${data.cards.length} 张卡片），继续？`)) return;
      const cards = data.cards.map(normalizeCard);   // 备份里的时间是字符串，先还原
      await DB.transaction("rw", DB.cards, DB.logs, async () => {
        await DB.cards.clear(); await DB.logs.clear();
        await DB.cards.bulkPut(cards);
        await DB.logs.bulkPut(data.logs || []);
      });
      if (data.settings) {
        Object.assign(settings, data.settings);
        settings.dailyNew = clampNew(settings.dailyNew);
        saveSettings(); applyScope();
      }
      await reloadCards();
      refreshToday();
      toast("导入成功");
    } catch (err) { toast("导入失败：" + err.message); }
  });

  $("btn-reset").addEventListener("click", async () => {
    if (!confirm("确定清空全部学习数据？此操作不可恢复（建议先导出备份）")) return;
    await DB.transaction("rw", DB.cards, DB.logs, async () => {
      await DB.cards.clear(); await DB.logs.clear();
    });
    await reloadCards();
    refreshToday();
    toast("已清空");
  });
}

function renderAbout() {
  if (!PROV) { $("about-src").textContent = "来源信息加载中…"; return; }
  let html = PROV.sources.map((s) =>
    `<div class="src-item">${esc(s.name)}<br><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a><br>协议：${esc(s.license)}</div>`
  ).join("");
  if (PROV.derived) html += `<div class="src-item" style="color:var(--text)">${esc(PROV.derived)}</div>`;
  if (PROV.components) {
    html += `<div class="src-item">开源组件：` + PROV.components.map((c) =>
      `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>（${esc(c.license)}）`).join("、") + `</div>`;
  }
  if (PROV.notices) html += `<div>${esc(PROV.notices)}</div>`;
  html += `<div style="margin-top:6px">${esc(PROV.note)}</div>`;
  $("about-src").innerHTML = html;
}

/* ---------------- 发音 ---------------- */
let audioCache = {};
try { audioCache = JSON.parse(localStorage.getItem("gwc-audio") || "{}") || {}; } catch (e) { audioCache = {}; }
let audioSaveTimer;
function saveAudioCache() {
  clearTimeout(audioSaveTimer);
  audioSaveTimer = setTimeout(() => {
    try { localStorage.setItem("gwc-audio", JSON.stringify(audioCache)); } catch (e) { /* 超额忽略 */ }
  }, 400);
}

async function showPhonetic(w) {
  const c = audioCache[w];
  if (c && c.ipa) { $("learn-phonetic").textContent = c.ipa; return; }
  const info = await fetchAudioInfo(w);
  if (info && info.ipa && S.current && S.current.w === w) $("learn-phonetic").textContent = info.ipa;
}

async function fetchAudioInfo(w) {
  if (audioCache[w] !== undefined) return audioCache[w];
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, { signal: ctl.signal });
    clearTimeout(timer);
    if (r.status === 404) {
      // 词条确实不存在，负缓存避免反复请求
      audioCache[w] = { ipa: "", url: "" };
      saveAudioCache();
      return audioCache[w];
    }
    if (!r.ok) return { ipa: "", url: "" }; // 临时故障不缓存，下次重试
    const d = await r.json();
    const ph = (d[0].phonetics || []).find((p) => p.audio) || (d[0].phonetics || [])[0] || {};
    const info = { ipa: d[0].phonetic || ph.text || "", url: (ph.audio || "").replace(/^http:/, "https:") };
    audioCache[w] = info;
    saveAudioCache();
    return info;
  } catch (e) {
    return { ipa: "", url: "" }; // 网络错误/超时不缓存
  }
}
async function playSound(w) {
  if (!settings.audio) return;
  const info = await fetchAudioInfo(w);
  if (info && info.url) {
    try { new Audio(info.url).play(); return; } catch (e) { /* 落到 TTS */ }
  }
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(w);
    u.lang = "en-US"; u.rate = 0.9;
    speechSynthesis.speak(u);
  }
}

init();
