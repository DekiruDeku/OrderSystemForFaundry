import { resolveSaveAbilities } from "./OrderSaveAbility.js";

const MIGRATION_VERSION = 6;

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function parseNumberOrNull(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}


function buildSkillPatch(item) {
  const sys = getSystem(item);
  const patch = {};

  if (sys.DeliveryType == null) patch["system.DeliveryType"] = "utility";
  if (sys.DeliveryPipeline == null) patch["system.DeliveryPipeline"] = "";
  if (sys.DamageMode == null) patch["system.DamageMode"] = "damage";
  const resolvedSaveAbilities = resolveSaveAbilities(sys);
  const existingSaveAbilities = Array.isArray(sys.SaveAbilities) ? sys.SaveAbilities.map((v) => String(v || "").trim()) : [];
  if (!Array.isArray(sys.SaveAbilities) || existingSaveAbilities.join("|") !== resolvedSaveAbilities.join("|")) {
    patch["system.SaveAbilities"] = resolvedSaveAbilities;
  }

  const primarySaveAbility = resolvedSaveAbilities[0] ?? "";
  if (String(sys.SaveAbility ?? "") !== primarySaveAbility) {
    patch["system.SaveAbility"] = primarySaveAbility;
  }

  if (sys.SaveDCFormula == null) patch["system.SaveDCFormula"] = "";

  if (sys.AreaShape == null) patch["system.AreaShape"] = "circle";
  if (sys.AreaSize == null) patch["system.AreaSize"] = 0;
  if (sys.AreaWidth == null) patch["system.AreaWidth"] = 0;
  if (sys.AreaAngle == null) patch["system.AreaAngle"] = 90;
  if (sys.AreaPersistent == null) patch["system.AreaPersistent"] = false;
  if (sys.AreaColor == null) patch["system.AreaColor"] = "";
  if (sys.Duration == null) patch["system.Duration"] = "";

  if (sys.DamageFormula === undefined) {
    patch["system.DamageFormula"] = String(sys?.Damage ?? 0);
  }



  return patch;
}

export async function runOrderSkillMigration() {
  try {
    if (!game.user?.isGM) return;

    const current = Number(game.settings.get("Order", "skillMigrationVersion") ?? 0) || 0;
    if (current >= MIGRATION_VERSION) return;

    let updated = 0;

    // World items
    for (const item of (game.items?.contents ?? [])) {
      if (item.type !== "Skill") continue;
      const patch = buildSkillPatch(item);
      if (!Object.keys(patch).length) continue;
      await item.update(patch);
      updated++;
    }

    // Embedded actor items
    for (const actor of (game.actors?.contents ?? [])) {
      for (const item of (actor.items?.contents ?? [])) {
        if (item.type !== "Skill") continue;
        const patch = buildSkillPatch(item);
        if (!Object.keys(patch).length) continue;
        await item.update(patch);
        updated++;
      }
    }

    await game.settings.set("Order", "skillMigrationVersion", MIGRATION_VERSION);
    console.log(`OrderSkillMigration | Done: ${updated}`);
  } catch (e) {
    console.error("OrderSkillMigration | ERROR", e);
  }
}
