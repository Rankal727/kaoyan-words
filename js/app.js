/* 考研英语一高频词记背 PWA 主逻辑 */
"use strict";

/* ---------------- 全局状态 ---------------- */
let WORDS = [];            // words.json 全量
let SCOPE = [];            // 当前词库范围
let CARDS = new Map();     // w -> card（缓存）
let PROV = null;
const settings = Object.assign(
  { dailyNew: 30, scope: "high", audio: true, theme: "auto" },
  JSON.parse(localStorage.getItem("gwc-settings") || "{}")
);

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
  document.querySelector('meta[name="theme-color"]')
    .setAttribute("content", effectiveTheme() === "dark" ? "#131519" : "#f6f6f4");
  const btn = $("btn-theme");
  if (btn) btn.innerHTML = effectiveTheme() === "dark" ? ICON_SUN : ICON_MOON;
  document.querySelectorAll("#theme-seg button").forEach((b) =>
    b.classList.toggle("active", b.dataset.themeMode === mode)
  );
}

async function init() {
  applyTheme();
  try {
    const [words, prov] = await Promise.all([
      fetch("data/words.json").then((r) => r.json()),
      fetch("data/provenance.json").then((r) => r.json()).catch(() => null),
    ]);
    WORDS = words;
    PROV = prov;
    for (const w of WORDS) w._l = w.w.toLowerCase();
  } catch (e) {
    document.body.innerHTML = "<p style='padding:40px;text-align:center'>词库加载失败，请刷新重试</p>";
    return;
  }
  applyScope();
  await reloadCards();
  bindTabs();
  bindToday();
  bindLearn();
  bindDict();
  bindStatsView();
  bindSettings();
  renderAbout();
  showView("today");

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

async function reloadCards() {
  CARDS = new Map((await DB.cards.toArray()).map((c) => [c.w, c]));
}
function applyScope() {
  SCOPE = settings.scope === "high" ? WORDS.filter((w) => w.r <= 2000) : WORDS;
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

async function refreshToday() {
  setGreeting();
  const now = Date.now();
  const key = todayKey();
  const log = await DB.logs.get(key) || { n: 0, r: 0 };

  let due = 0, learned = 0, masteredScope = 0, fresh = 0;
  const scopeSet = new Set(SCOPE.map((x) => x.w));
  for (const c of CARDS.values()) {
    if (!scopeSet.has(c.w)) continue;
    learned++;
    if (c.due.getTime() <= now) due++;
    if (c.state === FState.Review && c.stability >= 21) masteredScope++;
  }
  const introduced = new Set(CARDS.keys());
  for (const x of SCOPE) if (!introduced.has(x.w)) fresh++;
  const remainNew = Math.max(0, settings.dailyNew - (log.n || 0));

  $("stat-due").textContent = due;
  $("stat-new").textContent = Math.min(remainNew, fresh);
  $("stat-learned").textContent = learned;

  const totalTask = Math.min(remainNew, fresh) + due;
  const doneToday = Math.min(log.n || 0, settings.dailyNew);
  const pct = totalTask === 0 && (log.n + log.r) > 0 ? 100 : Math.round((doneToday / settings.dailyNew) * 100);
  $("day-ring").style.background = `conic-gradient(var(--accent) ${pct}%, var(--card-2) 0)`;
  $("ring-pct").textContent = pct + "%";
  $("today-done").hidden = !(totalTask === 0 && (log.n + log.r) > 0);
  $("btn-start").textContent = totalTask === 0 ? "自由加练 10 词" : `开始学习 · ${totalTask} 词`;

  const cov = Math.round((masteredScope / (settings.scope === "high" ? 2000 : 5530)) * 100);
  $("coverage-bar").style.width = cov + "%";
  $("coverage-caption").textContent =
    `已掌握 ${masteredScope} / ${settings.scope === "high" ? "高频 2000" : "全量 5530"} 词（间隔 ≥ 21 天视为掌握）`;

  // 连续打卡
  let streak = 0;
  for (let i = 0; ; i++) {
    const k = dateKeyOffset(-i);
    const rec = await DB.logs.get(k);
    if (rec && (rec.n + rec.r) > 0) streak++;
    else if (i === 0) continue; // 今天还没学不打断，从昨天起算
    else break;
    if (i > 365) break;
  }
  $("streak-badge").textContent = "🔥 " + streak + " 天";

  // 周条
  const strip = $("week-strip");
  strip.innerHTML = "";
  const wdNames = ["日", "一", "二", "三", "四", "五", "六"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    const rec = await DB.logs.get(k);
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
const S = { queue: [], idx: 0, isNew: [], nNew: 0, nRev: 0, revealed: false, active: false };

async function startSession() {
  const now = Date.now();
  const key = todayKey();
  const log = await DB.logs.get(key) || { n: 0, r: 0 };
  const remainNew = Math.max(0, settings.dailyNew - (log.n || 0));

  const dueWords = [];
  for (const x of SCOPE) {
    const c = CARDS.get(x.w);
    if (c && c.due.getTime() <= now) dueWords.push(x.w);
  }
  const introduced = new Set(CARDS.keys());
  const freshWords = [];
  for (const x of SCOPE) {
    if (!introduced.has(x.w)) { freshWords.push(x.w); if (freshWords.length >= remainNew) break; }
  }

  if (dueWords.length + freshWords.length === 0) {
    // 自由加练：按排名补 10 个已学但未到期的词（优先掌握度低的）
    const pool = SCOPE.filter((x) => CARDS.has(x.w))
      .sort((a, b) => (CARDS.get(a.w).stability || 0) - (CARDS.get(b.w).stability || 0))
      .slice(0, 10).map((x) => x.w);
    if (!pool.length) { toast("当前范围没有可学的词，先完成首轮吧"); return; }
    S.queue = pool;
    S.isNew = pool.map(() => false);
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
  const item = WORDS.find((x) => x.w === w);
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

function revealCard() {
  if (S.revealed || !S.current) return;
  S.revealed = true;
  const it = S.current;
  let html = esc(it.m);
  if (it.md) html += `<span class="detail">${esc(it.md)}</span>`;
  $("learn-meaning").innerHTML = html;
  $("learn-forms").innerHTML = (it.fo || [])
    .map(([f, lab]) => `<span class="form-chip"><b>${esc(f)}</b> ${esc(lab)}</span>`).join("");
  $("learn-example").innerHTML = it.ex && it.ex.length
    ? `${fmtSent(it.ex[0][0])}<span class="src">—— 真题原句 · ${esc(it.ex[0][1])}</span>`
    : "";
  $("learn-reveal").hidden = false;
  $("btn-show").hidden = true;
  $("rate-row").hidden = false;
  $("rate-hint").hidden = false;
  $("learn-count").textContent = `${S.idx + 1}/${S.queue.length}`;
}

async function rateCard(name) {
  if (!S.revealed || !S.active) return;
  S.active = false;
  const w = S.queue[S.idx];
  await rateWord(w, name, S.isNew[S.idx]);
  if (S.isNew[S.idx]) S.nNew++; else S.nRev++;
  CARDS.set(w, await DB.cards.get(w));
  $("learn-card").classList.add("swipe-out");
  setTimeout(async () => {
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
const D = { q: "", filter: "all", list: [], rowH: 70 };

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
  $("detail-mask").addEventListener("click", (e) => {
    if (e.target === $("detail-mask")) $("detail-mask").hidden = true;
  });
}

function renderDict() {
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
  $("dict-count").textContent = `${list.length} 词 · 范围：${settings.scope === "high" ? "高频 2000" : "全量 5530"}`;
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
  win.querySelectorAll(".dict-row").forEach((r) =>
    r.addEventListener("click", () => openDetail(r.dataset.w))
  );
}

function openDetail(w) {
  const it = WORDS.find((x) => x.w === w);
  if (!it) return;
  const card = CARDS.get(w);
  const st = cardStatusText(card);
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
      <span class="meta-tag">真题出现 ${it.f} 次</span>
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
  $("detail-sheet").innerHTML = html;
  $("detail-mask").hidden = false;
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
  const syncNew = () => { nv.textContent = settings.dailyNew; saveSettings(); };
  $("new-minus").addEventListener("click", () => { settings.dailyNew = Math.max(10, settings.dailyNew - 5); syncNew(); });
  $("new-plus").addEventListener("click", () => { settings.dailyNew = Math.min(100, settings.dailyNew + 5); syncNew(); });
  nv.textContent = settings.dailyNew;

  document.querySelectorAll("#scope-seg button").forEach((b) => {
    b.classList.toggle("active", b.dataset.scope === settings.scope);
    b.addEventListener("click", () => {
      settings.scope = b.dataset.scope;
      document.querySelectorAll("#scope-seg button").forEach((x) => x.classList.toggle("active", x === b));
      saveSettings(); applyScope();
      toast("词库范围已切换");
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
      await DB.transaction("rw", DB.cards, DB.logs, async () => {
        await DB.cards.clear(); await DB.logs.clear();
        await DB.cards.bulkPut(data.cards);
        await DB.logs.bulkPut(data.logs || []);
      });
      if (data.settings) {
        Object.assign(settings, data.settings);
        saveSettings();
      }
      await reloadCards();
      toast("导入成功");
    } catch (err) { toast("导入失败：" + err.message); }
  });

  $("btn-reset").addEventListener("click", async () => {
    if (!confirm("确定清空全部学习数据？此操作不可恢复（建议先导出备份）")) return;
    await DB.transaction("rw", DB.cards, DB.logs, async () => {
      await DB.cards.clear(); await DB.logs.clear();
    });
    await reloadCards();
    toast("已清空");
  });
}

function renderAbout() {
  if (!PROV) { $("about-src").textContent = "来源信息加载失败"; return; }
  $("about-src").innerHTML =
    PROV.sources.map((s) =>
      `<div class="src-item">${esc(s.name)}<br><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a><br>协议：${esc(s.license)}</div>`
    ).join("") + `<div style="margin-top:6px">${esc(PROV.note)}</div>`;
}

/* ---------------- 发音 ---------------- */
const audioCache = JSON.parse(localStorage.getItem("gwc-audio") || "{}");
async function showPhonetic(w) {
  const c = audioCache[w];
  if (c && c.ipa) { $("learn-phonetic").textContent = c.ipa; return; }
  const info = await fetchAudioInfo(w);
  if (info && info.ipa) $("learn-phonetic").textContent = info.ipa;
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
      localStorage.setItem("gwc-audio", JSON.stringify(audioCache));
      return audioCache[w];
    }
    if (!r.ok) return { ipa: "", url: "" }; // 临时故障不缓存，下次重试
    const d = await r.json();
    const ph = (d[0].phonetics || []).find((p) => p.audio) || (d[0].phonetics || [])[0] || {};
    const info = { ipa: d[0].phonetic || ph.text || "", url: (ph.audio || "").replace(/^http:/, "https:") };
    audioCache[w] = info;
    localStorage.setItem("gwc-audio", JSON.stringify(audioCache));
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
