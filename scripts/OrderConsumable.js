import { createMeleeAttackMessage } from "./OrderMelee.js";
import { createRangedAoEAttackMessage } from "./OrderRange.js";
import { collectItemAoETargetIds } from "./OrderItemAoE.js";
import { applySpellEffects, buildConfiguredEffectsListHtml } from "./OrderSpellEffects.js";
import { evaluateDamageFormula, evaluateRollFormula } from "./OrderDamageFormula.js";
import { startSpellSaveWorkflow } from "./OrderSpellSave.js";
import { startSpellMassSaveWorkflow } from "./OrderSpellMassSave.js";
import { resolveSaveAbilities } from "./OrderSaveAbility.js";

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

function shouldPostHpChatLog(actor) {
  return String(actor?.type ?? "").trim().toLowerCase() !== "npc";
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
    id: item?.id ?? null,
    uuid: item?.uuid ?? null,
    type: item?.type ?? "Consumables",
    name: item?.name ?? "Consumable",
    img: item?.img ?? "",
    system: foundry.utils?.duplicate?.(item?.system ?? {}) ?? { ...(item?.system ?? {}) }
  };
}

function getConsumableDeliveryType(item) {
  const raw = normalizeText(item?.system?.DeliveryType);
  if (raw === "save-check" || raw === "aoe-template" || raw === "mass-save-check") return raw;
  return "aoe-template";
}

function getGrenadeAreaSize(item) {
  return Number(item?.system?.AreaSize ?? item?.system?.Range ?? 0) || 0;
}

function createGrenadeWorkflowProxy(item) {
  const system = foundry.utils?.duplicate?.(item?.system ?? {}) ?? { ...(item?.system ?? {}) };
  const size = getGrenadeAreaSize(item);
  const rawShape = String(system?.AreaShape || "circle").trim().toLowerCase();
  const areaShape = (rawShape === "cone" || rawShape === "ray" || rawShape === "rect" || rawShape === "wall")
    ? (rawShape === "rect" || rawShape === "wall" ? "ray" : rawShape)
    : "circle";
  const tags = Array.isArray(system?.tags) ? Array.from(system.tags) : [];
  if (!tags.includes("массовая атака")) tags.push("массовая атака");

  return {
    id: item?.id ?? null,
    uuid: item?.uuid ?? null,
    type: item?.type ?? "Consumables",
    name: item?.name ?? "Grenade",
    img: item?.img ?? "",
    system: {
      ...system,
      tags,
      DeliveryType: getConsumableDeliveryType(item),
      AreaShape: areaShape,
      AreaSize: size,
      AreaWidth: Math.max(Number(system?.AreaWidth ?? 0) || 0, 0.5),
      AreaAngle: Number(system?.AreaAngle ?? 90) || 90,
      AreaColor: String(system?.AreaColor || game.user?.color || "#ffffff"),
      SaveAbilities: resolveSaveAbilities(system),
      SaveAbility: resolveSaveAbilities(system)[0] ?? "",
      DamageMode: String(system?.DamageMode || "damage").trim().toLowerCase() === "heal" ? "heal" : "damage",
      AoEShape: areaShape,
      AoESize: size,
      AoEWidth: Math.max(Number(system?.AreaWidth ?? 0) || 0, 0.5),
      AoEAngle: Number(system?.AreaAngle ?? 90) || 90,
      AoEColor: String(system?.AreaColor || game.user?.color || "#ffffff")
    }
  };
}

function getSelectedDCFormula(item) {
  const raw = String(item?.system?.SaveDCFormula || "").trim();
  if (!raw) return "";
  return raw.includes(",") ? (raw.split(",").map((part) => part.trim()).filter(Boolean).pop() || "") : raw;
}

function canResolveGrenadeSaveConfig(actor, item) {
  const saveAbilities = resolveSaveAbilities(item?.system ?? {});
  if (!saveAbilities.length) {
    ui.notifications?.warn?.("У гранаты не задана характеристика проверки цели.");
    return false;
  }

  const dcFormula = getSelectedDCFormula(item);
  if (!dcFormula) {
    ui.notifications?.warn?.("У гранаты не задана формула сложности проверки (КС).");
    return false;
  }

  const dc = Number(evaluateDamageFormula(dcFormula, actor, item) ?? NaN);
  if (!Number.isFinite(dc)) {
    ui.notifications?.warn?.(`Не удалось вычислить КС гранаты из формулы: "${dcFormula}".`);
    return false;
  }

  return true;
}


async function rollConsumableUse(actor, item) {
  const roll = await new Roll("1d20").roll({ async: true });
  roll._orderRollFormulaRaw = "";
  roll._orderRollFormulaValue = 0;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Consumable use: ${item?.name ?? "Consumable"}`
  });

  return roll;
}

function getRollFormulasFromConsumable(item) {
  const system = item?.system ?? item?.data?.system ?? {};
  let rawArr = [];

  if (Array.isArray(system.RollFormulas)) {
    rawArr = system.RollFormulas;
  } else if (system.RollFormulas && typeof system.RollFormulas === "object") {
    const keys = Object.keys(system.RollFormulas)
      .filter((k) => String(Number(k)) === k)
      .map((k) => Number(k))
      .sort((a, b) => a - b);
    rawArr = keys.map((k) => system.RollFormulas[k]);
  }

  const out = rawArr.map((value) => String(value ?? "").trim()).filter(Boolean);
  const legacy = String(system.RollFormula ?? "").trim();
  if (legacy && !out.includes(legacy)) out.unshift(legacy);
  return out;
}

async function chooseConsumableRollFormula({ consumableItem } = {}) {
  const rawList = getRollFormulasFromConsumable(consumableItem);
  const seen = new Set();
  const list = [];

  for (const formula of rawList) {
    if (seen.has(formula)) continue;
    seen.add(formula);
    list.push(formula);
  }

  if (!list.length) return "";
  if (list.length === 1) return list[0];

  const options = [
    `<option value="">По умолчанию (только куб)</option>`,
    ...list.map((formula, index) => `<option value="${index}">${escapeHtml(formula)}</option>`)
  ].join("");

  const content = `
    <form class="order-consumable-roll-formula">
      <div class="form-group">
        <label>Формула броска:</label>
        <select id="consumableRollFormula">
          ${options}
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(String(value ?? ""));
    };

    new Dialog({
      title: `Формула броска: ${consumableItem?.name ?? "Расходник"}`,
      content,
      buttons: {
        ok: {
          label: "OK",
          callback: (html) => {
            const raw = String(html.find("#consumableRollFormula").val() ?? "");
            if (raw === "") return done("");
            const idx = Number(raw);
            if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return done("");
            return done(list[idx]);
          }
        }
      },
      default: "ok",
      close: () => done("")
    }).render(true);
  });
}

async function rollConsumableUseWithFormula(actor, item, rollFormulaRaw = "") {
  let formula = "1d20";
  const raw = String(rollFormulaRaw ?? "").trim();
  let rollFormulaValue = 0;

  if (raw) {
    rollFormulaValue = Number(evaluateRollFormula(raw, actor, item) ?? 0) || 0;
    if (rollFormulaValue) {
      formula += rollFormulaValue > 0 ? ` + ${rollFormulaValue}` : ` - ${Math.abs(rollFormulaValue)}`;
    }
  }

  const roll = await new Roll(formula).roll({ async: true });
  roll._orderRollFormulaRaw = raw;
  roll._orderRollFormulaValue = rollFormulaValue;

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

async function postUtilityMessage({ actor, item, roll, subtype, targetName = "" }) {
  const s = item?.system ?? {};
  const description = getConsumableDescription(item);
  const effectsPreviewHtml = buildConfiguredEffectsListHtml(item, { title: "Эффекты расходника" });

  const content = `
    <div class="chat-item-message">
      <div class="item-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${item?.img ?? ""}" alt="${escapeHtml(item?.name ?? "Consumable")}" width="36" height="36" style="border:0;"/>
        <h3 style="margin:0;">${escapeHtml(item?.name ?? "Consumable")}</h3>
      </div>
      <p style="margin:6px 0 0 0;"><strong>Subtype:</strong> ${subtype}</p>
      <p style="margin:6px 0 0 0;"><strong>Use roll:</strong> ${Number(roll?.total ?? 0) || 0}</p>
      <p style="margin:6px 0 0 0;"><strong>Effect value:</strong> ${Number(s?.Damage ?? 0) || 0}</p>
      ${targetName ? `<p style="margin:6px 0 0 0;"><strong>Target:</strong> ${escapeHtml(targetName)}</p>` : ""}
      ${effectsPreviewHtml}
      ${description ? `<hr/><div>${description}</div>` : ""}
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

function buildConsumableEffectSnapshot(item) {
  const system = item?.system ?? {};
  return {
    name: item?.name ?? "Consumable",
    img: item?.img ?? "",
    type: item?.type ?? "Consumables",
    system: {
      Effects: foundry.utils?.duplicate?.(system?.Effects ?? []) ?? (Array.isArray(system?.Effects) ? [...system.Effects] : system?.Effects ?? []),
      EffectThreshold: Number(system?.EffectThreshold ?? 0) || 0
    }
  };
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

async function gmApplyHealing({ sourceActorId, targetActorId, targetTokenId, itemName, amount, rollTotal, consumableSnapshot } = {}) {
  const sourceActor = game.actors?.get(sourceActorId) ?? null;
  const token = canvas.tokens?.get(String(targetTokenId ?? "")) ?? null;
  const targetActor = game.actors?.get(targetActorId) ?? token?.actor ?? null;

  if (!targetActor) {
    ui.notifications?.warn?.("Target actor for healing was not found.");
    return;
  }

  const value = Math.max(0, Number(amount ?? 0) || 0);
  const current = Number(targetActor?.system?.Health?.value ?? 0) || 0;
  const max = Number(targetActor?.system?.Health?.max ?? 0) || 0;
  const rawNext = current + value;
  const next = max > 0 ? Math.min(max, rawNext) : rawNext;
  const healed = Math.max(0, next - current);

  await targetActor.update({ "system.Health.value": next });

  const effectThreshold = Number(consumableSnapshot?.system?.EffectThreshold ?? 0) || 0;
  const total = Number(rollTotal ?? 0) || 0;
  if (consumableSnapshot?.system?.Effects && total > effectThreshold) {
    await applySpellEffects({
      casterActor: sourceActor ?? targetActor,
      targetActor,
      spellItem: consumableSnapshot,
      attackTotal: total,
      silent: true
    });
  }

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

  if (shouldPostHpChatLog(targetActor)) {
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
}

async function gmApplyEffectsOnly({ sourceActorId, targetActorId, targetTokenId, rollTotal, consumableSnapshot } = {}) {
  const sourceActor = game.actors?.get(sourceActorId) ?? null;
  const token = canvas.tokens?.get(String(targetTokenId ?? "")) ?? null;
  const targetActor = game.actors?.get(targetActorId) ?? token?.actor ?? null;

  if (!targetActor) {
    ui.notifications?.warn?.("Target actor for consumable effects was not found.");
    return;
  }

  const effectThreshold = Number(consumableSnapshot?.system?.EffectThreshold ?? 0) || 0;
  const total = Number(rollTotal ?? 0) || 0;
  if (!consumableSnapshot?.system?.Effects || total <= effectThreshold) return;

  await applySpellEffects({
    casterActor: sourceActor ?? targetActor,
    targetActor,
    spellItem: consumableSnapshot,
    attackTotal: total,
    silent: true
  });
}

async function handleGMRequest(payload) {
  const type = String(payload?.type || "");

  if (type === "APPLY_CONSUMABLE_HEAL") {
    await gmApplyHealing(payload);
    return;
  }

  if (type === "APPLY_CONSUMABLE_EFFECTS_ONLY") {
    await gmApplyEffectsOnly(payload);
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

  const baseDamage = Number(consumableItem?.system?.Damage ?? 0) || 0;
  let roll = null;

  let execute = null;

  if (kind === CONSUMABLE_KIND.DOPING) {
    roll = await rollConsumableUse(actor, consumableItem);
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
      let healValue = Math.max(0, Math.abs(Number(baseDamage) || 0));
      if (healValue <= 0) {
        const healFormula = String(consumableItem?.system?.DamageFormula ?? "").trim();
        if (healFormula) {
          healValue = Math.max(0, Number(evaluateDamageFormula(healFormula, actor, consumableItem)) || 0);
        }
      }

      if (healValue <= 0) {
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
          amount: healValue,
          rollTotal: Number(roll?.total ?? 0) || 0,
          consumableSnapshot: buildConsumableEffectSnapshot(consumableItem)
        });
      };
    } else {
      const target = getHealTarget(actor);
      if (!target?.targetActor) {
        ui.notifications?.warn?.("Цель для применения расходника не найдена.");
        return;
      }

      execute = async () => {
        await emitToGM({
          type: "APPLY_CONSUMABLE_EFFECTS_ONLY",
          sourceActorId: actor.id,
          targetActorId: target.targetActor.id,
          targetTokenId: target.targetToken?.id ?? null,
          rollTotal: Number(roll?.total ?? 0) || 0,
          consumableSnapshot: buildConsumableEffectSnapshot(consumableItem)
        });
        await postUtilityMessage({ actor, item: consumableItem, roll, subtype, targetName: target.targetActor?.name ?? "" });
      };
    }
  }

  let consumeAfterExecute = false;

  if (kind === CONSUMABLE_KIND.GRENADE) {
    const rollFormulaRaw = await chooseConsumableRollFormula({ consumableItem });
    roll = await rollConsumableUseWithFormula(actor, consumableItem, rollFormulaRaw);

    const attackerToken = getPreferredAttackerToken(actor);
    if (!attackerToken) {
      ui.notifications?.warn?.("Выберите свой токен, чтобы бросить гранату.");
      return;
    }

    const delivery = getConsumableDeliveryType(consumableItem);
    const grenadeProxy = createGrenadeWorkflowProxy(consumableItem);
    const rollFormulaValue = Number(roll?._orderRollFormulaValue ?? 0) || 0;
    const natD20 = getD20Result(roll);
    consumeAfterExecute = true;

    if (delivery === "save-check") {
      const targetCount = Array.from(game.user?.targets ?? []).length;
      if (targetCount !== 1) {
        ui.notifications?.warn?.("Для гранаты с проверкой цели нужно выбрать ровно 1 цель.");
        return;
      }
      if (!canResolveGrenadeSaveConfig(actor, consumableItem)) return;

      execute = async () => {
        return !!(await startSpellSaveWorkflow({
          casterActor: actor,
          casterToken: attackerToken,
          spellItem: grenadeProxy,
          castRoll: roll,
          rollMode: "normal",
          manualMod: 0,
          rollFormulaRaw,
          rollFormulaValue
        }));
      };
    } else if (delivery === "mass-save-check") {
      if (getGrenadeAreaSize(consumableItem) <= 0) {
        ui.notifications?.warn?.("Для массовой проверки у гранаты должен быть задан размер области больше 0.");
        return;
      }
      if (!canResolveGrenadeSaveConfig(actor, consumableItem)) return;

      execute = async () => {
        return !!(await startSpellMassSaveWorkflow({
          casterActor: actor,
          casterToken: attackerToken,
          spellItem: grenadeProxy,
          castRoll: roll,
          rollMode: "normal",
          manualMod: 0,
          rollFormulaRaw,
          rollFormulaValue
        }));
      };
    } else {
      if (getGrenadeAreaSize(consumableItem) <= 0) {
        ui.notifications?.warn?.("Для гранаты должен быть задан размер области больше 0.");
        return;
      }

      const { targetTokenIds } = await collectItemAoETargetIds({
        item: grenadeProxy,
        casterToken: attackerToken,
        dialogTitle: "Цели гранаты",
        itemTypeLabel: "гранаты"
      });

      const targetTokens = (Array.isArray(targetTokenIds) ? targetTokenIds : [])
        .map((id) => canvas.tokens?.get?.(String(id)))
        .filter(Boolean);

      if (!targetTokens.length) {
        ui.notifications?.warn?.("Не выбрано ни одной цели для гранаты.");
        return;
      }

      execute = async () => {
        await createRangedAoEAttackMessage({
          attackerActor: actor,
          attackerToken,
          targetTokens,
          weapon: grenadeProxy,
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
        return true;
      };
    }
  }

  if (typeof execute !== "function") return;

  if (consumeAfterExecute) {
    const ok = await execute();
    if (ok === false) return;
    const consumed = await consumeOne(consumableItem);
    if (!consumed) return;
    return;
  }

  const consumed = await consumeOne(consumableItem);
  if (!consumed) return;

  await execute();
}
