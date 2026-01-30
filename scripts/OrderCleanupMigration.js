/**
 * One-time cleanup migration:
 * Removes deprecated spell/skill fields from item.system.
 */
export class OrderCleanupMigration {
  // bump this if you change cleanup rules
  static VERSION = 1;

  static KEYS_TO_REMOVE = [
    "SpellType",
    "EnemyInteractionType",
    "TriggerType",
    "EffectConditions",
    "UsageConditions",
    "LevelOfFatigue",
    "DamageType",
    "DamageSubtype",
  ];

  static ITEM_TYPES = new Set(["Spell", "Skill"]);

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

  static async _cleanupWorldItems() {
    const worldItems = game.items?.contents ?? [];
    let updated = 0;

    for (const item of worldItems) {
      if (!this.ITEM_TYPES.has(item.type)) continue;

      const update = this._buildUnsetUpdateData(item.system);
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
        if (!this.ITEM_TYPES.has(item.type)) continue;

        const update = this._buildUnsetUpdateData(item.system);
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
