/**
 * Order | Общие хелперы для Active Effects (Foundry v14).
 *
 * В v14 изменения эффекта лежат в `effect.system.changes`, у изменения строковый `type`
 * ("add", "custom", …) вместо числового `mode`. Старые данные (корневой `changes`, `mode: 2`)
 * Foundry мигрирует сам и молча, но ЧТЕНИЕ `change.mode` и `CONST.ACTIVE_EFFECT_MODES`
 * пишет в консоль предупреждение об устаревании. Поэтому код системы читает изменения
 * только через эти функции.
 *
 * Как система использует эффекты:
 *  - `flags.Order.roll.attack` / `flags.Order.roll.defense` — внешний модификатор к броскам
 *    атаки / защиты (дебаффы, Испытание духа, травмы). Суммируется в getExternalRollModifierFromEffects.
 *  - `myCustomEffect.<Характеристика>Mod` с типом "custom" — модификатор характеристики, который
 *    лист игрока раскладывает в `system.<Характеристика>.modifiers` (см. OrderPlayerSheet.js).
 */

/** Строковые типы изменений v14 (замена CONST.ACTIVE_EFFECT_MODES). */
export const CHANGE_TYPES = Object.freeze({
  CUSTOM: "custom",
  MULTIPLY: "multiply",
  ADD: "add",
  DOWNGRADE: "downgrade",
  UPGRADE: "upgrade",
  OVERRIDE: "override"
});

/** Числовой mode из старых данных → строковый type v14. */
const LEGACY_MODE_TO_TYPE = Object.freeze(["custom", "multiply", "add", "downgrade", "upgrade", "override"]);

/**
 * Массив изменений эффекта: документ v14, сырые данные или старый формат.
 * @param {ActiveEffect|object} effect
 * @returns {object[]}
 */
export function getEffectChanges(effect) {
  if (!effect) return [];
  const candidates = [effect.system?.changes, effect.changes, effect._source?.system?.changes, effect._source?.changes];
  return candidates.find(Array.isArray) ?? [];
}

/**
 * Тип изменения без обращения к устаревшему геттеру `mode`.
 * Для сырых данных старого формата (только числовой `mode`) переводим его в строку.
 * @param {object} change
 * @returns {string|null}
 */
export function getChangeType(change) {
  if (!change) return null;
  if (typeof change.type === "string") return change.type;
  // Обычное свойство (не геттер-шим) есть только у старых сырых данных — читать безопасно.
  const own = Object.getOwnPropertyDescriptor(change, "mode");
  if (own && "value" in own) {
    const mode = Number(own.value);
    if (Number.isInteger(mode)) return LEGACY_MODE_TO_TYPE[mode] ?? `custom.${mode}`;
  }
  return null;
}

/** Изменение «myCustomEffect.<X>Mod» c типом custom — модификатор характеристики системы. */
export function isOrderCustomChange(change) {
  return !!change?.key?.startsWith?.("myCustomEffect.") && getChangeType(change) === CHANGE_TYPES.CUSTOM;
}

/**
 * Сумма внешних модификаторов броска из включённых эффектов актёра.
 * @param {Actor} actor
 * @param {"attack"|"defense"} [kind="defense"]  "attack" → flags.Order.roll.attack, иначе flags.Order.roll.defense
 * @returns {number}
 */
export function getExternalRollModifierFromEffects(actor, kind = "defense") {
  if (!actor) return 0;
  const key = kind === "attack" ? "flags.Order.roll.attack" : "flags.Order.roll.defense";
  let sum = 0;
  for (const effect of actor.effects ?? []) {
    if (!effect || effect.disabled) continue;
    for (const change of getEffectChanges(effect)) {
      if (!change || change.key !== key) continue;
      const v = Number(change.value);
      if (!Number.isNaN(v)) sum += v;
    }
  }
  return sum;
}
