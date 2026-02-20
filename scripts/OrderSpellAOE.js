import { applySpellEffects } from "./OrderSpellEffects.js";
import { castDefensiveSpellDefense, getDefensiveReactionSpells } from "./OrderSpellDefenseReaction.js";
import { rollDefensiveSkillDefense, getDefensiveReactionSkills } from "./OrderSkillDefenseReaction.js";
import { buildCombatRollFlavor, formatSigned } from "./OrderRollFlavor.js";
import { pickTargetsDialog } from "./OrderMultiTargetPicker.js";

const FLAG_SCOPE = "Order";
const FLAG_AOE = "spellAoE";

function aoeDebugEnabled() {
  try { return !!game.settings.get("Order", "aoeDebug"); } catch { return false; }
}

function dbg(...args) {
  if (!aoeDebugEnabled()) return;
  console.log("[OrderSpellAoE]", ...args);
}


export function registerOrderSpellAoEHandlers() {
  $(document)
    .off("click.order-spell-aoe-defense")
    .on("click.order-spell-aoe-defense", ".order-spell-aoe-defense", onSpellAoEDefenseClick);

  $(document)
    .off("click.order-spell-aoe-apply")
    .on("click.order-spell-aoe-apply", ".order-spell-aoe-apply", onApplyAoEClick);

  $(document)
    .off("click.order-spell-aoe-effects")
    .on("click.order-spell-aoe-effects", ".order-spell-aoe-effects", onApplyAoEEffectsClick);

  console.log("OrderSpellAoE | Handlers registered");
}

export function registerOrderSpellAoEBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;
      const bus = message.getFlag("Order", "spellBus");
      if (!bus) return;
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderSpellAoE | BUS handler error", e);
    }
  });

  console.log("OrderSpellAoE | BUS listener registered");
}

/**
 * Entry point from OrderSpell.js after successful cast.
 */
export async function startSpellAoEWorkflow({
  casterActor,
  casterToken,
  spellItem,
  castRoll,
  rollMode = "normal",
  manualMod = 0,
  rollFormulaRaw = "",
  rollFormulaValue = 0,
  pipelineMode = false
}) {
  const s = getSystem(spellItem);
  const delivery = String(s.DeliveryType || "utility");
  if (!pipelineMode && delivery !== "aoe-template") return false;

  if (!canvas?.ready) {
    ui.notifications.warn("Сцена не готова.");
    return false;
  }

  const shape = normalizeAoEShape(String(s.AreaShape || "circle"));
  const shapeLabel = getAoEShapeLabel(shape);
  const size = Number(s.AreaSize ?? 0) || 0;
  if (!size) {
    ui.notifications.warn("У AoE заклинания не задан размер области (AreaSize).");
    return false;
  }

  const templateData = buildTemplateDataFromSpell({ casterToken, spellItem });
  const placed = await placeTemplateInteractively(templateData);
  if (!placed) {
    dbg("Template placement canceled.");
    return false;
  }

  const docId = placed.id;
  const templateObj = await waitForTemplateObject(docId);
  const targetsInTemplate = templateObj ? getTokensInTemplate(templateObj) : [];
  const pickedTargetIds = await pickTargetsDialog({
    title: "Цели заклинания",
    initialTokens: targetsInTemplate,
    allowAddTargets: true
  });
  const targets = (Array.isArray(pickedTargetIds) ? pickedTargetIds : [])
    .map((id) => canvas.tokens.get(String(id)))
    .filter((t) => !!t);

  const impact = getBaseImpactFromSystem(s);
  let baseDamage = impact.signed;
  const perkSpellDmg = Number(casterActor?.system?._perkBonuses?.SpellDamage ?? 0) || 0;
  if (impact.mode === "damage" && perkSpellDmg) baseDamage += perkSpellDmg;

  const castTotal = Number(castRoll?.total ?? 0) || 0;
  const nat20 = isNaturalTwenty(castRoll);
  const rollHTML = castRoll ? await castRoll.render() : "";
  const isHeal = impact.mode === "heal";
  const requiresDefense = !isHeal;
  const areaPersistent = !!s.AreaPersistent;

  const rollFormulaExtra = rollFormulaRaw
    ? [`формула: ${rollFormulaRaw} = ${formatSigned(rollFormulaValue)}`]
    : [];

  const cardFlavor = buildCombatRollFlavor({
    scene: "Магия",
    action: "Каст (AoE)",
    source: `Заклинание: ${spellItem?.name ?? "—"}`,
    rollMode,
    characteristic: rollFormulaRaw ? "формула" : "Magic",
    applyModifiers: true,
    manualMod: Number(manualMod) || 0,
    effectsMod: 0,
    extra: [...rollFormulaExtra, `шаблон: ${shapeLabel} (${size})`],
    isCrit: nat20
  });

  const targetsCtx = targets
    .map((token) => {
      const actor = token?.actor ?? null;
      return {
        tokenId: token?.id ?? null,
        tokenName: token?.name ?? actor?.name ?? "—",
        tokenImg: token?.document?.texture?.src ?? actor?.img ?? "",
        actorId: actor?.id ?? null,
        shieldInHand: actor ? actorHasEquippedWeaponTag(actor, "shield") : false
      };
    })
    .filter((t) => !!t.tokenId);

  const perTarget = {};
  for (const t of targetsCtx) {
    perTarget[String(t.tokenId)] = {
      state: requiresDefense ? "awaitingDefense" : "resolved",
      defenseType: null,
      defenseTotal: null,
      hit: requiresDefense ? null : true
    };
  }

  const ctx = {
    casterTokenId: casterToken?.id ?? null,
    casterActorId: casterActor?.id ?? null,
    spellId: spellItem?.id ?? null,
    spellName: spellItem?.name ?? "",
    spellImg: spellItem?.img ?? "",
    templateId: docId,
    shapeLabel,
    areaSize: size,

    attackTotal: castTotal,
    nat20,
    rollMode: rollMode ?? "normal",
    manualMod: Number(manualMod) || 0,
    rollFormulaRaw: String(rollFormulaRaw || ""),
    rollFormulaValue: Number(rollFormulaValue ?? 0) || 0,
    rollHTML,
    cardFlavor,

    requiresDefense,
    targetTokenIds: targetsCtx.map((t) => t.tokenId),
    targets: targetsCtx,
    perTarget,

    baseDamage,
    damageMode: impact.mode,
    damageApplied: false,
    effectsApplied: false,
    areaPersistent
  };

  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<div class="order-aoe-loading">Создаем AoE заклинание…</div>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { Order: { [FLAG_AOE]: ctx } }
  });

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;

  await message.update({
    content: renderSpellAoEContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_AOE}`]: ctx2
  });

  return true;
}

/* -------------------------------- UI -------------------------------- */

function renderSpellAoEResultCell(entry, { requiresDefense = true } = {}) {
  if (!requiresDefense) {
    return `<span class="order-aoe-result order-aoe-result--hit">Авто</span>`;
  }

  if (!entry || entry.state !== "resolved") {
    return `<span class="order-aoe-result order-aoe-result--pending">—</span>`;
  }

  const val = Number(entry.defenseTotal ?? 0) || 0;
  const miss = entry.hit === false;
  const cls = miss ? "order-aoe-result--miss" : "order-aoe-result--hit";
  const title = escapeHtml(formatDefenseEntryTitle(entry));
  return `<span class="order-aoe-result ${cls}" title="${title}">${val}</span>`;
}

function renderSpellAoEDefenseButtons({ tokenId, disabled = false, canBlock = false } = {}) {
  const dis = disabled ? "disabled" : "";
  const base = `class="order-spell-aoe-defense order-aoe-btn" data-defender-token-id="${tokenId}"`;

  return `
    <div class="order-aoe-actions">
      <button ${base} data-defense="dodge" title="Уворот (Dexterity)" ${dis}><i class="fas fa-person-running"></i></button>
      ${canBlock ? `<button ${base} data-defense="block-strength" title="Блок (Strength)" ${dis}><i class="fas fa-shield-halved"></i></button>` : ``}
      ${canBlock ? `<button ${base} data-defense="block-stamina" title="Блок (Stamina)" ${dis}><i class="fas fa-shield"></i></button>` : ``}
      <button ${base} data-defense="spell" title="Защита заклинанием" ${dis}><i class="fas fa-wand-magic-sparkles"></i></button>
      <button ${base} data-defense="skill" title="Защита навыком" ${dis}><i class="fas fa-hand-fist"></i></button>
    </div>
  `;
}

function renderSpellAoEContent(ctx) {
  const spellImg = ctx.spellImg ?? "";
  const spellName = ctx.spellName ?? "AoE";
  const attackTotal = Number(ctx.attackTotal ?? 0) || 0;
  const baseDamage = Number(ctx.baseDamage ?? 0) || 0;
  const isHeal = String(ctx.damageMode || "damage") === "heal";
  const nat20 = !!ctx.nat20;
  const rollHTML = String(ctx.rollHTML ?? "");
  const cardFlavor = String(ctx.cardFlavor ?? "");
  const requiresDefense = !!ctx.requiresDefense;
  const damageApplied = !!ctx.damageApplied;
  const effectsApplied = !!ctx.effectsApplied;

  const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
  const perTarget = (ctx.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};

  const rows = targets.map((t) => {
    const tokenId = String(t.tokenId);
    const entry = perTarget[tokenId] || {};
    const defenseDisabled = !requiresDefense || String(entry.state) === "resolved";

    return `
      <div class="order-aoe-row" data-token-id="${tokenId}">
        <div class="order-aoe-left">
          <img class="order-aoe-portrait" src="${t.tokenImg ?? ""}" />
          <span class="order-aoe-name">${escapeHtml(t.tokenName ?? "—")}</span>
        </div>
        <div class="order-aoe-right">
          ${renderSpellAoEResultCell(entry, { requiresDefense })}
          ${requiresDefense ? renderSpellAoEDefenseButtons({ tokenId, disabled: defenseDisabled, canBlock: !!t.shieldInHand }) : ""}
        </div>
      </div>
    `;
  }).join("");

  const unresolved = requiresDefense ? getUnresolvedDefenseCount(ctx) : 0;

  return `
    <div class="chat-attack-message order-ranged order-aoe" data-order-spell-aoe="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${spellImg}" alt="${escapeHtml(spellName)}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${escapeHtml(spellName)}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Кастер:</strong> ${escapeHtml(resolveCasterName(ctx))}</p>
        <p><strong>Шаблон:</strong> ${escapeHtml(ctx.shapeLabel || "—")} (${Number(ctx.areaSize ?? 0) || 0})</p>
        <p><strong>Результат каста:</strong> ${attackTotal}${nat20 ? ` <span style="color:#c00; font-weight:700;">[КРИТ]</span>` : ""}</p>
        ${baseDamage ? `<p><strong>Базовое ${isHeal ? "лечение" : "урон"}:</strong> ${Math.abs(baseDamage)}${nat20 ? ` <span class="order-aoe-x2">x2</span>` : ""}</p>` : ""}
        <p class="order-roll-flavor">${cardFlavor}</p>
        <div class="inline-roll">${rollHTML}</div>
      </div>

      <hr/>
      ${requiresDefense ? `<p><strong>Статус защит:</strong> ${unresolved ? `ожидаются (${unresolved})` : "завершены"}</p>` : `<p><strong>Статус защит:</strong> не требуется (лечение)</p>`}

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${baseDamage ? `<button class="order-spell-aoe-apply" data-mode="armor" ${damageApplied ? "disabled" : ""}>${isHeal ? "Лечение по области" : "Урон по попавшим"}</button>` : ""}
        ${baseDamage && !isHeal ? `<button class="order-spell-aoe-apply" data-mode="pierce" ${damageApplied ? "disabled" : ""}>Урон по попавшим сквозь броню</button>` : ""}
        <button class="order-spell-aoe-effects" ${effectsApplied ? "disabled" : ""}>${requiresDefense ? "Эффекты по попавшим" : "Эффекты по целям"}</button>
      </div>

      <hr/>

      <div class="order-aoe-targets">
        <div class="order-aoe-head">
          <span>Цель</span>
          <span class="order-aoe-head-right">Защита</span>
        </div>
        ${rows || `<div class="order-aoe-empty">Нет целей</div>`}
      </div>
    </div>
  `;
}

async function onSpellAoEDefenseClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const messageId = button.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение AoE.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return ui.notifications.error("Нет контекста AoE.");
  if (!ctx.requiresDefense) return ui.notifications.warn("Для этого AoE защита не требуется.");

  const defenderTokenId = String(button.dataset.defenderTokenId || "");
  if (!defenderTokenId) return ui.notifications.error("Не удалось определить цель защиты.");

  const entry = ctx?.perTarget?.[defenderTokenId];
  if (!entry) return ui.notifications.warn("Эта цель не входит в область.");
  if (String(entry.state) !== "awaitingDefense") return ui.notifications.warn("Для этой цели защита уже выбрана.");

  const defenderToken = canvas.tokens.get(defenderTokenId);
  const defenderActor = defenderToken?.actor ?? getTargetActorFromCtx(ctx, defenderTokenId);
  if (!defenderActor) return ui.notifications.error("Не найден актёр цели.");

  if (!(game.user.isGM || defenderActor.isOwner)) {
    return ui.notifications.warn("Защиту может выбрать только владелец цели (или GM).");
  }

  const defenseType = String(button.dataset.defense || "");

  if (defenseType === "spell") {
    const spellItem = await promptPickDefensiveSpell(defenderActor);
    if (!spellItem) return;

    const res = await castDefensiveSpellDefense({
      actor: defenderActor,
      token: defenderToken,
      spellItem,
      silent: true
    });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_SPELL_AOE_DEFENSE",
      messageId,
      defenderTokenId,
      defenseType: "spell",
      defenseTotal: res.defenseTotal,
      defenseSpellId: res.spellId,
      defenseSpellName: res.spellName,
      defenseCastFailed: res.castFailed,
      defenseCastTotal: res.castTotal
    });
    return;
  }

  if (defenseType === "skill") {
    const skillItem = await promptPickDefensiveSkill(defenderActor);
    if (!skillItem) return;

    const res = await rollDefensiveSkillDefense({
      actor: defenderActor,
      token: defenderToken,
      skillItem,
      scene: "Магия",
      toMessage: false
    });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_SPELL_AOE_DEFENSE",
      messageId,
      defenderTokenId,
      defenseType: "skill",
      defenseTotal: res.defenseTotal,
      defenseSkillId: res.skillId,
      defenseSkillName: res.skillName
    });
    return;
  }

  let defenseAttr = null;
  if (defenseType === "dodge") defenseAttr = "Dexterity";
  if (defenseType === "block-strength") defenseAttr = "Strength";
  if (defenseType === "block-stamina") defenseAttr = "Stamina";
  if (!defenseAttr) return;

  if (defenseType === "block-strength" || defenseType === "block-stamina") {
    const hasShield = actorHasEquippedWeaponTag(defenderActor, "shield");
    if (!hasShield) {
      return ui.notifications.warn("Блок доступен только при экипированном щите (tag: shield).");
    }
  }

  const defenseRoll = await rollActorCharacteristic(defenderActor, defenseAttr, {
    scene: "Магия",
    action: "Защита",
    source:
      defenseType === "dodge" ? "Уворот (Dexterity)" :
      defenseType === "block-strength" ? "Блок (Strength)" :
      "Блок (Stamina)",
    toMessage: false
  });

  await emitToGM({
    type: "RESOLVE_SPELL_AOE_DEFENSE",
    messageId,
    defenderTokenId,
    defenseType,
    defenseTotal: Number(defenseRoll?.total ?? 0) || 0
  });
}

async function onApplyAoEClick(event) {
  event.preventDefault();

  const mode = event.currentTarget.dataset.mode; // armor | pierce
  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return ui.notifications.error("Нет контекста AoE.");

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить урон может GM или владелец кастера.");
  }
  if (ctx.requiresDefense && getUnresolvedDefenseCount(ctx) > 0) {
    return ui.notifications.warn("Сначала завершите все броски защиты по целям.");
  }

  await emitToGM({
    type: "APPLY_SPELL_AOE_DAMAGE",
    messageId,
    mode
  });
}

async function onApplyAoEEffectsClick(event) {
  event.preventDefault();

  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return ui.notifications.error("Нет контекста AoE.");

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить эффекты может GM или владелец кастера.");
  }
  if (ctx.requiresDefense && getUnresolvedDefenseCount(ctx) > 0) {
    return ui.notifications.warn("Сначала завершите все броски защиты по целям.");
  }

  await emitToGM({
    type: "APPLY_SPELL_AOE_EFFECTS",
    messageId
  });
}

/* -------------------------------- GM BUS -------------------------------- */

async function emitToGM(payload) {
  if (game.user.isGM) return handleGMRequest(payload);

  const gmIds = game.users?.filter(u => u.isGM && u.active).map(u => u.id) ?? [];
  if (!gmIds.length) {
    ui.notifications.error("Не найден GM для отправки запроса.");
    return;
  }

  await ChatMessage.create({
    content: `<p>Шина заклинания: ${payload.type}</p>`,
    whisper: gmIds,
    flags: { Order: { spellBus: { payload } } }
  });
}

async function handleGMRequest(payload) {
  const type = payload?.type;
  if (!type) return;

  if (type === "RESOLVE_SPELL_AOE_DEFENSE") return gmResolveSpellAoEDefense(payload);
  if (type === "APPLY_SPELL_AOE_DAMAGE") return gmApplyAoEDamage(payload);
  if (type === "APPLY_SPELL_AOE_EFFECTS") return gmApplyAoEEffects(payload);
}

async function gmResolveSpellAoEDefense({
  messageId,
  defenderTokenId,
  defenseType,
  defenseTotal,
  defenseSpellId,
  defenseSpellName,
  defenseCastFailed,
  defenseCastTotal,
  defenseSkillId,
  defenseSkillName
}) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!message || !ctx || !ctx.requiresDefense) return;

  const tid = String(defenderTokenId || "");
  if (!tid) return;

  const entry = ctx?.perTarget?.[tid];
  if (!entry) return;
  if (String(entry.state) === "resolved") return;

  const attackTotal = Number(ctx.attackTotal ?? 0) || 0;
  const def = Number(defenseTotal ?? 0) || 0;
  const hit = attackTotal >= def;

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.perTarget = {
    ...(ctx2.perTarget || {}),
    [tid]: {
      ...entry,
      state: "resolved",
      defenseType: String(defenseType || ""),
      defenseTotal: def,
      hit,
      defenseSpellId: defenseType === "spell" ? (defenseSpellId || null) : null,
      defenseSpellName: defenseType === "spell" ? (defenseSpellName || null) : null,
      defenseCastFailed: defenseType === "spell" ? !!defenseCastFailed : null,
      defenseCastTotal: defenseType === "spell" ? (Number(defenseCastTotal ?? 0) || 0) : null,
      defenseSkillId: defenseType === "skill" ? (defenseSkillId || null) : null,
      defenseSkillName: defenseType === "skill" ? (defenseSkillName || null) : null
    }
  };

  await message.update({
    content: renderSpellAoEContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_AOE}`]: ctx2
  });
}

async function gmApplyAoEDamage({ messageId, mode }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return;
  if (ctx.damageApplied) return;
  if (ctx.requiresDefense && getUnresolvedDefenseCount(ctx) > 0) {
    ui.notifications.warn("Нельзя применить урон: не все цели выбрали защиту.");
    return;
  }

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const spellItem = casterActor.items.get(ctx.spellId);
  if (!spellItem) return ui.notifications.warn("Заклинание не найдено у кастера.");

  const raw = Number(ctx.baseDamage ?? 0) || 0;
  if (!raw) return;

  const critMult = ctx.nat20 ? 2 : 1;
  const isHeal = String(ctx?.damageMode || "damage") === "heal";
  const tokens = getAffectedTargetTokens(ctx);

  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;

    if (isHeal) {
      const heal = Math.abs(raw) * critMult;
      await applyHeal(actor, heal, token);
      continue;
    }

    const damageBase = raw * critMult;
    const armor = (mode === "armor") ? getArmorValueFromItems(actor) : 0;
    const applied = Math.max(0, damageBase - armor);
    await applyDamage(actor, applied, token);
  }

  if (!ctx.areaPersistent && ctx.templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [ctx.templateId]);
    } catch (e) {
      console.warn("OrderSpellAoE | Failed to delete template", e);
    }
  }

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.damageApplied = true;
  await message.update({
    content: renderSpellAoEContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_AOE}`]: ctx2
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<p><strong>${spellItem.name}</strong>: применено ${isHeal ? "лечение" : "урон"} по целям (${tokens.length}). Режим: <strong>${mode}</strong>${ctx.nat20 ? " (КРИТ x2)" : ""}.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

async function gmApplyAoEEffects({ messageId }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return;
  if (ctx.effectsApplied) return;
  if (ctx.requiresDefense && getUnresolvedDefenseCount(ctx) > 0) {
    ui.notifications.warn("Нельзя применить эффекты: не все цели выбрали защиту.");
    return;
  }

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const spellItem = casterActor.items.get(ctx.spellId);
  if (!spellItem) return ui.notifications.warn("Заклинание не найдено у кастера.");

  const tokens = getAffectedTargetTokens(ctx);

  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    await applySpellEffects({
      casterActor,
      targetActor: actor,
      spellItem,
      attackTotal: Number(ctx.attackTotal ?? 0) || 0
    });
  }

  if (!ctx.areaPersistent && ctx.templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [ctx.templateId]);
    } catch (e) {
      console.warn("OrderSpellAoE | Failed to delete template", e);
    }
  }

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.effectsApplied = true;
  await message.update({
    content: renderSpellAoEContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_AOE}`]: ctx2
  });


  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<p><strong>${spellItem.name}</strong>: применены эффекты по целям (${tokens.length}).</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

/* ----------------------------- Template placement ----------------------------- */

function buildTemplateDataFromSpell({ casterToken, spellItem }) {
  const s = getSystem(spellItem);

  const t = mapShape(normalizeAoEShape(String(s.AreaShape || "circle")));
  const distance = Number(s.AreaSize ?? 0) || 0;

  const angle = Number(s.AreaAngle ?? 90) || 90;
  const width = Number(s.AreaWidth ?? 0) || 0;

  const center = casterToken?.center ?? { x: 0, y: 0 };

  return {
    t,
    user: game.user.id,
    x: center.x,
    y: center.y,
    direction: 0,
    distance,
    angle,
    width,
    fillColor: (String(s.AreaColor || "").trim() || game.user.color),
    flags: {
      Order: {
        fromSpell: spellItem.id
      }
    }
  };
}

function mapShape(shape) {
  // Foundry template types: circle, cone, ray, rect
  if (shape === "circle") return "circle";
  if (shape === "cone") return "cone";
  if (shape === "ray") return "ray";
  return "circle";
}

function normalizeAoEShape(shape) {
  const s = String(shape || "").trim().toLowerCase();
  if (s === "circle") return "circle";
  if (s === "cone") return "cone";
  // Legacy AoE shapes are normalized to ray.
  if (s === "ray" || s === "rect" || s === "wall") return "ray";
  return "circle";
}

function getAoEShapeLabel(shape) {
  if (shape === "circle") return "Круг";
  if (shape === "cone") return "Конус";
  if (shape === "ray") return "Прямоугольник";
  return shape;
}

async function placeTemplateInteractively(templateData) {
  // Запоминаем активный слой, чтобы вернуть управление
  const priorLayer = canvas.activeLayer;

  // Preview document/object
  const previewDoc = new MeasuredTemplateDocument(templateData, { parent: canvas.scene });
  const previewObj = new MeasuredTemplate(previewDoc);
  await previewObj.draw();

  // В Foundry v11 preview-контейнер у layer = canvas.templates.preview
  const layer = canvas.templates;
  layer.activate();
  layer.preview.addChild(previewObj);
  previewObj.alpha = 0.6;

  let resolve;
  const promise = new Promise((res) => (resolve = res));
  const wheelListenerOptions = { passive: false, capture: true };

  const cleanup = () => {
    // снять листенеры
    canvas.stage.off("mousemove", onMove);
    canvas.stage.off("mousedown", onMouseDown);
    window.removeEventListener("keydown", onKeyDown);
    canvas.app.view.removeEventListener("wheel", onWheel, wheelListenerOptions);

    // убрать preview с контейнера
    try { layer.preview.removeChild(previewObj); } catch { }
    try { previewObj.destroy({ children: true }); } catch { }

    // вернуть предыдущий слой
    try { priorLayer?.activate?.(); } catch { }
  };

  const onMove = (event) => {
    const pos = event.data.getLocalPosition(canvas.stage);
    // Важно: для MeasuredTemplate в v11 корректнее работать от центра клетки
    const [cx, cy] = canvas.grid.getCenter(pos.x, pos.y);
    previewDoc.updateSource({ x: cx, y: cy });
    previewObj.refresh();

  };

  const onWheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    // rotate by 15 degrees
    const delta = event.deltaY < 0 ? 15 : -15;
    const dir = Number(previewDoc.direction ?? 0) || 0;
    previewDoc.updateSource({ direction: (dir + delta + 360) % 360 });
    previewObj.refresh();
  };

  const confirm = async (event) => {
    event.stopPropagation();
    cleanup();

    // Создаём документ шаблона на сцене
    const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [previewDoc.toObject()]);
    resolve(created?.[0] ?? null);
  };

  const cancel = (event) => {
    if (event) event.stopPropagation();
    cleanup();
    resolve(null);
  };

  const onMouseDown = (event) => {
    // left click confirm, right click cancel
    if (event.data.button === 0) return confirm(event);
    return cancel(event);
  };

  const onKeyDown = (ev) => {
    if (ev.key === "Escape") cancel();
  };

  canvas.stage.on("mousemove", onMove);
  canvas.stage.on("mousedown", onMouseDown);
  window.addEventListener("keydown", onKeyDown);
  canvas.app.view.addEventListener("wheel", onWheel, wheelListenerOptions);

  return promise;
}


function getTokensInTemplate(templateObj) {
  const doc = templateObj.document;
  if (!doc) return [];

  const geom = getTemplateGeometry(doc);
  dbg("Template geometry (computed):", geom);

  const tokens = canvas.tokens.placeables ?? [];
  const out = [];

  for (const tok of tokens) {
    const points = sampleTokenPoints(tok);

    let hitPoint = null;
    for (const p of points) {
      if (pointInTemplate(geom, p.x, p.y)) {
        hitPoint = p;
        break;
      }
    }

    dbg(`Token check: ${tok.name}`, {
      tokenXY: { x: tok.x, y: tok.y, w: tok.w, h: tok.h },
      center: tok.center,
      hit: !!hitPoint,
      hitPoint
    });

    if (hitPoint) out.push(tok);
  }

  return out;
}




function safeBounds(obj) {
  try {
    // PIXI bounds
    const b = obj.getBounds?.();
    if (b && Number.isFinite(b.x)) return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch { }
  try {
    // some objects expose .bounds already
    const b = obj.bounds;
    if (b && Number.isFinite(b.x)) return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch { }
  return null;
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}



/* ----------------------------- Common helpers ----------------------------- */

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}


function getBaseImpactFromSystem(sys) {
  const amount = Math.max(0, Number(sys?.Damage ?? 0) || 0);
  const mode = String(sys?.DamageMode || "damage").toLowerCase() === "heal" ? "heal" : "damage";
  return { amount, mode, signed: mode === "heal" ? -amount : amount };
}

function getItemSystem(item) {
  return item?.system ?? item?.data?.system ?? {};
}

function isNaturalTwenty(roll) {
  try {
    const d20 = roll?.dice?.find(d => d?.faces === 20);
    if (!d20) return false;
    const active = (d20.results || []).find(r => r.active);
    return Number(active?.result) === 20;
  } catch {
    return false;
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function getUnresolvedDefenseCount(ctx) {
  if (!ctx?.requiresDefense) return 0;
  const perTarget = (ctx?.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};
  return Object.values(perTarget).filter((entry) => String(entry?.state) !== "resolved").length;
}

function formatDefenseEntryTitle(entry) {
  const kind = String(entry?.defenseType || "");
  if (kind === "spell") {
    const name = entry?.defenseSpellName || "заклинание";
    const castInfo = entry?.defenseCastTotal != null ? `, каст: ${entry.defenseCastTotal}` : "";
    return `Защита: ${name}${castInfo}`;
  }
  if (kind === "skill") return `Защита: ${entry?.defenseSkillName || "навык"}`;
  if (kind === "dodge") return "Защита: уворот";
  if (kind === "block-strength") return "Защита: блок (Strength)";
  if (kind === "block-stamina") return "Защита: блок (Stamina)";
  return "Защита";
}

function getAffectedTargetTokens(ctx) {
  const ids = Array.isArray(ctx?.targetTokenIds) ? ctx.targetTokenIds.map((x) => String(x)) : [];
  if (!ids.length) return [];

  if (!ctx?.requiresDefense) {
    return ids.map((id) => canvas.tokens.get(id)).filter(Boolean);
  }

  const perTarget = (ctx?.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};
  const hitIds = ids.filter((id) => perTarget[id]?.hit === true);
  return hitIds.map((id) => canvas.tokens.get(id)).filter(Boolean);
}

async function promptPickItem({ title, items = [], emptyWarning = "Нет доступных вариантов." } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    ui.notifications.warn(emptyWarning);
    return null;
  }
  if (list.length === 1) return list[0];

  const options = list.map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

  return await new Promise((resolve) => {
    new Dialog({
      title,
      content: `<div class="form-group"><select id="pick-item" style="width:100%;">${options}</select></div>`,
      buttons: {
        ok: { label: "OK", callback: (html) => resolve(list.find((x) => x.id === html.find("#pick-item").val()) || null) },
        cancel: { label: "Отмена", callback: () => resolve(null) }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

async function promptPickDefensiveSpell(actor) {
  const spells = getDefensiveReactionSpells(actor);
  return promptPickItem({
    title: "Выбор защитного заклинания",
    items: spells,
    emptyWarning: "У персонажа нет защитных заклинаний (defensive-reaction)."
  });
}

async function promptPickDefensiveSkill(actor) {
  const skills = getDefensiveReactionSkills(actor);
  return promptPickItem({
    title: "Выбор защитного навыка",
    items: skills,
    emptyWarning: "У персонажа нет защитных навыков (defensive-reaction)."
  });
}

function normalizeTagKeySafe(raw) {
  const fn = game?.OrderTags?.normalize;
  if (typeof fn === "function") return fn(raw);
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function weaponHasTag(weapon, tagKey) {
  const tags = Array.isArray(weapon?.system?.tags) ? weapon.system.tags : [];
  const want = normalizeTagKeySafe(tagKey);
  if (!want) return false;
  return tags.some((t) => normalizeTagKeySafe(t) === want);
}

function actorHasEquippedWeaponTag(actor, tag) {
  if (!actor) return false;
  const want = normalizeTagKeySafe(tag);
  const weapons = (actor.items || []).filter((i) => {
    if (!i) return false;
    if (!(i.type === "weapon" || i.type === "meleeweapon" || i.type === "rangeweapon")) return false;
    const s = getItemSystem(i);
    return !!(s?.isEquiped && s?.isUsed);
  });
  return weapons.some((w) => weaponHasTag(w, want));
}

function getExternalRollModifierFromEffects(actor, kind = "defense") {
  if (!actor) return 0;
  const key = kind === "attack" ? "flags.Order.roll.attack" : "flags.Order.roll.defense";
  const effects = Array.from(actor.effects ?? []);
  let sum = 0;
  for (const ef of effects) {
    if (!ef || ef.disabled) continue;
    const changes =
      Array.isArray(ef.changes) ? ef.changes :
      Array.isArray(ef.data?.changes) ? ef.data.changes :
      Array.isArray(ef._source?.changes) ? ef._source.changes :
      [];
    for (const ch of changes) {
      if (!ch || ch.key !== key) continue;
      const v = Number(ch.value);
      if (!Number.isNaN(v)) sum += v;
    }
  }
  return sum;
}

function getCharacteristicValueAndMods(actor, key) {
  const sys = getSystem(actor);
  const obj = sys?.[key] ?? {};
  const value = Number(obj?.value ?? 0) || 0;
  const localMods = Array.isArray(obj?.modifiers)
    ? obj.modifiers.reduce((acc, m) => acc + (Number(m?.value) || 0), 0)
    : 0;
  const globalMods = Array.isArray(sys?.MaxModifiers)
    ? sys.MaxModifiers.reduce((acc, m) => {
      const modKey = m?.characteristic ?? m?.Characteristic ?? m?.key ?? null;
      if (String(modKey) !== String(key)) return acc;
      return acc + (Number(m?.value) || 0);
    }, 0)
    : 0;
  return { value, mods: localMods + globalMods };
}

async function rollActorCharacteristic(actor, attribute, {
  scene = "Магия",
  action = "Защита",
  source = null,
  toMessage = true,
  kind = "defense"
} = {}) {
  const { value, mods } = getCharacteristicValueAndMods(actor, attribute);
  const external = getExternalRollModifierFromEffects(actor, kind);

  const parts = ["1d20"];
  if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
  if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
  if (external !== 0) parts.push(external > 0 ? `+ ${external}` : `- ${Math.abs(external)}`);

  const roll = await new Roll(parts.join(" ")).roll({ async: true });

  if (toMessage) {
    const flavor = buildCombatRollFlavor({
      scene,
      action,
      source: source ?? `Характеристика: ${attribute}`,
      rollMode: "normal",
      characteristic: attribute,
      applyModifiers: true,
      effectsMod: external
    });
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
  }

  return roll;
}

function getArmorValueFromItems(actor) {
  const items = actor?.items ?? [];
  const equipped = items.filter(i => {
    if (!i) return false;
    if (i.type !== "Armor") return false;
    const sys = getItemSystem(i);
    return !!(sys?.isEquiped && sys?.isUsed);
  });

  let best = 0;
  for (const a of equipped) {
    const sys = getItemSystem(a);
    const val = Number(sys?.Deffensepotential ?? 0) || 0;
    if (val > best) best = val;
  }
  return best + (Number(actor?.system?._perkBonuses?.Armor ?? 0) || 0);
}

function showHealthChangeText(token, amount, { isHeal = false } = {}) {
  const value = Math.max(0, Number(amount) || 0);
  if (!value) return;
  if (!token?.center || typeof canvas?.interface?.createScrollingText !== "function") return;

  canvas.interface.createScrollingText(token.center, `${isHeal ? "+" : "-"}${value}`, {
    fontSize: 32,
    fill: isHeal ? "#00aa00" : "#ff0000",
    stroke: "#000000",
    strokeThickness: 4,
    jitter: 0.5
  });
}

async function applyDamage(actor, amount, token = null) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0);
  const value = Math.max(0, Number(amount) || 0);
  const next = Math.max(0, cur - value);
  await actor.update({ "system.Health.value": next });
  showHealthChangeText(token, value, { isHeal: false });
}

async function applyHeal(actor, amount, token = null) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0);
  const max = Number(sys?.Health?.max ?? 0);
  const rawNext = cur + (Number(amount) || 0);
  const next = max > 0 ? Math.min(rawNext, max) : rawNext;
  await actor.update({ "system.Health.value": next });
  showHealthChangeText(token, Math.max(0, next - cur), { isHeal: true });
}

async function waitForTemplateObject(templateId, tries = 20, delayMs = 50) {
  for (let i = 0; i < tries; i++) {
    const obj = canvas.templates.placeables.find(t => t.document?.id === templateId);
    if (obj) return obj;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

function getTemplateGeometry(doc) {
  const t = String(doc.t || "circle");

  // Конвертация "единиц сцены" в пиксели
  const unitsToPx = canvas.dimensions.size / canvas.dimensions.distance;

  const origin = { x: Number(doc.x) || 0, y: Number(doc.y) || 0 };

  const distanceUnits = Number(doc.distance) || 0;
  const widthUnits = Number(doc.width) || 0;
  const angleDeg = Number(doc.angle) || 0;
  const directionDeg = normalizeDeg(Number(doc.direction) || 0);

  const distancePx = distanceUnits * unitsToPx;
  const widthPx = widthUnits * unitsToPx;

  const dirRad = (directionDeg * Math.PI) / 180;
  const ux = Math.cos(dirRad);
  const uy = Math.sin(dirRad);

  // перпендикуляр (для ray/rect)
  const px = -uy;
  const py = ux;

  return {
    t,
    origin,
    unitsToPx,
    distanceUnits,
    widthUnits,
    distancePx,
    widthPx,
    angleDeg,
    directionDeg,
    ux, uy,
    px, py
  };
}

function pointInTemplate(g, x, y) {
  const dx = x - g.origin.x;
  const dy = y - g.origin.y;

  // circle
  if (g.t === "circle") {
    const r2 = g.distancePx * g.distancePx;
    return (dx * dx + dy * dy) <= r2;
  }

  // cone
  if (g.t === "cone") {
    const dist2 = dx * dx + dy * dy;
    if (dist2 > g.distancePx * g.distancePx) return false;

    const ang = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
    const delta = deltaAngleDeg(ang, g.directionDeg);
    return delta <= (Number(g.angleDeg) || 90) / 2;
  }

  // ray/rect: считаем как прямоугольник вдоль direction
  // localX вдоль направления, localY поперёк
  const localX = dx * g.ux + dy * g.uy;
  const localY = dx * g.px + dy * g.py;

  const len = g.distancePx;
  const halfW = (g.widthPx || (canvas.dimensions.size)) / 2; // fallback: 1 клетка

  // Foundry ray/rect начинается от origin и идёт вперёд
  return (localX >= 0 && localX <= len && Math.abs(localY) <= halfW);
}

function normalizeDeg(a) {
  let x = Number(a) || 0;
  x = x % 360;
  if (x < 0) x += 360;
  return x;
}

function deltaAngleDeg(a, b) {
  // минимальная разница углов (0..180)
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

function sampleTokenPoints(tok) {
  // Используем реальные пиксельные размеры токена на сцене
  const x = Number(tok.x) || 0;
  const y = Number(tok.y) || 0;
  const w = Number(tok.w) || 0;
  const h = Number(tok.h) || 0;

  if (!w || !h) {
    const c = tok.center ?? { x, y };
    return [{ x: c.x, y: c.y }];
  }

  const pad = 2;
  const x1 = x + pad;
  const x2 = x + w / 2;
  const x3 = x + w - pad;

  const y1 = y + pad;
  const y2 = y + h / 2;
  const y3 = y + h - pad;

  // 3x3 сетка точек (устойчиво к касанию)
  return [
    { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x3, y: y1 },
    { x: x1, y: y2 }, { x: x2, y: y2 }, { x: x3, y: y2 },
    { x: x1, y: y3 }, { x: x2, y: y3 }, { x: x3, y: y3 }
  ];
}




