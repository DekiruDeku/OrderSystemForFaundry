/* =========================================================================
   Order | Прокачка: запись в документы.
   Всё, что меняет предметы, актёра и чат, собрано здесь: окно только рисует
   и анимирует, а глобальные хуки (hooks.js) и кнопки чата зовут те же функции.

   Флаги предмета: flags.Order.leveling = {
     pending:  [{ level, source, replace }]   уровни, за которые ещё не выбрано улучшение
     history:  [{ level, at, by, user, mode, picks, evolution, before, variants }]
     evolutionOf, evoLevel                     у варианта Эволюции: id исходной способности и уровень
     ping                                      метка «ГМ что-то поменял» для клиента игрока
   }
   Флаг актёра: flags.Order.leveling.day.count — тренировки за социальный день.
   Все свои обновления помечаем опцией { osLeveling: true }: хуки их не трогают.
   ========================================================================= */

import * as R from "./rules.js";
import { postCard, setCardStatus, CARD_FLAG } from "./chat.js";

/* Опции записи: каждый раз новый объект. Foundry дописывает в опции parent, pack и updates,
   поэтому общий (тем более замороженный) объект ломает запись: «object is not extensible». */
export const opt = () => ({ osLeveling: true });
const RollClass = () => foundry?.dice?.Roll ?? globalThis.Roll;
const clone = (v) => foundry.utils.deepClone(v);
const today = () => new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

export const SOURCE = {
  training: "тренировка",
  award: "награда ГМа",
  rank: "О.М.П. (повышение ранга)",
  manual: "изменение уровня в листе"
};

/* ---------- кто есть кто ---------- */
export function variantsOf(actor, item) {
  return actor?.items?.filter((i) => R.lvFlags(i).evolutionOf === item.id) ?? [];
}
export function parentOf(actor, item) {
  const id = R.lvFlags(item).evolutionOf;
  return id ? actor?.items?.get(id) ?? null : null;
}
/* Игроки-владельцы в игре (без ГМа): им отдаём выбор улучшения */
export function activePlayerOwners(actor) {
  return game.users?.filter((u) => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER")) ?? [];
}
export function dayCount(actor) { return R.num(actor?.flags?.Order?.leveling?.day?.count); }

function ping(kind, levels, extra = {}) {
  return { id: foundry.utils.randomID(8), by: game.user.id, kind, levels, at: Date.now(), ...extra };
}

/* Варианты Эволюции живут на уровне исходной способности */
export async function syncVariantLevels(actor, item, level = R.num(item.system.Level)) {
  const upd = variantsOf(actor, item)
    .filter((v) => R.num(v.system.Level) !== level)
    .map((v) => ({ _id: v.id, "system.Level": level, "system.filledSegments": 0 }));
  if (upd.length) await actor.updateEmbeddedDocuments("Item", upd, opt());
}

/* =========================================================================
   Тренировка
   ========================================================================= */
export async function rollTraining(actor, item, charKey, mod = 0) {
  const bonus = R.trainingBonus(R.charValue(actor, charKey)) + mod;
  const dc = R.trainingDC(item);
  const n = R.diceCount(actor);
  const Roll = RollClass();
  const roll = await new Roll(`${n}d20`).evaluate();
  const nats = (roll.dice?.[0]?.results ?? []).map((r) => Number(r.result));
  const rolls = nats.map((nat) => {
    const total = nat + bonus;
    const crit = nat === 20, one = nat === 1, ok = crit || (!one && total >= dc);
    return { nat, total, crit, one, ok, pts: crit ? 2 : ok ? 1 : 0 };
  });
  return { roll, rolls, bonus, dc, n, charKey, mod };
}

/* Записать итог тренировки: шкала, уровни, счётчик дня, одна карточка в чат */
export async function commitTraining(actor, item, t, { net = 0, aborted = false } = {}) {
  const before = R.num(item.system.Level);
  const res = aborted
    ? { level: before, filled: R.num(item.system.filledSegments), gained: [] }
    : R.addPoints(item, net);
  const lv = R.lvFlags(item);
  const pending = [...lv.pending, ...res.gained.map((level) => ({ level, source: SOURCE.training, replace: false }))];
  await item.update({
    "system.Level": res.level,
    "system.filledSegments": res.filled,
    "flags.Order.leveling.pending": pending
  }, opt());
  if (res.level !== before) await syncVariantLevels(actor, item, res.level);

  const day = dayCount(actor) + 1;
  await actor.update({ "flags.Order.leveling.day.count": day }, opt());

  const max = R.maxLevel(item);
  await postCard(actor, {
    type: "training", itemId: item.id, name: item.name, img: item.img,
    char: R.CHAR[t.charKey] ?? t.charKey, bonus: t.bonus, mod: t.mod, dc: t.dc,
    rolls: t.rolls.map((r) => ({ nat: r.nat, total: r.total, cls: r.crit ? "is-crit" : r.one ? "is-fail" : r.ok ? "is-ok" : "" })),
    net, aborted, level: res.level, filled: res.filled, need: R.segmentsFor(item, res.level),
    up: res.gained.length > 0, max: res.level >= max, overLimit: day > R.DAY_LIMIT
  }, { rolls: t.roll ? [t.roll] : [] });

  return { ...res, day };
}

/* =========================================================================
   Выбор улучшения
   ========================================================================= */
export async function applyChoice(actor, item, choice) {
  const { level, picks = {}, mode = "single", custom = "", evoName = "", evoText = "", replace = false, source = "" } = choice;
  const opts = R.buildOptions(item, actor);
  const std = Object.entries(picks).filter(([k]) => k !== "custom").map(([key, times]) => ({ key, times }));
  const { before, after } = R.applyPicks(item, actor, std);
  const patch = R.diffPatch(before, after);
  const beforePatch = R.pickFields(before, Object.keys(patch));

  const pickRecs = std.map(({ key, times }) => {
    const o = opts.find((x) => x.key === key);
    return {
      key, times, label: o?.title ?? key,
      delta: times > 1 ? R.doubleDelta(o?.delta ?? "") : (o?.delta ?? ""),
      from: String(o?.from ?? ""), to: String(R.pickResult(item, actor, key, times) ?? o?.to ?? "")
    };
  });
  if (picks.custom) pickRecs.push({ key: "custom", label: "Другое", to: custom.trim(), status: "pending" });

  /* варианты Эволюции: одинаковые поля растут вместе с исходной */
  const varBefore = {};
  const varUpdates = [];
  const synced = [];
  for (const v of variantsOf(actor, item)) {
    const vp = R.syncVariantSystem(before, after, v.system);
    const keys = Object.keys(vp);
    if (!keys.length) continue;
    varBefore[v.id] = R.pickFields(v.system, keys);
    const u = { _id: v.id };
    for (const k of keys) u[`system.${k}`] = vp[k];
    varUpdates.push(u);
    synced.push(v.name);
  }

  const lv = R.lvFlags(item);
  const history = clone(lv.history);
  const idx = history.findIndex((h) => h.level === level);
  if (replace && idx >= 0) {
    /* замена отклонённой заявки: дописываем к записи уровня, «до» берём самое раннее */
    const ex = history[idx];
    ex.picks = (ex.picks ?? []).filter((p) => p.status !== "declined").concat(pickRecs);
    ex.before = { ...beforePatch, ...(ex.before ?? {}) };
    const vb = { ...(ex.variants ?? {}) };
    for (const [id, fields] of Object.entries(varBefore)) vb[id] = { ...fields, ...(vb[id] ?? {}) };
    ex.variants = vb;
    ex.replaced = true;
  } else {
    const entry = {
      level, at: today(), by: source, user: game.user.name, mode, picks: pickRecs,
      evolution: mode === "evo" ? { name: evoName.trim(), text: evoText.trim(), status: "pending" } : null,
      before: beforePatch, variants: varBefore
    };
    if (idx >= 0) history[idx] = entry; else history.push(entry);
  }
  history.sort((a, b) => a.level - b.level);

  const pi = lv.pending.findIndex((p) => p.level === level);
  const pending = lv.pending.filter((_, i) => i !== pi);

  const upd = { "flags.Order.leveling.history": history, "flags.Order.leveling.pending": pending };
  for (const [k, v] of Object.entries(patch)) upd[`system.${k}`] = v;
  await item.update(upd, opt());
  if (varUpdates.length) await actor.updateEmbeddedDocuments("Item", varUpdates, opt());

  const base = { itemId: item.id, name: item.name, img: item.img, level };
  await postCard(actor, { ...base, type: "level", picks: pickRecs, replacing: replace, source, synced, evo: R.isEvolutionLevel(level) && !replace, status: "done" });
  if (mode === "evo") await postCard(actor, { ...base, type: "evo", evoName: evoName.trim(), evoText: evoText.trim(), status: "pending" });
  if (picks.custom) await postCard(actor, { ...base, type: "custom", text: custom.trim(), status: "pending" });

  return { patch, pickRecs, synced };
}

/* =========================================================================
   ГМ: очки, уровень за О.М.П., новый день
   ========================================================================= */
export async function gmAddPoints(actor, item, delta) {
  if (delta < 0 && R.num(item.system.filledSegments) <= 0) return null;
  const before = R.num(item.system.Level);
  const res = R.addPoints(item, delta);
  const lv = R.lvFlags(item);
  const pending = [...lv.pending, ...res.gained.map((level) => ({ level, source: SOURCE.award, replace: false }))];
  const upd = { "system.Level": res.level, "system.filledSegments": res.filled, "flags.Order.leveling.pending": pending };
  if (res.gained.length) upd["flags.Order.leveling.ping"] = ping("levelup", res.gained, { cutin: true });
  await item.update(upd, opt());
  if (res.level !== before) await syncVariantLevels(actor, item, res.level);
  return res;
}

export async function gmAwardLevel(actor, item, source = SOURCE.rank) {
  const r = R.levelByAward(item);
  if (!r) return null;
  const lv = R.lvFlags(item);
  await item.update({
    "system.Level": r.level,
    "system.filledSegments": r.filled,
    "flags.Order.leveling.pending": [...lv.pending, { level: r.level, source, replace: false }],
    "flags.Order.leveling.ping": ping("levelup", [r.level], { cutin: true })
  }, opt());
  await syncVariantLevels(actor, item, r.level);
  return { level: r.level, filled: r.filled, gained: [r.level] };
}

export async function newDay(actor) {
  await actor.update({ "flags.Order.leveling.day.count": 0 }, opt());
}

/* =========================================================================
   ГМ: откат последнего выбора
   ========================================================================= */
export function latestLevel(item) {
  const h = R.lvFlags(item).history;
  return h.length ? Math.max(...h.map((x) => x.level)) : null;
}

export async function revertLevel(actor, item, level) {
  if (!game.user.isGM) return false;
  const lv = R.lvFlags(item);
  const history = clone(lv.history);
  const i = history.findIndex((h) => h.level === level);
  if (i < 0 || level !== latestLevel(item)) return false;
  const h = history[i];
  history.splice(i, 1);

  const upd = {};
  for (const [k, v] of Object.entries(h.before ?? {})) upd[`system.${k}`] = v;
  upd["flags.Order.leveling.history"] = history;
  upd["flags.Order.leveling.pending"] = [{ level, source: h.by ?? "", replace: false }, ...lv.pending.filter((p) => p.level !== level)];
  upd["flags.Order.leveling.ping"] = ping("revert", [level]);
  await item.update(upd, opt());

  /* поля вариантов, выросшие вместе с исходной */
  const varUpd = Object.entries(h.variants ?? {})
    .filter(([id]) => actor.items.get(id))
    .map(([id, fields]) => {
      const u = { _id: id };
      for (const [k, v] of Object.entries(fields)) u[`system.${k}`] = v;
      return u;
    });
  if (varUpd.length) await actor.updateEmbeddedDocuments("Item", varUpd, opt());

  /* вариант, созданный одобренной Эволюцией этого уровня, уходит вместе с выбором */
  const evoIds = variantsOf(actor, item).filter((v) => R.lvFlags(v).evoLevel === level).map((v) => v.id);
  if (evoIds.length) await actor.deleteEmbeddedDocuments("Item", evoIds, opt());

  /* карточки этого уровня: заявки отменяются, карточка уровня помечается */
  for (const m of game.messages?.contents ?? []) {
    const f = m.flags?.Order?.[CARD_FLAG];
    if (!f || f.itemId !== item.id || f.level !== level || f.actorUuid !== actor.uuid) continue;
    if ((f.type === "evo" || f.type === "custom") && f.status === "pending") await setCardStatus(m, "void");
    if (f.type === "level" && f.status !== "void") await setCardStatus(m, "void");
  }
  await postCard(actor, { type: "revert", itemId: item.id, name: item.name, img: item.img, level });
  return true;
}

/* =========================================================================
   ГМ: решение по заявке из чата
   ========================================================================= */
export async function resolveRequest(message, ok) {
  if (!game.user.isGM) return false;
  const f = message?.flags?.Order?.[CARD_FLAG];
  if (!f || f.status !== "pending" || !["evo", "custom"].includes(f.type)) return false;
  const actor = f.actorUuid ? fromUuidSync(f.actorUuid) : null;
  const item = actor?.items?.get(f.itemId);
  if (!item) { await setCardStatus(message, "void"); return false; }

  const lv = R.lvFlags(item);
  const history = clone(lv.history);
  const h = history.find((x) => x.level === f.level);
  const pending = [...lv.pending];
  const status = ok ? "approved" : "declined";

  if (f.type === "evo") {
    if (h?.evolution) h.evolution.status = status;
    if (ok) {
      const data = item.toObject();
      delete data._id;
      data.name = `${item.name}: ${f.evoName}`;
      data.sort = (item.sort ?? 0) + 1;
      const note = `<p><strong>Эволюция «${foundry.utils.escapeHTML(f.evoName)}»</strong> (уровень ${f.level}): ${foundry.utils.escapeHTML(f.evoText)}</p>`;
      data.system = { ...data.system, description: `${note}${data.system?.description ?? ""}`, filledSegments: 0 };
      data.flags = { ...(data.flags ?? {}), Order: { ...(data.flags?.Order ?? {}), leveling: { evolutionOf: item.id, evoLevel: f.level, history: [], pending: [] } } };
      const [variant] = await actor.createEmbeddedDocuments("Item", [data], opt());
      if (h?.evolution && variant) h.evolution.variantId = variant.id;
    } else {
      pending.push({ level: f.level, source: h?.by ?? "", replace: true });
    }
  } else {
    const pk = h?.picks?.find((p) => p.key === "custom" && p.status === "pending" && p.to === f.text)
      ?? h?.picks?.find((p) => p.key === "custom" && p.status === "pending");
    if (pk) pk.status = status;
    if (!ok) pending.push({ level: f.level, source: h?.by ?? "", replace: true });
  }

  const upd = { "flags.Order.leveling.history": history, "flags.Order.leveling.pending": pending };
  upd["flags.Order.leveling.ping"] = ping(ok ? "approved" : "declined", [f.level], { request: f.type });
  await item.update(upd, opt());
  await setCardStatus(message, status);
  return true;
}
