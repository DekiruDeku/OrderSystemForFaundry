import { collectItemAoETargetIds } from "./OrderItemAoE.js";
import { applySpellEffects } from "./OrderSpellEffects.js";
import { evaluateDamageFormula } from "./OrderDamageFormula.js";
import { getDefenseD20Formula, promptDefenseRollSetup } from "./OrderDefenseRollDialog.js";

const FLAG_SCOPE = "Order";
const FLAG_MASS_SAVE = "skillMassSave";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getBaseImpactFromSystem(sys) {
  const amount = Math.max(0, Number(sys?.Damage ?? 0) || 0);
  const mode = String(sys?.DamageMode || "damage").toLowerCase() === "heal" ? "heal" : "damage";
  return { amount, mode, signed: mode === "heal" ? -amount : amount };
}

function parseDCFormula(formula, casterActor, skillItem) {
  const f = String(formula ?? "").trim();
  if (!f) return NaN;
  const val = evaluateDamageFormula(f, casterActor, skillItem);
  return Number.isFinite(val) ? val : NaN;
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

async function rollActorCharacteristic(actor, attribute, { rollMode = "normal", manualModifier = 0 } = {}) {
  const { value, mods } = getCharacteristicValueAndMods(actor, attribute);

  const parts = [getDefenseD20Formula(rollMode)];
  if (value) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
  if (mods) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
  if (manualModifier) parts.push(manualModifier > 0 ? `+ ${manualModifier}` : `- ${Math.abs(manualModifier)}`);

  return new Roll(parts.join(" ")).roll({ async: true });
}

function getArmorValueFromItems(actor) {
  const items = actor?.items ?? [];
  const equipped = items.filter((i) => {
    if (!i) return false;
    if (i.type !== "Armor") return false;
    const sys = i.system ?? i.data?.system ?? {};
    return !!(sys?.isEquiped && sys?.isUsed);
  });

  let best = 0;
  for (const a of equipped) {
    const sys = a.system ?? a.data?.system ?? {};
    const val = Number(sys?.Deffensepotential ?? 0) || 0;
    if (val > best) best = val;
  }
  return best + (Number(actor?.system?._perkBonuses?.Armor ?? 0) || 0);
}

async function applyDamage(actor, amount) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0);
  const next = Math.max(0, cur - (Number(amount) || 0));
  await actor.update({ "system.Health.value": next });
}

async function applyHeal(actor, amount) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0);
  const max = Number(sys?.Health?.max ?? 0);
  const rawNext = cur + (Number(amount) || 0);
  const next = max > 0 ? Math.min(rawNext, max) : rawNext;
  await actor.update({ "system.Health.value": next });
}

function getUnresolvedCount(ctx) {
  const perTarget = (ctx?.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};
  return Object.values(perTarget).filter((entry) => String(entry?.state) !== "resolved").length;
}

function getFailedTargetIds(ctx) {
  const ids = Array.isArray(ctx?.targetTokenIds) ? ctx.targetTokenIds.map((x) => String(x)) : [];
  if (!ids.length) return [];

  const perTarget = (ctx?.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};
  return ids.filter((id) => {
    const entry = perTarget[id];
    return entry && String(entry.state) === "resolved" && entry.success === false;
  });
}

function renderResultCell(entry) {
  if (!entry || String(entry.state) !== "resolved") {
    return `<span class="order-aoe-result order-aoe-result--pending">—</span>`;
  }

  const total = Number(entry.saveTotal ?? 0) || 0;
  // In AoE palette: miss=green (target defended), hit=red (target failed defense).
  const cls = entry.success ? "order-aoe-result--miss" : "order-aoe-result--hit";
  return `<span class="order-aoe-result ${cls}" title="${entry.success ? "Успех сейва" : "Провал сейва"}">${total}</span>`;
}

function renderAppliedEffectsSummary(ctx) {
  if (!ctx?.effectsApplied) return "";

  const rows = Array.isArray(ctx?.effectsSummary?.rows) ? ctx.effectsSummary.rows : [];
  if (!rows.length) {
    return `<p><strong>Применённые эффекты:</strong> нет целей, не прошедших проверку.</p>`;
  }

  const body = rows.map((row) => {
    const targetName = escapeHtml(row?.targetName ?? "—");
    const logs = Array.isArray(row?.appliedLogs) ? row.appliedLogs : [];
    const logsHtml = logs.length
      ? logs.map((line) => `<div>${escapeHtml(line)}</div>`).join("")
      : `<div style="opacity:.8;">Нет эффектов для применения.</div>`;

    return `
      <div style="padding:6px 8px; border:1px solid rgba(255,255,255,.15); border-radius:6px;">
        <div><strong>${targetName}</strong></div>
        ${logsHtml}
      </div>
    `;
  }).join("");

  return `
    <div class="order-mass-save-effects-summary">
      <p><strong>Применённые эффекты:</strong></p>
      <div style="display:grid; gap:6px;">${body}</div>
    </div>
  `;
}

function renderContent(ctx) {
  const skillImg = String(ctx?.skillImg ?? "");
  const skillName = String(ctx?.skillName ?? "Массовая проверка");
  const saveAbility = String(ctx?.saveAbility ?? "");
  const dc = Number(ctx?.dc ?? 0) || 0;
  const dcFormula = String(ctx?.dcFormula ?? "");
  const unresolved = getUnresolvedCount(ctx);
  const failedCount = getFailedTargetIds(ctx).length;
  const baseDamage = Number(ctx?.baseDamage ?? 0) || 0;
  const isHeal = String(ctx?.damageMode || "damage") === "heal";
  const damageApplied = !!ctx?.damageApplied;
  const effectsApplied = !!ctx?.effectsApplied;
  const effectsSummaryHtml = renderAppliedEffectsSummary(ctx);

  const targets = Array.isArray(ctx?.targets) ? ctx.targets : [];
  const perTarget = (ctx?.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};

  const rows = targets.map((t) => {
    const tokenId = String(t.tokenId);
    const entry = perTarget[tokenId] || {};
    const disabled = String(entry.state) === "resolved" ? "disabled" : "";

    return `
      <div class="order-aoe-row" data-token-id="${tokenId}">
        <div class="order-aoe-left">
          <img class="order-aoe-portrait" src="${t.tokenImg ?? ""}" />
          <span class="order-aoe-name">${escapeHtml(t.tokenName ?? "—")}</span>
        </div>
        <div class="order-aoe-right">
          ${renderResultCell(entry)}
          <div class="order-aoe-actions">
            <button
              class="order-skill-mass-save-roll order-aoe-btn"
              data-target-token-id="${tokenId}"
              title="Проверка (${escapeHtml(game.i18n.localize(saveAbility))})"
              ${disabled}
            ><i class="fas fa-dice-d20"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="chat-attack-message order-ranged order-aoe" data-order-skill-mass-save="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${skillImg}" alt="${escapeHtml(skillName)}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${escapeHtml(skillName)}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Использующий:</strong> ${escapeHtml(resolveCasterName(ctx))}</p>
        <p><strong>Проверка цели:</strong> ${escapeHtml(game.i18n.localize(saveAbility))}</p>
        <p><strong>Сложность (DC):</strong> ${dc} <span style="opacity:.8;">(${escapeHtml(dcFormula)})</span></p>
        ${baseDamage ? `<p><strong>Базовое ${isHeal ? "лечение" : "урон"}:</strong> ${Math.abs(baseDamage)}</p>` : ""}
        <p><strong>Статус проверок:</strong> ${unresolved ? `ожидаются (${unresolved})` : "завершены"}; непрошли: ${failedCount}</p>
      </div>

      <hr/>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="order-skill-mass-save-apply" ${damageApplied ? "disabled" : ""}>${isHeal ? "Лечение непрошедшим" : "Урон по непрошедшим"}</button>
        <button class="order-skill-mass-save-effects" ${effectsApplied ? "disabled" : ""}>Эффекты непрошедшим</button>
      </div>

      ${effectsSummaryHtml ? `<hr/>${effectsSummaryHtml}` : ""}

      <hr/>

      <div class="order-aoe-targets">
        <div class="order-aoe-head">
          <span>Цель</span>
          <span class="order-aoe-head-right">Сейв</span>
        </div>
        ${rows || `<div class="order-aoe-empty">Нет целей</div>`}
      </div>
    </div>
  `;
}

function resolveCasterName(ctx) {
  const casterToken = ctx?.casterTokenId ? canvas.tokens.get(ctx.casterTokenId) : null;
  const casterActor = casterToken?.actor ?? (ctx?.casterActorId ? game.actors.get(ctx.casterActorId) : null);
  return casterToken?.name ?? casterActor?.name ?? "—";
}

function getTargetActorFromCtx(ctx, tokenId) {
  const actorId = ctx?.targets?.find((t) => String(t.tokenId) === String(tokenId))?.actorId;
  return actorId ? game.actors.get(actorId) : null;
}

async function emitToGM(payload) {
  if (game.user.isGM) return handleGMRequest(payload);

  const gmIds = game.users?.filter((u) => u.isGM && u.active).map((u) => u.id) ?? [];
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

  if (type === "RESOLVE_SKILL_MASS_SAVE_TARGET") return gmResolveTargetSave(payload);
  if (type === "APPLY_SKILL_MASS_SAVE_DAMAGE") return gmApplyFailedDamage(payload);
  if (type === "APPLY_SKILL_MASS_SAVE_EFFECTS") return gmApplyFailedEffects(payload);
}

export function registerOrderSkillMassSaveHandlers() {
  $(document)
    .off("click.order-skill-mass-save-roll")
    .on("click.order-skill-mass-save-roll", ".order-skill-mass-save-roll", onTargetSaveRollClick);

  $(document)
    .off("click.order-skill-mass-save-apply")
    .on("click.order-skill-mass-save-apply", ".order-skill-mass-save-apply", onApplyDamageClick);

  $(document)
    .off("click.order-skill-mass-save-effects")
    .on("click.order-skill-mass-save-effects", ".order-skill-mass-save-effects", onApplyEffectsClick);

  console.log("OrderSkillMassSave | Handlers registered");
}

export function registerOrderSkillMassSaveBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;
      const bus = message.getFlag("Order", "skillBus");
      if (!bus) return;
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderSkillMassSave | BUS handler error", e);
    }
  });

  console.log("OrderSkillMassSave | BUS listener registered");
}

export async function startSkillMassSaveWorkflow({
  casterActor,
  casterToken,
  skillItem,
  pipelineMode = false,
  pipelineContinuation = null
} = {}) {
  if (!casterActor || !skillItem) return false;

  const s = getSystem(skillItem);
  const delivery = String(s.DeliveryType || "utility").trim().toLowerCase();
  if (!pipelineMode && delivery !== "mass-save-check") return false;

  const saveAbility = String(s.SaveAbility || "").trim();
  if (!saveAbility) {
    ui.notifications?.warn?.("У навыка не задана характеристика проверки (SaveAbility).");
    return false;
  }

  const dcFormulaRaw = String(s.SaveDCFormula || "").trim();
  const dcFormula = (dcFormulaRaw.includes(",")
    ? (dcFormulaRaw.split(",").map((t) => t.trim()).filter(Boolean).pop() || "")
    : dcFormulaRaw
  );
  const dc = parseDCFormula(dcFormula, casterActor, skillItem);
  if (!Number.isFinite(dc)) {
    ui.notifications.warn(`Не удалось вычислить DC из формулы: "${dcFormula}".`);
    return false;
  }

  const { targetTokenIds } = await collectItemAoETargetIds({
    item: skillItem,
    casterToken,
    dialogTitle: "Цели навыка",
    itemTypeLabel: "навыка"
  });

  const targets = (Array.isArray(targetTokenIds) ? targetTokenIds : [])
    .map((id) => canvas.tokens.get(String(id)))
    .filter((t) => !!t);

  if (!targets.length) {
    ui.notifications?.warn?.("Не выбрано ни одной цели для массовой проверки.");
    return false;
  }

  const impact = getBaseImpactFromSystem(s);
  let baseDamage = impact.signed;
  const perkSkillDmg = Number(casterActor?.system?._perkBonuses?.SkillDamage ?? 0) || 0;
  if (impact.mode === "damage" && perkSkillDmg) baseDamage += perkSkillDmg;

  const targetsCtx = targets.map((token) => {
    const actor = token?.actor ?? null;
    return {
      tokenId: token?.id ?? null,
      tokenName: token?.name ?? actor?.name ?? "—",
      tokenImg: token?.document?.texture?.src ?? actor?.img ?? "",
      actorId: actor?.id ?? null
    };
  }).filter((t) => !!t.tokenId);

  const perTarget = {};
  for (const target of targetsCtx) {
    perTarget[String(target.tokenId)] = {
      state: "awaitingSave",
      saveTotal: null,
      success: null
    };
  }

  const ctx = {
    casterTokenId: casterToken?.id ?? null,
    casterActorId: casterActor?.id ?? null,
    skillId: skillItem?.id ?? null,
    skillName: skillItem?.name ?? "",
    skillImg: skillItem?.img ?? "",
    saveAbility,
    dcFormula,
    dc,
    baseDamage,
    damageMode: impact.mode,
    targetTokenIds: targetsCtx.map((t) => t.tokenId),
    targets: targetsCtx,
    perTarget,
    damageApplied: false,
    effectsApplied: false,
    effectsSummary: null,
    createdAt: Date.now()
  };

  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<div class="order-aoe-loading">Создаём массовую проверку...</div>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      Order: {
        [FLAG_MASS_SAVE]: ctx,
        ...(pipelineContinuation ? { pipelineContinuation } : {})
      }
    }
  });

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;

  await message.update({
    content: renderContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_MASS_SAVE}`]: ctx2
  });

  return true;
}

async function onTargetSaveRollClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const messageId = button.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение массовой проверки.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_MASS_SAVE);
  if (!ctx) return ui.notifications.error("Нет контекста массовой проверки.");

  const targetTokenId = String(button.dataset.targetTokenId || "");
  if (!targetTokenId) return ui.notifications.error("Не удалось определить цель проверки.");

  const entry = ctx?.perTarget?.[targetTokenId];
  if (!entry) return ui.notifications.warn("Эта цель не входит в массовую проверку.");
  if (String(entry.state) !== "awaitingSave") return ui.notifications.warn("Для этой цели проверка уже выполнена.");

  const targetToken = canvas.tokens.get(targetTokenId);
  const targetActor = targetToken?.actor ?? getTargetActorFromCtx(ctx, targetTokenId);
  if (!targetActor) return ui.notifications.error("Не найден актёр цели.");

  if (!(game.user.isGM || targetActor.isOwner)) {
    return ui.notifications.warn("Проверку может сделать только владелец цели (или GM).");
  }

  const defenseSetup = await promptDefenseRollSetup({
    title: `Защитный бросок: ${ctx.saveAbility || "Save"}`
  });
  if (!defenseSetup) return;

  const roll = await rollActorCharacteristic(targetActor, ctx.saveAbility, {
    rollMode: defenseSetup.rollMode,
    manualModifier: defenseSetup.manualModifier
  });

  await emitToGM({
    type: "RESOLVE_SKILL_MASS_SAVE_TARGET",
    messageId,
    targetTokenId,
    saveTotal: Number(roll?.total ?? 0) || 0
  });
}

async function onApplyDamageClick(event) {
  event.preventDefault();

  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_MASS_SAVE);
  if (!ctx) return ui.notifications.error("Нет контекста массовой проверки.");

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить урон может GM или владелец использующего.");
  }
  if (getUnresolvedCount(ctx) > 0) {
    return ui.notifications.warn("Сначала завершите все проверки по целям.");
  }

  await emitToGM({
    type: "APPLY_SKILL_MASS_SAVE_DAMAGE",
    messageId
  });
}

async function onApplyEffectsClick(event) {
  event.preventDefault();

  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_MASS_SAVE);
  if (!ctx) return ui.notifications.error("Нет контекста массовой проверки.");

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить эффекты может GM или владелец использующего.");
  }
  if (getUnresolvedCount(ctx) > 0) {
    return ui.notifications.warn("Сначала завершите все проверки по целям.");
  }

  await emitToGM({
    type: "APPLY_SKILL_MASS_SAVE_EFFECTS",
    messageId
  });
}

async function gmResolveTargetSave({ messageId, targetTokenId, saveTotal }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_MASS_SAVE);
  if (!message || !ctx) return;

  const tid = String(targetTokenId || "");
  if (!tid) return;

  const entry = ctx?.perTarget?.[tid];
  if (!entry) return;
  if (String(entry.state) === "resolved") return;

  const total = Number(saveTotal ?? 0) || 0;
  const dc = Number(ctx.dc ?? 0) || 0;
  const success = total >= dc;

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.perTarget = {
    ...(ctx2.perTarget || {}),
    [tid]: {
      ...entry,
      state: "resolved",
      saveTotal: total,
      success
    }
  };

  await message.update({
    content: renderContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_MASS_SAVE}`]: ctx2
  });
}

async function gmApplyFailedDamage({ messageId }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_MASS_SAVE);
  if (!ctx) return;
  if (ctx.damageApplied) return;
  if (getUnresolvedCount(ctx) > 0) {
    ui.notifications.warn("Нельзя применить урон: не все цели сделали проверку.");
    return;
  }

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const skillItem = casterActor.items.get(ctx.skillId);
  if (!skillItem) return ui.notifications.warn("Навык не найден у использующего.");

  const failedIds = getFailedTargetIds(ctx);
  const tokens = failedIds.map((id) => canvas.tokens.get(id)).filter(Boolean);

  const raw = Number(ctx.baseDamage ?? 0) || 0;
  const isHeal = String(ctx?.damageMode || "damage") === "heal";

  if (raw) {
    for (const token of tokens) {
      const actor = token.actor;
      if (!actor) continue;

      if (isHeal) {
        await applyHeal(actor, Math.abs(raw));
        canvas.interface.createScrollingText(token.center, `+${Math.abs(raw)}`, { fontSize: 32, strokeThickness: 4 });
        continue;
      }

      const armor = getArmorValueFromItems(actor);
      const applied = Math.max(0, raw - armor);
      await applyDamage(actor, applied);
      canvas.interface.createScrollingText(token.center, `-${applied}`, { fontSize: 32, strokeThickness: 4 });
    }
  }

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.damageApplied = true;
  await message.update({
    content: renderContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_MASS_SAVE}`]: ctx2
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<p><strong>${escapeHtml(skillItem.name)}</strong>: ${isHeal ? "лечение" : "урон"} по непрошедшим (${tokens.length}).</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

async function gmApplyFailedEffects({ messageId }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_MASS_SAVE);
  if (!ctx) return;
  if (ctx.effectsApplied) return;
  if (getUnresolvedCount(ctx) > 0) {
    ui.notifications.warn("Нельзя применить эффекты: не все цели сделали проверку.");
    return;
  }

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const skillItem = casterActor.items.get(ctx.skillId);
  if (!skillItem) return ui.notifications.warn("Навык не найден у использующего.");

  const failedIds = getFailedTargetIds(ctx);
  const tokens = failedIds.map((id) => canvas.tokens.get(id)).filter(Boolean);
  const appliedRows = [];

  for (const token of tokens) {
    const targetActor = token.actor;
    if (!targetActor) continue;
    const effectResult = await applySpellEffects({
      casterActor,
      targetActor,
      spellItem: skillItem,
      attackTotal: 0,
      silent: true
    });

    appliedRows.push({
      tokenId: token.id,
      targetName: token.name ?? targetActor.name ?? "—",
      appliedLogs: Array.isArray(effectResult?.appliedLogs)
        ? effectResult.appliedLogs.map((line) => String(line ?? "").trim()).filter(Boolean)
        : []
    });
  }

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.effectsApplied = true;
  ctx2.effectsSummary = { rows: appliedRows };
  await message.update({
    content: renderContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_MASS_SAVE}`]: ctx2
  });
}
