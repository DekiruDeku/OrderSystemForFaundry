/**
 * OrderSystem - Melee Attack / Defense flow (Foundry VTT v11)
 *
 * ВАЖНОЕ ИСПРАВЛЕНИЕ ДЛЯ PREEMPT ОТ ИГРОКА:
 * - Игрок выбирает "удар на опережение" -> диалог характеристики -> emitToGM() с payload.preempt
 * - GM ОБЯЗАН взять weaponId + characteristic из payload.preempt, иначе поток “умирает”
 */

const FLAG_SCOPE = "Order";
const FLAG_KEY = "attack";

const SOCKET_SCOPE = "OrderMelee";
const SOCKET_CHANNEL = () => "system.Order";

export function registerOrderMeleeHandlers() {
  $(document)
    .off("click.order-defense")
    .on("click.order-defense", ".order-defense", onDefenseClick);

  $(document)
    .off("click.order-apply-damage")
    .on("click.order-apply-damage", ".order-apply-damage", onApplyDamageClick);

  $(document)
    .off("click.order-defense-vs-preempt")
    .on("click.order-defense-vs-preempt", ".order-defense-vs-preempt", onDefenseVsPreemptClick);

  console.log("OrderMelee | Handlers registered");
}

/* -------------------------------------------- */
/*  Attack message creation                       */
/* -------------------------------------------- */

export async function createMeleeAttackMessage({
  attackerActor,
  attackerToken,
  defenderToken,
  weapon,
  characteristic,
  applyModifiers,
  customModifier,
  attackRoll,
  damage
}) {
  const attackTotal = Number(attackRoll?.total ?? 0);
  const weaponDamage = Number(damage ?? 0);

  const attackNat20 = isNat20(attackRoll);

  const ctx = {
    attackerTokenId: attackerToken?.id ?? null,
    attackerActorId: attackerActor?.id ?? null,

    defenderTokenId: defenderToken?.id ?? null,
    defenderActorId: defenderToken?.actor?.id ?? null,

    weaponId: weapon?.id ?? null,
    weaponName: weapon?.name ?? "",
    weaponImg: weapon?.img ?? "",

    characteristic: characteristic ?? null,
    applyModifiers: !!applyModifiers,
    customModifier: Number(customModifier) || 0,

    attackTotal,
    attackNat20,
    damage: weaponDamage,

    state: "awaitingDefense",
    createdAt: Date.now()
  };

  const charText = applyModifiers
    ? (game.i18n?.localize?.(characteristic) ?? characteristic)
    : "Без характеристики";

  const rollHTML = attackRoll ? await attackRoll.render() : "";

  const content = `
    <div class="chat-attack-message order-melee" data-order-attack="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${weapon?.img ?? ""}" alt="${weapon?.name ?? ""}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${weapon?.name ?? "Атака"}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Цель:</strong> ${defenderToken?.name ?? "—"}</p>
        <p><strong>Характеристика атаки:</strong> ${charText}</p>
        <p><strong>Урон (потенциал):</strong> ${weaponDamage}</p>
        <p><strong>Результат атаки:</strong> ${attackTotal}${attackNat20 ? ' <span style="color:#b00;"><strong>(КРИТ 20)</strong></span>' : ""}</p>
        <div class="inline-roll">${rollHTML}</div>
      </div>

      <hr/>

      <div class="defense-buttons">
        <p><strong>Защита цели:</strong> выбери реакцию</p>
        <button class="order-defense" data-defense="dodge">Уворот (Dexterity)</button>
        <button class="order-defense" data-defense="block">Блок (Strength)</button>
        <button class="order-defense" data-defense="preempt">Удар на опережение</button>
      </div>
    </div>
  `;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { [FLAG_SCOPE]: { [FLAG_KEY]: ctx } }
  });
}

/* -------------------------------------------- */
/*  Client click handlers                        */
/* -------------------------------------------- */

async function onDefenseClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const messageEl = button.closest?.(".message");
  const messageId = messageEl?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение атаки.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!ctx) return ui.notifications.error("В сообщении нет контекста атаки.");

  if (ctx.state !== "awaitingDefense") {
    ui.notifications.warn("Эта атака уже разрешена или ожидает другой шаг.");
    return;
  }

  const defenderToken = canvas.tokens.get(ctx.defenderTokenId);
  const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
  if (!defenderActor) return ui.notifications.error("Не найден защитник.");

  // Защиту выбирает владелец цели (или GM)
  if (!(defenderActor.isOwner || game.user.isGM)) {
    ui.notifications.warn("Защиту может выбрать только владелец цели (или GM).");
    return;
  }

  const defenseType = button.dataset.defense;

  // PREEMPT
  if (defenseType === "preempt") {
    const melee = findEquippedMeleeWeapon(defenderActor);

    const availableChars = getAvailableCharacteristics(defenderActor);
    const chosenChar = await promptSelectCharacteristic({
      title: "Удар на опережение: выбрать характеристику атаки",
      choices: availableChars,
      defaultKey: availableChars[0]?.key
    });

    if (!chosenChar) {
      ui.notifications.info("Удар на опережение: выбор отменён.");
      return;
    }

    console.log("OrderMelee | Preempt selected characteristic:", chosenChar, "weapon:", melee?.id ?? null);

    await emitToGM({
      type: "RESOLVE_DEFENSE",
      messageId,
      defenseType: "preempt",
      defenseTotal: null,
      defenderUserId: game.user.id,
      preempt: {
        weaponId: melee?.id ?? null,
        characteristic: chosenChar
      }
    });

    return;
  }

  // DODGE / BLOCK
  let defenseAttr = null;
  if (defenseType === "dodge") defenseAttr = "Dexterity";
  if (defenseType === "block") defenseAttr = "Strength";

  const defenseRoll = await rollActorCharacteristic(defenderActor, defenseAttr);
  const defenseTotal = Number(defenseRoll.total ?? 0);

  await emitToGM({
    type: "RESOLVE_DEFENSE",
    messageId,
    defenseType,
    defenseTotal,
    defenderUserId: game.user.id
  });
}

async function onDefenseVsPreemptClick(event) {
  event.preventDefault();

  const btn = event.currentTarget;
  const srcMessageId = btn.dataset.src;
  const defenseType = btn.dataset.defense;

  const message = game.messages.get(srcMessageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!message || !ctx) return ui.notifications.error("Не найдено исходное сообщение preempt.");

  if (ctx.state !== "awaitingPreemptDefense") {
    ui.notifications.warn("Сейчас не ожидается защита против Удара на опережение.");
    return;
  }

  const attackerToken = canvas.tokens.get(ctx.attackerTokenId);
  const attackerActor = attackerToken?.actor ?? game.actors.get(ctx.attackerActorId);
  if (!attackerActor) return ui.notifications.error("Не найден атакующий.");

  // защищается владелец атакующего (или GM)
  if (!(attackerActor.isOwner || game.user.isGM)) {
    ui.notifications.warn("Эту защиту выбирает владелец атакующего (или GM).");
    return;
  }

  let attr = null;
  if (defenseType === "dodge") attr = "Dexterity";
  if (defenseType === "block") attr = "Strength";

  const roll = await rollActorCharacteristic(attackerActor, attr);
  const total = Number(roll.total ?? 0);

  await emitToGM({
    type: "PREEMPT_DEFENSE",
    srcMessageId,
    defenseType,
    defenseTotal: total,
    userId: game.user.id
  });
}

async function onApplyDamageClick(event) {
  event.preventDefault();

  const btn = event.currentTarget;
  const mode = btn.dataset.mode;                 // "armor" | "true"
  const defenderTokenId = btn.dataset.tokenId;
  const baseDamage = Number(btn.dataset.dmg) || 0;
  const sourceMessageId = btn.dataset.src;
  const isCrit = btn.dataset.crit === "1";       // "1" если крит-кнопка

  await emitToGM({
    type: "APPLY_DAMAGE",
    defenderTokenId,
    baseDamage,
    mode,
    isCrit,
    sourceMessageId,
    userId: game.user.id
  });
}

/* -------------------------------------------- */
/*  Socket dispatch                              */
/* -------------------------------------------- */

export async function handleGMRequest(payload) {
  try {
    const { type } = payload ?? {};
    if (!type) return;

    // ЛОГ ДЛЯ GM, чтобы сразу видеть пришёл ли payload от игрока
    if (game.user.isGM) console.log("OrderMelee | GM handle payload:", payload);

    if (type === "RESOLVE_DEFENSE") return await gmResolveDefense(payload);
    if (type === "APPLY_DAMAGE") return await gmApplyDamage(payload);
    if (type === "PREEMPT_DEFENSE") return await gmResolvePreemptDefense(payload);
  } catch (e) {
    console.error("OrderMelee | handleGMRequest ERROR", e, payload);
  }
}

/**
 * IMPORTANT:
 * If current user is GM, process locally too (socket may not echo back)
 */
async function emitToGM(data) {
  const payload = { scope: SOCKET_SCOPE, ...data };

  if (game.user.isGM) {
    try {
      console.log("OrderMelee | Local GM handleGMRequest()", payload);
      await handleGMRequest(payload);
    } catch (e) {
      console.error("OrderMelee | Local GM handleGMRequest ERROR", e, payload);
    }
  }

  try {
    console.log("OrderMelee | socket.emit ->", SOCKET_CHANNEL(), payload);
    return game.socket.emit(SOCKET_CHANNEL(), payload);
  } catch (e) {
    console.error("OrderMelee | socket.emit ERROR", e, payload);
  }
}

/* -------------------------------------------- */
/*  Rolls / system getters                       */
/* -------------------------------------------- */

function getActorSystem(actor) {
  return actor?.system ?? actor?.data?.system ?? {};
}
function getItemSystem(item) {
  return item?.system ?? item?.data?.system ?? {};
}

/**
 * Более “живучее” извлечение:
 * - sys[key].value
 * - sys[key].modifiers
 * - sys.MaxModifiers (если у вас общий массив активных влияний)
 */
function getCharacteristicValueAndMods(actor, key) {
  const sys = getActorSystem(actor);

  const obj = sys?.[key] ?? null;
  const value = Number(obj?.value ?? 0) || 0;

  // 1) локальные модификаторы в характеристике
  const localModsArray =
    obj?.modifiers ??
    obj?.maxModifiers ??
    obj?.MaxModifiers ??
    [];

  let localSum = 0;
  if (Array.isArray(localModsArray)) {
    localSum = localModsArray.reduce((acc, m) => acc + (Number(m?.value) || 0), 0);
  }

  // 2) глобальные модификаторы актёра (если у вас так устроено)
  const globalModsArray = sys?.MaxModifiers ?? sys?.maxModifiers ?? [];
  let globalSum = 0;

  if (Array.isArray(globalModsArray)) {
    globalSum = globalModsArray.reduce((acc, m) => {
      const v = Number(m?.value) || 0;

      const k =
        m?.characteristic ??
        m?.Characteristic ??
        m?.key ??
        m?.attr ??
        m?.attribute ??
        null;

      if (!k) return acc;
      if (String(k) === String(key)) return acc + v;

      return acc;
    }, 0);
  }

  return { value, mods: localSum + globalSum };
}

async function rollActorCharacteristic(actor, attribute) {
  const { value, mods } = getCharacteristicValueAndMods(actor, attribute);

  const parts = ["1d20"];
  if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
  if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);

  const roll = await new Roll(parts.join(" ")).roll({ async: true });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Защита: ${attribute}${mods ? ` (моды ${mods})` : ""}`
  });

  return roll;
}

function isNat20(roll) {
  try {
    if (!roll) return false;
    const terms = roll.terms ?? [];
    for (const t of terms) {
      if (!t || typeof t !== "object") continue;
      if (t.faces !== 20) continue;

      const results = t.results ?? [];
      const active = results.filter(r => r?.active !== false);
      const used = active.length ? active : results;
      if (used.some(r => Number(r.result) === 20)) return true;
    }
  } catch (e) {
    console.warn("OrderMelee | isNat20 error", e);
  }
  return false;
}

/* -------------------------------------------- */
/*  Preempt helpers                              */
/* -------------------------------------------- */

function findEquippedMeleeWeapon(actor) {
  const items = actor?.items ?? [];
  const melee = items.filter(i => i?.type === "meleeweapon");
  if (!melee.length) return null;

  // если у оружия есть isEquiped/isUsed — используем, иначе берём первое
  const strict = melee.find(i => {
    const sys = getItemSystem(i);
    return !!(sys?.isEquiped && sys?.isUsed);
  });
  return strict ?? melee[0] ?? null;
}

function getAvailableCharacteristics(actor) {
  const sys = getActorSystem(actor);

  const keys = [];
  for (const k of Object.keys(sys)) {
    const obj = sys[k];
    if (!obj || typeof obj !== "object") continue;
    if (!("value" in obj)) continue;
    keys.push(k);
  }

  // гарантируем базовые
  const fallback = ["Strength", "Dexterity", "Stamina"];
  const uniq = [...new Set([...fallback, ...keys])];

  const priority = ["Strength", "Dexterity", "Stamina"];
  uniq.sort((a, b) => {
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    const pa = ia === -1 ? 999 : ia;
    const pb = ib === -1 ? 999 : ib;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });

  return uniq.map(k => ({ key: k, label: k }));
}

async function promptSelectCharacteristic({ title, choices, defaultKey }) {
  const optionsHTML = (choices ?? []).map(c => {
    const selected = (c.key === defaultKey) ? "selected" : "";
    return `<option value="${c.key}" ${selected}>${c.label}</option>`;
  }).join("");

  return new Promise(resolve => {
    let resolved = false;

    new Dialog({
      title,
      content: `
        <form>
          <div class="form-group">
            <label>Характеристика атаки:</label>
            <select name="char" style="width:100%">${optionsHTML}</select>
          </div>
        </form>
      `,
      buttons: {
        ok: {
          label: "ОК",
          callback: (html) => {
            const val = html.find("select[name='char']").val();
            resolved = true;
            resolve(val || null);
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => {
            resolved = true;
            resolve(null);
          }
        }
      },
      default: "ok",
      close: () => {
        if (!resolved) resolve(null);
      }
    }).render(true);
  });
}

/**
 * выбранная характеристика добавляется к броску (помеха)
 */
async function rollActorAttackWithDisadvantage(actor, weapon, characteristicKeyOrNull) {
  const charKey = characteristicKeyOrNull;

  const dmg = Number(getItemSystem(weapon)?.Damage ?? 0);

  const parts = ["2d20kl1"]; // помеха

  if (charKey) {
    const { value, mods } = getCharacteristicValueAndMods(actor, charKey);

    console.log("OrderMelee | Preempt roll uses:", { charKey, value, mods });

    if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
    if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
  } else {
    console.log("OrderMelee | Preempt roll: NO characteristic selected (only dice).");
  }

  const roll = await new Roll(parts.join(" ")).roll({ async: true });
  const nat20 = isNat20(roll);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Удар на опережение (помеха). Оружие: ${weapon?.name ?? "—"}, характеристика: ${charKey ?? "без модов"}, урон: ${dmg}${nat20 ? " (КРИТ 20)" : ""}`
  });

  return roll;
}

/* -------------------------------------------- */
/*  GM resolution                                */
/* -------------------------------------------- */

async function gmResolveDefense(payload) {
  try {
    const { messageId, defenseType, defenseTotal } = payload ?? {};

    const message = game.messages.get(messageId);
    const ctx = message?.flags?.[FLAG_SCOPE]?.[FLAG_KEY];
    if (!message || !ctx) return;
    if (ctx.state === "resolved") return;

    const attackerToken = canvas.tokens.get(ctx.attackerTokenId);
    const defenderToken = canvas.tokens.get(ctx.defenderTokenId);
    const attackerActor = attackerToken?.actor ?? game.actors.get(ctx.attackerActorId);
    const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
    if (!attackerActor || !defenderActor) return;

    // IMPORTANT FIX: preempt details come from payload.preempt (player choice)
    if (defenseType === "preempt") {
      return await gmStartPreemptFlow({
        message,
        ctx,
        attackerActor,
        defenderActor,
        attackerToken,
        defenderToken,
        preempt: payload?.preempt ?? null
      });
    }

    // regular defense
    const hit = Number(ctx.attackTotal) > Number(defenseTotal);

    await message.update({
      "flags.Order.attack.state": "resolved",
      "flags.Order.attack.defenseType": defenseType,
      "flags.Order.attack.defenseTotal": Number(defenseTotal) || 0,
      "flags.Order.attack.hit": hit,
      // крит теперь НЕ применяется автоматически урона — только как опция кнопки
      "flags.Order.attack.criticalPossible": !!ctx.attackNat20,
      "flags.Order.attack.criticalForced": false
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
      content: `<p><strong>${defenderToken?.name ?? defenderActor.name}</strong> выбрал защиту: <strong>${defenseType}</strong>. Защита: <strong>${Number(defenseTotal) || 0}</strong>. Итог: <strong>${hit ? "ПОПАДАНИЕ" : "ПРОМАХ"}</strong>${ctx.attackNat20 ? ' <span style="color:#b00;"><strong>(ДОСТУПЕН КРИТ)</strong></span>' : ""}.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    if (hit) {
      await createDamageButtonsMessage({
        attackerActor,
        defenderTokenId: ctx.defenderTokenId,
        baseDamage: Number(ctx.damage) || 0,
        sourceMessageId: messageId,
        criticalPossible: !!ctx.attackNat20,
        criticalForced: false
      });
    }
  } catch (e) {
    console.error("OrderMelee | gmResolveDefense ERROR", e, payload);
  }
}

async function gmStartPreemptFlow({ message, ctx, attackerActor, defenderActor, attackerToken, defenderToken, preempt }) {
  try {
    // FIX: использовать weaponId из payload, а не искать "inHand"
    let meleeWeapon = null;

    if (preempt?.weaponId) {
      meleeWeapon = defenderActor.items.get(preempt.weaponId) ?? defenderActor.items.find(i => i.id === preempt.weaponId);
    }

    // Fallback: найти реальное используемое оружие по вашим полям isEquiped/isUsed
    if (!meleeWeapon) {
      meleeWeapon = defenderActor.items.find(i =>
        i?.type === "meleeweapon" &&
        !!(getItemSystem(i)?.isEquiped) &&
        !!(getItemSystem(i)?.isUsed)
      );
    }

    // Last fallback: первое meleeweapon
    if (!meleeWeapon) {
      meleeWeapon = defenderActor.items.find(i => i?.type === "meleeweapon") ?? null;
    }

    // ВАЖНО: логируем, чтобы на GM сразу видно было что пришло и что нашли
    console.log("OrderMelee | GM preempt received:", preempt);
    console.log("OrderMelee | GM preempt weapon resolved:", meleeWeapon?.id ?? null, meleeWeapon?.name ?? null);

    if (!meleeWeapon || meleeWeapon.type !== "meleeweapon") {
      // Fail-preempt: attacker hits and becomes CRIT FORCED by rules
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
        content: `<p><strong>${defenderToken?.name ?? defenderActor.name}</strong> пытался совершить <strong>Удар на опережение</strong>, но не найдено используемое ближнее оружие (meleeweapon). Считается провалом.</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });

      await message.update({
        "flags.Order.attack.state": "resolved",
        "flags.Order.attack.defenseType": "preempt",
        "flags.Order.attack.preempt": { result: "no-weapon" },
        "flags.Order.attack.hit": true,
        "flags.Order.attack.criticalPossible": true,
        "flags.Order.attack.criticalForced": true
      });

      await createDamageButtonsMessage({
        attackerActor,
        defenderTokenId: ctx.defenderTokenId,
        baseDamage: Number(ctx.damage) || 0,
        sourceMessageId: message.id,
        criticalPossible: true,
        criticalForced: true
      });
      return;
    }

    // FIX: характеристику брать из payload.preempt.characteristic
    const preemptChar = preempt?.characteristic ?? null;
    if (!preemptChar) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
        content: `<p><strong>Удар на опережение</strong>: не выбрана характеристика атаки (payload.preempt.characteristic пуст).</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
      return;
    }

    const preemptRoll = await rollActorAttackWithDisadvantage(defenderActor, meleeWeapon, preemptChar);
    const preemptTotal = Number(preemptRoll.total ?? 0);
    const preemptNat20 = isNat20(preemptRoll);

    const attackerTotal = Number(ctx.attackTotal) || 0;

    if (preemptTotal < attackerTotal) {
      // Absolute fail: attacker attack is CRIT FORCED by rules
      await message.update({
        "flags.Order.attack.state": "resolved",
        "flags.Order.attack.defenseType": "preempt",
        "flags.Order.attack.preemptTotal": preemptTotal,
        "flags.Order.attack.preemptChar": preemptChar,
        "flags.Order.attack.preemptWeaponId": meleeWeapon.id,
        "flags.Order.attack.hit": true,
        "flags.Order.attack.criticalPossible": true,
        "flags.Order.attack.criticalForced": true
      });

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
        content: `<p><strong>Удар на опережение — провал</strong> (${preemptTotal} &lt; ${attackerTotal}). Атака врага считается успешной и <strong>критической</strong> (по правилу).</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });

      await createDamageButtonsMessage({
        attackerActor,
        defenderTokenId: ctx.defenderTokenId,
        baseDamage: Number(ctx.damage) || 0,
        sourceMessageId: message.id,
        criticalPossible: true,
        criticalForced: true
      });
      return;
    }

    // SUCCESS preempt:
    // attacker attack canceled, attacker must defend vs preempt (no choice)
    const preemptBaseDamage = Number(getItemSystem(meleeWeapon)?.Damage ?? 0);

    await message.update({
      "flags.Order.attack.state": "awaitingPreemptDefense",
      "flags.Order.attack.defenseType": "preempt",
      "flags.Order.attack.preemptTotal": preemptTotal,
      "flags.Order.attack.preemptNat20": preemptNat20,
      "flags.Order.attack.preemptChar": preemptChar,
      "flags.Order.attack.preemptWeaponId": meleeWeapon.id,
      "flags.Order.attack.preemptDamage": preemptBaseDamage,
      "flags.Order.attack.preemptCriticalPossible": !!preemptNat20,
      "flags.Order.attack.preemptCriticalForced": false
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: `
        <div class="order-preempt-defense">
          <p><strong>Удар на опережение успешен</strong> (${preemptTotal} ≥ ${attackerTotal}).</p>
          <p>Атака <strong>${attackerActor.name}</strong> отменена. Теперь он защищается против удара на опережение:</p>
          <button class="order-defense-vs-preempt" data-defense="dodge" data-src="${message.id}">Уворот (Dexterity)</button>
          <button class="order-defense-vs-preempt" data-defense="block" data-src="${message.id}">Блок (Strength)</button>
          ${preemptNat20 ? `<p style="color:#b00;"><strong>На преемпте доступен крит (нат.20)</strong></p>` : ""}
        </div>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  } catch (e) {
    console.error("OrderMelee | gmStartPreemptFlow ERROR", e, { preempt, ctx });
  }
}

async function gmResolvePreemptDefense({ srcMessageId, defenseType, defenseTotal }) {
  try {
    const message = game.messages.get(srcMessageId);
    const ctx = message?.flags?.Order?.attack;
    if (!message || !ctx) return;
    if (ctx.state !== "awaitingPreemptDefense") return;

    const attackerToken = canvas.tokens.get(ctx.attackerTokenId);
    const defenderToken = canvas.tokens.get(ctx.defenderTokenId);

    const attackerActor = attackerToken?.actor ?? game.actors.get(ctx.attackerActorId);
    const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
    if (!attackerActor || !defenderActor) return;

    const preemptAttack = Number(ctx.preemptTotal ?? 0);
    const defendTotal = Number(defenseTotal ?? 0);

    const preemptHit = preemptAttack > defendTotal;

    await message.update({
      "flags.Order.attack.state": "resolved",
      "flags.Order.attack.preemptDefenseType": defenseType,
      "flags.Order.attack.preemptDefenseTotal": defendTotal,
      "flags.Order.attack.preemptHit": preemptHit
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: `<p><strong>${attackerActor.name}</strong> защищается против Удара на опережение: <strong>${defenseType}</strong> = ${defendTotal}. Итог: <strong>${preemptHit ? "ПОПАДАНИЕ по атакующему" : "ПРОМАХ"}</strong>.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    if (preemptHit) {
      await createDamageButtonsMessage({
        attackerActor: defenderActor,
        defenderTokenId: ctx.attackerTokenId,
        baseDamage: Number(ctx.preemptDamage) || 0,
        sourceMessageId: `${message.id}-preempt`,
        criticalPossible: !!ctx.preemptCriticalPossible,
        criticalForced: !!ctx.preemptCriticalForced
      });
    }
  } catch (e) {
    console.error("OrderMelee | gmResolvePreemptDefense ERROR", e);
  }
}

/* -------------------------------------------- */
/*  Damage buttons + armor logic                 */
/* -------------------------------------------- */

async function createDamageButtonsMessage({
  attackerActor,
  defenderTokenId,
  baseDamage,
  sourceMessageId,
  criticalPossible = false,
  criticalForced = false
}) {
  const showCrit = !!criticalPossible;
  const onlyCrit = !!criticalForced;

  const normalBlock = `
    <button class="order-apply-damage" data-crit="0" data-mode="armor" data-token-id="${defenderTokenId}" data-dmg="${baseDamage}" data-src="${sourceMessageId}">
      Урон с учётом брони
    </button>
    <button class="order-apply-damage" data-crit="0" data-mode="true" data-token-id="${defenderTokenId}" data-dmg="${baseDamage}" data-src="${sourceMessageId}">
      Урон сквозь броню
    </button>
  `;

  const critBlock = showCrit ? `
    <hr style="margin:6px 0;">
    <p style="margin:0 0 6px 0;"><strong>Критический урон (x2):</strong></p>
    <button class="order-apply-damage" data-crit="1" data-mode="armor" data-token-id="${defenderTokenId}" data-dmg="${baseDamage}" data-src="${sourceMessageId}">
      Крит с учётом брони (x2)
    </button>
    <button class="order-apply-damage" data-crit="1" data-mode="true" data-token-id="${defenderTokenId}" data-dmg="${baseDamage}" data-src="${sourceMessageId}">
      Крит сквозь броню (x2)
    </button>
  ` : "";

  const forcedNote = onlyCrit
    ? `<p style="color:#b00; margin:6px 0 0 0;"><strong>Крит обязателен по правилу.</strong></p>`
    : "";

  const content = `
    <div class="order-damage-panel">
      <p><strong>Нанесение урона:</strong></p>
      ${onlyCrit ? "" : normalBlock}
      ${critBlock}
      ${forcedNote}
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { Order: { damage: { defenderTokenId, baseDamage, sourceMessageId, criticalPossible, criticalForced } } }
  });
}

function getArmorValueFromItems(actor) {
  const items = actor?.items ?? [];
  const equipped = items.filter(i => {
    if (!i) return false;
    if (i.type !== "Armor") return false;
    const sys = getItemSystem(i);
    // system.isEquiped + system.isUsed
    return !!(sys?.isEquiped && sys?.isUsed);
  });

  if (!equipped.length) return 0;

  // берём максимум
  let best = 0;
  for (const a of equipped) {
    const sys = getItemSystem(a);
    const val = Number(sys?.Deffensepotential ?? 0) || 0;
    if (val > best) best = val;
  }
  return best;
}

async function gmApplyDamage({ defenderTokenId, baseDamage, mode, isCrit, sourceMessageId }) {
  try {
    const token = canvas.tokens.get(defenderTokenId);
    const actor = token?.actor;
    if (!token || !actor) return;

    // prevent double apply
    if (sourceMessageId) {
      const srcMsg = game.messages.get(sourceMessageId);
      const ctx = srcMsg?.flags?.Order?.attack;
      if (ctx?.damageApplied) return;
      if (srcMsg) await srcMsg.update({ "flags.Order.attack.damageApplied": true });
    }

    const armor = getArmorValueFromItems(actor);

    const dmg = Math.max(0, Number(baseDamage) || 0);
    const finalBase = (isCrit ? dmg * 2 : dmg);

    const finalDamage = (mode === "armor")
      ? Math.max(0, finalBase - armor)
      : finalBase;

    const sys = getActorSystem(actor);
    const currentHealth = Number(sys?.Health?.value ?? 0);
    const newHealth = Math.max(0, currentHealth - finalDamage);

    await actor.update({ "system.Health.value": newHealth });

    canvas.interface.createScrollingText(token.center, `-${finalDamage}`, {
      fontSize: 32,
      fill: "#ff0000",
      stroke: "#000000",
      strokeThickness: 4,
      jitter: 0.5
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${token.name}</strong> получает урон: <strong>${finalDamage}</strong>${isCrit ? " <strong>(КРИТ x2)</strong>" : ""}${mode === "armor" ? ` (броня ${armor})` : ""}.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  } catch (e) {
    console.error("OrderMelee | gmApplyDamage ERROR", e);
  }
}
