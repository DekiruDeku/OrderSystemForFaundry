/**
 * One-time cleanup & normalization migration:
 * - Removes deprecated spell/skill fields from item.system.
 * - Normalizes legacy armor/weapon fields so actor sheets display correct values.
 */
export class OrderCleanupMigration {
  // bump this if you change cleanup rules
  static VERSION = 5;

  static KEYS_TO_REMOVE = [
    "SpellType",
    "EnemyInteractionType",
    "TriggerType",
    "LevelOfFatigue",
    "DamageType",
    "DamageSubtype",
  ];

  // only these types should have deprecated fields removed
  static CLEANUP_TYPES = new Set(["Spell", "Skill"]);

  /**
   * Run cleanup for world items + embedded actor items.
   * Safe to call multiple times; guarded by settings version.
   */
  static async runIfNeeded() {
    const key = "cleanupMigrationVersion";
    const last = Number(game.settings.get("Order", key) ?? 0);
    if (last >= this.VERSION) return;

    console.log(`[Order] Cleanup migration v${this.VERSION} started (prev=${last})...`);

    let totalUpdated = 0;

    // 1) World Items
    totalUpdated += await this._cleanupWorldItems();

    // 2) Embedded Items on Actors
    totalUpdated += await this._cleanupActorItems();

    await game.settings.set("Order", key, this.VERSION);

    console.log(`[Order] Cleanup migration v${this.VERSION} done. Updated documents: ${totalUpdated}`);
    ui.notifications?.info?.(`Order: cleanup migration complete (updated ${totalUpdated})`);
  }

  static _buildUnsetUpdateData(itemSystem) {
    // Use Foundry "-=key" syntax to delete keys.
    const update = {};
    for (const k of this.KEYS_TO_REMOVE) {
      if (itemSystem && Object.prototype.hasOwnProperty.call(itemSystem, k)) {
        update[`system.-=${k}`] = null;
      }
    }
    return update;
  }

  static _buildNormalizationUpdate(item) {
    const update = {};
    const sys = item?.system ?? {};

    // Armor: some versions wrote "Defense" instead of the canonical "Deffensepotential".
    if (item.type === "Armor") {
      const dp = Number(sys?.Deffensepotential ?? 0) || 0;
      const def = Number(sys?.Defense ?? 0) || 0;
      if (dp <= 0 && def > 0) {
        update["system.Deffensepotential"] = def;
      }
    }

    // Weapons: older template used "Modification slots" (with a space).
    if (["meleeweapon", "rangeweapon", "weapon"].includes(item.type)) {
      const modernRaw = sys?.Modificationslots;
      const legacyRaw = sys?.["Modification slots"];

      const modern = Number(modernRaw ?? 0) || 0;
      const legacy = Number(legacyRaw ?? 0) || 0;

      // Copy legacy to modern only when modern is missing/empty.
      if ((modernRaw === undefined || modern <= 0) && legacy > 0) {
        update["system.Modificationslots"] = legacy;
      }

      // Initialize formula-based damage for legacy weapons.
      if (sys?.DamageFormula === undefined) {
        update["system.DamageFormula"] = String(sys?.Damage ?? 0);
      }
    }

    // Consumables: initialize formula-based damage for legacy items.
    if (item.type === "Consumables" && sys?.DamageFormula === undefined) {
      update["system.DamageFormula"] = String(sys?.Damage ?? 0);
    }

    return update;
  }

  static _buildUpdate(item) {
    const update = {};

    if (this.CLEANUP_TYPES.has(item.type)) {
      Object.assign(update, this._buildUnsetUpdateData(item.system));
    }

    Object.assign(update, this._buildNormalizationUpdate(item));

    return update;
  }

  static async _cleanupWorldItems() {
    const worldItems = game.items?.contents ?? [];
    let updated = 0;

    for (const item of worldItems) {
      const update = this._buildUpdate(item);
      if (!Object.keys(update).length) continue;

      try {
        await item.update(update, { diff: false, render: false });
        updated++;
      } catch (err) {
        console.error(`[Order] Cleanup failed for world item ${item.name} (${item.id})`, err);
      }
    }
    return updated;
  }

  static async _cleanupActorItems() {
    const actors = game.actors?.contents ?? [];
    let updated = 0;

    for (const actor of actors) {
      const embedded = actor.items?.contents ?? [];
      for (const item of embedded) {
        const update = this._buildUpdate(item);
        if (!Object.keys(update).length) continue;

        try {
          await item.update(update, { diff: false, render: false });
          updated++;
        } catch (err) {
          console.error(`[Order] Cleanup failed for actor item ${actor.name} -> ${item.name} (${item.id})`, err);
        }
      }
    }
    return updated;
  }
}
