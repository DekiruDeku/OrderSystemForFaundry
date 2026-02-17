const DELIVERY_ORDER = [
  "defensive-reaction",
  "attack-ranged",
  "attack-melee",
  "aoe-template",
  "save-check"
];

const EXCLUSIVE_PRIMARY = new Set(["utility", "summon"]);

export function normalizeDeliveryType(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function parseDeliveryTypeList(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => normalizeDeliveryType(v))
      .filter(Boolean);
  }

  const text = String(raw ?? "");
  if (!text.trim()) return [];

  return text
    .split(",")
    .map((v) => normalizeDeliveryType(v))
    .filter(Boolean);
}

function uniqueInOrder(list) {
  const seen = new Set();
  const out = [];
  for (const value of list) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function collapseConflictingAttacks(list) {
  const out = [];
  let hasAttack = false;
  for (const value of list) {
    if (value === "attack-ranged" || value === "attack-melee") {
      if (hasAttack) continue;
      hasAttack = true;
      out.push(value);
      continue;
    }
    out.push(value);
  }
  return out;
}

/**
 * Returns normalized pipeline where:
 * - first type is always respected;
 * - if first is utility/summon => no additional processing;
 * - remaining steps are sorted by fixed priority.
 */
export function buildSpellDeliveryPipeline(systemData) {
  const primary = normalizeDeliveryType(systemData?.DeliveryType || "utility") || "utility";
  const extraRaw = parseDeliveryTypeList(systemData?.DeliveryPipeline || []);

  const combined = uniqueInOrder([primary, ...extraRaw].filter(Boolean));
  const noAttackConflict = collapseConflictingAttacks(combined);
  const [first, ...rest] = noAttackConflict;

  if (!first) return ["utility"];
  if (EXCLUSIVE_PRIMARY.has(first)) return [first];

  const rank = (value) => {
    const idx = DELIVERY_ORDER.indexOf(value);
    return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
  };

  const sortedRest = [...rest].sort((a, b) => rank(a) - rank(b));
  return [first, ...sortedRest];
}

export function stringifyDeliveryPipeline(list) {
  return parseDeliveryTypeList(list).join(", ");
}