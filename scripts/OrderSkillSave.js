import { buildCombatRollFlavor } from "./OrderRollFlavor.js";
import { evaluateDamageFormula } from "./OrderDamageFormula.js";
import { getDefenseD20Formula, promptDefenseRollSetup } from "./OrderDefenseRollDialog.js";

const FLAG_SCOPE = "Order";
const FLAG_SAVE = "skillSave";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}


function getBaseImpactFromSystem(sys) {
  const amount = Math.max(0, Number(sys?.Damage ?? 0) || 0);
  const mode = String(sys?.DamageMode || "damage").toLowerCase() === "heal" ? "heal" : "damage";
  return { amount, mode, signed: mode === "heal" ? -amount : amount };
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getCharacteristicValueAndMods(actor, key) {
  const sys = getSystem(actor);
  const obj = sys?.[key] ?? null;
  const value = Number(obj?.value ?? 0) || 0;

  const localModsArray = obj?.modifiers ?? [];
  const localSum = Array.isArray(localModsArray)
    ? localModsArray.reduce((acc, m) => acc + (Number(m?.value) || 0), 0)
    : 0;

  const globalModsArray = sys?.MaxModifiers ?? [];
  const globalSum = Array.isArray(globalModsArray)
    ? globalModsArray.reduce((acc, m) => {
      const v = Number(m?.value) || 0;
      const k = m?.characteristic ?? m?.Characteristic ?? m?.key ?? null;
      return String(k) === String(key) ? acc + v : acc;
    }, 0)
    : 0;

  return { value, mods: localSum + globalSum };
}

function normalizeFormula(raw) {
  const f = String(raw ?? "").trim();
  return f
    .replace(/магия/gi, "Magic")
    .replace(/ловкость/gi, "Dexterity")
    .replace(/выносливость/gi, "Stamina")
    .replace(/сила/gi, "Strength")
    .replace(/знания/gi, "Knowledge")
    .replace(/\s+/g, " ")
    .trim();
}

function substituteStatsInFormula(formula, actor) {
  let out = normalizeFormula(formula);
  const stats = ["Magic", "Dexterity", "Stamina", "Strength", "Knowledge", "Will", "Accuracy", "Charisma", "Faith", "Medicine", "Stealth", "Leadership", "Seduction"];

  for (const stat of stats) {
    const { value, mods } = getCharacteristicValueAndMods(actor, stat);
    const total = (Number(value) || 0) + (Number(mods) || 0);
    const rep = total < 0 ? `(${total})` : String(total);
    out = out.replace(new RegExp(`\\b${stat}\\b`, "g"), rep);
  }
  return out;
}

function parseDCFormula(dcFormula, casterActor, skillItem) {
  const f = String(dcFormula ?? "").trim();
  if (!f) return NaN;

  const val = evaluateDamageFormula(f, casterActor, skillItem);
  return Number.isFinite(val) ? val : NaN;
}

async function rollActorCharacteristic(actor, key, { rollMode = "normal", manualModifier = 0 } = {}) {
  const sys = getSystem(actor);
  const obj = sys?.[key] ?? {};
  const value = Number(obj?.value ?? 0) || 0;

  const localMods = Array.isArray(obj?.modifiers)
    ? obj.modifiers.reduce((acc, m) => acc + (Number(m?.value) || 0), 0)
    : 0;

  const globalMods = Array.isArray(sys?.MaxModifiers)
    ? sys.MaxModifiers.reduce((acc, m) => {
      const v = Number(m?.value) || 0;
      const k = m?.characteristic ?? m?.Characteristic ?? m?.key ?? null;
      return String(k) === String(key) ? acc + v : acc;
    }, 0)
    : 0;

  let formula = getDefenseD20Formula(rollMode);
  if (value) formula += value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`;
  const mods = localMods + globalMods;
  if (mods) formula += mods > 0 ? ` + ${mods}` : ` - ${Math.abs(mods)}`;
  if (manualModifier) formula += manualModifier > 0 ? ` + ${manualModifier}` : ` - ${Math.abs(manualModifier)}`;

  const roll = await new Roll(formula).roll({ async: true });
  return roll;
}

/* ----------------------------- Handlers + Bus ----------------------------- */

export function registerOrderSkillSaveHandlers() {
  $(document)
    .off("click.order-skill-save-roll")
    .on("click.order-skill-save-roll", ".order-skill-save-roll", onSaveRollClick);

  $(document)
    .off("click.order-skill-save-apply")
    .on("click.order-skill-save-apply", ".order-skill-save-apply", onApplyClick);

  console.log("OrderSkillSave | Handlers registered");
}

export function registerOrderSkillSaveBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;
      const bus = message.getFlag("Order", "skillBus");
      if (!bus) return;
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderSkillSave | BUS handler error", e);
    }
  });

  console.log("OrderSkillSave | BUS listener registered");
}

async function emitToGM(payload) {
  if (game.user.isGM) return handleGMRequest(payload);

  const gmIds = game.users?.filter(u => u.isGM && u.active).map(u => u.id) ?? [];
  if (!gmIds.length) {
    ui.notifications.error("Не найден GM для отправки запроса.");
    return;
  }

  await ChatMessage.create({
    content: `<p>Шина навыка: ${payload.type}</p>`,
    whisper: gmIds,
    flags: { Order: { skillBus: { payload } } }
  });
}

async function handleGMRequest(payload) {
  const type = payload?.type;
  if (!type) return;

  if (type === "RESOLVE_SKILL_SAVE") return gmResolveSkillSave(payload);
  if (type === "APPLY_SKILL_SAVE_DAMAGE") return gmApplySkillSaveDamage(payload);
}

/* ----------------------------- Entry point ----------------------------- */

export async function startSkillSaveWorkflow({
  casterActor,
  casterToken,
  skillItem,
  pipelineMode = false,
  targetTokenOverride = null
}) {
  const s = getSystem(skillItem);
  const delivery = String(s.DeliveryType || "utility").trim().toLowerCase();
  if (!pipelineMode && delivery !== "save-check") return false;

  let targetToken = targetTokenOverride ?? null;
  if (targetToken && typeof targetToken === "string") {
    targetToken = canvas.tokens.get(String(targetToken)) ?? null;
  }

  if (!targetToken) {
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length !== 1) {
      ui.notifications.warn("Для навыка с проверкой нужно выбрать ровно 1 цель (target).");
      return false;
    }
    targetToken = targets[0];
  }

  const targetActor = targetToken?.actor;
  if (!targetActor) {
    ui.notifications.warn("Цель не имеет актёра.");
    return false;
  }

  const saveAbility = String(s.SaveAbility || "").trim();
  if (!saveAbility) {
    ui.notifications.warn("У навыка не задана характеристика проверки (SaveAbility).");
    return false;
  }

  const dcFormulaRaw = String(s.SaveDCFormula || "").trim();
  const dcFormula = (dcFormulaRaw.includes(",")
    ? (dcFormulaRaw.split(",").map(t => t.trim()).filter(Boolean).pop() || "")
    : dcFormulaRaw
  );

  const dc = parseDCFormula(dcFormula, casterActor, skillItem);

  if (!Number.isFinite(dc)) {
    ui.notifications.warn(`Не удалось вычислить DC из формулы: "${dcFormula}".`);
    return false;
  }

  const impact = getBaseImpactFromSystem(s);
  let baseDamage = impact.signed;
  const perkSkillDmg = Number(casterActor?.system?._perkBonuses?.SkillDamage ?? 0) || 0;
  if (impact.mode === "damage" && perkSkillDmg) baseDamage += perkSkillDmg;

  const ctx = {
    casterTokenId: casterToken?.id ?? null,
    casterActorId: casterActor?.id ?? null,

    targetTokenId: targetToken?.id ?? null,
    targetActorId: targetActor?.id ?? null,

    skillId: skillItem?.id ?? null,
    skillName: skillItem?.name ?? "",
    skillImg: skillItem?.img ?? "",

    saveAbility,
    dcFormula,
    dc,

    baseDamage,
    damageMode: impact.mode,
    state: "awaitingSave",
    createdAt: Date.now()
  };

  const content = `
    <div class="order-skill-save-card">
      <div style="display:flex; gap:8px; align-items:center;">
        <img src="${ctx.skillImg}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${ctx.skillName}</h3>
      </div>

      <p><strong>Использующий:</strong> ${casterToken?.name ?? casterActor.name}</p>
      <p><strong>Цель:</strong> ${targetToken?.name ?? targetActor.name}</p>
      <p><strong>Проверка цели:</strong> ${game.i18n.localize(saveAbility)}</p>
      <p><strong>Сложность (DC):</strong> ${dc} <span style="opacity:.8;">(${escapeHtml(dcFormula)})</span></p>

      ${baseDamage ? `<p><strong>Базовое ${impact.mode === "heal" ? "лечение" : "урон"}:</strong> ${Math.abs(baseDamage)}</p>` : ""}

      <hr/>
      <button class="order-skill-save-roll">Сделать проверку (${game.i18n.localize(saveAbility)})</button>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { Order: { [FLAG_SAVE]: ctx } }
  });

  return true;
}

/* ----------------------------- UI handlers ----------------------------- */

async function onSaveRollClick(event) {
  event.preventDefault();

  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_SAVE);
  if (!ctx) return ui.notifications.error("В сообщении нет контекста save-check.");

  if (ctx.state !== "awaitingSave") {
    ui.notifications.warn("Эта проверка уже разрешена.");
    return;
  }

  const targetToken = canvas.tokens.get(ctx.targetTokenId);
  const targetActor = targetToken?.actor ?? game.actors.get(ctx.targetActorId);
  if (!targetActor) return ui.notifications.error("Не найден актёр цели.");

  if (!(game.user.isGM || targetActor.isOwner)) {
    ui.notifications.warn("Проверку может сделать только владелец цели (или GM).");
    return;
  }

  const defenseSetup = await promptDefenseRollSetup({
    title: `Защитный бросок: ${ctx.saveAbility || "Save"}`
  });
  if (!defenseSetup) return;

  const roll = await rollActorCharacteristic(targetActor, ctx.saveAbility, {
    rollMode: defenseSetup.rollMode,
    manualModifier: defenseSetup.manualModifier
  });
  const total = Number(roll.total ?? 0);

  await emitToGM({
    type: "RESOLVE_SKILL_SAVE",
    messageId,
    saveTotal: total
  });
}

async function onApplyClick(event) {
  event.preventDefault();
  const mode = event.currentTarget.dataset.mode; // armor | pierce

  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const dmgCtx = message?.getFlag("Order", "skillSaveDamage");
  if (!dmgCtx) return ui.notifications.error("В сообщении нет контекста урона save-check.");

  const casterToken = canvas.tokens.get(dmgCtx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(dmgCtx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить урон/лечение может GM или владелец использующего.");
  }

  await emitToGM({
    type: "APPLY_SKILL_SAVE_DAMAGE",
    sourceMessageId: dmgCtx.sourceMessageId,
    targetTokenId: dmgCtx.targetTokenId,
    baseDamage: dmgCtx.baseDamage,
    mode
  });
}

/* ----------------------------- GM resolve/apply ----------------------------- */

async function gmResolveSkillSave({ messageId, saveTotal }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_SAVE);
  if (!message || !ctx) return;

  if (ctx.state === "resolved") return;

  const dc = Number(ctx.dc ?? 0) || 0;
  const total = Number(saveTotal ?? 0) || 0;
  const success = total >= dc;

  await message.update({
    [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.state`]: "resolved",
    [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.saveTotal`]: total,
    [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.success`]: success
  });

  const targetToken = canvas.tokens.get(ctx.targetTokenId);
  const targetActor = targetToken?.actor ?? game.actors.get(ctx.targetActorId);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor, token: targetToken }),
    content: `<p><strong>${targetToken?.name ?? targetActor?.name ?? "Цель"}</strong> делает проверку: ${total} против DC ${dc} → <strong>${success ? "УСПЕХ" : "ПРОВАЛ"}</strong>.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });

  const baseDamage = Number(ctx.baseDamage ?? 0) || 0;
  if (!baseDamage) return;

  if (success) return;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: ctx.casterActorId ? game.actors.get(ctx.casterActorId) : null }),
    content: `
      <div class="order-skill-save-apply-card">
        <p><strong>Применить результат навыка:</strong> ${ctx.skillName}</p>
        <p><strong>Цель:</strong> ${targetToken?.name ?? targetActor?.name ?? "—"}</p>
        <p><strong>База (${String(ctx.damageMode || "damage") === "heal" ? "лечение" : "урон"}):</strong> ${Math.abs(baseDamage)}</p>
        <button class="order-skill-save-apply" data-mode="armor">${String(ctx.damageMode || "damage") === "heal" ? "Применить лечение" : "Урон с учётом брони"}</button>
        ${String(ctx.damageMode || "damage") === "heal" ? "" : `<button class="order-skill-save-apply" data-mode="pierce">Урон сквозь броню</button>`}
      </div>
    `,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      Order: {
        skillSaveDamage: {
          sourceMessageId: messageId,
          casterTokenId: ctx.casterTokenId,
          casterActorId: ctx.casterActorId,
          targetTokenId: ctx.targetTokenId,
          baseDamage,
          damageMode: ctx.damageMode || "damage"
        }
      }
    }
  });
}

async function gmApplySkillSaveDamage({ sourceMessageId, targetTokenId, baseDamage, damageMode, mode }) {
  // anti double apply
  if (sourceMessageId) {
    const src = game.messages.get(sourceMessageId);
    const ctx = src?.getFlag(FLAG_SCOPE, FLAG_SAVE);
    if (ctx?.damageApplied) return;
    if (src) await src.update({ [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.damageApplied`]: true });
  }

  const token = canvas.tokens.get(targetTokenId);
  const actor = token?.actor;
  if (!token || !actor) return;

  const raw = Number(baseDamage ?? 0) || 0;
  const isHeal = String(damageMode || "damage") === "heal";

  // armor only affects damage
  if (isHeal) {
    const heal = Math.abs(raw);
    const sys = getSystem(actor);
    const cur = Number(sys?.Health?.value ?? 0) || 0;
    const max = Number(sys?.Health?.max ?? 0) || 0;
    const next = max ? Math.min(max, cur + heal) : (cur + heal);
    await actor.update({ "system.Health.value": next });

    canvas.interface.createScrollingText(token.center, `+${heal}`, { fontSize: 32, strokeThickness: 4 });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${token.name}</strong> получает лечение: <strong>${heal}</strong>.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
    return;
  }

  const armor = (mode === "armor")
    ? (actor?.items?.contents ?? []).reduce((best, it) => {
      if (!it || it.type !== "Armor") return best;
      const sys = getSystem(it);
      if (!(sys?.isEquiped && sys?.isUsed)) return best;
      const v = Number(sys?.Deffensepotential ?? 0) || 0;
      return Math.max(best, v);
    }, 0)
    : 0;

  const applied = Math.max(0, raw - armor);
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0) || 0;
  const next = Math.max(0, cur - applied);
  await actor.update({ "system.Health.value": next });

  canvas.interface.createScrollingText(token.center, `-${applied}`, { fontSize: 32, strokeThickness: 4 });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${token.name}</strong> получает урон: <strong>${applied}</strong>${mode === "armor" ? ` (броня ${armor})` : " (сквозь броню)"}.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

