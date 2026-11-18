/* =========================================================================
   Order | Прокачка: глобальные хуки.
   1. Уровень заклинания или навыка вырос не через окно (кольцо в листе способности,
      мастер повышения ранга, ручная правка) — добавляем «ждёт выбора улучшения»
      и открываем окно «Прокачка» с кат-ином и выбором.
   2. ГМ что-то поменял у способности игрока (уровень, откат, решение по заявке) —
      клиент игрока по метке ping открывает окно сам.
   3. Карточки чата: кнопки ГМа видит только ГМ, «Откатить» — только у последнего выбора.
   Свои записи окно помечает опцией { osLeveling: true }: здесь они пропускаются.
   ========================================================================= */

import * as R from "./rules.js";
import * as A from "./actions.js";
import { CARD_FLAG } from "./chat.js";
import OrderLevelingApp from "./OrderLevelingApp.js";

const PREV = "osLvPrev";
/* Уровень «до» ещё и здесь, по uuid: если опции операции вернутся с сервера без нашего ключа,
   смена уровня всё равно не потеряется. Пишет и читает только клиент, который меняет предмет. */
const prevLevels = new Map();

/** Новая прокачка работает у бойцов (Player); у NPC и дронов остаётся прежний диалог */
export function usesLevelingWindow(actor) { return actor?.documentName === "Actor" && actor.type === "Player"; }

/** Открыть окно «Прокачка» персонажа, при необходимости — сразу на способности */
export function openLeveling(actor, opts = {}) {
  if (!actor) return null;
  return OrderLevelingApp.open(actor, opts);
}

function watched(item) {
  const actor = item?.parent;
  return !!actor && usesLevelingWindow(actor) && R.isLevelable(item) && !R.isVariant(item);
}

/* лист способности открыт — у него свой кат-ин уровня, второй не нужен */
function sheetIsOpen(item) { return !!item?.sheet?.rendered; }

async function onLevelChanged(item, prev, options) {
  const actor = item.parent;
  const level = R.num(item.system.Level);
  const lv = R.lvFlags(item);

  if (level < prev) {
    /* уровень понизили руками: выбор за снятые уровни больше не нужен */
    const pending = lv.pending.filter((p) => p.level <= level);
    if (pending.length !== lv.pending.length) await item.update({ "flags.Order.leveling.pending": pending }, A.opt());
    await A.syncVariantLevels(actor, item, level);
    return;
  }

  const source = options?.osRankUpOpenSheet ? A.SOURCE.rank : A.SOURCE.manual;
  const fresh = [];
  for (let n = Math.max(2, prev + 1); n <= level; n++) {
    /* за уровень уже выбрано (понизили и подняли обратно) или он уже ждёт — не дублируем */
    if (lv.history.some((h) => h.level === n) || lv.pending.some((p) => p.level === n)) continue;
    fresh.push({ level: n, source, replace: false });
  }
  await A.syncVariantLevels(actor, item, level);
  if (!fresh.length) return;

  const players = game.user.isGM ? A.activePlayerOwners(actor) : [];
  const upd = { "flags.Order.leveling.pending": [...lv.pending, ...fresh] };
  if (players.length) {
    upd["flags.Order.leveling.ping"] = {
      id: foundry.utils.randomID(8), by: game.user.id, kind: "levelup",
      levels: fresh.map((f) => f.level), at: Date.now(), cutin: true
    };
  }
  await item.update(upd, A.opt());

  if (players.length) {
    ui.notifications?.info?.(`${item.name}: уровень ${level}. ${players.map((u) => u.name).join(", ")} выберет улучшение в окне «Прокачка».`);
    return;
  }
  openLeveling(actor, { itemId: item.id, levelUp: { cutin: !sheetIsOpen(item), source } });
}

function onPing(item, ping) {
  if (!ping || ping.by === game.user.id || game.user.isGM) return;
  const actor = item.parent;
  if (!actor?.isOwner || !usesLevelingWindow(actor)) return;
  const lvl = (ping.levels ?? []).join(", ");
  switch (ping.kind) {
    case "levelup":
      openLeveling(actor, { itemId: item.id, levelUp: { cutin: ping.cutin !== false, notice: `ГМ поднял уровень: ${item.name}` } });
      break;
    case "revert":
      ui.notifications?.info?.(`ГМ откатил выбор улучшения «${item.name}» за уровень ${lvl}. Выбери заново.`);
      openLeveling(actor, { itemId: item.id, levelUp: { cutin: false, notice: `ГМ откатил выбор уровня ${lvl}` } });
      break;
    case "declined":
      ui.notifications?.warn?.(`ГМ отклонил заявку «${item.name}» (уровень ${lvl}). Выбери обычное улучшение.`);
      openLeveling(actor, { itemId: item.id, levelUp: { cutin: false, notice: `Заявка отклонена, уровень ${lvl}` } });
      break;
    case "approved":
      ui.notifications?.info?.(ping.request === "evo"
        ? `ГМ одобрил Эволюцию «${item.name}»: вариант появился в списке способностей.`
        : `ГМ одобрил улучшение «${item.name}» (уровень ${lvl}).`);
      break;
    default: break;
  }
}

/* ---------- карточки чата ---------- */
function decorateCard(message, root) {
  const f = message?.flags?.Order?.[CARD_FLAG];
  const card = root?.querySelector?.(".lvx-cm");
  if (!f || !card) return;
  const isGM = !!game.user?.isGM;
  card.querySelectorAll(isGM ? "[data-lvx-player]" : "[data-lvx-gm]").forEach((n) => n.remove());

  const actor = f.actorUuid ? fromUuidSync(f.actorUuid) : null;
  const item = actor?.items?.get?.(f.itemId) ?? null;

  /* «Откатить» — только у последнего выбора, пока способность есть, и на самой свежей карточке
     этого уровня (после замены отклонённой заявки карточек уровня две) */
  if (f.type === "level") {
    const newest = (game.messages?.contents ?? []).filter((m) => {
      const g = m.flags?.Order?.[CARD_FLAG];
      return g?.type === "level" && g.itemId === f.itemId && g.level === f.level && g.actorUuid === f.actorUuid && g.status !== "void";
    }).at(-1);
    const ok = isGM && item && f.status !== "void" && A.latestLevel(item) === f.level && (!newest || newest.id === message.id);
    if (!ok) card.querySelector('[data-lvx-act="revert"]')?.closest(".lvx-cm-actions")?.remove();
  }

  /* шапка карточки открывает окно «Прокачка» на этой способности */
  const head = card.querySelector(".lvx-cm-head");
  if (head && item && actor?.isOwner && usesLevelingWindow(actor)) {
    head.style.cursor = "pointer";
    head.title = "Открыть окно «Прокачка»";
    head.addEventListener("click", () => openLeveling(actor, { itemId: item.id }));
  }

  card.querySelectorAll("[data-lvx-act]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!game.user?.isGM) return;
      const act = btn.dataset.lvxAct;
      card.querySelectorAll("[data-lvx-act]").forEach((b) => { b.disabled = true; });
      try {
        if (act === "approve" || act === "decline") {
          await A.resolveRequest(message, act === "approve");
        } else if (act === "revert") {
          if (!item) { ui.notifications?.warn?.("Способность уже удалена."); return; }
          if (A.latestLevel(item) !== f.level) { ui.notifications?.warn?.("Откатить можно только последний выбор."); return; }
          const done = await A.revertLevel(actor, item, f.level);
          if (done) { try { globalThis.OrderSfx?.play?.("lvRevert"); } catch (e) { /* ignore */ } }
        }
      } catch (err) {
        console.error("Order | Leveling | действие из чата", err);
        ui.notifications?.error?.("Не удалось выполнить действие прокачки.");
      } finally {
        card.querySelectorAll("[data-lvx-act]").forEach((b) => { if (b.isConnected) b.disabled = false; });
      }
    });
  });
}

/* ========================================================================= */

export function registerOrderLevelingHooks() {
  Hooks.on("preUpdateItem", (item, changes, options) => {
    try {
      if (options?.osLeveling || !watched(item)) return;
      if (foundry.utils.getProperty(changes, "system.Level") === undefined) return;
      const prev = R.num(item.system.Level);
      prevLevels.set(item.uuid, prev);
      options[PREV] = options[PREV] || {};
      options[PREV][item.id] = prev;
    } catch (e) { /* не мешаем обновлению */ }
  });

  Hooks.on("updateItem", (item, changes, options, userId) => {
    try {
      const ping = foundry.utils.getProperty(changes, "flags.Order.leveling.ping");
      if (ping) onPing(item, ping);
      if (userId !== game.user?.id) return;
      const stored = prevLevels.get(item.uuid);
      prevLevels.delete(item.uuid);
      if (options?.osLeveling || !watched(item)) return;
      if (foundry.utils.getProperty(changes, "system.Level") === undefined) return;
      const prev = options?.[PREV]?.[item.id] ?? stored;
      if (prev === undefined) return;
      const level = R.num(item.system.Level);
      if (level === prev) return;
      onLevelChanged(item, prev, options).catch((err) => console.error("Order | Leveling | смена уровня", err));
    } catch (err) {
      console.error("Order | Leveling | updateItem", err);
    }
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    try {
      const root = html instanceof HTMLElement ? html : html?.[0];
      decorateCard(message, root);
    } catch (err) {
      console.error("Order | Leveling | карточка чата", err);
    }
  });

  /* API для макросов и других частей системы */
  game.OrderLeveling = { open: openLeveling, App: OrderLevelingApp, rules: R, actions: A };
}
