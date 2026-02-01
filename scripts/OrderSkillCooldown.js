const FLAG_SCOPE = "Order";
const FLAG_KEY = "skillCooldowns";

/**
 * Семантика:
 * - cooldown=0 -> можно каждый ход
 * - cooldown=1 -> нельзя в следующий раунд, доступно через раунд
 * => availableFromRound = currentRound + cooldown + 1
 */

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function getCombatState() {
  const c = game.combat;
  if (!c) return null;
  const round = Number(c.round ?? 0) || 0;
  return { combat: c, combatId: c.id, round };
}

export async function markSkillUsed({ actor, skillItem }) {
  if (!actor || !skillItem) return;

  const cs = getCombatState();
  if (!cs) return; // вне боя не отслеживаем

  const cooldown = Number(getSystem(skillItem)?.Cooldown ?? 0) || 0;
  if (cooldown <= 0) return;

  const availableFromRound = cs.round + cooldown + 1;

  const cur = foundry.utils.duplicate(actor.getFlag(FLAG_SCOPE, FLAG_KEY) || {});
  cur[skillItem.id] = {
    combatId: cs.combatId,
    availableFromRound
  };

  await actor.setFlag(FLAG_SCOPE, FLAG_KEY, cur);
}

export function getSkillCooldownView({ actor, skillItem }) {
  const cs = getCombatState();
  if (!actor || !skillItem || !cs) return { inCombat: false, active: false };

  const all = actor.getFlag(FLAG_SCOPE, FLAG_KEY) || {};
  const entry = all?.[skillItem.id];
  if (!entry) return { inCombat: true, active: false };

  if (entry.combatId !== cs.combatId) return { inCombat: true, active: false };

  const availableFromRound = Number(entry.availableFromRound ?? 0) || 0;
  const active = cs.round < availableFromRound;

  const remainingRounds = active ? Math.max(0, availableFromRound - cs.round) : 0;

  if (!cs) return { inCombat: false, active: false };
  return {
    inCombat: true,
    active,
    availableFromRound,
    remainingRounds
  };
}

/**
 * Чистка:
 * - если бой закончился -> сбрасываем флаг
 * - если прошло время -> можем удалить записи (не обязательно, но держит флаги чистыми)
 */
export function registerOrderSkillCooldownHooks() {
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user?.isGM) return;
    const combatId = combat?.id;

    for (const a of (game.actors?.contents ?? [])) {
      const all = a.getFlag(FLAG_SCOPE, FLAG_KEY);
      if (!all) continue;

      const next = {};
      for (const [k, v] of Object.entries(all)) {
        if (v?.combatId && v.combatId !== combatId) next[k] = v;
      }
      // проще всего просто очистить, относящееся к combatId
      await a.unsetFlag(FLAG_SCOPE, FLAG_KEY);
    }
  });

  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isGM) return;
    if (!("round" in changed)) return;
    if (!game.user?.isGM) return;

    // Бой завершили (active -> false) => чистим кулдауны у всех
    if ("active" in changed && changed.active === false) {
      for (const a of (game.actors?.contents ?? [])) {
        const all = a.getFlag("Order", "skillCooldowns");
        if (all) await a.unsetFlag("Order", "skillCooldowns");
      }
      return;
    }
    const round = Number(combat.round ?? 0) || 0;
    const combatId = combat.id;

    for (const a of (game.actors?.contents ?? [])) {
      const all = a.getFlag(FLAG_SCOPE, FLAG_KEY);
      if (!all) continue;

      let dirty = false;
      const next = { ...all };

      for (const [skillId, entry] of Object.entries(all)) {
        if (!entry) continue;
        if (entry.combatId !== combatId) {
          // старый бой
          delete next[skillId];
          dirty = true;
          continue;
        }
        const afr = Number(entry.availableFromRound ?? 0) || 0;
        if (afr && round >= afr) {
          // уже откатилось — можно удалить запись
          delete next[skillId];
          dirty = true;
        }
      }

      if (dirty) {
        await a.setFlag(FLAG_SCOPE, FLAG_KEY, next);
      }
    }
  });

  console.log("OrderSkillCooldown | Hooks registered");
}
