const MIGRATION_VERSION = 4;

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function parseNumberOrNull(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function getInitialRangeValue(sys) {
  const direct = Number(sys?.Range);
  if (Number.isFinite(direct)) return Math.max(0, direct);

  // Legacy: some skills stored distance as plain numeric text in AttackArea.
  const fromAttackArea = parseNumberOrNull(sys?.AttackArea);
  if (fromAttackArea != null) return Math.max(0, fromAttackArea);

  return 0;
}

function buildSkillPatch(item) {
  const sys = getSystem(item);
  const patch = {};

  if (sys.DeliveryType == null) patch["system.DeliveryType"] = "utility";
  if (sys.DamageMode == null) patch["system.DamageMode"] = "damage";
  if (sys.SaveAbility == null) patch["system.SaveAbility"] = "";
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

  if (sys.Range === undefined) {
    patch["system.Range"] = getInitialRangeValue(sys);
  }

  if (sys.RangeFormula === undefined) {
    const initialRange = getInitialRangeValue(sys);
    patch["system.RangeFormula"] = String(initialRange);
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
