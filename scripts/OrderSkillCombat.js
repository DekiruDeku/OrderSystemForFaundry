import { rollDefensiveSkillDefense } from "./OrderSkillDefenseReaction.js";
import { castDefensiveSpellDefense } from "./OrderSpellDefenseReaction.js";
import { buildCombatRollFlavor, formatSigned } from "./OrderRollFlavor.js";
import { applySpellEffects } from "./OrderSpellEffects.js";

const FLAG_SCOPE = "Order";
const FLAG_ATTACK = "skillAttack";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function normalizeSkillEffects(rawEffects) {
  if (typeof rawEffects === "string") {
    const text = rawEffects.trim();
    return text ? [{ type: "text", text }] : [];
  }
  return Array.isArray(rawEffects) ? rawEffects : [];
}


function getBaseImpactFromSystem(sys) {
  const amount = Math.max(0, Number(sys?.Damage ?? 0) || 0);
  const mode = String(sys?.DamageMode || "damage").toLowerCase() === "heal" ? "heal" : "damage";
  return { amount, mode, signed: mode === "heal" ? -amount : amount };
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

function getArmorValueFromItems(actor) {
  const items = actor?.items ?? [];
  const equipped = items.filter(i => i && i.type === "Armor" && !!(getSystem(i)?.isEquiped && getSystem(i)?.isUsed));
  if (!equipped.length) return 0;

  let best = 0;
  for (const a of equipped) {
    const val = Number(getSystem(a)?.Deffensepotential ?? 0) || 0;
    if (val > best) best = val;
  }
  return best + (Number(actor?.system?._perkBonuses?.Armor ?? 0) || 0);
}

function getExternalRollModifierFromEffects(actor, kind) {
  if (!actor) return 0;

  const key = kind === "attack"
    ? "flags.Order.roll.attack"
    : "flags.Order.roll.defense";

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

async function applyDamage(actor, dmg) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0) || 0;
  const next = Math.max(0, cur - Math.max(0, Number(dmg) || 0));
  await actor.update({ "system.Health.value": next });
}

async function applyHeal(actor, heal) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0) || 0;
  const max = Number(sys?.Health?.max ?? 0) || 0;
  const add = Math.max(0, Number(heal) || 0);
  const next = max ? Math.min(max, cur + add) : (cur + add);
  await actor.update({ "system.Health.value": next });
}

async function rollActorCharacteristic(actor, key) {
  const sys = getSystem(actor);
  const obj = sys?.[key] ?? {};
  const value = Number(obj?.value ?? 0) || 0;
  const externalDefenseMod = getExternalRollModifierFromEffects(actor, "defense");

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

  let formula = "1d20";
  if (value) formula += value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`;
  const mods = localMods + globalMods;
  if (mods) formula += mods > 0 ? ` + ${mods}` : ` - ${Math.abs(mods)}`;
  if (externalDefenseMod) formula += externalDefenseMod > 0 ? ` + ${externalDefenseMod}` : ` - ${Math.abs(externalDefenseMod)}`;

  const roll = await new Roll(formula).roll({ async: true });
  return roll;
}

/* ----------------------------- Handlers + Bus ----------------------------- */

export function registerOrderSkillCombatHandlers() {
  $(document)
    .off("click.order-skill-defense")
    .on("click.order-skill-defense", ".order-skill-defense", onSkillDefenseClick);

  $(document)
    .off("click.order-skill-apply")
    .on("click.order-skill-apply", ".order-skill-apply", onSkillApplyClick);

  console.log("OrderSkillCombat | Handlers registered");
}

export function registerOrderSkillCombatBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;
      const bus = message.getFlag("Order", "skillBus");
      if (!bus) return;
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderSkillCombat | BUS handler error", e);
    }
  });

  console.log("OrderSkillCombat | BUS listener registered");
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

  if (type === "RESOLVE_SKILL_DEFENSE") return gmResolveSkillDefense(payload);
  if (type === "APPLY_SKILL_RESULT") return gmApplySkillResult(payload);
}

/* ----------------------------- Entry point ----------------------------- */

export async function startSkillAttackWorkflow({
  attackerActor,
  attackerToken,
  skillItem,
  attackRoll,
  rollMode,
  manualMod,
  characteristic,
  rollFormulaRaw,
  rollFormulaValue
}) {
  const s = getSystem(skillItem);
  const delivery = String(s.DeliveryType || "utility");
  if (delivery !== "attack-ranged" && delivery !== "attack-melee") return;

  const targets = Array.from(game.user.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications.warn("Для атаки навыком нужно выбрать ровно 1 цель (target).");
    return;
  }

  const defenderToken = targets[0];
  const defenderActor = defenderToken?.actor;
  if (!defenderActor) {
    ui.notifications.warn("Цель не имеет актёра.");
    return;
  }

  const attackTotal = Number(attackRoll?.total ?? 0) || 0;
  const nat20 = isNaturalTwenty(attackRoll);
  const rollHTML = attackRoll ? await attackRoll.render() : "";

  const applyModifiers = true;
  const manualModValue = Number(manualMod ?? 0) || 0;

  const rollFormulaExtra = rollFormulaRaw
    ? [`формула: ${rollFormulaRaw} = ${formatSigned(rollFormulaValue)}`]
    : [];

  const cardFlavor = buildCombatRollFlavor({
    scene: "Бой",
    action: "Атака",
    source: `Навык: ${skillItem?.name ?? "—"}`,
    rollMode: rollMode ?? "normal",
    characteristic: rollFormulaRaw ? "формула" : (characteristic ?? null),
    applyModifiers,
    manualMod: manualModValue,
    effectsMod: (applyModifiers ? getExternalRollModifierFromEffects(attackerActor, "attack") : 0),
    extra: rollFormulaExtra,
    isCrit: !!nat20
  });

  const impact = getBaseImpactFromSystem(s);
  let baseDamage = impact.signed;
  const perkSkillDmg = Number(attackerActor?.system?._perkBonuses?.SkillDamage ?? 0) || 0;
  if (impact.mode === "damage" && perkSkillDmg) baseDamage += perkSkillDmg;
  const isHeal = impact.mode === "heal";

  const hasShield = actorHasEquippedWeaponTag(defenderActor, "shield");
  const allowStrengthBlock = delivery === "attack-melee";

  // Для дальних атак навыком (attack-ranged) блок через характеристики доступен только если у цели есть щит (tag: shield)
  const rangedStrengthBlockBtn = (delivery === "attack-ranged" && hasShield)
    ? `<button class="order-skill-defense" data-defense="block-strength">Блок (Strength)</button>`
    : "";
  const rangedStaminaBlockBtn = (delivery === "attack-ranged" && hasShield)
    ? `<button class="order-skill-defense" data-defense="block-stamina">Блок (Stamina)</button>`
    : "";

  const defenseBlock = isHeal ? "" : `
      <hr/>

      <div class="defense-buttons">
        <p><strong>Защита цели:</strong> выбери реакцию</p>
        <button class="order-skill-defense" data-defense="dodge">Уворот (Dexterity)</button>
        ${delivery === "attack-ranged"
      ? `${rangedStrengthBlockBtn}${rangedStaminaBlockBtn}`
      : `<button class="order-skill-defense" data-defense="block-stamina">Блок (Stamina)</button>${allowStrengthBlock ? `<button class="order-skill-defense" data-defense="block-strength">Блок (Strength)</button>` : ""
      }`
    }

        <div class="order-defense-skill-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
          <select class="order-defense-skill-select" style="flex:1; min-width:180px;"></select>
          <button class="order-skill-defense" data-defense="skill" style="flex:0 0 auto; white-space:nowrap;">
            Защита навыком
          </button>
        </div>

        <div class="order-defense-spell-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
          <select class="order-defense-spell-select" style="flex:1; min-width:180px;"></select>
          <button class="order-skill-defense" data-defense="spell" style="flex:0 0 auto; white-space:nowrap;">
            Защита заклинанием
          </button>
        </div>

      </div>
  `;

  const formulaLine = rollFormulaRaw
    ? `<p><strong>Формула броска:</strong> ${rollFormulaRaw} = ${formatSigned(rollFormulaValue)}</p>`
    : (characteristic ? `<p><strong>Характеристика атаки:</strong> ${characteristic}</p>` : "");

  const content = `
    <div class="chat-attack-message order-skill" data-order-skill-attack="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${skillItem?.img ?? ""}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${skillItem?.name ?? "Навык"}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Атакующий:</strong> ${attackerToken?.name ?? attackerActor.name}</p>
        <p><strong>Цель:</strong> ${defenderToken?.name ?? defenderActor.name}</p>
        <p><strong>Тип:</strong> ${delivery}</p>
        ${formulaLine}
        <p><strong>Результат атаки:</strong> ${attackTotal}${nat20 ? ` <span style="color:#c00; font-weight:700;">[КРИТ]</span>` : ""}</p>
        <p class="order-roll-flavor">${cardFlavor}</p>  
        <div class="inline-roll">${rollHTML}</div>
        ${baseDamage ? `<p><strong>Базовое ${impact.mode === "heal" ? "лечение" : "урон"}:</strong> ${Math.abs(baseDamage)}</p>` : ""}
      </div>

      ${defenseBlock}
    </div>
  `;

  const ctx = {
    attackerTokenId: attackerToken?.id ?? null,
    attackerActorId: attackerActor?.id ?? null,

    defenderTokenId: defenderToken?.id ?? null,
    defenderActorId: defenderActor?.id ?? null,

    skillId: skillItem?.id ?? null,
    skillName: skillItem?.name ?? "",
    skillImg: skillItem?.img ?? "",
    delivery,
    effectThreshold: Number(s?.EffectThreshold ?? 0) || 0,

    attackTotal,
    nat20,
    rollMode: rollMode ?? "normal",
    manualMod: Number(manualMod ?? 0) || 0,
    characteristic: characteristic || null,

    baseDamage,
    damageMode: impact.mode,
    state: isHeal ? "resolved" : "awaitingDefense",
    hit: isHeal ? true : undefined,
    createdAt: Date.now()
  };

  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor, token: attackerToken }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { Order: { [FLAG_ATTACK]: ctx } }
  });

  if (isHeal) {
    const messageId = message?.id ?? message?._id ?? null;
    await createSkillApplyMessage({
      messageId,
      ctx,
      attackerActor,
      attackerToken,
      defenderActor,
      defenderToken
    });
  }
}

/* ----------------------------- UI handlers ----------------------------- */

async function onSkillDefenseClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const messageId = button.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение атаки.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_ATTACK);
  if (!ctx) return ui.notifications.error("В сообщении нет контекста атаки навыком.");

  if (ctx.state !== "awaitingDefense") {
    ui.notifications.warn("Эта атака уже разрешена.");
    return;
  }

  const defenderToken = canvas.tokens.get(ctx.defenderTokenId);
  const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
  if (!defenderActor) return ui.notifications.error("Не найден защитник.");

  if (!(game.user.isGM || defenderActor.isOwner)) {
    ui.notifications.warn("Защиту может выбрать только владелец цели (или GM).");
    return;
  }

  const defenseType = button.dataset.defense;

  if (defenseType === "skill") {
    const messageEl = button.closest?.(".message");
    const select = messageEl?.querySelector?.(".order-defense-skill-select");
    const skillId = String(select?.value || "");
    if (!skillId) return ui.notifications.warn("Выберите защитный навык в списке.");

    const skillItem = defenderActor.items.get(skillId);
    if (!skillItem) return ui.notifications.warn("Выбранный навык не найден у цели.");

    const res = await rollDefensiveSkillDefense({ actor: defenderActor, token: defenderToken, skillItem });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_SKILL_DEFENSE",
      messageId,
      defenseType: "skill",
      defenseTotal: res.defenseTotal,
      defenseSkillId: res.skillId,
      defenseSkillName: res.skillName
    });
    return;
  }
  if (defenseType === "spell") {
    const messageEl = button.closest?.(".message");
    const select = messageEl?.querySelector?.(".order-defense-spell-select");
    const spellId = String(select?.value || "");
    if (!spellId) return ui.notifications.warn("Выберите защитное заклинание в списке.");

    const spellItem = defenderActor.items.get(spellId);
    if (!spellItem) return ui.notifications.warn("Выбранное заклинание не найдено у персонажа.");

    const res = await castDefensiveSpellDefense({ actor: defenderActor, token: defenderToken, spellItem });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_SKILL_DEFENSE",
      messageId,
      defenseType: "spell",
      defenseTotal: res.defenseTotal,

      defenseSpellId: res.spellId,
      defenseSpellName: res.spellName,
      defenseCastFailed: res.castFailed,
      defenseCastTotal: res.castTotal
    });
    return;
  }


  let attribute = null;
  if (defenseType === "dodge") attribute = "Dexterity";
  if (defenseType === "block-stamina") attribute = "Stamina";
  if (defenseType === "block-strength") attribute = "Strength";
  if (!attribute) return;
  // Для дальних атак навыком блоки через характеристики доступны только при наличии щита.
  if (
    String(ctx.delivery) === "attack-ranged" &&
    (defenseType === "block-stamina" || defenseType === "block-strength")
  ) {
    const hasShield = actorHasEquippedWeaponTag(defenderActor, "shield");
    if (!hasShield) return ui.notifications.warn("Блок доступен только при наличии щита (tag: shield).");
  }

  const roll = await rollActorCharacteristic(defenderActor, attribute);
  const defenseTotal = Number(roll.total ?? 0) || 0;

  await emitToGM({
    type: "RESOLVE_SKILL_DEFENSE",
    messageId,
    defenseType,
    defenseTotal
  });
}

async function onSkillApplyClick(event) {
  event.preventDefault();

  const mode = event.currentTarget.dataset.mode; // armor | pierce
  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const dmgCtx = message?.getFlag("Order", "skillDamage");
  if (!dmgCtx) return ui.notifications.error("В сообщении нет контекста применения результата.");

  // применить может GM или владелец атакующего
  const attackerToken = canvas.tokens.get(dmgCtx.attackerTokenId);
  const attackerActor = attackerToken?.actor ?? game.actors.get(dmgCtx.attackerActorId);
  if (!(game.user.isGM || attackerActor?.isOwner)) {
    return ui.notifications.warn("Применить урон/лечение может GM или владелец атакующего.");
  }

  await emitToGM({
    type: "APPLY_SKILL_RESULT",
    sourceMessageId: dmgCtx.sourceMessageId,
    defenderTokenId: dmgCtx.defenderTokenId,
    baseDamage: dmgCtx.baseDamage,
    damageMode: dmgCtx.damageMode || "damage",
    nat20: !!dmgCtx.nat20,
    mode
  });
}

/* ----------------------------- GM resolve/apply ----------------------------- */

async function gmResolveSkillDefense({
  messageId,
  defenseType,
  defenseTotal,
  defenseSkillId,
  defenseSkillName,
  defenseSpellName,
  defenseSpellId,
  defenseCastFailed
}) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_ATTACK);
  if (!message || !ctx) return;
  if (ctx.state === "resolved") return;

  const attackTotal = Number(ctx.attackTotal ?? 0) || 0;
  const def = Number(defenseTotal ?? 0) || 0;
  const hit = attackTotal >= def;

  await message.update({
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.state`]: "resolved",
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseType`]: defenseType,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseTotal`]: def,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.hit`]: hit,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseSkillId`]: defenseType === "skill" ? (defenseSkillId || null) : null,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseSkillName`]: defenseType === "skill" ? (defenseSkillName || null) : null,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseSpellId`]: defenseType === "spell" ? (defenseSpellId || null) : null,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseSpellName`]: defenseType === "spell" ? (defenseSpellName || null) : null,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseCastFailed`]: defenseType === "spell" ? !!defenseCastFailed : null,
    [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseCastTotal`]: defenseType === "spell" ? (Number(defenseTotal ?? 0) || 0) : null
  });

  const defenderToken = canvas.tokens.get(ctx.defenderTokenId);
  const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
  const attackerToken = canvas.tokens.get(ctx.attackerTokenId);
  const attackerActor = attackerToken?.actor ?? game.actors.get(ctx.attackerActorId);

  const defenseLabel =
    defenseType === "skill" ? `навык: ${defenseSkillName || "—"}` :
      defenseType === "spell" ? `заклинание: ${defenseSpellName || "—"}` :
        defenseType;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: defenderActor, token: defenderToken }),
    content: `<p><strong>${defenderToken?.name ?? defenderActor?.name ?? "Цель"}</strong> защищается: <strong>${defenseLabel}</strong> → ${def}. Итог: <strong>${hit ? "ПОПАДАНИЕ" : "ПРОМАХ"}</strong>.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });

  if (!hit) return;

  await createSkillApplyMessage({
    messageId,
    ctx,
    attackerActor,
    attackerToken,
    defenderActor,
    defenderToken
  });
}

async function createSkillApplyMessage({ messageId, ctx, attackerActor, attackerToken, defenderActor, defenderToken }) {
  if (!ctx) return;
  const skillItem = attackerActor?.items?.get?.(ctx.skillId) ?? null;
  const attackTotal = Number(ctx.attackTotal ?? 0) || 0;
  const skillEffectThreshold = Number((skillItem?.system?.EffectThreshold) ?? ctx.effectThreshold ?? 0) || 0;
  const thresholdPassed = attackTotal > skillEffectThreshold;
  const effects = normalizeSkillEffects(getSystem(skillItem)?.Effects);
  const hasEffects = effects.some((ef) => {
    if (!ef) return false;
    const type = String(ef?.type || "text");
    if (type === "debuff") return !!String(ef?.debuffKey ?? "").trim();
    return !!String(ef?.text ?? "").trim();
  });

  if (skillEffectThreshold > 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor, token: attackerToken }),
      content: `<p><strong>Порог эффекта:</strong> ${skillEffectThreshold}. Итог атаки: ${attackTotal}. ${thresholdPassed ? "<strong>Порог достигнут</strong>." : "<strong>Порог не достигнут</strong>."}</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  }

  if (hasEffects && thresholdPassed && defenderActor && skillItem) {
    await applySpellEffects({
      casterActor: attackerActor,
      targetActor: defenderActor,
      spellItem: skillItem,
      attackTotal
    });
  }

  const baseDamage = Number(ctx.baseDamage ?? 0) || 0;
  if (!baseDamage) return;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor, token: attackerToken }),
    content: `
      <div class="order-skill-apply-card">
        <p><strong>Применить результат навыка:</strong> ${ctx.skillName}</p>
        <p><strong>Цель:</strong> ${defenderToken?.name ?? defenderActor?.name ?? "—"}</p>
        <p><strong>База (${String(ctx.damageMode || "damage") === "heal" ? "лечение" : "урон"}):</strong> ${Math.abs(baseDamage)}</p>
        ${ctx.nat20 ? `<p style="color:#c00;"><strong>КРИТ:</strong> урон/лечение ×2.</p>` : ""}
        <button class="order-skill-apply" data-mode="armor">${String(ctx.damageMode || "damage") === "heal" ? "Применить лечение" : "Урон с учётом брони"}</button>
        ${String(ctx.damageMode || "damage") === "heal" ? "" : `<button class="order-skill-apply" data-mode="pierce">Урон сквозь броню</button>`}
      </div>
    `,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      Order: {
        skillDamage: {
          sourceMessageId: messageId,
          attackerTokenId: ctx.attackerTokenId,
          attackerActorId: ctx.attackerActorId,
          defenderTokenId: ctx.defenderTokenId,
          baseDamage,
          damageMode: ctx.damageMode || "damage",
          nat20: !!ctx.nat20
        }
      }
    }
  });
}

async function gmApplySkillResult({ sourceMessageId, defenderTokenId, baseDamage, damageMode, nat20, mode }) {
  // anti double apply
  if (sourceMessageId) {
    const src = game.messages.get(sourceMessageId);
    const ctx = src?.getFlag(FLAG_SCOPE, FLAG_ATTACK);
    if (ctx?.damageApplied) return;
    if (src) await src.update({ [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.damageApplied`]: true });
  }

  const token = canvas.tokens.get(defenderTokenId);
  const actor = token?.actor;
  if (!token || !actor) return;

  const raw = Number(baseDamage ?? 0) || 0;
  const critMult = nat20 ? 2 : 1;

  const isHeal = String(damageMode || "damage") === "heal";
  if (isHeal) {
    const heal = Math.abs(raw) * critMult;
    await applyHeal(actor, heal);
    canvas.interface.createScrollingText(token.center, `+${heal}`, { fontSize: 32, strokeThickness: 4 });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${token.name}</strong> получает лечение: <strong>${heal}</strong>${nat20 ? " <strong>(КРИТ ×2)</strong>" : ""}.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
    return;
  }

  const damageBase = raw * critMult;
  const armor = (mode === "armor") ? getArmorValueFromItems(actor) : 0;
  const applied = Math.max(0, damageBase - armor);

  await applyDamage(actor, applied);
  canvas.interface.createScrollingText(token.center, `-${applied}`, { fontSize: 32, strokeThickness: 4 });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${token.name}</strong> получает урон: <strong>${applied}</strong>${nat20 ? " <strong>(КРИТ ×2)</strong>" : ""}${mode === "armor" ? ` (броня ${armor})` : " (сквозь броню)"}.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

function actorHasEquippedWeaponTag(actor, tag) {
  const items = actor?.items ?? [];
  return items.some(i => {
    if (!i) return false;
    if (i.type !== "meleeweapon" && i.type !== "rangeweapon") return false;
    const sys = getSystem(i);
    if (!sys?.inHand) return false;
    const tags = Array.isArray(sys?.tags) ? sys.tags : [];
    return tags.includes(tag);
  });
}
