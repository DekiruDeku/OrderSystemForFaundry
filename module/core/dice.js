/**
 * Order | Общие хелперы d20 для всех бросков (атака, защита, каст, спасброски).
 *
 * Рулбук, «Двадцатигранник судьбы»: чистая 20 на d20 — Критический успех,
 * чистая 1 — Критический провал. Бонусы не делают бросок «чистым» критом,
 * поэтому здесь смотрим на грань оставленного d20, а не на итог.
 *
 * «Оставленный» важен при преимуществе/помехе (2d20kh1 / 2d20kl1): чистую 1 или 20
 * определяет только кость, которая пошла в итог; отброшенная не считается.
 */

/** Формула d20 для режима броска из диалогов системы: adv / dis / обычный. */
export function d20FormulaForMode(mode) {
  if (mode === "adv") return "2d20kh1";
  if (mode === "dis") return "2d20kl1";
  return "1d20";
}

/**
 * Грани d20, которые пошли в итог броска (отброшенные kh/kl не включаются).
 * @param {Roll|null} roll
 * @returns {number[]}
 */
export function keptD20Results(roll) {
  const out = [];
  try {
    for (const die of roll?.dice ?? []) {
      if (Number(die?.faces) !== 20) continue;
      const results = Array.isArray(die.results) ? die.results : [];
      const kept = results.filter((r) => r?.active !== false && !r?.discarded);
      for (const r of (kept.length ? kept : results)) {
        const n = Number(r?.result);
        if (Number.isFinite(n)) out.push(n);
      }
    }
  } catch (err) {
    console.warn("Order | keptD20Results failed", err);
  }
  return out;
}

/** На оставленном d20 выпала 20 — Критический успех. */
export function isNaturalTwenty(roll) {
  return keptD20Results(roll).includes(20);
}

/** На оставленном d20 выпала 1 — Критический провал. */
export function isNaturalOne(roll) {
  return keptD20Results(roll).includes(1);
}

/**
 * Попала ли атака с учётом броска защиты. Единое правило для всех потоков боя:
 * - автопровал атаки (итог ниже порога атаки) — промах всегда;
 * - иначе попадание, только если атака строго больше защиты (ничья — защита успешна).
 *
 * Чистая 1 на защите исход НЕ меняет: крит. провал только показывается в чате, как и крит. успех
 * (решение команды). Параметр defenseNat1 оставлен, чтобы вызовы не менять; чтобы вернуть
 * «чистая 1 = защита не сработала», достаточно добавить здесь `if (defenseNat1) return true;`.
 */
// eslint-disable-next-line no-unused-vars
export function resolveDefenseHit({ attackTotal, defenseTotal, defenseNat1 = false, autoFail = false } = {}) {
  if (autoFail) return false;
  return (Number(attackTotal) || 0) > (Number(defenseTotal) || 0);
}

/** Строка в карточке чата под защитой с чистой 1 (её подхватывает скин чата — штамп «Крит. провал»). */
export function critFailDefenseHtml() {
  return `<p class="order-crit-fail"><strong>Крит. провал защиты:</strong> на d20 выпала чистая 1.</p>`;
}

/**
 * Метка «[КРИТ. ПРОВАЛ]» рядом с результатом броска — зеркально красной метке «[КРИТ]».
 * Ставится там же, где метка крита: атака, каст, воздействие навыка, итог спасброска.
 */
export function critFailTagHtml() {
  return ` <span class="order-crit-fail-tag" style="color:#c00;font-weight:700;">[КРИТ. ПРОВАЛ]</span>`;
}

/**
 * Доп. класс и подсказка для ячейки итога АоЕ / массового спасброска, если у цели на d20
 * выпала чистая 1 (защита или спасбросок). Исход ячейки не меняется, только метка.
 * @param {{defenseNat1?: boolean, saveNat1?: boolean}} entry  запись цели
 * @returns {{cls: string, title: string}}
 */
export function critFailAoECell(entry) {
  return (entry?.defenseNat1 || entry?.saveNat1)
    ? { cls: " order-aoe-result--critfail", title: " · крит. провал (чистая 1)" }
    : { cls: "", title: "" };
}
