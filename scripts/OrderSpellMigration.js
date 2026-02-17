/**
 * Stage 1.5 migration for spells:
 * - Normalizes EnemyInteractionType to enum keys: none | guaranteed | contested
 * - Adds/guesses DeliveryType and related config fields (Save/AoE)
 *
 * Runs once per world (GM only) via a world setting.
 */

const MIGRATION_VERSION = 5;

function normalizeEnemyInteractionType(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v || v === "-" || v === "—") return "none";
  if (v.includes("гарант")) return "guaranteed";
  if (v.includes("оспари")) return "contested";
  if (["none", "guaranteed", "contested"].includes(v)) return v;
  return "none";
}

function inferDeliveryType(sys) {
  const spellType = String(sys?.SpellType ?? "").toLowerCase();
  const trigger = String(sys?.TriggerType ?? "").toLowerCase();
  const enemyKey = normalizeEnemyInteractionType(sys?.EnemyInteractionType);

  const text = [
    sys?.Description,
    sys?.Effects,
    sys?.EffectConditions,
    sys?.UsageConditions,
    sys?.DamageType,
    sys?.DamageSubtype
  ].filter(Boolean).join(" ").toLowerCase();

  if (spellType.includes("призыв")) return "summon";
  if (spellType.includes("защит")) return "defensive-reaction";

  const aoeRe = /(радиус|конус|линия|луч|стена|купол|области|область|по площади|все цели|всех|в пределах)/;
  if (aoeRe.test(text)) return "aoe-template";

  if (enemyKey === "contested" && /(провер(ка|ку|ки|ить)|спасброс)/.test(text)) return "save-check";

  if (spellType.includes("атак")) {
    const range = Number(sys?.Range ?? 0);
    const meleeRe = /(касани|вплотн|соседн|ближн)/;
    if (range === 0 || meleeRe.test(text)) return "attack-melee";
    return "attack-ranged";
  }

  if (trigger.includes("поддерж")) return "utility";
  return "utility";
}

const RUS_ABILITY_MAP = [
  [/(ловк|уклон)/, "Dexterity"],
  [/(сил)/, "Strength"],
  [/(вынос|стамин)/, "Stamina"],
  [/(вол)/, "Will"],
  [/(знан)/, "Knowledge"],
  [/(харизм)/, "Charisma"],
  [/(маг)/, "Magic"],
  [/(вера)/, "Faith"],
  [/(медиц)/, "Medicine"],
  [/(лидер)/, "Leadership"],
  [/(соблазн)/, "Seduction"]
];

function inferSaveAbility(sys) {
  const text = [sys?.Description, sys?.Effects, sys?.UsageConditions, sys?.EffectConditions]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [re, key] of RUS_ABILITY_MAP) {
    if (re.test(text)) return key;
  }
  return "";
}

function inferSaveDCFormula(sys) {
  const text = [sys?.Description, sys?.Effects, sys?.UsageConditions, sys?.EffectConditions]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // "10 + магия"
  const m = text.match(/(\d+)\s*\+\s*маг/);
  if (m) return `${m[1]} + Magic`;

  // "сложность 15"
  const m2 = text.match(/сложн(?:ость)?\s*(\d+)/);
  if (m2) return `${m2[1]}`;

  return "";
}

async function migrateSpellItem(item) {
  const sys = item.system ?? {};
  const updates = {};

  const normalizedEnemy = normalizeEnemyInteractionType(sys.EnemyInteractionType);
  if (sys.EnemyInteractionType !== normalizedEnemy) {
    updates["system.EnemyInteractionType"] = normalizedEnemy;
  }

  const hasDelivery = typeof sys.DeliveryType === "string" && sys.DeliveryType.length;
  const delivery = hasDelivery ? sys.DeliveryType : inferDeliveryType(sys);
  if (!hasDelivery) updates["system.DeliveryType"] = delivery;

  // Ensure new fields exist (don’t overwrite user values)
  if (sys.SaveAbility === undefined) updates["system.SaveAbility"] = "";
  if (sys.DeliveryPipeline === undefined) updates["system.DeliveryPipeline"] = "";
  if (sys.DamageMode === undefined) updates["system.DamageMode"] = "damage";
  if (sys.SaveDCFormula === undefined) updates["system.SaveDCFormula"] = "";
  if (sys.AreaShape === undefined) updates["system.AreaShape"] = "circle";
  if (sys.AreaSize === undefined) updates["system.AreaSize"] = 0;
  if (sys.AreaWidth === undefined) updates["system.AreaWidth"] = 0;
  if (sys.AreaAngle === undefined) updates["system.AreaAngle"] = 0;
  if (sys.AreaPersistent === undefined) updates["system.AreaPersistent"] = false;
  // Summon defaults (v2) — do not overwrite user values.
  if (sys.SummonActorUuid === undefined) updates["system.SummonActorUuid"] = "";
  if (sys.SummonCount === undefined) updates["system.SummonCount"] = 1;
  if (sys.SummonDeleteOnExpiry === undefined) updates["system.SummonDeleteOnExpiry"] = true;
  if (sys.SummonDisposition === undefined) updates["system.SummonDisposition"] = "same-as-caster";
  if (sys.AreaColor === undefined) updates["system.AreaColor"] = "";
  if (sys.DamageFormula === undefined) updates["system.DamageFormula"] = String(sys?.Damage ?? 0);
  if (sys.RangeFormula === undefined) updates["system.RangeFormula"] = String(Math.max(0, Number(sys?.Range ?? 0) || 0));


  const finalDelivery = (updates["system.DeliveryType"] ?? sys.DeliveryType ?? delivery);
  if (finalDelivery === "save-check") {
    if (!sys.SaveAbility) {
      const ab = inferSaveAbility(sys);
      if (ab) updates["system.SaveAbility"] = ab;
    }
    if (!sys.SaveDCFormula) {
      const dc = inferSaveDCFormula(sys);
      if (dc) updates["system.SaveDCFormula"] = dc;
    }
  }

  if (Object.keys(updates).length) {
    await item.update(updates);
    return true;
  }
  return false;
}

export async function runOrderSpellMigration() {
  if (!game.user?.isGM) return;

  const current = game.settings.get("Order", "spellMigrationVersion") ?? 0;
  if (current >= MIGRATION_VERSION) return;

  let changed = 0;

  // World items
  for (const item of game.items.contents) {
    if (item.type !== "Spell") continue;
    if (await migrateSpellItem(item)) changed++;
  }

  // Embedded items on actors
  for (const actor of game.actors.contents) {
    for (const item of actor.items.contents) {
      if (item.type !== "Spell") continue;
      if (await migrateSpellItem(item)) changed++;
    }
  }

  await game.settings.set("Order", "spellMigrationVersion", MIGRATION_VERSION);
  console.log(`Order | Spell migration v${MIGRATION_VERSION} done. Updated: ${changed}`);
  if (changed) ui.notifications?.info?.(`Order: обновлены заклинания (${changed}) по миграции магии.`);
}
