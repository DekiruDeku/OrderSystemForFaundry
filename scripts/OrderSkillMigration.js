const MIGRATION_VERSION = 1;

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

export async function runOrderSkillMigration() {
  try {
    if (!game.user?.isGM) return;

    const current = Number(game.settings.get("Order", "skillMigrationVersion") ?? 0) || 0;
    if (current >= MIGRATION_VERSION) return;

    const toUpdate = [];

    for (const item of (game.items?.contents ?? [])) {
      if (item.type !== "Skill") continue;

      const sys = getSystem(item);

      const patch = {};
      if (sys.DeliveryType == null) patch["system.DeliveryType"] = "utility";
      if (sys.SaveAbility == null) patch["system.SaveAbility"] = "";
      if (sys.SaveDCFormula == null) patch["system.SaveDCFormula"] = "";

      if (sys.AreaShape == null) patch["system.AreaShape"] = "circle";
      if (sys.AreaSize == null) patch["system.AreaSize"] = 0;
      if (sys.AreaWidth == null) patch["system.AreaWidth"] = 0;
      if (sys.AreaAngle == null) patch["system.AreaAngle"] = 90;
      if (sys.AreaPersistent == null) patch["system.AreaPersistent"] = false;
      if (sys.AreaColor == null) patch["system.AreaColor"] = "";
      if (sys.Duration == null) patch["system.Duration"] = "";

      if (Object.keys(patch).length) {
        patch["_id"] = item.id;
        toUpdate.push(patch);
      }
    }

    if (toUpdate.length) {
      await Item.updateDocuments(toUpdate);
    }

    await game.settings.set("Order", "skillMigrationVersion", MIGRATION_VERSION);
    console.log("OrderSkillMigration | Done:", toUpdate.length);
  } catch (e) {
    console.error("OrderSkillMigration | ERROR", e);
  }
}
