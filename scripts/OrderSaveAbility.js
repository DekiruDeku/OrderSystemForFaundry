const DEFAULT_CHARACTERISTICS = [
  "Strength",
  "Dexterity",
  "Stamina",
  "Accuracy",
  "Will",
  "Knowledge",
  "Charisma",
  "Seduction",
  "Leadership",
  "Faith",
  "Medicine",
  "Magic",
  "Stealth"
];

function getSystemLike(source) {
  if (!source || typeof source !== "object") return {};
  return source?.system ?? source?.data?.system ?? source;
}

export function getKnownCharacteristics() {
  const fromConfig = CONFIG?.Order?.Caracteristics;
  if (fromConfig && typeof fromConfig === "object") {
    const keys = Object.keys(fromConfig).filter((k) => String(k || "").trim().length > 0);
    if (keys.length) return keys;
  }
  return DEFAULT_CHARACTERISTICS.slice();
}

export function normalizeSaveAbilityKey(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return "";

  const known = getKnownCharacteristics();
  if (known.includes(input)) return input;

  const lower = input.toLowerCase();
  const matched = known.find((k) => k.toLowerCase() === lower);
  return matched || "";
}

function parseSaveAbilityString(raw) {
  return String(raw ?? "")
    .split(/[,;|/]+/g)
    .map((v) => normalizeSaveAbilityKey(v))
    .filter(Boolean);
}

function normalizeUnique(rawList) {
  const out = [];
  const seen = new Set();
  for (const raw of (Array.isArray(rawList) ? rawList : [])) {
    const key = normalizeSaveAbilityKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function resolveSaveAbilities(source) {
  const data = getSystemLike(source);
  const rawList = [];

  const fromArray = data?.SaveAbilities ?? data?.saveAbilities;
  if (Array.isArray(fromArray)) {
    rawList.push(...fromArray);
  } else if (typeof fromArray === "string") {
    rawList.push(...parseSaveAbilityString(fromArray));
  }

  const single = data?.SaveAbility ?? data?.saveAbility;
  if (typeof single === "string" && single.trim()) {
    rawList.push(...parseSaveAbilityString(single));
  }

  return normalizeUnique(rawList);
}

export function pickAllowedSaveAbility(preferred, allowed) {
  const list = normalizeUnique(allowed);
  if (!list.length) return "";

  const normalizedPreferred = normalizeSaveAbilityKey(preferred);
  if (normalizedPreferred && list.includes(normalizedPreferred)) return normalizedPreferred;
  return list[0];
}

export function localizeSaveAbilityList(source, { separator = " / ", empty = "—" } = {}) {
  const list = Array.isArray(source) ? normalizeUnique(source) : resolveSaveAbilities(source);
  if (!list.length) return empty;
  return list.map((k) => game.i18n.localize(k)).join(separator);
}

export function buildSaveAbilitiesUpdatePayload(rawAbilities) {
  const saveAbilities = normalizeUnique(rawAbilities);
  return {
    "system.SaveAbilities": saveAbilities,
    "system.SaveAbility": saveAbilities[0] ?? ""
  };
}
