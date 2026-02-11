/**
 * OrderDamageFormula.js
 * Safe (non-eval) parser/evaluator for a limited damage formula syntax:
 *   <base number> + <Characteristic Name> * <multiplier>
 * Supports Russian and English characteristic names.
 * Compatibility: also accepts a single number (fixed damage).
 */

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

export const ORDER_CHARACTERISTICS = [
  "Strength","Dexterity","Stamina","Accuracy","Will","Knowledge","Charisma",
  "Seduction","Leadership","Faith","Medicine","Magic","Stealth",
];

const CHARACTERISTIC_ALIASES = (() => {
  const map = new Map();
  const add = (key, ...aliases) => {
    for (const a of aliases) {
      const n = normalizeToken(a);
      if (n) map.set(n, key);
    }
  };

  add("Strength", "strength", "сила");
  add("Dexterity", "dexterity", "ловкость");
  add("Stamina", "stamina", "выносливость");
  add("Accuracy", "accuracy", "меткость");
  add("Will", "will", "сила духа");
  add("Knowledge", "knowledge", "знания");
  add("Charisma", "charisma", "харизма");
  add("Seduction", "seduction", "обольщение");
  add("Leadership", "leadership", "лидерство");
  add("Faith", "faith", "вера");
  add("Medicine", "medicine", "медицина");
  add("Magic", "magic", "магия");
  add("Stealth", "stealth", "скрытность");
  return map;
})();

function normalizeToken(raw) {
  return String(raw ?? "")
    .trim().toLowerCase()
    .replace(/[\s_\-]+/g, "")
    .replace(/ё/g, "е");
}

function toNumber(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function resolveCharacteristicKey(token) {
  const n = normalizeToken(token);
  if (!n) return null;
  return CHARACTERISTIC_ALIASES.get(n) ?? null;
}

export function getActorCharacteristicTotal(actor, key) {
  const sys = getSystem(actor);
  const obj = sys?.[key] ?? null;
  const base = Number(obj?.value ?? 0) || 0;

  const localMods = Array.isArray(obj?.modifiers)
    ? obj.modifiers.reduce((acc, m) => acc + (Number(m?.value) || 0), 0)
    : 0;

  const globalMods = Array.isArray(sys?.MaxModifiers)
    ? sys.MaxModifiers.reduce((acc, m) => {
      const v = Number(m?.value) || 0;
      const k = m?.characteristic ?? m?.Characteristic ?? m?.key ?? null;
      return String(k) === String(key) ? acc + v : acc;
    }, 0)
    : 0;

  return base + localMods + globalMods;
}

export function parseDamageFormula(raw) {
  const src = String(raw ?? "").trim();
  if (!src) return null;

  // fixed number
  if (/^[+-]?\d+(?:[\.,]\d+)?$/.test(src)) {
    const fixed = toNumber(src);
    if (!Number.isFinite(fixed)) return null;
    return { fixed };
  }

  // base + stat * mult
  const m = src.match(/^\s*([+-]?\d+(?:[\.,]\d+)?)\s*\+\s*([^*]+?)\s*\*\s*([+-]?\d+(?:[\.,]\d+)?)\s*$/i);
  if (!m) return null;

  const base = toNumber(m[1]);
  const key = resolveCharacteristicKey(m[2]);
  const mult = toNumber(m[3]);

  if (!Number.isFinite(base) || !key || !Number.isFinite(mult)) return null;
  return { base, key, mult };
}

export function evaluateDamageFormula(rawFormula, actor) {
  const parsed = parseDamageFormula(rawFormula);
  if (!parsed) return 0;

  if (parsed.fixed !== undefined) {
    return Math.max(0, Math.round(Number(parsed.fixed) || 0));
  }

  if (!actor) return 0;
  const stat = getActorCharacteristicTotal(actor, parsed.key);
  const value = (Number(parsed.base) || 0) + (Number(stat) || 0) * (Number(parsed.mult) || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function applyComputedDamageToItem({ item, actor } = {}) {
  if (!item) return 0;
  const sys = getSystem(item);

  const formula = sys?.DamageFormula;
  const hasFormula = typeof formula === "string" && formula.trim().length > 0;

  const computed = hasFormula
    ? evaluateDamageFormula(formula, actor)
    : Math.max(0, Math.round(Number(sys?.Damage ?? 0) || 0));

  // derived-only overwrite
  try {
    if (item.system) item.system.Damage = computed;
    else if (item.data?.system) item.data.system.Damage = computed;
  } catch {}

  return computed;
}