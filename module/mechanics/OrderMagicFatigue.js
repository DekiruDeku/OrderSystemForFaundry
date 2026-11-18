/**
 * Order | Магическая усталость сверх предела → дебафф «Магическая усталость» по стадиям.
 *
 * Правило (решение команды, 2026-11-18): превышение предела МУ на
 *   +1 → стадия 1 («Магическая усталость», −3 на действия),
 *   +2 → стадия 2 («Магическая изнеможденность», −6),
 *   +3 и больше → стадия 3 («Магическая ломка», −12).
 * Без превышения дебаффа от автоматики нет. Стадии и штрафы берутся из module/debuffs.json (MagicFatigue).
 *
 * Как работает:
 *  - стадия зависит только от `system.ManaFatigue.value − system.ManaFatigue.max`, поэтому неважно,
 *    откуда пришло изменение: каст заклинания, ввод в листе или HUD, снятие МУ эффектом,
 *    изменение предела (Магия / Выносливость);
 *  - OrderActor.prepareData() вызывает syncManaOverflowDebuff(); записывает только один клиент
 *    (core/side-effects.js), остальные выходят сразу;
 *  - эффект бессрочный и помечен флагом `flags.Order.manaOverflow`. Его стадия ходит за превышением
 *    в обе стороны, а при превышении 0 эффект снимается;
 *  - дебафф «Магическая усталость», который GM повесил вручную (без флага), автоматика не снимает и
 *    не понижает. Если превышение требует стадию выше, эффект поднимается, а ручная стадия
 *    запоминается (`manaOverflowFloor`); когда превышение уйдёт, эффект вернётся к ней и снова
 *    станет ручным.
 */

import { shouldPersistActorSideEffects } from "../core/side-effects.js";

export const MAGIC_FATIGUE_DEBUFF = "MagicFatigue";
const MAX_STAGE = 3;
const DEBUFFS_URL = "systems/Order/module/debuffs.json";

/**
 * Стадия дебаффа по текущему значению и пределу МУ.
 * @param {number} value  текущая магическая усталость
 * @param {number} max    предел магической усталости
 * @returns {0|1|2|3}
 */
export function manaOverflowStage(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m)) return 0;
  const over = Math.floor(v - m);
  return Math.max(0, Math.min(MAX_STAGE, over));
}

/**
 * Что сделать с эффектом. Возвращает null, если ничего менять не нужно.
 *  - эффекта нет: при превышении создаём свой (auto);
 *  - свой (auto): стадия = превышение; если превышения больше нет — возвращаем ручную стадию,
 *    которая была до автоматики (floor), и отдаём эффект GM, либо снимаем эффект;
 *  - ручной: только поднимаем, если превышение требует больше; ручная стадия запоминается как floor.
 * @returns {{target: number, auto: boolean, floor: number}|null}  target 0 = снять эффект
 */
export function planManaOverflowStage({ desired, hasEffect = false, current = 0, auto = false, floor = 0 }) {
  let next;
  if (!hasEffect) next = desired > 0 ? { target: desired, auto: true, floor: 0 } : null;
  else if (auto) {
    if (desired > floor) next = { target: desired, auto: true, floor };
    else if (floor > 0) next = { target: floor, auto: false, floor: 0 };
    else next = { target: 0, auto: false, floor: 0 };
  } else next = desired > current ? { target: desired, auto: true, floor: current } : null;

  if (!next) return null;
  const same = hasEffect && next.target === current && next.auto === auto && (!next.auto || next.floor === floor);
  return same ? null : next;
}

function readEffectState(actor) {
  const effect = actor?.effects?.find?.((e) => e?.getFlag?.("Order", "debuffKey") === MAGIC_FATIGUE_DEBUFF) ?? null;
  return {
    effect,
    hasEffect: !!effect,
    current: Number(effect?.getFlag?.("Order", "stateKey")) || 0,
    auto: effect?.getFlag?.("Order", "manaOverflow") === true,
    floor: Number(effect?.getFlag?.("Order", "manaOverflowFloor")) || 0
  };
}

/** Нужна ли запись: дешёвая синхронная проверка, вызывается из prepareData(). */
function computePlan(actor) {
  const mf = actor?.system?.ManaFatigue;
  if (!mf) return null;
  const state = readEffectState(actor);
  const plan = planManaOverflowStage({ desired: manaOverflowStage(mf.value, mf.max), ...state });
  return plan ? { ...plan, effect: state.effect } : null;
}

let debuffDefsPromise = null;
function loadMagicFatigueDef() {
  if (game?.OrderDebuffs?.[MAGIC_FATIGUE_DEBUFF]) return Promise.resolve(game.OrderDebuffs[MAGIC_FATIGUE_DEBUFF]);
  debuffDefsPromise ??= fetch(DEBUFFS_URL)
    .then((r) => { if (!r.ok) throw new Error(`Failed to load ${DEBUFFS_URL}`); return r.json(); })
    .catch((err) => { debuffDefsPromise = null; throw err; });
  return debuffDefsPromise.then((d) => d?.[MAGIC_FATIGUE_DEBUFF] ?? null);
}

async function writePlan(actor, plan) {
  const { effect, target, auto, floor } = plan;

  if (target <= 0) {
    if (effect) await effect.delete();
    return;
  }

  const def = await loadMagicFatigueDef();
  if (!def?.states?.[String(target)]) {
    console.warn("Order | MagicFatigue: нет стадии в debuffs.json", target);
    return;
  }
  const maxState = Object.keys(def.states).length || MAX_STAGE;
  const changes = Array.isArray(def.changes?.[String(target)]) ? def.changes[String(target)].map((c) => ({ ...c })) : [];
  const orderFlags = {
    debuffKey: MAGIC_FATIGUE_DEBUFF,
    stateKey: target,
    maxState,
    manaOverflow: auto,
    manaOverflowFloor: floor
  };

  if (effect) {
    await effect.update({
      name: def.name,
      img: def.icon || "icons/svg/skull.svg",
      changes,
      description: def.states[String(target)],
      "flags.Order.debuffKey": orderFlags.debuffKey,
      "flags.Order.stateKey": orderFlags.stateKey,
      "flags.Order.maxState": orderFlags.maxState,
      "flags.Order.manaOverflow": auto,
      "flags.Order.manaOverflowFloor": floor
    });
  } else {
    // без duration: дебафф держится, пока есть превышение (а не один раунд)
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: def.name,
      img: def.icon || "icons/svg/skull.svg",
      changes,
      description: def.states[String(target)],
      flags: { Order: orderFlags }
    }]);
  }
}

/**
 * Привести дебафф к стадии по текущему превышению МУ. Безопасно вызывать часто:
 * без изменений и на «чужом» клиенте выходит сразу. Записи по одному актёру идут по очереди.
 * @param {Actor} actor
 */
export function syncManaOverflowDebuff(actor) {
  try {
    if (!game?.ready || !actor?.id || actor.pack) return;
    if (!["Player", "NPC"].includes(actor.type)) return;
    if (actor._orderManaSync) { actor._orderManaResync = true; return; }
    const plan = computePlan(actor);
    if (!plan) return;
    if (!shouldPersistActorSideEffects(actor)) return;

    actor._orderManaSync = writePlan(actor, plan)
      .catch((err) => console.warn("Order | MagicFatigue sync failed", err))
      .finally(() => {
        actor._orderManaSync = null;
        if (actor._orderManaResync) {
          actor._orderManaResync = false;
          syncManaOverflowDebuff(actor);
        }
      });
  } catch (err) {
    console.warn("Order | MagicFatigue sync failed", err);
  }
}

/** Проход по всем актёрам мира после загрузки (на случай превышения, внесённого раньше). */
export function syncAllManaOverflowDebuffs() {
  for (const actor of game?.actors ?? []) syncManaOverflowDebuff(actor);
}
