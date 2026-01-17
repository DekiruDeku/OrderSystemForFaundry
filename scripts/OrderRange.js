/**
 * OrderRanged.js
 *
 * Ranged-weapon attack flow will be implemented later.
 * For now we provide a dedicated entry point so range weapons
 * do NOT call the melee attack logic.
 */

/**
 * Entry point for a ranged attack.
 * Currently a stub (placeholder) that will be extended with a full flow.
 */
export async function startRangedAttack({ attackerActor, weapon } = {}) {
  if (!attackerActor || !weapon) return;

  // Safety: ensure we only use this flow for ranged weapons.S
  if (weapon.type !== "rangeweapon") {
    ui.notifications?.warn?.("Это не оружие дальнего боя.");
    return;
  }

  // Placeholder UI so users see that the button works and is intentionally separate.
  ui.notifications?.info?.(
    `Атака дальним оружием ("${weapon.name}") пока в разработке. ` +
    `Кнопка уже переключена на отдельный сценарий.`
  );

  // Future: implement ranged targeting, hit/crit, ammunition, distance, etc.
}
