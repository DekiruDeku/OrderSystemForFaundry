import { createMeleeAttackMessage } from "./OrderMelee.js";
import { createRangedAoEAttackMessage } from "./OrderRange.js";
import { collectWeaponAoETargetIds } from "./OrderWeaponAoE.js";

const BUS_SCOPE = "Order";
const BUS_KEY = "consumableBus";

const CONSUMABLE_KIND = {
  DOPING: "doping",
  GRENADE: "grenade",
  AMMO: "ammo"
};

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function escapeHtml(value) {
  const text = String(value ?? "");

  const foundryEscape = globalThis?.foundry?.utils?.escapeHTML;
  if (typeof foundryEscape === "function") return foundryEscape(text);

  const hbsEscape = globalThis?.Handlebars?.escapeExpression;
  if (typeof hbsEscape === "function") return hbsEscape(text);

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getConsumableKind(item) {
  const raw = normalizeText(item?.system?.TypeOfConsumables);

  if (raw.includes("\u043f\u0430\u0442\u0440\u043e\u043d") || raw === "ammo") return CONSUMABLE_KIND.AMMO;
  if (raw.includes("\u0433\u0440\u0430\u043d\u0430\u0442") || raw === "grenade") return CONSUMABLE_KIND.GRENADE;
  if (raw.includes("\u0434\u043e\u043f\u043f\u0438\u043d\u0433") || raw === "doping") return CONSUMABLE_KIND.DOPING;

  // Fallback: treat unknown consumables as doping to preserve legacy behavior.
  return CONSUMABLE_KIND.DOPING;
}

function getDopingSubtype(item) {
  const raw = normalizeText(item?.system?.ConsumableType);

  if (raw === "damage" || raw.includes("\u0443\u0440\u043e\u043d")) return "damage";
  if (raw === "healing" || raw.includes("\u043b\u0435\u0447")) return "healing";
  if (raw === "utility" || raw.includes("\u0443\u0442\u0438\u043b")) return "utility";

  return "utility";
}

function getPreferredAttackerToken(actor) {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  return controlled.find((t) => t?.actor?.id === actor?.id) || actor?.getActiveTokens?.()[0] || null;
}

function getSingleTargetToken() {
  const targets = Array.from(game.user?.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications?.warn?.("Select exactly one target token.");
    return null;
  }
  return targets[0];
}

function getHealTarget(actor) {
  const targets = Array.from(game.user?.targets ?? []);
  if (targets.length > 1) {
    ui.notifications?.warn?.("Select zero or one target token for healing.");
    return null;
  }

  if (targets.length === 1) {
    return { targetActor: targets[0]?.actor ?? null, targetToken: targets[0] ?? null };
  }

  return { targetActor: actor ?? null, targetToken: getPreferredAttackerToken(actor) };
}

function getD20Result(roll) {
  try {
    const term = (roll?.terms ?? []).find((t) => Number(t?.faces) === 20);
    if (!term) return null;

    const results = Array.isArray(term.results) ? term.results : [];
    const active = results.filter((r) => r?.active !== false);
    const used = active.length ? active : results;
    const value = Number(used?.[0]?.result);

    return Number.isFinite(value) ? value : null;
  } catch (_err) {
    return null;
  }
}

function getConsumableDescription(item) {
  const s = item?.system ?? {};
  const text = String(s.description ?? s.Description ?? "").trim();
  if (!text) return "";
  return escapeHtml(text);
}

function createCombatProxyItem(item) {
  return {
    id: null,
    uuid: null,
    name: item?.name ?? "Consumable",
    img: item?.img ?? ""
  };
}

function createGrenadeTemplateProxy(item) {
  const size = Number(item?.system?.Range ?? 0) || 0;

  return {
    id: null,
    uuid: null,
    name: item?.name ?? "Grenade",
    img: item?.img ?? "",
    system: {
      tags: ["\u043c\u0430\u0441\u0441\u043e\u0432\u0430\u044f \u0430\u0442\u0430\u043a\u0430"],
      AoEShape: "circle",
      AoESize: size,
      AoEWidth: 0,
      AoEAngle: 90,
      AoEColor: String(game.user?.color || "#ffffff")
    }
  };
}

async function rollConsumableUse(actor, item) {
  const roll = await new Roll("1d20").roll({ async: true });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Consumable use: ${item?.name ?? "Consumable"}`
  });

  return roll;
}

async function consumeOne(item) {
  const quantity = Number(item?.system?.Quantity ?? 0) || 0;
  if (quantity <= 0) {
    ui.notifications?.warn?.("No charges left for this consumable.");
    return false;
  }

  await item.update({ "system.Quantity": Math.max(0, quantity - 1) });
  return true;
}

async function postUtilityMessage({ actor, item, roll, subtype }) {
  const s = item?.system ?? {};
  const description = getConsumableDescription(item);

  const content = `
    <div class="chat-item-message">
      <div class="item-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${item?.img ?? ""}" alt="${escapeHtml(item?.name ?? "Consumable")}" width="36" height="36" style="border:0;"/>
        <h3 style="margin:0;">${escapeHtml(item?.name ?? "Consumable")}</h3>
      </div>
      <p style="margin:6px 0 0 0;"><strong>Subtype:</strong> ${subtype}</p>
      <p style="margin:6px 0 0 0;"><strong>Use roll:</strong> ${Number(roll?.total ?? 0) || 0}</p>
      <p style="margin:6px 0 0 0;"><strong>Effect value:</strong> ${Number(s?.Damage ?? 0) || 0}</p>
      ${description ? `<hr/><div>${description}</div>` : ""}
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

function getActiveGMIds() {
  return game.users?.filter((u) => u.isGM && u.active).map((u) => u.id) ?? [];
}

async function emitToGM(payload) {
  if (game.user?.isGM) return handleGMRequest(payload);

  const gmIds = getActiveGMIds();
  if (!gmIds.length) {
    ui.notifications?.warn?.("No active GM found to resolve consumable effect.");
    return;
  }

  await ChatMessage.create({
    user: game.user?.id,
    whisper: gmIds,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    content: "<div style='display:none'>consumable-bus</div>",
    flags: {
      [BUS_SCOPE]: {
        [BUS_KEY]: { payload }
      }
    }
  });
}

async function gmApplyHealing({ sourceActorId, targetActorId, targetTokenId, itemName, amount, rollTotal } = {}) {
  const sourceActor = game.actors?.get(sourceActorId) ?? null;
  const token = canvas.tokens?.get(String(targetTokenId ?? "")) ?? null;
  const targetActor = game.actors?.get(targetActorId) ?? token?.actor ?? null;

  if (!targetActor) {
    ui.notifications?.warn?.("Target actor for healing was not found.");
    return;
  }

  const value = Math.max(0, Number(amount ?? 0) || 0);
  const current = Number(targetActor?.system?.Health?.value ?? 0) || 0;
  const max = Number(targetActor?.system?.Health?.max ?? current) || current;
  const next = Math.min(max, current + value);
  const healed = Math.max(0, next - current);

  await targetActor.update({ "system.Health.value": next });

  if (token?.center && typeof canvas?.interface?.createScrollingText === "function") {
    canvas.interface.createScrollingText(token.center, `+${healed}`, {
      fontSize: 32,
      fill: "#00aa00",
      stroke: "#000000",
      strokeThickness: 4,
      jitter: 0.35
    });
  }

  const sourceName = escapeHtml(sourceActor?.name ?? "Source");
  const targetName = escapeHtml(targetActor?.name ?? "Target");
  const safeItemName = escapeHtml(itemName ?? "Consumable");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor ?? targetActor }),
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    content: `
      <p>
        <strong>${sourceName}</strong> uses <strong>${safeItemName}</strong> on <strong>${targetName}</strong>.<br/>
        Roll: <strong>${Number(rollTotal ?? 0) || 0}</strong>.<br/>
        Restored HP: <strong>${healed}</strong> (now ${next}/${max}).
      </p>
    `
  });
}

async function handleGMRequest(payload) {
  const type = String(payload?.type || "");

  if (type === "APPLY_CONSUMABLE_HEAL") {
    await gmApplyHealing(payload);
  }
}

export function registerOrderConsumableBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user?.isGM) return;

      const bus = message?.getFlag?.(BUS_SCOPE, BUS_KEY);
      if (!bus?.payload) return;

      await handleGMRequest(bus.payload);
    } catch (err) {
      console.error("OrderConsumable | BUS handler failed", err);
    }
  });
}

export async function startConsumableUse({ actor, consumableItem } = {}) {
  if (!actor || !consumableItem || consumableItem.type !== "Consumables") return;

  if (!(game.user?.isGM || actor.isOwner)) {
    ui.notifications?.warn?.("Only GM or owner can use this consumable.");
    return;
  }

  const kind = getConsumableKind(consumableItem);
  if (kind === CONSUMABLE_KIND.AMMO) {
    ui.notifications?.warn?.("Ammo consumables cannot be used directly.");
    return;
  }

  const quantity = Number(consumableItem?.system?.Quantity ?? 0) || 0;
  if (quantity <= 0) {
    ui.notifications?.warn?.("No charges left for this consumable.");
    return;
  }

  const roll = await rollConsumableUse(actor, consumableItem);
  const baseDamage = Number(consumableItem?.system?.Damage ?? 0) || 0;

  let execute = null;

  if (kind === CONSUMABLE_KIND.DOPING) {
    const subtype = getDopingSubtype(consumableItem);

    if (subtype === "damage") {
      const defenderToken = getSingleTargetToken();
      if (!defenderToken) return;

      const attackerToken = getPreferredAttackerToken(actor);
      execute = async () => {
        await createMeleeAttackMessage({
          attackerActor: actor,
          attackerToken,
          defenderToken,
          weapon: createCombatProxyItem(consumableItem),
          characteristic: null,
          rollMode: "normal",
          applyModifiers: false,
          customModifier: 0,
          attackRoll: roll,
          damage: baseDamage,
          stealthAttack: false
        });
      };
    } else if (subtype === "healing") {
      if (baseDamage <= 0) {
        ui.notifications?.warn?.("Healing value must be greater than 0.");
        return;
      }

      const target = getHealTarget(actor);
      if (!target?.targetActor) {
        ui.notifications?.warn?.("Healing target was not found.");
        return;
      }

      execute = async () => {
        await emitToGM({
          type: "APPLY_CONSUMABLE_HEAL",
          sourceActorId: actor.id,
          targetActorId: target.targetActor.id,
          targetTokenId: target.targetToken?.id ?? null,
          itemName: consumableItem.name,
          amount: baseDamage,
          rollTotal: Number(roll?.total ?? 0) || 0
        });
      };
    } else {
      execute = async () => {
        await postUtilityMessage({ actor, item: consumableItem, roll, subtype });
      };
    }
  }

  if (kind === CONSUMABLE_KIND.GRENADE) {
    const attackerToken = getPreferredAttackerToken(actor);
    if (!attackerToken) {
      ui.notifications?.warn?.("Select your token to throw a grenade.");
      return;
    }

    const templateWeapon = createGrenadeTemplateProxy(consumableItem);
    const templateSize = Number(templateWeapon?.system?.AoESize ?? 0) || 0;
    if (templateSize <= 0) {
      ui.notifications?.warn?.("Grenade range (used as AoE radius) must be greater than 0.");
      return;
    }

    const { targetTokenIds } = await collectWeaponAoETargetIds({
      weaponItem: templateWeapon,
      attackerToken,
      dialogTitle: "Grenade targets"
    });

    const targetTokens = (Array.isArray(targetTokenIds) ? targetTokenIds : [])
      .map((id) => canvas.tokens?.get?.(String(id)))
      .filter(Boolean);

    if (!targetTokens.length) {
      ui.notifications?.warn?.("No targets were selected for grenade use.");
      return;
    }

    const natD20 = getD20Result(roll);

    execute = async () => {
      await createRangedAoEAttackMessage({
        attackerActor: actor,
        attackerToken,
        targetTokens,
        weapon: createCombatProxyItem(consumableItem),
        characteristic: null,
        attackRoll: roll,
        rollMode: "normal",
        applyModifiers: false,
        customModifier: 0,
        attackEffectMod: 0,
        bullets: 1,
        bulletPenalty: 0,
        baseDamage,
        hidden: false,
        isCrit: natD20 === 20
      });
    };
  }

  if (typeof execute !== "function") return;

  const consumed = await consumeOne(consumableItem);
  if (!consumed) return;

  await execute();
}
