/**
 * OrderSystem - Melee Attack / Defense flow (Foundry VTT v11)
 *
 * Design goals:
 * - Attack is created by attacker (usually via weapon button).
 * - Defender performs a defense roll by choosing a reaction:
 *   Dodge (Dexterity), Block (Stamina), Preempt (placeholder).
 * - We bind the whole interaction to a single ChatMessage via flags so
 *   we never rely on "current targets" after the attack is made.
 */

const FLAG_SCOPE = "Order";
const FLAG_KEY = "attack";

/**
 * Register global chat button handlers.
 * Call once from system init.
 */
export function registerOrderMeleeHandlers() {
  // Defensive clicks (delegated)
  $(document)
    .off("click.order-defense")
    .on("click.order-defense", ".order-defense", onDefenseClick);
}

/**
 * Create an "attack message" with embedded context and defense buttons.
 * This is called from the attacker side (e.g. from a sheet).
 */
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
    damage: weaponDamage,

    state: "awaitingDefense",
    createdAt: Date.now()
  };

  const charText = applyModifiers
    ? game.i18n.localize(characteristic)
    : "Без характеристики";

  const rollHTML = attackRoll ? await attackRoll.render() : "";

  const content = `
    <div class="chat-attack-message order-melee" data-order-attack="1">
      <div class="attack-header">
        <img src="${weapon?.img}" alt="${weapon?.name}" width="50" height="50">
        <h3>${weapon?.name}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Цель:</strong> ${defenderToken?.name ?? "—"}</p>
        <p><strong>Характеристика:</strong> ${charText}</p>
        <p><strong>Урон (потенциал):</strong> ${weaponDamage}</p>
        <p><strong>Результат атаки:</strong> ${attackTotal}</p>
        <div class="inline-roll">${rollHTML}</div>
      </div>

      <hr/>

      <div class="defense-buttons">
        <p><strong>Защита цели:</strong> выбери реакцию</p>
        <button class="order-defense" data-defense="dodge">Уворот (Dex)</button>
        <button class="order-defense" data-defense="block">Блок (Stamina)</button>
        <button class="order-defense" data-defense="preempt">Удар на опережение</button>
      </div>
    </div>
  `;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      [FLAG_SCOPE]: {
        [FLAG_KEY]: ctx
      }
    }
  });
}

async function onDefenseClick(event) {
  event.preventDefault();
  const button = event.currentTarget;

  // Resolve the ChatMessage that contains this button
  const messageEl = button.closest?.(".message");
  const messageId = messageEl?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение атаки.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!ctx) return ui.notifications.error("В сообщении нет контекста атаки (flags.Order.attack).");

  if (ctx.state !== "awaitingDefense") {
    ui.notifications.warn("Эта атака уже разрешена.");
    return;
  }

  // Find defender
  const defenderToken = canvas.tokens.get(ctx.defenderTokenId);
  const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
  if (!defenderActor) return ui.notifications.error("Не найден защитник (defenderActor).");

  // Permission: defender owner or GM
  if (!(game.user.isGM || defenderActor.isOwner)) {
    ui.notifications.warn("Защиту может выбрать только владелец цели (или GM).");
    return;
  }

  const defenseType = button.dataset.defense;
  let defenseAttr = null;
  if (defenseType === "dodge") defenseAttr = "Dexterity";
  if (defenseType === "block") defenseAttr = "Stamina";
  if (defenseType === "preempt") defenseAttr = "Dexterity"; // placeholder for now

  // Defense roll
  const defenseRoll = await rollActorCharacteristic(defenderActor, defenseAttr);
  const defenseTotal = Number(defenseRoll.total ?? 0);

  // Resolve
  const hit = Number(ctx.attackTotal) > defenseTotal;
  if (hit) {
    await applyDamageToTokenId(ctx.defenderTokenId, ctx.damage);
  }

  // Mark resolved (prevents repeated clicks)
  await message.update({
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.state`]: "resolved",
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.defenseType`]: defenseType,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.defenseTotal`]: defenseTotal,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.hit`]: hit
  });

  const resultText = hit ? `ПОПАДАНИЕ! Урон: ${Number(ctx.damage) || 0}` : "ПРОМАХ / защита успешна";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
    content: `
      <p><strong>${defenderToken?.name ?? defenderActor.name}</strong> выбрал защиту: <strong>${defenseType}</strong>.
      Защита: <strong>${defenseTotal}</strong>. Итог: <strong>${resultText}</strong></p>
    `,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

async function rollActorCharacteristic(actor, attribute) {
  const characteristicValue = Number(actor.system?.[attribute]?.value ?? 0);
  const modifiersArray = actor.system?.[attribute]?.modifiers ?? [];
  const baseModifiers = Array.isArray(modifiersArray)
    ? modifiersArray.reduce((acc, m) => acc + (Number(m.value) || 0), 0)
    : 0;

  const parts = ["1d20"];
  if (characteristicValue !== 0) {
    parts.push(characteristicValue > 0 ? `+ ${characteristicValue}` : `- ${Math.abs(characteristicValue)}`);
  }
  if (baseModifiers !== 0) {
    parts.push(baseModifiers > 0 ? `+ ${baseModifiers}` : `- ${Math.abs(baseModifiers)}`);
  }

  const roll = await new Roll(parts.join(" ")).roll({ async: true });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Защита: ${attribute}${baseModifiers ? ` (моды ${baseModifiers})` : ""}`
  });
  return roll;
}

async function applyDamageToTokenId(tokenId, damage) {
  const token = canvas.tokens.get(tokenId);
  if (!token?.actor) {
    ui.notifications.error("Не найден токен для нанесения урона.");
    return;
  }

  const actor = token.actor;
  const currentHealth = Number(actor.system?.Health?.value ?? 0);
  const dmg = Math.max(0, Number(damage) || 0);
  const newHealth = Math.max(0, currentHealth - dmg);

  await actor.update({ "system.Health.value": newHealth });

  canvas.interface.createScrollingText(token.center, `-${dmg}`,
    {
      fontSize: 32,
      fill: "#ff0000",
      stroke: "#000000",
      strokeThickness: 4,
      jitter: 0.5
    }
  );
}
