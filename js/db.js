/* IndexedDB 存储（Dexie） + FSRS 调度封装（ts-fsrs UMD → window.FSRS） */
"use strict";

const DB = new Dexie("gwc-kaoyan");
DB.version(1).stores({
  cards: "w, due",   // w: 单词; due: 下次复习时间(Date)
  logs: "date",      // date: YYYY-MM-DD; n: 新学数; r: 复习数
});

const FSRSLib = window.FSRS;
const FSRSys = FSRSLib.fsrs ? FSRSLib.fsrs() : new FSRSLib.FSRS();
const Rating = FSRSLib.Rating;
const FState = FSRSLib.State;

function freshCard(w) {
  return {
    w: w,
    due: new Date(),
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: FState.New,
    last_review: undefined,
  };
}

/** 对某词执行一次评分，返回更新后的 FSRS 卡片；isNew 用于统计当日新学 */
async function rateWord(w, ratingName, isNew) {
  const now = new Date();
  let card = await DB.cards.get(w);
  if (!card) card = freshCard(w);
  const log = FSRSys.repeat(card, now)[Rating[ratingName]]; // 键为数字评分 1..4
  const next = Object.assign({}, log.card, { w: w });
  await DB.cards.put(next);

  const key = todayKey();
  const rec = (await DB.logs.get(key)) || { date: key, n: 0, r: 0 };
  if (isNew) rec.n += 1; else rec.r += 1;
  await DB.logs.put(rec);
  return next;
}

/** 重置某词学习进度 */
async function resetWord(w) {
  await DB.cards.delete(w);
}

function todayKey(d) {
  const t = d || new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

function dateKeyOffset(offsetDays) {
  const t = new Date();
  t.setDate(t.getDate() + offsetDays);
  return todayKey(t);
}

/** 卡片状态展示文案 */
function cardStatusText(card) {
  if (!card) return { text: "未学习", cls: "" };
  if (card.state === FState.New) return { text: "未开始", cls: "" };
  if (card.state === FState.Learning || card.state === FState.Relearning)
    return { text: "学习中", cls: "learning" };
  if (card.stability >= 21) return { text: "已掌握", cls: "mastered" };
  const days = Math.max(1, Math.round(card.due.getTime() / 86400000 - Date.now() / 86400000));
  return { text: `复习中 · 间隔 ${days} 天`, cls: "reviewing" };
}
