import { evaluateRollFormula } from "./OrderDamageFormula.js";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function appendSigned(formula, n) {
  const value = Number(n) || 0;
  if (!value) return formula;
  return formula + (value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`);
}

function normalizeToken(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "")
    .replace(/ё/g, "е");
}

const CHARACTERISTIC_ALIASES = (() => {
  const map = new Map();
  const add = (key, ...aliases) => {
    for (const alias of aliases) {
      const normalized = normalizeToken(alias);
      if (normalized) map.set(normalized, key);
    }
  };

  add("Strength", "strength", "сила");
  add("Dexterity", "dexterity", "ловкость");
  add("Stamina", "stamina", "выносливость");
  add("Accuracy", "accuracy", "меткость");
  add("Will", "will", "стойкость духа", "сила духа");
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

function resolveCharacteristicKey(actor, selection) {
  const raw = String(selection ?? "").trim();
  if (!raw) return null;

  const actorData = getSystem(actor);
  if (actorData?.[raw] && typeof actorData[raw] === "object") return raw;

  const aliasKey = CHARACTERISTIC_ALIASES.get(normalizeToken(raw));
  if (aliasKey && actorData?.[aliasKey] && typeof actorData[aliasKey] === "object") {
    return aliasKey;
  }

  return null;
}

export function buildD20Formula(mode) {
  if (mode === "adv") return "2d20kh1";
  if (mode === "dis") return "2d20kl1";
  return "1d20";
}

export function buildWeaponAttackFormula({ rollMode = "normal", baseValue = 0, totalModifier = 0 } = {}) {
  let formula = buildD20Formula(rollMode);
  formula = appendSigned(formula, baseValue);
  formula = appendSigned(formula, totalModifier);
  return formula;
}

export function getWeaponAttackEntries(weapon) {
  const sys = getSystem(weapon);
  const raw = sys?.AttackCharacteristics;

  let rawArr = [];
  if (Array.isArray(raw)) {
    rawArr = raw;
  } else if (typeof raw === "string") {
    rawArr = [raw];
  } else if (raw && typeof raw === "object") {
    const keys = Object.keys(raw)
      .filter((k) => String(Number(k)) === k)
      .map((k) => Number(k))
      .sort((a, b) => a - b);
    rawArr = keys.map((k) => raw[k]);
  }

  const out = [];
  const seen = new Set();

  for (const entry of rawArr) {
    const value = typeof entry === "string"
      ? entry.trim()
      : String(entry?.Characteristic ?? entry ?? "").trim();

    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

export function isWeaponAttackCharacteristic(actor, selection) {
  const key = resolveCharacteristicKey(actor, selection);
  if (!key) return false;

  const actorData = getSystem(actor);
  const characteristicData = actorData?.[key];
  return !!(
    characteristicData &&
    typeof characteristicData === "object" &&
    (Object.prototype.hasOwnProperty.call(characteristicData, "value") || Array.isArray(characteristicData?.modifiers))
  );
}

export function getWeaponAttackEntryLabel(selection) {
  const raw = String(selection ?? "").trim();
  if (!raw) return "";

  try {
    const localized = game?.i18n?.localize?.(raw);
    return localized && localized !== raw ? localized : raw;
  } catch (err) {
    return raw;
  }
}

export function resolveWeaponAttackSelection({ actor, weapon, selection, applyModifiers = true } = {}) {
  const selected = String(selection ?? "").trim();
  const actorData = getSystem(actor);

  if (!selected) {
    return {
      selection: "",
      selectionLabel: "",
      characteristic: null,
      isCharacteristic: false,
      isFormula: false,
      baseValue: 0,
      characteristicModifier: 0,
      rollFormulaRaw: "",
      rollFormulaValue: 0
    };
  }

  const characteristicKey = resolveCharacteristicKey(actor, selected);

  if (characteristicKey && isWeaponAttackCharacteristic(actor, characteristicKey)) {
    const characteristicData = actorData?.[characteristicKey] ?? {};
    const baseValue = Number(characteristicData?.value ?? 0) || 0;
    const modifiersArray = applyModifiers ? (Array.isArray(characteristicData?.modifiers) ? characteristicData.modifiers : []) : [];
    const tempModifier = applyModifiers ? (Number(characteristicData?.tempModifier ?? 0) || 0) : 0;
    const characteristicModifier = applyModifiers
      ? modifiersArray.reduce((sum, modifier) => sum + (Number(modifier?.value) || 0), 0) + tempModifier
      : 0;

    return {
      selection: selected,
      selectionLabel: getWeaponAttackEntryLabel(characteristicKey),
      characteristic: characteristicKey,
      isCharacteristic: true,
      isFormula: false,
      baseValue,
      characteristicModifier,
      rollFormulaRaw: "",
      rollFormulaValue: 0
    };
  }

  let rollFormulaValue = 0;
  try {
    rollFormulaValue = Number(evaluateRollFormula(selected, actor, weapon)) || 0;
  } catch (error) {
    console.error("[Order] Failed to evaluate weapon attack formula", { selection: selected, error });
  }

  return {
    selection: selected,
    selectionLabel: selected,
    characteristic: null,
    isCharacteristic: false,
    isFormula: true,
    baseValue: rollFormulaValue,
    characteristicModifier: 0,
    rollFormulaRaw: selected,
    rollFormulaValue
  };
}
