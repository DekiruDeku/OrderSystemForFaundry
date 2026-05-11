const BUFF_KIND_ARMOR_DEFENSE_ROUNDS = "armor-defense-rounds";
const ARMOR_DEFENSE_CHANGE_KEY = "flags.Order.armor.defense";
const ARMOR_DEFENSE_LAST_TURN_FLAG = "lastArmorDefenseTurnMarker";

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function getEffectChanges(effect) {
  return Array.isArray(effect?.changes) ? effect.changes
    : Array.isArray(effect?.data?.changes) ? effect.data.changes
      : Array.isArray(effect?._source?.changes) ? effect._source.changes
        : [];
}

function getOrderFlag(effect, key) {
  return effect?.getFlag?.("Order", key) ?? effect?.flags?.Order?.[key];
}

function hasChanged(changed, key) {
  if (!changed || typeof changed !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(changed, key)) return true;
  return !!globalThis.foundry?.utils?.hasProperty?.(changed, key);
}

function getCombatTurnMarker(combat, combatant = null) {
  if (!combat) return "";
  const combatId = combat.id ?? "no-combat-id";
  const round = Number(combat.round ?? 0) || 0;
  const turn = Number(combat.turn ?? 0) || 0;
  const combatantId = combatant?.id ?? combatant?._id ?? combat?.combatant?.id ?? combat?.combatant?._id ?? "no-combatant-id";
  return `${combatId}:${round}:${turn}:${combatantId}`;
}

function getEffectDurationData(rounds) {
  const safeRounds = Math.max(1, Math.floor(safeNumber(rounds, 1)));
  const combat = game?.combat ?? null;
  const duration = { rounds: safeRounds };

  if (combat) {
    const round = Number(combat.round);
    const turn = Number(combat.turn);
    const roundTime = Number(combat.roundTime);
    const time = Number(combat.time);

    if (Number.isFinite(round)) duration.startRound = round;
    if (Number.isFinite(turn)) duration.startTurn = turn;
    if (Number.isFinite(roundTime)) duration.seconds = safeRounds * roundTime;
    if (Number.isFinite(time)) duration.startTime = time;
    if (combat.id) duration.combat = combat.id;
  }

  return duration;
}

function isArmorDefenseBuffEffect(effect) {
  const buffKey = String(getOrderFlag(effect, "buffKey") ?? "").trim();
  if (buffKey && buffKey !== BUFF_KIND_ARMOR_DEFENSE_ROUNDS) return false;

  return getEffectChanges(effect).some((change) => String(change?.key ?? "") === ARMOR_DEFENSE_CHANGE_KEY);
}

function collectActorsForCombatant(combat, combatant) {
  const actors = [];
  const add = (actor) => {
    if (!actor) return;
    if (actors.some((existing) => existing === actor || (existing.uuid && actor.uuid && existing.uuid === actor.uuid))) return;
    actors.push(actor);
  };

  add(combatant?.actor);

  const tokenDoc = combatant?.token
    ?? combat?.scene?.tokens?.get?.(combatant?.tokenId)
    ?? canvas?.scene?.tokens?.get?.(combatant?.tokenId)
    ?? null;

  add(tokenDoc?.actor);

  const placedToken = combatant?.tokenId ? canvas?.tokens?.get?.(combatant.tokenId) : null;
  add(placedToken?.actor);

  if (combatant?.actorId) add(game?.actors?.get?.(combatant.actorId));

  return actors;
}

async function tickArmorDefenseBuffsForActor(actor, combat, combatant) {
  if (!actor) return;

  const marker = getCombatTurnMarker(combat, combatant);
  if (!marker) return;

  for (const effect of Array.from(actor.effects ?? [])) {
    if (!effect || effect.disabled || !isArmorDefenseBuffEffect(effect)) continue;

    const lastMarker = String(getOrderFlag(effect, ARMOR_DEFENSE_LAST_TURN_FLAG) ?? "");
    if (lastMarker === marker) continue;

    const rawRemaining = Number(getOrderFlag(effect, "roundsRemaining"));
    const fallbackRounds = safeNumber(getOrderFlag(effect, "rounds"), 1);
    const remainingSource = Number.isFinite(rawRemaining) ? rawRemaining : fallbackRounds;
    const remaining = Math.max(0, Math.floor(safeNumber(remainingSource, 1)));
    const nextRemaining = remaining - 1;

    if (nextRemaining <= 0) {
      await effect.delete();
      continue;
    }

    await effect.update({
      "flags.Order.roundsRemaining": nextRemaining,
      [`flags.Order.${ARMOR_DEFENSE_LAST_TURN_FLAG}`]: marker
    });
  }
}

async function tickArmorDefenseBuffsForCurrentTurn(combat) {
  if (!combat?.started) return;

  const combatant = combat?.combatant ?? null;
  if (!combatant) return;

  const actors = collectActorsForCombatant(combat, combatant);
  for (const actor of actors) {
    await tickArmorDefenseBuffsForActor(actor, combat, combatant);
  }
}

let armorDefenseBuffHookRegistered = false;
export function registerArmorDefenseBuffTurnHook() {
  if (armorDefenseBuffHookRegistered) return;
  if (!globalThis.Hooks) return;
  armorDefenseBuffHookRegistered = true;

  Hooks.on("updateCombat", async (combat, changed = {}) => {
    try {
      if (!game?.user?.isGM) return;
      if (!combat?.started) return;

      const turnChanged = hasChanged(changed, "turn") || hasChanged(changed, "round") || hasChanged(changed, "active");
      if (!turnChanged) return;

      await tickArmorDefenseBuffsForCurrentTurn(combat);
    } catch (err) {
      console.error("Order | Armor defense buff turn tick failed", err);
    }
  });

  // Foundry вызывает этот хук после смены хода. Он нужен как запасной вариант,
  // если кастомная инициатива обновила ход, но updateCombat не дал ожидаемый changed.turn.
  Hooks.on("combatTurn", async (combat) => {
    try {
      if (!game?.user?.isGM) return;
      await tickArmorDefenseBuffsForCurrentTurn(combat);
    } catch (err) {
      console.error("Order | Armor defense buff combatTurn tick failed", err);
    }
  });

  Hooks.on("deleteCombat", async () => {
    // Ничего не удаляем принудительно: если бафф ещё не истёк, он может остаться как обычный эффект.
    // Истечение именно по раундам обрабатывается при наступлении хода персонажа.
  });

  console.log("Order | Armor defense buff turn hook registered");
}

// На случай если файл загружен уже после инициализации Foundry.
registerArmorDefenseBuffTurnHook();

export function getActorArmorDefenseBonus(actor) {
  if (!actor) return 0;

  let total = 0;
  const effects = Array.from(actor.effects ?? []);
  for (const effect of effects) {
    if (!effect || effect.disabled || !isArmorDefenseBuffEffect(effect)) continue;

    const rawRemaining = Number(getOrderFlag(effect, "roundsRemaining"));
    const remaining = Number.isFinite(rawRemaining) ? rawRemaining : safeNumber(getOrderFlag(effect, "rounds"), 1);
    if (remaining <= 0) continue;

    const changes = getEffectChanges(effect);
    for (const change of changes) {
      if (!change || String(change.key ?? "") !== ARMOR_DEFENSE_CHANGE_KEY) continue;
      const value = Number(change.value ?? 0);
      if (Number.isFinite(value)) total += value;
    }
  }

  return total;
}

export async function applyArmorDefenseBuff(actor, { bonus = 0, rounds = 1, label, icon } = {}) {
  if (!actor) return null;

  const safeBonus = safeNumber(bonus, 0);
  const safeRounds = Math.max(1, Math.floor(safeNumber(rounds, 1)));
  if (safeBonus === 0) return null;

  const sign = safeBonus > 0 ? `+${safeBonus}` : String(safeBonus);
  const combat = game?.combat ?? null;
  const currentCombatant = combat?.combatant ?? null;
  const currentMarker = getCombatTurnMarker(combat, currentCombatant);
  const effectData = {
    label: String(label || `Бафф: защита/броня ${sign}`),
    icon: icon || "icons/svg/shield.svg",
    changes: [{
      key: ARMOR_DEFENSE_CHANGE_KEY,
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: safeBonus
    }],
    duration: getEffectDurationData(safeRounds),
    flags: {
      Order: {
        buffKey: BUFF_KIND_ARMOR_DEFENSE_ROUNDS,
        armorDefenseBonus: safeBonus,
        rounds: safeRounds,
        roundsRemaining: safeRounds,
        [ARMOR_DEFENSE_LAST_TURN_FLAG]: currentMarker
      }
    }
  };

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  return created?.[0] ?? null;
}

export { BUFF_KIND_ARMOR_DEFENSE_ROUNDS, ARMOR_DEFENSE_CHANGE_KEY };
