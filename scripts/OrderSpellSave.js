import { applySpellEffects } from "./OrderSpellEffects.js";

const FLAG_SCOPE = "Order";
const FLAG_SAVE = "spellSave";

export function registerOrderSpellSaveHandlers() {
  $(document)
    .off("click.order-spell-save-roll")
    .on("click.order-spell-save-roll", ".order-spell-save-roll", onSaveRollClick);

  $(document)
    .off("click.order-spell-save-apply")
    .on("click.order-spell-save-apply", ".order-spell-save-apply", onApplyClick);

  $(document)
    .off("click.order-spell-save-apply-effects")
    .on("click.order-spell-save-apply-effects", ".order-spell-save-apply-effects", onApplyEffectsClick);

  console.log("OrderSpellSave | Handlers registered");
}

export function registerOrderSpellSaveBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;
      const bus = message.getFlag("Order", "spellBus");
      if (!bus) return;
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderSpellSave | BUS handler error", e);
    }
  });

  console.log("OrderSpellSave | BUS listener registered");
}

/**
 * Entry point from OrderSpell.js after successful cast.
 */
export async function startSpellSaveWorkflow({
  casterActor,
  casterToken,
  spellItem,
  castRoll
}) {
  const s = getSystem(spellItem);
  const delivery = String(s.DeliveryType || "utility");
  if (delivery !== "save-check") return;

  const targets = Array.from(game.user.targets ?? []);
  if (targets.length !== 1) {
    ui.notifications.warn("Для заклинания с проверкой нужно выбрать ровно 1 цель (target).");
    return;
  }

  const targetToken = targets[0];
  const targetActor = targetToken?.actor;
  if (!targetActor) {
    ui.notifications.warn("Цель не имеет актёра.");
    return;
  }

  const saveAbility = String(s.SaveAbility || "").trim();
  if (!saveAbility) {
    ui.notifications.warn("У заклинания не задана характеристика проверки (SaveAbility).");
    return;
  }

  const dcFormula = String(s.SaveDCFormula || "").trim();
  const dc = parseDCFormula(dcFormula, casterActor);
  if (!Number.isFinite(dc)) {
    ui.notifications.warn(`Не удалось вычислить DC из формулы: "${dcFormula}".`);
    return;
  }

  const rollHTML = castRoll ? await castRoll.render() : "";

  const ctx = {
    casterTokenId: casterToken?.id ?? null,
    casterActorId: casterActor?.id ?? null,

    targetTokenId: targetToken?.id ?? null,
    targetActorId: targetActor?.id ?? null,

    spellId: spellItem?.id ?? null,
    spellName: spellItem?.name ?? "",
    spellImg: spellItem?.img ?? "",

    saveAbility,
    dcFormula,
    dc,

    castTotal: Number(castRoll?.total ?? 0) || 0,
    nat20: isNaturalTwenty(castRoll),

    baseDamage: Number(s.Damage ?? 0) || 0,
    state: "awaitingSave",
    createdAt: Date.now()
  };

  const content = `
    <div class="order-spell-save-card">
      <div style="display:flex; gap:8px; align-items:center;">
        <img src="${ctx.spellImg}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${ctx.spellName}</h3>
      </div>

      <p><strong>Кастер:</strong> ${casterToken?.name ?? casterActor.name}</p>
      <p><strong>Цель:</strong> ${targetToken?.name ?? targetActor.name}</p>
      <p><strong>Проверка цели:</strong> ${saveAbility}</p>
      <p><strong>Сложность (DC):</strong> ${dc} <span style="opacity:.8;">(${escapeHtml(dcFormula)})</span></p>

      <p><strong>Результат каста:</strong> ${ctx.castTotal}${ctx.nat20 ? ` <span style="color:#c00;font-weight:700;">[КРИТ]</span>` : ""}</p>
      <div class="inline-roll">${rollHTML}</div>

      ${ctx.baseDamage ? `<p><strong>Базовый урон/лечение:</strong> ${ctx.baseDamage}</p>` : ""}

      <hr/>
      <p><strong>Действие цели:</strong></p>
      <button class="order-spell-save-roll">Сделать проверку (${saveAbility})</button>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { Order: { [FLAG_SAVE]: ctx } }
  });
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

  // Only target owner (or GM)
  if (!(game.user.isGM || targetActor.isOwner)) {
    ui.notifications.warn("Проверку может сделать только владелец цели (или GM).");
    return;
  }

  const roll = await rollActorCharacteristic(targetActor, ctx.saveAbility);
  const total = Number(roll.total ?? 0);

  await emitToGM({
    type: "RESOLVE_SPELL_SAVE",
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
  const dmgCtx = message?.getFlag("Order", "spellSaveDamage");
  if (!dmgCtx) return ui.notifications.error("В сообщении нет контекста урона save-check.");

  const casterToken = canvas.tokens.get(dmgCtx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(dmgCtx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить урон/лечение может GM или владелец кастера.");
  }

  await emitToGM({
    type: "APPLY_SPELL_SAVE_DAMAGE",
    sourceMessageId: dmgCtx.sourceMessageId,
    targetTokenId: dmgCtx.targetTokenId,
    baseDamage: dmgCtx.baseDamage,
    nat20: !!dmgCtx.nat20,
    mode
  });
}

async function onApplyEffectsClick(event) {
  event.preventDefault();

  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const effCtx = message?.getFlag("Order", "spellSaveEffects");
  if (!effCtx) return ui.notifications.error("В сообщении нет контекста эффектов.");

  const casterToken = canvas.tokens.get(effCtx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(effCtx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить эффекты может GM или владелец кастера.");
  }

  await emitToGM({
    type: "APPLY_SPELL_SAVE_EFFECTS",
    sourceMessageId: effCtx.sourceMessageId,
    casterActorId: effCtx.casterActorId,
    casterTokenId: effCtx.casterTokenId,
    targetActorId: effCtx.targetActorId,
    targetTokenId: effCtx.targetTokenId,
    spellId: effCtx.spellId,
    castTotal: effCtx.castTotal
  });
}

/* ----------------------------- GM bus ----------------------------- */

async function emitToGM(payload) {
  if (game.user.isGM) return handleGMRequest(payload);

  const gmIds = game.users?.filter(u => u.isGM && u.active).map(u => u.id) ?? [];
  if (!gmIds.length) {
    ui.notifications.error("Не найден GM для отправки запроса.");
    return;
  }

  await ChatMessage.create({
    content: `<p>Spell bus: ${payload.type}</p>`,
    whisper: gmIds,
    flags: { Order: { spellBus: { payload } } }
  });
}

async function handleGMRequest(payload) {
  const type = payload?.type;
  if (!type) return;

  if (type === "RESOLVE_SPELL_SAVE") return gmResolveSpellSave(payload);
  if (type === "APPLY_SPELL_SAVE_DAMAGE") return gmApplySpellSaveDamage(payload);
  if (type === "APPLY_SPELL_SAVE_EFFECTS") return gmApplySpellSaveEffects(payload);
}

async function gmResolveSpellSave({ messageId, saveTotal }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_SAVE);
  if (!message || !ctx) return;

  if (ctx.state === "resolved") return;

  const targetToken = canvas.tokens.get(ctx.targetTokenId);
  const targetActor = targetToken?.actor ?? game.actors.get(ctx.targetActorId);
  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!targetActor || !casterActor) return;

  const dc = Number(ctx.dc ?? 0) || 0;
  const total = Number(saveTotal ?? 0) || 0;

  const success = total >= dc;

  await message.update({
    [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.state`]: "resolved",
    [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.saveTotal`]: total,
    [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.success`]: success
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor, token: targetToken }),
    content: `<p><strong>${targetToken?.name ?? targetActor.name}</strong> делает проверку <strong>${ctx.saveAbility}</strong>: ${total} против DC ${dc} → <strong>${success ? "УСПЕХ" : "ПРОВАЛ"}</strong>.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });

  // По твоим правилам нет "половины урона при успехе".
  // Поэтому базовый урон/лечение и эффекты даём кнопками только на ПРОВАЛ (MVP).
  if (success) return;

  const baseDamage = Number(ctx.baseDamage ?? 0) || 0;
  const nat20 = !!ctx.nat20;

  if (baseDamage) {
    const critNote = nat20 ? `<p style="color:#c00;"><strong>КРИТ:</strong> урон/лечение ×2.</p>` : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
      content: `
        <div class="order-spell-save-apply-card">
          <p><strong>Применить урон/лечение:</strong> ${ctx.spellName}</p>
          <p><strong>Цель:</strong> ${targetToken?.name ?? targetActor.name}</p>
          <p><strong>База:</strong> ${baseDamage}</p>
          ${critNote}
          <button class="order-spell-save-apply" data-mode="armor">Урон с учётом брони</button>
          <button class="order-spell-save-apply" data-mode="pierce">Урон сквозь броню</button>
        </div>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      flags: {
        Order: {
          spellSaveDamage: {
            sourceMessageId: messageId,
            casterTokenId: ctx.casterTokenId,
            casterActorId: ctx.casterActorId,
            targetTokenId: ctx.targetTokenId,
            baseDamage,
            nat20
          }
        }
      }
    });
  }

  // Эффекты (debuff/text) — тоже только на провал (MVP)
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `
      <div class="order-spell-save-effects-card">
        <p><strong>Эффекты заклинания:</strong> ${ctx.spellName}</p>
        <p><strong>Цель:</strong> ${targetToken?.name ?? targetActor.name}</p>
        <button class="order-spell-save-apply-effects">Применить эффекты</button>
      </div>
    `,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      Order: {
        spellSaveEffects: {
          sourceMessageId: messageId,
          casterTokenId: ctx.casterTokenId,
          casterActorId: ctx.casterActorId,
          targetTokenId: ctx.targetTokenId,
          targetActorId: ctx.targetActorId,
          spellId: ctx.spellId,
          castTotal: ctx.castTotal
        }
      }
    }
  });
}

async function gmApplySpellSaveDamage({ sourceMessageId, targetTokenId, baseDamage, nat20, mode }) {
  // anti-double apply on source message
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

  const critMult = nat20 ? 2 : 1;

  // convention: positive = damage, negative = healing
  const isHeal = raw < 0;

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

async function gmApplySpellSaveEffects({ sourceMessageId, casterActorId, casterTokenId, targetActorId, targetTokenId, spellId, castTotal }) {
  // anti-double apply on source
  if (sourceMessageId) {
    const src = game.messages.get(sourceMessageId);
    const ctx = src?.getFlag(FLAG_SCOPE, FLAG_SAVE);
    if (ctx?.effectsApplied) return;
    if (src) await src.update({ [`flags.${FLAG_SCOPE}.${FLAG_SAVE}.effectsApplied`]: true });
  }

  const casterToken = canvas.tokens.get(casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(casterActorId);

  const targetToken = canvas.tokens.get(targetTokenId);
  const targetActor = targetToken?.actor ?? game.actors.get(targetActorId);

  if (!casterActor || !targetActor) return;

  const spellItem = casterActor.items.get(spellId);
  if (!spellItem) {
    ui.notifications?.warn?.("Заклинание не найдено у кастера.");
    return;
  }

  await applySpellEffects({
    casterActor,
    targetActor,
    spellItem,
    attackTotal: Number(castTotal ?? 0) || 0
  });
}

/* ----------------------------- DC parser ----------------------------- */

function parseDCFormula(formula, casterActor) {
  const f = String(formula ?? "").trim();
  if (!f) return NaN;

  // Normalize: allow russian "магия" already migrated but be defensive
  const norm = f
    .replace(/магия/gi, "Magic")
    .replace(/ловкость/gi, "Dexterity")
    .replace(/выносливость/gi, "Stamina")
    .replace(/сила/gi, "Strength")
    .replace(/знания/gi, "Knowledge")
    .replace(/\s+/g, " ")
    .trim();

  // 1) Just a number
  if (/^\d+$/.test(norm)) return Number(norm);

  // 2) "10 + Magic" or "Magic + 10" (also support "-")
  // tokens split by space, allow "10+Magic" style
  const compact = norm.replace(/\s+/g, "");
  const m1 = compact.match(/^(\d+)([+\-])([A-Za-z]+)$/);
  const m2 = compact.match(/^([A-Za-z]+)([+\-])(\d+)$/);

  if (m1) {
    const base = Number(m1[1]);
    const op = m1[2];
    const stat = m1[3];
    const v = getCharacteristicValue(casterActor, stat);
    return op === "+" ? (base + v) : (base - v);
  }

  if (m2) {
    const stat = m2[1];
    const op = m2[2];
    const base = Number(m2[3]);
    const v = getCharacteristicValue(casterActor, stat);
    return op === "+" ? (v + base) : (v - base);
  }

  // 3) Fallback: "10 + Magic" spaced
  const parts = norm.split(" ");
  if (parts.length === 3 && /^\d+$/.test(parts[0]) && (parts[1] === "+" || parts[1] === "-")) {
    const base = Number(parts[0]);
    const v = getCharacteristicValue(casterActor, parts[2]);
    return parts[1] === "+" ? (base + v) : (base - v);
  }

  return NaN;
}

function getCharacteristicValue(actor, key) {
  const sys = getSystem(actor);
  const obj = sys?.[key];
  return Number(obj?.value ?? 0) || 0;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ----------------------------- Common helpers ----------------------------- */

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
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Проверка: ${attribute}`
  });
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
  return best;
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
