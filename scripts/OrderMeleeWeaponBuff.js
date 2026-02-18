/**
 * OrderMeleeWeaponBuff.js
 * Variant 2:
 * - Bonus damage comes from ActiveEffect.
 * - Charges are spent manually by a chat button.
 * - ONLY for melee combat.
 */

const BUFF_KEY = "melee-damage-hits";
const CHANGE_KEY = "flags.Order.damage.melee";

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getEffectChanges(effect) {
  return Array.isArray(effect?.changes) ? effect.changes
    : Array.isArray(effect?.data?.changes) ? effect.data.changes
      : Array.isArray(effect?._source?.changes) ? effect._source.changes
        : [];
}

/**
 * Collect active melee damage buffs from actor effects.
 * Returns: { totalBonus, effects: [{id,label,bonus,hitsRemaining}] }
 */
export function collectMeleeWeaponDamageBuffs(actor) {
  const out = { totalBonus: 0, effects: [] };
  if (!actor) return out;

  for (const ef of Array.from(actor.effects ?? [])) {
    if (!ef || ef.disabled) continue;

    const buffKey = ef.getFlag?.("Order", "buffKey") ?? ef?.flags?.Order?.buffKey;
    if (String(buffKey || "") !== BUFF_KEY) continue;

    const hitsRemaining = safeNumber(
      ef.getFlag?.("Order", "hitsRemaining") ?? ef?.flags?.Order?.hitsRemaining,
      0
    );
    if (hitsRemaining <= 0) continue;

    let bonus = 0;
    for (const ch of getEffectChanges(ef)) {
      if (!ch) continue;
      if (String(ch.key || "") !== CHANGE_KEY) continue;
      bonus += safeNumber(ch.value, 0);
    }

    if (bonus === 0) continue;

    out.totalBonus += bonus;
    out.effects.push({
      id: ef.id,
      label: ef.label ?? ef.name ?? "Бафф урона",
      bonus,
      hitsRemaining
    });
  }

  return out;
}

/**
 * Create ActiveEffect on actor that adds melee damage and stores remaining hits.
 */
export async function applyMeleeWeaponDamageBuff(actor, { bonus = 0, hits = 1, label, icon } = {}) {
  if (!actor) return null;

  const b = safeNumber(bonus, 0);
  const h = Math.max(1, Math.floor(safeNumber(hits, 1)));
  if (b === 0) return null;

  const effectData = {
    label: String(label || `Бафф: урон ближнего оружия ${b > 0 ? `+${b}` : b}`),
    icon: icon || "icons/svg/sword.svg",
    changes: [
      {
        key: CHANGE_KEY,
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: b
      }
    ],
    flags: {
      Order: {
        buffKey: BUFF_KEY,
        hitsRemaining: h,
        perHitBonus: b
      }
    }
  };

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  return created?.[0] ?? null;
}

/**
 * Spend charges manually. Deletes effect if hits go to 0.
 */
export async function spendMeleeWeaponDamageBuff(actor, effectId, spend = 1) {
  if (!actor || !effectId) return { ok: false, reason: "bad_args" };

  const ef = actor.effects.get(effectId);
  if (!ef) return { ok: false, reason: "not_found" };

  const buffKey = ef.getFlag?.("Order", "buffKey") ?? ef?.flags?.Order?.buffKey;
  if (String(buffKey || "") !== BUFF_KEY) return { ok: false, reason: "wrong_type" };

  const cur = safeNumber(ef.getFlag?.("Order", "hitsRemaining") ?? ef?.flags?.Order?.hitsRemaining, 0);
  const dec = Math.max(1, Math.floor(safeNumber(spend, 1)));
  const next = cur - dec;

  if (next <= 0) {
    await ef.delete();
    return { ok: true, deleted: true, hitsRemaining: 0 };
  }

  await ef.update({ "flags.Order.hitsRemaining": next });
  return { ok: true, deleted: false, hitsRemaining: next };
}