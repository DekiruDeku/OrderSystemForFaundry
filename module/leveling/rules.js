/* =========================================================================
   Order | Правила прокачки навыков и заклинаний (без DOM).
   Источники: рулбук «Система Обучения» (с. 119, 125–129) и таблицы, которые
   раньше жили в OrderPlayerSheet (потолок уровня, шкала О.О., сложность обучения).

   Что здесь есть:
   - шкала О.О. и потолок уровня по кругу, сложность и бонус обучения;
   - уровни Эволюции (нечётные с 3-го), очки круга магии;
   - список улучшений, собранный из реальных полей способности (buildOptions),
     и их применение к копии system (applyPicks);
   - синхронизация одинаковых полей с вариантами Эволюции (syncVariantSystem).
   ========================================================================= */

import { evaluateDamageFormula, evaluateRangeFormula } from "../mechanics/OrderDamageFormula.js";

/* Потолок уровня по кругу */
export const MAX_LEVEL = { 0: 3, 1: 5, 2: 7, 3: 9, 4: 11 };

/* Шкала «Процесса обучения»: сколько О.О. нужно, чтобы перейти с уровня L на L+1 */
export const SEGMENTS = {
  0: [8, 10, 12],
  1: [12, 12, 14, 16, 18],
  2: [14, 16, 18, 22, 26, 32, 38],
  3: [16, 20, 24, 30, 36, 44, 52, 62, 72],
  4: [18, 24, 30, 38, 46, 56, 66, 78, 90, 104, 118]
};

/* Шаг улучшения по кругу (рулбук с. 127). Для 0 круга рулбук значений не даёт:
   берём значения 1 круга и честно пишем это в окне. */
export const STEP = {
  damage: { 0: 5, 1: 5, 2: 10, 3: 15, 4: 20 },
  mult: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2 },
  range: { 0: 1, 1: 1, 2: 2, 3: 3, 4: 4 },
  aoe: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2 },
  down: { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2 }
};

/* Переход на следующий круг магии (с. 125): сколько очков вложить в текущий круг */
export const CIRCLE_GATE = { 1: 5, 2: 8 };

/* Тренировок за социальный день по правилам (мягкое ограничение) */
export const DAY_LIMIT = 3;

export const CHAR = {
  Strength: "Сила", Dexterity: "Ловкость", Stamina: "Выносливость", Accuracy: "Меткость",
  Will: "Стойкость духа", Knowledge: "Знания", Charisma: "Харизма", Seduction: "Обольщение",
  Leadership: "Лидерство", Faith: "Вера", Medicine: "Медицина", Magic: "Магия", Stealth: "Скрытность"
};
export const CHAR_KEYS = Object.keys(CHAR);

/* Поля, которые меняют улучшения. По ним же идёт синхронизация с вариантами Эволюции. */
export const UPGRADE_FIELDS = [
  "DamageFormulas", "DamageFormula", "Damage", "Multiplier", "RangeFormula", "Range", "AreaSize",
  "SaveDCFormula", "EffectThreshold", "UsageThreshold", "Duration", "additionalFields"
];

export const num = (v, d = 0) => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : d;
};
const sysOf = (item) => item?.system ?? {};
const circleOf = (item) => Math.max(0, Math.min(4, Math.trunc(num(sysOf(item).Circle))));
const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/* ---------- флаги прокачки на предмете ---------- */
export function lvFlags(item) {
  const f = item?.flags?.Order?.leveling ?? {};
  const pending = Array.isArray(f.pending) ? f.pending.filter((p) => p && Number.isFinite(Number(p.level))) : [];
  return {
    history: Array.isArray(f.history) ? f.history : [],
    pending: pending.map((p) => ({ level: Number(p.level), source: p.source ?? "", replace: !!p.replace })),
    evolutionOf: f.evolutionOf ?? null,
    evoLevel: f.evoLevel ?? null
  };
}

export const isPerk = (item) => item?.type === "Skill" && !!sysOf(item).isPerk;
export const isRacial = (item) => item?.type === "Skill" && !!sysOf(item).isRacial;
export const isVariant = (item) => !!lvFlags(item).evolutionOf;
/* Что показывается в окне прокачки: заклинания и навыки, кроме перков (у них своя логика) */
export const isLevelable = (item) => (item?.type === "Spell" || item?.type === "Skill") && !isPerk(item);
/* Что тренируется: всё прокачиваемое, кроме расовых навыков и вариантов Эволюции */
export const isTrainable = (item) => isLevelable(item) && !isRacial(item) && !isVariant(item);

export function maxLevel(item) { return MAX_LEVEL[circleOf(item)] ?? 0; }

export function segmentsFor(item, level = num(sysOf(item).Level)) {
  const max = maxLevel(item);
  if (level >= max) return 0;
  return SEGMENTS[circleOf(item)]?.[Math.max(0, level)] ?? 0;
}

/* Сложность обучения: 10 + 2·круг, +2 за каждый нечётный уровень кроме первого.
   Считается от уровня, к которому идёт тренировка. */
export function trainingDC(item, level = num(sysOf(item).Level)) {
  const target = level + 1;
  return 10 + 2 * circleOf(item) + 2 * Math.floor(Math.max(0, target - 1) / 2);
}

/* Бонус обучения: полный до +3, половина на 4–6, треть на 7–10 */
export function trainingBonus(value) {
  const v = num(value);
  if (v <= 3) return v;
  if (v <= 6) return Math.floor(v / 2);
  return Math.floor(v / 3);
}

/* Как в листе: значение характеристики без модификаторов */
export function charValue(actor, key) { return num(actor?.system?.[key]?.value); }
export function diceCount(actor) { return charValue(actor, "Knowledge") >= 7 ? 4 : 3; }

/* Эволюция: нечётные уровни начиная с 3 (рулбук с. 129) */
export function isEvolutionLevel(level) { return level >= 3 && level % 2 === 1; }

/* Бонус обучения берётся от характеристики из «Условий применения» (с. 128).
   В данных она чаще всего стоит в RollFormulas; если нет — Магия для заклинаний. */
export function defaultTrainingChar(item) {
  const s = sysOf(item);
  const rolls = Array.isArray(s.RollFormulas) ? s.RollFormulas : Object.values(s.RollFormulas ?? {});
  const hay = [...rolls, s.UsageConditions || "", s.EffectConditions || ""].join(" ");
  const low = hay.toLowerCase();
  for (const k of CHAR_KEYS) {
    if (new RegExp(`\\b${k}\\b`, "i").test(hay) || low.includes(CHAR[k].toLowerCase())) return k;
  }
  return item?.type === "Spell" ? "Magic" : "Strength";
}

/* Добавить О.О. и посчитать переходы уровней. Остаток переносится дальше, ниже нуля шкала не уходит. */
export function addPoints(item, delta) {
  let level = num(sysOf(item).Level);
  let filled = Math.max(0, num(sysOf(item).filledSegments) + delta);
  const gained = [];
  const max = maxLevel(item);
  while (level < max) {
    const need = segmentsFor(item, level);
    if (!need || filled < need) break;
    filled -= need;
    level += 1;
    gained.push(level);
  }
  if (level >= max) filled = 0;
  return { level, filled, gained };
}

/* Очки, вложенные в круг: изучение = 1, каждое повышение = 1 (с. 129).
   Значит, заклинание N уровня = N очков. Варианты Эволюции не считаются. */
export function circleInvested(items, circle) {
  return items.filter((i) => num(sysOf(i).Circle) === circle && !isVariant(i))
    .reduce((s, i) => s + num(sysOf(i).Level), 0);
}

/* =========================================================================
   Формулы
   ========================================================================= */

/* DamageFormulas может прийти массивом, объектом {0:…} или строкой; первая формула дублируется в DamageFormula */
export function damageFormulas(sys) {
  const raw = sys?.DamageFormulas;
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object") {
    arr = Object.keys(raw).filter((k) => String(Number(k)) === k).map(Number).sort((a, b) => a - b).map((k) => raw[k]);
  } else if (typeof raw === "string") arr = [raw];
  const out = arr.map((v) => String(v ?? ""));
  const legacy = String(sys?.DamageFormula ?? "").trim();
  if (legacy && !out.some((v) => v.trim() === legacy)) out.unshift(legacy);
  return out.filter((v) => v.trim());
}
function setDamageFormulas(sys, arr) {
  sys.DamageFormulas = arr.map((v) => String(v ?? ""));
  sys.DamageFormula = String(arr[0] ?? "");
}

const CHAR_WORDS = /\b(Strength|Dexterity|Stamina|Accuracy|Will|Knowledge|Charisma|Seduction|Leadership|Faith|Medicine|Magic|Stealth|Multiplier)\b/g;
export function prettyFormula(f) {
  return String(f || "")
    .replace(CHAR_WORDS, (m) => (m === "Multiplier" ? "Множитель" : CHAR[m]))
    .replace(/@/g, "")
    .replace(/\s*[*×]\s*/g, " × ")
    .replace(/\s+/g, " ")
    .trim();
}
export const hasLetters = (f) => /[A-Za-zА-Яа-яЁё]/.test(String(f ?? ""));
const MULT_WORD = /(множитель|multiplier)/i;

/* Вычислить формулу так же, как это делает система в бою */
export function evalDamage(f, actor, sys) {
  if (!String(f ?? "").trim()) return 0;
  try { return evaluateDamageFormula(f, actor, { system: sys }); } catch (e) { return 0; }
}
export function evalRange(f, actor, sys) {
  if (!String(f ?? "").trim()) return 0;
  try { return evaluateRangeFormula(f, actor, { system: sys }); } catch (e) { return 0; }
}
/* КС: если в формуле несколько частей через запятую, система берёт последнюю */
const dcPart = (f) => {
  const s = String(f ?? "").trim();
  return s.includes(",") ? (s.split(",").map((t) => t.trim()).filter(Boolean).pop() || "") : s;
};
export function evalDC(f, actor, sys) { return evalDamage(dcPart(f), actor, sys); }

const LEAD = /^(\s*)(\d+(?:[.,]\d+)?)/;
const MULT = /[*×]\s*(\d+(?:[.,]\d+)?)/;

export function leadingNumber(f) { const m = String(f || "").match(LEAD); return m ? num(m[2]) : null; }
export function bumpLeading(f, by) {
  const s = String(f || "");
  if (LEAD.test(s)) return s.replace(LEAD, (_, sp, n) => `${sp}${fmtNum(num(n) + by)}`);
  return s.trim() ? `${by} + ${s.trim()}` : String(by);
}
function bumpDC(f, by) {
  const s = String(f || "");
  if (!s.includes(",")) return bumpLeading(s, by);
  const i = s.lastIndexOf(",");
  return `${s.slice(0, i + 1)} ${bumpLeading(s.slice(i + 1).trim(), by)}`;
}
export function formulaMult(f) {
  const s = String(f || "");
  if (MULT_WORD.test(s)) return null; // множитель берётся из поля Multiplier
  const m = s.match(MULT);
  return m ? num(m[1]) : null;
}
export function bumpMult(f, by) { return String(f).replace(MULT, (_, n) => `* ${fmtNum(num(n) + by)}`); }

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
export function bumpDuration(text, by) {
  return String(text).replace(/^(\s*)(\d+)(\s*)(ход\S*|раунд\S*|минут\S*|час\S*)?/i, (_, sp, n, gap, word) => {
    const v = num(n) + by;
    if (!word) return `${sp}${v}${gap}`;
    const w = word.toLowerCase();
    const forms = w.startsWith("ход") ? ["ход", "хода", "ходов"]
      : w.startsWith("раунд") ? ["раунд", "раунда", "раундов"]
        : w.startsWith("час") ? ["час", "часа", "часов"]
          : ["минута", "минуты", "минут"];
    return `${sp}${v}${gap}${plural(v, forms)}`;
  });
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function fmtNum(n) { return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))).replace(".", ","); }
export const hidden = (s, key) => !!(s?.hiddenDefaults && Object.prototype.hasOwnProperty.call(s.hiddenDefaults, key));

/* additionalFields тоже бывает объектом {0:…} */
export function additionalFields(sys) {
  const raw = sys?.additionalFields;
  const arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object")
    ? Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map((k) => raw[k]) : [];
  return arr.map((f) => (f && typeof f === "object" ? f : {}));
}
const NUMERIC_VALUE = /^\s*[+-]?\d+(?:[.,]\d+)?\s*$/;

/* Использует ли способность множитель */
export function multInfo(s) {
  const forms = damageFormulas(s);
  const byWord = forms.some((f) => MULT_WORD.test(f));
  const lit = forms.length ? formulaMult(forms[0]) : null;
  if (byWord) return { kind: "field", value: num(s.Multiplier) };
  if (lit !== null) return { kind: "literal", value: lit };
  return null;
}

/* =========================================================================
   Варианты улучшения
   Каждый вариант знает, что поменяет в system и как это выглядит «было → станет».
   Список строится из реальных полей способности: нет зоны — нет варианта «зона».
   ========================================================================= */
export function buildOptions(item, actor) {
  const s = sysOf(item);
  const c = circleOf(item);
  const max = maxLevel(item);
  const out = [];
  const impactWord = s.DamageMode === "heal" ? "лечение" : "урон";
  const forms = damageFormulas(s);

  if (!hidden(s, "DamageFormula")) {
    forms.forEach((f, idx) => {
      const by = STEP.damage[c];
      const nf = bumpLeading(f, by);
      const after = { ...s }; setDamageFormulas(after, forms.map((x, i) => (i === idx ? nf : x)));
      out.push({
        key: `damage:${idx}`, kind: "damage", icon: "burst",
        title: forms.length > 1 ? `${cap(impactWord)} · формула ${idx + 1}` : cap(impactWord),
        delta: `+${by}`,
        from: evalDamage(f, actor, s), to: evalDamage(nf, actor, after),
        fromNote: hasLetters(f) ? prettyFormula(f) : "", toNote: hasLetters(nf) ? prettyFormula(nf) : "",
        apply: (sys, times) => {
          const arr = damageFormulas(sys);
          let x = arr[idx] ?? f;
          for (let i = 0; i < times; i++) x = bumpLeading(x, by);
          arr[idx] = x;
          setDamageFormulas(sys, arr);
        }
      });
    });
    if (!forms.length && num(s.Damage) > 0) {
      const by = STEP.damage[c];
      out.push({
        key: "damage:value", kind: "damage", icon: "burst", title: cap(impactWord), delta: `+${by}`,
        from: num(s.Damage), to: num(s.Damage) + by,
        apply: (sys, times) => { sys.Damage = num(sys.Damage) + by * times; }
      });
    }
  }

  const mi = multInfo(s);
  if (mi && !hidden(s, "DamageFormula")) {
    const by = STEP.mult[c];
    const can1 = mi.value + by <= max, can2 = mi.value + 2 * by <= max;
    const after = { ...s };
    if (mi.kind === "field") after.Multiplier = mi.value + by;
    else setDamageFormulas(after, forms.map((f) => (formulaMult(f) !== null ? bumpMult(f, by) : f)));
    const base = forms[0] ?? "";
    const baseAfter = damageFormulas(after)[0] ?? "";
    out.push({
      key: "mult", kind: "mult", icon: "times",
      title: "Множитель характеристики", delta: `×${by}`,
      from: `×${fmtNum(mi.value)}`, to: `×${fmtNum(mi.value + by)}`,
      fromNote: `${impactWord} ${evalDamage(base, actor, s)}`, toNote: `${impactWord} ${evalDamage(baseAfter, actor, after)}`,
      disabled: !can1 ? `Множитель не выше макс. уровня (${max})` : null,
      maxTimes: can2 ? 2 : 1,
      apply: (sys, times) => {
        if (mi.kind === "field") sys.Multiplier = num(sys.Multiplier) + by * times;
        else {
          setDamageFormulas(sys, damageFormulas(sys).map((f) => (formulaMult(f) !== null ? bumpMult(f, by * times) : f)));
          if (num(sys.Multiplier) > 0) sys.Multiplier = num(sys.Multiplier) + by * times;
        }
      }
    });
  }

  if (!hidden(s, "Range") && !hidden(s, "RangeFormula") && (String(s.RangeFormula ?? "").trim() || num(s.Range) > 0)) {
    const by = STEP.range[c];
    const rf = String(s.RangeFormula ?? "").trim();
    const from = rf ? evalRange(rf, actor, s) : num(s.Range);
    out.push({
      key: "range", kind: "range", icon: "range", title: "Дальность", delta: `+${by} кл.`,
      from: `${from} кл.`, to: `${from + by} кл.`,
      fromNote: hasLetters(rf) ? prettyFormula(rf) : "",
      toNote: hasLetters(rf) ? prettyFormula(bumpLeading(rf, by)) : "",
      apply: (sys, times) => {
        if (String(sys.RangeFormula ?? "").trim()) sys.RangeFormula = bumpLeading(sys.RangeFormula, by * times);
        else sys.Range = num(sys.Range) + by * times;
      }
    });
  }

  if (!hidden(s, "AreaSize") && num(s.AreaSize) > 0) {
    const by = STEP.aoe[c];
    out.push({
      key: "aoe", kind: "aoe", icon: "aoe", title: "Зона поражения", delta: `+${by} кл.`,
      from: `${fmtNum(num(s.AreaSize))} кл.`, to: `${fmtNum(num(s.AreaSize) + by)} кл.`,
      apply: (sys, times) => { sys.AreaSize = num(sys.AreaSize) + by * times; }
    });
  }

  if (!hidden(s, "SaveDCFormula") && String(s.SaveDCFormula ?? "").trim()) {
    const nf = bumpDC(s.SaveDCFormula, 1);
    out.push({
      key: "dc", kind: "dc", icon: "shield", title: "Сложность проверки для врагов", delta: "+1",
      from: evalDC(s.SaveDCFormula, actor, s), to: evalDC(nf, actor, s),
      fromNote: hasLetters(dcPart(s.SaveDCFormula)) ? prettyFormula(dcPart(s.SaveDCFormula)) : "",
      toNote: hasLetters(dcPart(nf)) ? prettyFormula(dcPart(nf)) : "",
      apply: (sys, times) => { sys.SaveDCFormula = bumpDC(sys.SaveDCFormula, times); }
    });
  }

  if (!hidden(s, "EffectThreshold") && num(s.EffectThreshold) > 1) {
    const by = STEP.down[c];
    const to = Math.max(1, num(s.EffectThreshold) - by);
    out.push({
      key: "effect", kind: "effect", icon: "down", title: "Порог срабатывания эффекта", delta: `−${by}`,
      from: num(s.EffectThreshold), to,
      fromNote: "эффект срабатывает от", toNote: "эффект срабатывает от",
      maxTimes: num(s.EffectThreshold) - 2 * by >= 1 ? 2 : 1,
      apply: (sys, times) => { sys.EffectThreshold = Math.max(1, num(sys.EffectThreshold) - by * times); }
    });
  }

  if (!hidden(s, "UsageThreshold") && num(s.UsageThreshold) > 0) {
    const by = STEP.down[c];
    out.push({
      key: "usage", kind: "usage", icon: "down", title: "Условие применения", delta: `−${by}`,
      from: num(s.UsageThreshold), to: Math.max(0, num(s.UsageThreshold) - by),
      fromNote: "минимум на броске", toNote: "минимум на броске",
      maxTimes: num(s.UsageThreshold) - 2 * by >= 0 ? 2 : 1,
      apply: (sys, times) => { sys.UsageThreshold = Math.max(0, num(sys.UsageThreshold) - by * times); }
    });
  }

  if (!hidden(s, "Duration") && /^\s*\d+/.test(String(s.Duration ?? ""))) {
    out.push({
      key: "duration", kind: "duration", icon: "hourglass", title: "Длительность эффекта", delta: "+1",
      from: String(s.Duration).trim(), to: bumpDuration(String(s.Duration).trim(), 1),
      apply: (sys, times) => { sys.Duration = bumpDuration(sys.Duration, times); }
    });
  }

  additionalFields(s).forEach((f, idx) => {
    if (f.hidden || !NUMERIC_VALUE.test(String(f.value ?? ""))) return;
    const raw = String(f.value).trim();
    const v = num(raw.replace("+", ""));
    const sign = raw.startsWith("+") ? "+" : "";
    out.push({
      key: `bonus:${idx}`, kind: "bonus", icon: "plus", title: String(f.name || `Поле ${idx + 1}`), delta: "+1",
      from: `${sign}${fmtNum(v)}`, to: `${sign}${fmtNum(v + 1)}`,
      apply: (sys, times) => {
        const arr = additionalFields(sys).map((x) => ({ ...x }));
        if (!arr[idx]) return;
        const cur = num(String(arr[idx].value).replace("+", ""));
        arr[idx].value = `${sign}${fmtNum(cur + times)}`;
        sys.additionalFields = arr;
      }
    });
  });

  out.push({
    key: "custom", kind: "custom", icon: "pen", title: "Другое улучшение", delta: "заявка",
    from: "", to: "", custom: true, maxTimes: 1,
    note: "Опиши, что меняется. Уйдёт ГМу на согласование."
  });

  return out;
}

/* Применить выбор к копии system. picks: [{key, times}] */
export function applyPicks(item, actor, picks) {
  const before = clone(sysOf(item));
  const sys = clone(sysOf(item));
  const opts = buildOptions(item, actor);
  for (const p of picks) {
    const o = opts.find((x) => x.key === p.key);
    if (o?.apply) o.apply(sys, p.times || 1);
  }
  return { before, after: sys };
}

/* Значение «станет» для одного варианта, взятого times раз (для карточек и истории) */
export function pickResult(item, actor, key, times = 1) {
  const { after } = applyPicks(item, actor, [{ key, times }]);
  const o = buildOptions({ type: item?.type, system: after }, actor).find((x) => x.key === key);
  return o ? o.from : null;
}

export function doubleDelta(d) { return String(d).replace(/(\d+)/, (n) => String(Number(n) * 2)); }

/* =========================================================================
   Изменённые поля и синхронизация с вариантами Эволюции
   ========================================================================= */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* Патч обновления: только поля улучшений, которые реально поменялись */
export function diffPatch(before, after) {
  const patch = {};
  for (const k of UPGRADE_FIELDS) {
    if (!same(before?.[k], after?.[k])) patch[k] = clone(after?.[k]);
  }
  return patch;
}

/* Значения тех же полей «до» — чтобы откатить */
export function pickFields(sys, keys) {
  const out = {};
  for (const k of keys) out[k] = clone(sys?.[k] ?? null);
  return out;
}

/* Вариант Эволюции растёт вместе с исходной способностью там, где поля совпадают.
   Поле совпадало до улучшения → в варианте оно меняется так же. Отличается (это и есть
   суть Эволюции) → не трогаем. Для формул урона и доп. полей сравниваем поштучно. */
export function syncVariantSystem(parentBefore, parentAfter, variantSys) {
  const patch = {};
  const changed = diffPatch(parentBefore, parentAfter);

  if ("DamageFormulas" in changed || "DamageFormula" in changed) {
    const pb = damageFormulas(parentBefore), pa = damageFormulas(parentAfter), vb = damageFormulas(variantSys);
    let touched = false;
    const next = vb.map((vf, i) => {
      if (pb[i] !== undefined && pa[i] !== undefined && vf.trim() === pb[i].trim() && pa[i] !== pb[i]) { touched = true; return pa[i]; }
      return vf;
    });
    if (touched) { patch.DamageFormulas = next; patch.DamageFormula = next[0] ?? ""; }
  }
  for (const k of ["Damage", "Multiplier", "RangeFormula", "Range", "AreaSize", "SaveDCFormula", "EffectThreshold", "UsageThreshold", "Duration"]) {
    if (!(k in changed)) continue;
    if (same(variantSys?.[k], parentBefore?.[k])) patch[k] = clone(parentAfter?.[k]);
  }
  if ("additionalFields" in changed) {
    const pb = additionalFields(parentBefore), pa = additionalFields(parentAfter);
    const vf = additionalFields(variantSys).map((x) => ({ ...x }));
    let touched = false;
    pb.forEach((f, i) => {
      const after = pa[i];
      if (!after || same(f.value, after.value)) return;
      const j = vf.findIndex((x) => String(x.name ?? "") === String(f.name ?? "") && same(x.value, f.value));
      if (j >= 0) { vf[j].value = after.value; touched = true; }
    });
    if (touched) patch.additionalFields = vf;
  }
  return patch;
}

/* Сдвиг уровня и шкалы при уровне «за О.М.П.»: как в мастере ранга, О.О. сохраняются, кроме максимума */
export function levelByAward(item) {
  const max = maxLevel(item);
  const level = num(sysOf(item).Level);
  if (level >= max) return null;
  const next = level + 1;
  const filled = next >= max ? 0 : Math.min(num(sysOf(item).filledSegments), Math.max(0, segmentsFor(item, next) - 1));
  return { level: next, filled };
}
