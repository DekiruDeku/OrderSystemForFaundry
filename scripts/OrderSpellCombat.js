import { applySpellEffects } from "./OrderSpellEffects.js";
import { castDefensiveSpellDefense } from "./OrderSpellDefenseReaction.js";
import { rollDefensiveSkillDefense } from "./OrderSkillDefenseReaction.js";
import { buildCombatRollFlavor } from "./OrderRollFlavor.js";


const FLAG_SCOPE = "Order";
const FLAG_ATTACK = "spellAttack";

function D(...args) {
    try {
        if (!game.settings.get("Order", "debugDefenseSpell")) return;
    } catch { /* ignore */ }
    console.log("[Order][SpellCombat]", ...args);
}


function getBaseImpactFromSystem(sys) {
  const amount = Math.max(0, Number(sys?.Damage ?? 0) || 0);
  const mode = String(sys?.DamageMode || "damage").toLowerCase() === "heal" ? "heal" : "damage";
  return { amount, mode, signed: mode === "heal" ? -amount : amount };
}

/* ----------------------------- Public hooks ----------------------------- */

export function registerOrderSpellCombatHandlers() {
    $(document)
        .off("click.order-spell-defense")
        .on("click.order-spell-defense", ".order-spell-defense", onSpellDefenseClick);

    $(document)
        .off("click.order-spell-apply")
        .on("click.order-spell-apply", ".order-spell-apply", onSpellApplyClick);

    $(document)
        .off("click.order-spell-apply-effects")
        .on("click.order-spell-apply-effects", ".order-spell-apply-effects", onSpellApplyEffectsClick);

    console.log("OrderSpellCombat | Handlers registered");
}

export function registerOrderSpellCombatBus() {
    Hooks.on("createChatMessage", async (message) => {
        try {
            D("createChatMessage hook fired", {
                msgId: message?.id,
                whisper: message?.whisper,
                user: game.user?.name,
                isGM: game.user?.isGM,
                hasSpellBus: !!message.getFlag("Order", "spellBus")
            });

            const bus = message.getFlag("Order", "spellBus");
            D("spellBus payload received", bus?.payload);

            if (!bus) return;
            D("handling bus payload", bus?.payload?.type);

            await handleGMRequest(bus.payload);
        } catch (e) {
            console.error("OrderSpellCombat | BUS handler error", e);
        }
    });

    console.log("OrderSpellCombat | BUS listener registered");
}

/* ----------------------------- Entry point ----------------------------- */
/**
 * Starts spell-attack workflow for DeliveryType attack-ranged / attack-melee.
 * Uses the CAST roll total as attackTotal (per your current MVP).
 */
export async function startSpellAttackWorkflow({
    casterActor,
    casterToken,
    spellItem,
    castRoll,
    rollMode,
    manualMod
}) {
    const s = spellItem?.system ?? spellItem?.data?.system ?? {};
    const delivery = String(s.DeliveryType || "utility");

    if (delivery !== "attack-ranged" && delivery !== "attack-melee") return;

    // Target requirement: exactly one
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length !== 1) {
        ui.notifications.warn("Для атаки заклинанием нужно выбрать ровно 1 цель (target).");
        return;
    }

    const defenderToken = targets[0];
    const defenderActor = defenderToken?.actor;
    if (!defenderActor) {
        ui.notifications.warn("Цель не имеет актёра.");
        return;
    }

    const attackTotal = Number(castRoll?.total ?? 0);
    const nat20 = isNaturalTwenty(castRoll);


    const hasShield = actorHasEquippedWeaponTag(defenderActor, "shield");
    const allowStrengthBlock = delivery === "attack-melee";

    const shieldBtn = hasShield
        ? `<button class="order-spell-defense" data-defense="block-stamina">Блок (Stamina)</button>`
        : "";

    const strengthBtn = allowStrengthBlock
        ? `<button class="order-spell-defense" data-defense="block-strength">Блок (Strength)</button>`
        : "";


    const rollHTML = castRoll ? await castRoll.render() : "";

    const cardFlavor = buildCombatRollFlavor({
        scene: "Магия",
        action: "Атака",
        source: `Заклинание: ${spellItem?.name ?? "—"}`,
        rollMode,
        characteristic: "Magic",
        applyModifiers: true,
        manualMod: Number(manualMod) || 0,
        effectsMod: 0,
        extra: [String(delivery || "")].filter(Boolean),
        isCrit: nat20
    });

    // Damage parsing (stage 2: only numeric base; stage 3 will support formulas)
    const impact = getBaseImpactFromSystem(s);
    let baseDamage = impact.signed;
  const perkSpellDmg = Number(casterActor?.system?._perkBonuses?.SpellDamage ?? 0) || 0;
  if (impact.mode === "damage" && perkSpellDmg) baseDamage += perkSpellDmg;
    const isHeal = impact.mode === "heal";

    const defenseBlock = isHeal ? "" : `
      <hr/>

      <div class="defense-buttons">
        <p><strong>Защита цели:</strong> выбери реакцию</p>
        <button class="order-spell-defense" data-defense="dodge">Уворот (Dexterity)</button>
        ${shieldBtn}
        ${strengthBtn}
        <div class="order-defense-spell-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
        <select class="order-defense-spell-select" style="flex:1; min-width:180px;"></select>
        <button class="order-spell-defense" data-defense="spell" style="flex:0 0 auto; white-space:nowrap;">
            Защита заклинанием
        </button>
        </div>
        <div class="order-defense-skill-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
            <select class="order-defense-skill-select" style="flex:1; min-width:180px;"></select>
            <button class="order-spell-defense" data-defense="skill" style="flex:0 0 auto; white-space:nowrap;">
                Защита навыком
            </button>
        </div>

      </div>
    `;

    const content = `
    <div class="chat-attack-message order-spell" data-order-spell-attack="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${spellItem?.img ?? ""}" alt="${spellItem?.name ?? ""}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${spellItem?.name ?? "Заклинание"}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Кастер:</strong> ${casterToken?.name ?? casterActor.name}</p>
        <p><strong>Цель:</strong> ${defenderToken?.name ?? defenderActor.name}</p>
        <p><strong>Тип:</strong> ${delivery}</p>
        <p><strong>Результат атаки:</strong> ${attackTotal}${nat20 ? ` <span style="color:#c00; font-weight:700;">[КРИТ]</span>` : ""}</p>
        <p class="order-roll-flavor">${cardFlavor}</p>
        <div class="inline-roll">${rollHTML}</div>
        ${baseDamage ? `<p><strong>Базовое ${impact.mode === "heal" ? "лечение" : "урон"}:</strong> ${Math.abs(baseDamage)}</p>` : ""}
      </div>

      ${defenseBlock}
    </div>
  `;

    const ctx = {
        casterTokenId: casterToken?.id ?? null,
        casterActorId: casterActor?.id ?? null,

        defenderTokenId: defenderToken?.id ?? null,
        defenderActorId: defenderActor?.id ?? null,

        spellId: spellItem?.id ?? null,
        spellName: spellItem?.name ?? "",
        spellImg: spellItem?.img ?? "",
        delivery,

        attackTotal,
        nat20,
        rollMode: rollMode ?? "normal",
        manualMod: Number(manualMod ?? 0) || 0,

        baseDamage,
        damageMode: impact.mode,
        state: isHeal ? "resolved" : "awaitingDefense",
        hit: isHeal ? true : undefined,

        createdAt: Date.now()
    };

    const message = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
        content,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
        flags: { Order: { [FLAG_ATTACK]: ctx } }
    });

    if (isHeal) {
        const messageId = message?.id ?? message?._id ?? null;
        await createSpellPostHitMessages({
            messageId,
            ctx,
            casterActor,
            casterToken,
            defenderActor,
            defenderToken
        });
    }
}

/* ----------------------------- UI handlers ----------------------------- */

async function onSpellDefenseClick(event) {
    event.preventDefault();

    D("onSpellDefenseClick fired", {
        user: game.user?.name,
        isGM: game.user?.isGM
    });

    const button = event.currentTarget;
    const messageId = button.closest?.(".message")?.dataset?.messageId;
    D("clicked messageId", messageId);

    if (!messageId) return ui.notifications.error("Не удалось определить сообщение атаки.");

    const message = game.messages.get(messageId);
    const ctx = message?.getFlag(FLAG_SCOPE, FLAG_ATTACK);
    D("ctx loaded", { state: ctx?.state, defenderActorId: ctx?.defenderActorId, defenderTokenId: ctx?.defenderTokenId, attackTotal: ctx?.attackTotal });

    if (!ctx) return ui.notifications.error("В сообщении нет контекста атаки заклинанием.");

    if (ctx.state !== "awaitingDefense") {
        ui.notifications.warn("Эта атака уже разрешена.");
        return;
    }

    const defenderToken = canvas.tokens.get(ctx.defenderTokenId);
    const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
    if (!defenderActor) return ui.notifications.error("Не найден защитник.");

    // Only defender owner (or GM) can choose defense
    if (!(game.user.isGM || defenderActor.isOwner)) {
        ui.notifications.warn("Защиту может выбрать только владелец цели (или GM).");
        return;
    }

    const defenseType = button.dataset.defense;
    D("defenseType", defenseType);

    if (defenseType === "spell") {
        const messageEl = button.closest?.(".message");
        const select = messageEl?.querySelector?.(".order-defense-spell-select");
        const spellId = String(select?.value || "");
        if (!spellId) return ui.notifications.warn("Выберите защитное заклинание в списке.");

        const spellItem = defenderActor.items.get(spellId);
        if (!spellItem) return ui.notifications.warn("Выбранное заклинание не найдено у цели.");

        const res = await castDefensiveSpellDefense({ actor: defenderActor, token: defenderToken, spellItem });
        D("castDefensiveSpellDefense returned", res);

        if (!res) return; // отмена

        D("emitToGM RESOLVE_SPELL_DEFENSE", {
            messageId,
            defenseTotal: res?.defenseTotal,
            spell: res?.spellName,
            castFailed: res?.castFailed,
            castTotal: res?.castTotal
        });

        // КРИТИЧНО: type должен быть именно RESOLVE_SPELL_DEFENSE
        await emitToGM({
            type: "RESOLVE_SPELL_DEFENSE",
            messageId,
            defenseType: "spell",
            defenseTotal: res.defenseTotal,

            // (необязательно, но полезно)
            defenseSpellId: res.spellId,
            defenseSpellName: res.spellName,
            defenseCastFailed: res.castFailed,
            defenseCastTotal: res.castTotal
        });
        return;
    }

    if (defenseType === "skill") {
        const messageEl = button.closest?.(".message");

        const select = messageEl?.querySelector?.(".order-defense-skill-select");
        const skillId = String(select?.value || "");
        if (!skillId) return ui.notifications.warn("Выберите защитный навык в списке.");

        const skillItem = defenderActor.items.get(skillId);
        if (!skillItem) return ui.notifications.warn("Выбранный навык не найден у персонажа.");

        const res = await rollDefensiveSkillDefense({ actor: defenderActor, token: defenderToken, skillItem, scene: "Магия" });
        if (!res) return;

        await emitToGM({
            type: "RESOLVE_SPELL_DEFENSE",
            messageId,
            defenseType: "skill",
            defenseTotal: res.defenseTotal,
            defenseSkillId: res.skillId,
            defenseSkillName: res.skillName
        });

        return;
    }

    let attribute = null;
    if (defenseType === "dodge") attribute = "Dexterity";
    if (defenseType === "block-stamina") attribute = "Stamina";
    if (defenseType === "block-strength") attribute = "Strength";

    if (!attribute) return;

    if (defenseType === "block-stamina") {
        const hasShield = actorHasEquippedWeaponTag(defenderActor, "shield");
        if (!hasShield) return ui.notifications.warn("Блок (Stamina) доступен только при наличии щита.");
    }

    // Roll defense
    const defenseRoll = await rollActorCharacteristic(defenderActor, attribute);
    const defenseTotal = Number(defenseRoll.total ?? 0);

    await emitToGM({
        type: "RESOLVE_SPELL_DEFENSE",
        messageId,
        defenseType,
        defenseTotal
    });
}

async function onSpellApplyClick(event) {
    event.preventDefault();

    const button = event.currentTarget;
    const mode = button.dataset.mode; // armor | pierce
    const messageId = button.closest?.(".message")?.dataset?.messageId;
    if (!messageId) return;

    const message = game.messages.get(messageId);
    const dmgCtx = message?.getFlag("Order", "spellDamage");
    if (!dmgCtx) return ui.notifications.error("В сообщении нет контекста применения урона.");

    const casterToken = canvas.tokens.get(dmgCtx.casterTokenId);
    const casterActor = casterToken?.actor ?? game.actors.get(dmgCtx.casterActorId);
    if (!(game.user.isGM || casterActor?.isOwner)) {
        return ui.notifications.warn("Применить урон может GM или владелец кастера.");
    }

    await emitToGM({
        type: "APPLY_SPELL_RESULT",
        sourceMessageId: dmgCtx.sourceMessageId,
        defenderTokenId: dmgCtx.defenderTokenId,
        baseDamage: dmgCtx.baseDamage,
        damageMode: dmgCtx.damageMode || "damage",
        nat20: !!dmgCtx.nat20,
        mode
    });
}

/* ----------------------------- GM bus ----------------------------- */

async function emitToGM(payload) {
    D("emitToGM called", payload);
    D("emitToGM: I am GM, handling locally");
    // Если я GM — обрабатываю сразу
    if (game.user.isGM) return handleGMRequest(payload);

    const gmIds = game.users?.filter(u => u.isGM && u.active).map(u => u.id) ?? [];
    if (gmIds.length) {
        await ChatMessage.create({
            content: `<p>Шина заклинания: ${payload.type}</p>`,
            whisper: gmIds,
            flags: { Order: { spellBus: { payload } } }
        });
        return;
    }

    // Fallback: если GM нет, шлём автору исходного сообщения атаки
    const srcId = payload.messageId || payload.sourceMessageId || payload.srcMessageId;
    const srcMsg = srcId ? game.messages.get(srcId) : null;

    const authorId =
        srcMsg?.user?.id ??
        srcMsg?.author ??
        srcMsg?.data?.user ??
        null;

    // Если автор — это я, можно обработать сразу
    if (authorId && authorId === game.user.id) {
        return handleGMRequest(payload);
    }

    D("emitToGM: sending whisper to GMs", gmIds);

    // Если автор найден — шепчем ему
    if (authorId) {
        await ChatMessage.create({
            content: `<p>Шина заклинания: ${payload.type}</p>`,
            whisper: [authorId],
            flags: { Order: { spellBus: { payload } } }
        });
        return;
    }

    ui.notifications.error("Не найден GM (и не удалось определить автора сообщения атаки) для отправки запроса.");
}


async function handleGMRequest(payload) {
    D("handleGMRequest", payload);

    const type = payload?.type;
    if (!type) return;

    if (type === "RESOLVE_SPELL_DEFENSE") return gmResolveSpellDefense(payload);
    if (type === "APPLY_SPELL_RESULT") return gmApplySpellResult(payload);
    if (type === "APPLY_SPELL_EFFECTS") return gmApplySpellEffects(payload);

}

async function gmResolveSpellDefense({ messageId,
    defenseType,
    defenseTotal,
    defenseSkillId,
    defenseSkillName,
    defenseSpellId,
    defenseSpellName,
    defenseCastFailed,
    defenseCastTotal }) {
    D("gmResolveSpellDefense START", { messageId, defenseType, defenseTotal, defenseSpellName, defenseCastFailed, defenseCastTotal });

    const message = game.messages.get(messageId);
    const ctx = message?.getFlag(FLAG_SCOPE, FLAG_ATTACK);
    D("gmResolveSpellDefense ctx", { state: ctx?.state, attackTotal: ctx?.attackTotal, casterActorId: ctx?.casterActorId, defenderActorId: ctx?.defenderActorId });

    if (!message || !ctx) return;
    const authorId =
        message?.user?.id ??
        message?.author ??
        message?.data?.user ??
        null;

    if (!game.user.isGM && authorId && authorId !== game.user.id) return;

    if (ctx.state === "resolved") return;

    const casterToken = canvas.tokens.get(ctx.casterTokenId);
    const defenderToken = canvas.tokens.get(ctx.defenderTokenId);
    const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
    const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
    if (!casterActor || !defenderActor) return;

    const attackTotal = Number(ctx.attackTotal) || 0;
    const def = Number(defenseTotal) || 0;

    const hit = attackTotal >= def;

    const defenseLabel =
        defenseType === "spell" ? `заклинание: ${defenseSpellName || "—"}` :
            defenseType === "skill" ? `навык: ${defenseSkillName || "—"}` :
                defenseType;

    let extraSpellInfo = "";
    if (defenseType === "spell") {
        extraSpellInfo = defenseCastFailed
            ? `<p><strong>Заклинание не удалось:</strong> бросок каста ${defenseCastTotal ?? "—"}</p>`
            : `<p><strong>Бросок каста:</strong> ${defenseCastTotal ?? "—"}</p>`;
    }


    D("updating source message flags", { hit, attackTotal, def: defenseTotal });

    await message.update({
        [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.state`]: "resolved",
        [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseType`]: defenseType,
        [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.defenseTotal`]: def,
        [`flags.${FLAG_SCOPE}.${FLAG_ATTACK}.hit`]: hit,
        "flags.Order.spellAttack.defenseSpellId": defenseType === "spell" ? (defenseSpellId || null) : null,
        "flags.Order.spellAttack.defenseSpellName": defenseType === "spell" ? (defenseSpellName || null) : null,
        "flags.Order.spellAttack.defenseCastFailed": defenseType === "spell" ? !!defenseCastFailed : null,
        "flags.Order.spellAttack.defenseCastTotal": defenseType === "spell" ? (Number(defenseCastTotal ?? 0) || 0) : null,
        [`flags.Order.spellAttack.defenseSkillId`]: defenseType === "skill" ? (defenseSkillId || null) : null,
        [`flags.Order.spellAttack.defenseSkillName`]: defenseType === "skill" ? (defenseSkillName || null) : null
    });

    D("source message updated OK");

    D("creating resolve chat message");

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defenderActor, token: defenderToken }),
        content: `<p><strong>${defenderToken?.name ?? defenderActor.name}</strong> защищается: <strong>${defenseLabel}</strong> → ${def}. ${extraSpellInfo} Итог: <strong>${hit ? "ПОПАДАНИЕ" : "ПРОМАХ"}</strong>.</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    D("resolve chat message created");

    if (!hit) return;

    await createSpellPostHitMessages({
        messageId,
        ctx,
        casterActor,
        casterToken,
        defenderActor,
        defenderToken
    });
}

async function createSpellPostHitMessages({ messageId, ctx, casterActor, casterToken, defenderActor, defenderToken }) {
    if (!ctx) return;

    // EffectThreshold (Stage 3.1)
    const spellEffectThreshold = Number((casterActor?.items?.get?.(ctx.spellId)?.system?.EffectThreshold) ?? ctx.effectThreshold ?? 0) || 0;

    if (spellEffectThreshold > 0) {
        const ok = (Number(ctx.attackTotal ?? 0) || 0) >= spellEffectThreshold;

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
            content: `<p><strong>Порог эффекта:</strong> ${spellEffectThreshold}. Итог атаки: ${ctx.attackTotal}. ${ok ? "<strong>Порог достигнут</strong>." : "<strong>Порог не достигнут</strong>."}</p>`,
            type: CONST.CHAT_MESSAGE_TYPES.OTHER
        });

        if (ok) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
                content: `
        <div class="order-spell-effects-card">
          <p><strong>Эффекты заклинания:</strong> ${ctx.spellName}</p>
          <p><strong>Цель:</strong> ${defenderToken?.name ?? defenderActor?.name}</p>
          <button class="order-spell-apply-effects">Применить эффекты</button>
        </div>
      `,
                type: CONST.CHAT_MESSAGE_TYPES.OTHER,
                flags: {
                    Order: {
                        spellEffects: {
                            sourceMessageId: messageId,
                            casterTokenId: ctx.casterTokenId,
                            casterActorId: ctx.casterActorId,
                            defenderTokenId: ctx.defenderTokenId,
                            defenderActorId: ctx.defenderActorId,
                            spellId: ctx.spellId,
                            spellName: ctx.spellName,
                            attackTotal: ctx.attackTotal
                        }
                    }
                }
            });
        }
    }

    // If we hit and we have something to apply (damage/heal), create a new message with buttons.
    const baseDamage = Number(ctx.baseDamage ?? 0) || 0;
    if (!baseDamage) return;

    const nat20 = !!ctx.nat20;
    const critNote = nat20
        ? `<p style="color:#c00;"><strong>КРИТ:</strong> урон/лечение ×2.</p>`
        : "";

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
        content: `
      <div class="order-spell-apply-card">
        <p><strong>Применить результат заклинания:</strong> ${ctx.spellName}</p>
        <p><strong>Цель:</strong> ${defenderToken?.name ?? defenderActor?.name}</p>
        <p><strong>База (${String(ctx.damageMode || "damage") === "heal" ? "лечение" : "урон"}):</strong> ${Math.abs(baseDamage)}</p>
        ${critNote}
        <button class="order-spell-apply" data-mode="armor">${String(ctx.damageMode || "damage") === "heal" ? "Применить лечение" : "Урон с учётом брони"}</button>
        ${String(ctx.damageMode || "damage") === "heal" ? "" : `<button class="order-spell-apply" data-mode="pierce">Урон сквозь броню</button>`}
      </div>
    `,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
        flags: {
            Order: {
                spellDamage: {
                    sourceMessageId: messageId,
                    casterTokenId: ctx.casterTokenId,
                    casterActorId: ctx.casterActorId,
                    defenderTokenId: ctx.defenderTokenId,
                    baseDamage,
                    damageMode: ctx.damageMode || "damage",
                    nat20
                }
            }
        }
    });
}

async function gmApplySpellResult({ sourceMessageId, defenderTokenId, baseDamage, damageMode, nat20, mode }) {
    // Anti double-apply: mark on source attack message
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

    // Crit: x2 only for damage/heal
    const critMult = nat20 ? 2 : 1;

    // Convention:
    // - positive value = damage
    // - negative value = healing (Stage 3 can make separate field)
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

    // Damage
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

/* ----------------------------- Helpers ----------------------------- */

function getSystem(obj) {
    return obj?.system ?? obj?.data?.system ?? {};
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

function actorHasEquippedWeaponTag(actor, tag) {
    const items = actor?.items ?? [];
    return items.some(i => {
        if (!i) return false;
        if (i.type !== "meleeweapon" && i.type !== "rangeweapon") return false;
        const sys = getItemSystem(i);
        if (!sys?.inHand) return false;
        const tags = Array.isArray(sys?.tags) ? sys.tags : [];
        return tags.includes(tag);
    });
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

async function rollActorCharacteristic(actor, attribute) {
    const { value, mods } = getCharacteristicValueAndMods(actor, attribute);

    const parts = ["1d20"];
    if (value) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
    if (mods) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);

    const roll = await new Roll(parts.join(" ")).roll({ async: true });
    const flavor = buildCombatRollFlavor({
        scene: "Магия",
        action: "Защита",
        source: "Реакция",
        rollMode: "normal",
        characteristic: attribute,
        applyModifiers: true
    });

    await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor
    });

    return roll;
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
    const max = Number(sys?.Health?.max ?? 0); // если у тебя есть max, иначе просто +amount
    const rawNext = cur + (Number(amount) || 0);
    const next = max > 0 ? Math.min(rawNext, max) : rawNext;
    await actor.update({ "system.Health.value": next });
}


async function onSpellApplyEffectsClick(event) {
    event.preventDefault();

    const msgId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
    if (!msgId) return;

    const message = game.messages.get(msgId);
    const effCtx = message?.getFlag("Order", "spellEffects");
    if (!effCtx) return ui.notifications.error("В сообщении нет контекста эффектов.");

    // кто может нажимать: GM или владелец кастера
    const casterToken = canvas.tokens.get(effCtx.casterTokenId);
    const casterActor = casterToken?.actor ?? game.actors.get(effCtx.casterActorId);
    if (!(game.user.isGM || casterActor?.isOwner)) {
        return ui.notifications.warn("Применить эффекты может GM или владелец кастера.");
    }

    await emitToGM({
        type: "APPLY_SPELL_EFFECTS",
        sourceMessageId: effCtx.sourceMessageId,
        casterActorId: effCtx.casterActorId,
        casterTokenId: effCtx.casterTokenId,
        defenderActorId: effCtx.defenderActorId,
        defenderTokenId: effCtx.defenderTokenId,
        spellId: effCtx.spellId,
        attackTotal: effCtx.attackTotal
    });
}

async function gmApplySpellEffects({ sourceMessageId, casterActorId, casterTokenId, defenderActorId, defenderTokenId, spellId, attackTotal }) {
    // anti-double apply: mark on source attack message
    if (sourceMessageId) {
        const src = game.messages.get(sourceMessageId);
        const ctx = src?.getFlag("Order", "spellAttack");
        if (ctx?.effectsApplied) return;
        if (src) await src.update({ "flags.Order.spellAttack.effectsApplied": true });
    }

    const casterToken = canvas.tokens.get(casterTokenId);
    const casterActor = casterToken?.actor ?? game.actors.get(casterActorId);

    const defenderToken = canvas.tokens.get(defenderTokenId);
    const targetActor = defenderToken?.actor ?? game.actors.get(defenderActorId);

    if (!casterActor || !targetActor) return;

    // spell item from caster inventory
    const spellItem = casterActor.items.get(spellId);
    if (!spellItem) {
        ui.notifications?.warn?.("Заклинание не найдено у кастера.");
        return;
    }

    await applySpellEffects({ casterActor, targetActor, spellItem, attackTotal: Number(attackTotal ?? 0) || 0 });
}

