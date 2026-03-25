const FLAG_SCOPE = "Order";
const FLAG_KEY = "storedDodge";

function getCurrentCombatId() {
  const combat = game.combat;
  return combat?.started ? String(combat.id || "") : "";
}

function resolveFlagDocument({ actor = null, token = null } = {}) {
  if (token?.document) return token.document;
  if (token) return token;
  return actor ?? null;
}

export function summarizeDefenseRoll(roll) {
  const total = Number(roll?.total ?? 0) || 0;
  if (!roll) {
    return { total, text: `итог: ${total}` };
  }

  try {
    const chunks = [];
    const dice = Array.isArray(roll.dice) ? roll.dice : [];

    for (const die of dice) {
      if (!die || Number(die.faces ?? 0) !== 20) continue;
      const all = Array.isArray(die.results)
        ? die.results.map((r) => Number(r?.result)).filter((n) => Number.isFinite(n))
        : [];
      const active = Array.isArray(die.results)
        ? die.results.filter((r) => r?.active !== false).map((r) => Number(r?.result)).filter((n) => Number.isFinite(n))
        : [];
      const used = active.length ? active : all;
      if (!used.length) continue;

      if (all.length > 1 && active.length === 1) {
        chunks.push(`${all.join("/")} → ${active[0]}`);
      } else if (all.length > 1) {
        chunks.push(all.join("/"));
      } else {
        chunks.push(String(used[0]));
      }
    }

    if (chunks.length) {
      return {
        total,
        text: `d20: ${chunks.join(", ")}; итог: ${total}`
      };
    }

    const formula = String(roll.formula || "").trim();
    if (formula) {
      return {
        total,
        text: `${formula} = ${total}`
      };
    }
  } catch (err) {
    console.warn("OrderDodgeState | summarizeDefenseRoll failed", err);
  }

  return { total, text: `итог: ${total}` };
}

export function getStoredDodgeState({ actor = null, token = null } = {}) {
  const doc = resolveFlagDocument({ actor, token });
  if (!doc?.getFlag) return null;

  const combatId = getCurrentCombatId();
  if (!combatId) return null;

  const state = doc.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!state || typeof state !== "object") return null;
  if (String(state.combatId || "") !== combatId) return null;

  const total = Number(state.total ?? NaN);
  if (!Number.isFinite(total)) return null;

  return {
    combatId,
    total,
    rollSummary: String(state.rollSummary || `итог: ${total}`),
    storedAt: Number(state.storedAt ?? 0) || 0
  };
}

export async function storeDodgeState({ actor = null, token = null } = {}, { total, rollSummary } = {}) {
  const doc = resolveFlagDocument({ actor, token });
  const combatId = getCurrentCombatId();
  const value = Number(total ?? NaN);
  if (!doc?.setFlag || !combatId || !Number.isFinite(value)) return;

  await doc.setFlag(FLAG_SCOPE, FLAG_KEY, {
    combatId,
    total: value,
    rollSummary: String(rollSummary || `итог: ${value}`),
    storedAt: Date.now()
  });
}

export async function clearStoredDodgeState({ actor = null, token = null } = {}) {
  const doc = resolveFlagDocument({ actor, token });
  if (!doc?.getFlag) return;

  const existing = doc.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (existing == null) return;

  try {
    if (doc.unsetFlag) {
      await doc.unsetFlag(FLAG_SCOPE, FLAG_KEY);
      return;
    }
  } catch (_err) {
    // fall through to update-based removal below
  }

  try {
    await doc.update({ [`flags.${FLAG_SCOPE}.-=${FLAG_KEY}`]: null });
  } catch (err) {
    console.warn("OrderDodgeState | clearStoredDodgeState failed", err);
  }
}

export function registerOrderDodgeStateHooks() {
  Hooks.on("updateCombat", async (combat, changed) => {
    try {
      if (!game.user?.isGM) return;
      const hasTurnChange = Object.prototype.hasOwnProperty.call(changed ?? {}, "turn");
      const hasRoundChange = Object.prototype.hasOwnProperty.call(changed ?? {}, "round");
      if (!hasTurnChange && !hasRoundChange) return;

      const combatant = combat?.combatant;
      if (!combatant) return;

      const tokenDoc = combatant.token ?? combat?.scene?.tokens?.get?.(combatant.tokenId) ?? null;
      const actor = combatant.actor ?? tokenDoc?.actor ?? (combatant.actorId ? game.actors?.get(combatant.actorId) : null) ?? null;
      if (!actor && !tokenDoc) return;

      await clearStoredDodgeState({ actor, token: tokenDoc });
    } catch (err) {
      console.warn("OrderDodgeState | updateCombat hook failed", err);
    }
  });
}
