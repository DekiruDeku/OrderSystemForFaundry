/**
 * OrderRanged.js
 * Диалог настройки атаки дальнего боя + создание чат-сообщения атаки.
 * (Дальнейшая обработка попадания/защиты будет добавлена позже.)
 */

const FLAG_SCOPE = "Order";
const FLAG_KEY = "rangedAttack";
const AUTO_FAIL_ATTACK_BELOW = 10;

export function registerOrderRangedHandlers() {
  $(document)
    .off("click.order-ranged-defense")
    .on("click.order-ranged-defense", ".order-ranged-defense", onRangedDefenseClick);

  $(document)
    .off("click.order-ranged-apply-damage")
    .on("click.order-ranged-apply-damage", ".order-ranged-apply-damage", onApplyRangedDamageClick);

  console.log("OrderRanged | Handlers registered");
}


export function registerOrderRangedBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;

      const bus = message.getFlag("Order", "rangedBus");
      if (!bus) return;

      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderRanged | BUS handler error", e);
    }
  });

  console.log("OrderRanged | BUS listener registered");
}



function getGmWhisperRecipients() {
  const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
  // чтобы атакующий тоже видел "скрытую" атаку
  const selfId = game.user?.id ? [game.user.id] : [];
  return Array.from(new Set([...gmIds, ...selfId]));
}

function clampInt(n, min, max) {
  // n может быть строкой/пустым/NaN — нормализуем
  const x = Number.parseInt(String(n ?? "").trim(), 10);
  const safe = Number.isFinite(x) ? x : min;
  return Math.min(max, Math.max(min, safe));
}


function getWeaponRateOfFire(weapon) {
  // Поддерживаем оба варианта ключа (старый и текущий из листа)
  const raw =
    weapon?.system?.Rateoffire ??
    weapon?.system?.["Rate of fire"] ??
    0;

  const rof = Number(raw);
  return Number.isFinite(rof) && rof > 0 ? Math.floor(rof) : 1;
}


function getWeaponAmmo(weapon) {
  // В template.json это поле называется "Magazine"
  const ammo = Number(weapon?.system?.["Magazine"] ?? 0);
  return Number.isFinite(ammo) ? Math.floor(ammo) : 0;
}

/**
 * Рассчитать модификаторы атаки аналогично melee (как в OrderPlayerSheet._rollAttack),
 * но дополнительно учесть штраф за количество пуль.
 */
function buildRangedAttackRollFormula({
  attackerActor,
  characteristic,
  applyModifiers,
  customModifier,
  rollMode,
  bullets
}) {
  const dice =
    rollMode === "adv" ? "2d20kh1" :
      rollMode === "dis" ? "2d20kl1" :
        "1d20";

  const actorData = attackerActor.system;

  const charValue = Number(actorData?.[characteristic]?.value ?? 0);

  const modifiersArray = applyModifiers ? (actorData?.[characteristic]?.modifiers || []) : [];
  const charMod = applyModifiers
    ? modifiersArray.reduce((acc, m) => acc + (Number(m.value) || 0), 0)
    : 0;

  // внешний мод атаки (AE)
  const attackEffectMod = applyModifiers
    ? attackerActor.effects.reduce((total, effect) => {
      if (!effect || effect.disabled) return total;
      const changes = Array.isArray(effect.changes) ? effect.changes : [];
      const bonus = changes
        .filter(c => c.key === "flags.Order.roll.attack")
        .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
      return total + bonus;
    }, 0)
    : 0;

  // Штраф за доп. пули: каждая пуля сверх первой даёт -1 к итогу
  const bulletPenalty = -Math.max(0, (Number(bullets) || 1) - 1);

  const totalMod =
    (Number(charMod) || 0) +
    (Number(attackEffectMod) || 0) +
    (Number(customModifier) || 0) +
    (Number(bulletPenalty) || 0);

  const parts = [dice];

  if (charValue !== 0) parts.push(charValue > 0 ? `+ ${charValue}` : `- ${Math.abs(charValue)}`);
  if (totalMod !== 0) parts.push(totalMod > 0 ? `+ ${totalMod}` : `- ${Math.abs(totalMod)}`);

  return {
    formula: parts.join(" "),
    bulletPenalty
  };
}

/**
 * Создать чат-сообщение атаки дальнего боя (пока без защиты/попадания).
 */
async function createRangedAttackMessage({
  attackerActor,
  attackerToken,
  defenderToken,
  weapon,
  characteristic,
  attackRoll,
  bullets,
  bulletPenalty,
  baseDamage,
  hidden,
  isCrit
}) {

  const attackTotal = Number(attackRoll?.total ?? 0);
  const autoFail = attackTotal < AUTO_FAIL_ATTACK_BELOW;

  const bulletsCount = Number(bullets) || 1;
  const weaponDamage = Number(baseDamage) || 0;
  const damagePotential = weaponDamage * bulletsCount;

  const charText = game.i18n?.localize?.(characteristic) ?? characteristic;
  const rollHTML = attackRoll ? await attackRoll.render() : "";

  const defenderActor = defenderToken?.actor ?? game.actors.get(defenderToken?.actor?.id ?? null);
  const shieldAvailable = defenderActor ? actorHasEquippedWeaponTag(defenderActor, "shield") : false;

  const staminaBlockBtn = shieldAvailable
    ? `<button class="order-ranged-defense" data-defense="block-stamina">Блок (Stamina)</button>`
    : "";

  const content = `
    <div class="chat-attack-message order-ranged" data-order-ranged-attack="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${weapon?.img ?? ""}" alt="${weapon?.name ?? ""}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${weapon?.name ?? "Дальняя атака"}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Цель:</strong> ${defenderToken?.name ?? "—"}</p>
        <p><strong>Характеристика атаки:</strong> ${charText}</p>
        <p><strong>Пули:</strong> ${bulletsCount} (штраф к броску: ${bulletPenalty})</p>
        <p><strong>Урон оружия (база):</strong> ${weaponDamage}</p>
        <p><strong>Урон (потенциал):</strong> ${damagePotential}</p>
        <p><strong>Результат атаки:</strong> ${attackTotal}</p>
        ${autoFail ? `<p style="color:#b00;"><strong>Авто-провал:</strong> итог < ${AUTO_FAIL_ATTACK_BELOW}</p>` : ""}
        <div class="inline-roll">${rollHTML}</div>
      </div>

      <hr/>

      ${autoFail
      ? `<p style="color:#b00;"><strong>Атака автоматически провалена</strong> (итог ${attackTotal} < ${AUTO_FAIL_ATTACK_BELOW}). Реакции цели не применяются.</p>`
      : `
          <div class="defense-buttons">
                <p><strong>Защита цели:</strong> выбери реакцию</p>
              <button class="order-ranged-defense" data-defense="dodge">Уворот (Dexterity)</button>
              ${staminaBlockBtn}
          </div>
        `
    }
    </div>
  `;

  const ctx = {
    attackerTokenId: attackerToken?.id ?? null,
    attackerActorId: attackerActor?.id ?? null,

    defenderTokenId: defenderToken?.id ?? null,
    defenderActorId: defenderToken?.actor?.id ?? null,

    weaponId: weapon?.id ?? null,
    weaponName: weapon?.name ?? "",
    weaponImg: weapon?.img ?? "",
    weaponUuid: weapon?.uuid ?? null,

    characteristic: characteristic ?? null,
    attackTotal,
    isCrit: !!isCrit,
    bullets: bulletsCount,
    bulletPenalty: Number(bulletPenalty) || 0,
    baseDamage: weaponDamage,
    damagePotential,

    autoFail,
    state: autoFail ? "resolved" : "awaitingDefense",
    hit: autoFail ? false : undefined,

    createdAt: Date.now()
  };

  const whisper = hidden ? getGmWhisperRecipients() : null;

  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: attackerActor, token: attackerToken }),
    content,
    whisper,
    flags: {
      Order: {
        [FLAG_KEY]: ctx
      }
    }
  });

  // Если авто-провал — сразу сообщим в чат отдельной строкой (как в melee стиле)
  if (autoFail) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor, token: attackerToken }),
      content: `<p><strong>${attackerToken?.name ?? attackerActor.name}</strong> совершает дальнюю атаку: <strong>АВТО-ПРОВАЛ</strong> (итог ${attackTotal} < ${AUTO_FAIL_ATTACK_BELOW}).</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  }
}


/**
 * Entry point: открыть диалог и создать атаку дальнего боя.
 */
export async function startRangedAttack({ attackerActor, weapon } = {}) {
  if (!attackerActor || !weapon) return;

  if (weapon.type !== "rangeweapon") {
    ui.notifications?.warn?.("Это не оружие дальнего боя.");
    return;
  }

  // 2) Нельзя атаковать если боезапас 0
  const ammo = getWeaponAmmo(weapon);
  if (ammo <= 0) {
    ui.notifications?.warn?.(`Боезапас оружия "${weapon.name}" равен 0. Атака невозможна.`);
    return;
  }

  const characteristics = Array.isArray(weapon.system?.AttackCharacteristics)
    ? weapon.system.AttackCharacteristics
    : [];

  if (characteristics.length === 0) {
    ui.notifications?.warn?.(`Нужно добавить характеристику атаки в оружие "${weapon.name}".`);
    return;
  }

  const rof = getWeaponRateOfFire(weapon);

  const options = characteristics
    .map(char => `<option value="${char}">${game.i18n.localize(char)}</option>`)
    .join("");

  const content = `
    <form>
      <div class="form-group">
        <label for="characteristic">Характеристика атаки:</label>
        <select id="characteristic">${options}</select>
      </div>

      <div class="form-group">
        <label for="modifier">Ручной модификатор атаки:</label>
        <input type="number" id="modifier" value="0" step="1" style="width: 90px;" />
      </div>

      <div class="form-group">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="applyMods" checked />
          Применять активные эффекты (моды характеристики)
        </label>
      </div>

      <div class="form-group">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="hiddenAttack" />
          Скрытая атака (видит только GM и атакующий)
        </label>
      </div>

      <hr/>

      <div class="form-group">
        <label for="bullets">Сколько пуль выпустить за атаку:</label>
        <input
          type="number"
          id="bullets"
          value="1"
          min="1"
          max="${rof}"
          step="1"
          style="width: 90px;"
        />
        <div style="font-size:12px; opacity:0.8; margin-top:4px;">
          Максимум = скорострельность (${rof}). Каждая пуля сверх первой даёт -1 к броску,
          а урон умножается на количество пуль.
        </div>
      </div>

      <p>Выберите вариант броска:</p>
    </form>
  `;

  const doRoll = async (html, rollMode) => {
    const characteristic = html.find("#characteristic").val();
    const customMod = Number(html.find("#modifier").val() || 0);
    const applyMods = html.find("#applyMods").is(":checked");
    const hidden = html.find("#hiddenAttack").is(":checked");

    // 1) Ограничение по скорострельности
    const $bullets = html.find("#bullets");
    const bullets = clampInt($bullets?.val?.() ?? $bullets?.[0]?.value, 1, rof);

    // на всякий случай сразу же синхронизируем UI (если пользователь ввёл криво)
    if ($bullets?.length) $bullets.val(bullets);


    // ещё раз проверим боезапас на момент клика (на всякий случай)
    const ammoNow = getWeaponAmmo(weapon);
    if (ammoNow <= 0) {
      ui.notifications?.warn?.(`Боезапас оружия "${weapon.name}" равен 0. Атака невозможна.`);
      return;
    }

    // 3) Боезапас уменьшается на 1 (только если нажали кнопку броска, т.е. не отменили)
    await weapon.update({ "system.Magazine": Math.max(0, ammoNow - 1) });

    const { formula, bulletPenalty } = buildRangedAttackRollFormula({
      attackerActor,
      characteristic,
      applyModifiers: applyMods,
      customModifier: customMod,
      rollMode,
      bullets
    });

    const roll = new Roll(formula);
    const result = await roll.roll({ async: true });
    const keptD20 = getKeptD20Result(result, rollMode);
    const isCrit = keptD20 === 20;


    if (typeof AudioHelper !== "undefined" && CONFIG?.sounds?.dice) {
      AudioHelper.play({ src: CONFIG.sounds.dice });
    }

    // По аналогии с melee: одна цель через T, и свой токен должен быть выделен
    const targets = Array.from(game.user.targets || []);
    if (targets.length !== 1) {
      ui.notifications.warn("Для атаки выбери ровно одну цель (клавиша T).");
      return;
    }
    const defenderToken = targets[0];

    const controlled = Array.from(canvas.tokens.controlled || []);
    const attackerToken = controlled.find(t => t.actor?.id === attackerActor.id) || controlled[0] || null;
    if (!attackerToken) {
      ui.notifications.warn("Выдели своего токена (controlled), чтобы совершить атаку.");
      return;
    }

    const baseDamage = Number(weapon.system?.Damage ?? 0);

    await createRangedAttackMessage({
      attackerActor,
      attackerToken,
      defenderToken,
      weapon,
      characteristic,
      attackRoll: result,
      bullets,
      bulletPenalty,
      baseDamage,
      hidden,
      isCrit
    });

  };

  const dlg = new Dialog({
    title: `Дальняя атака: ${weapon.name}`,
    content,
    buttons: {
      normal: {
        label: "Обычный",
        callback: html => doRoll(html, "normal")
      },
      adv: {
        label: "Преимущество",
        callback: html => doRoll(html, "adv")
      },
      dis: {
        label: "Помеха",
        callback: html => doRoll(html, "dis")
      }
    },
    default: "normal"
  });

  // Рендерим и после этого цепляем живую валидацию ввода
  dlg.render(true);

  // Важно: element появляется после render, поэтому в микротаск/таймаут
  setTimeout(() => {
    const $el = dlg.element;
    if (!$el?.length) return;

    const $bullets = $el.find("#bullets");
    if (!$bullets?.length) return;

    const sanitize = () => {
      const v = clampInt($bullets.val(), 1, rof);
      $bullets.val(v);
    };

    // Нормализуем сразу (на случай странного состояния)
    sanitize();

    // Динамическая обработка: игрок не сможет оставить <1 или >rof
    $bullets.on("input change blur", sanitize);
  }, 0);

}


function getActorSystem(actor) {
  return actor?.system ?? actor?.data?.system ?? {};
}

function getItemSystem(item) {
  return item?.system ?? item?.data?.system ?? {};
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

function getCharacteristicValueAndMods(actor, key) {
  const sys = getActorSystem(actor);
  const obj = sys?.[key] ?? null;
  const value = Number(obj?.value ?? 0) || 0;

  const localModsArray =
    obj?.modifiers ??
    obj?.maxModifiers ??
    obj?.MaxModifiers ??
    [];

  let localSum = 0;
  if (Array.isArray(localModsArray)) {
    localSum = localModsArray.reduce((acc, m) => acc + (Number(m?.value) || 0), 0);
  }

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
      return String(k) === String(key) ? acc + v : acc;
    }, 0);
  }

  return { value, mods: localSum + globalSum };
}

async function rollActorCharacteristic(actor, attribute) {
  const { value, mods } = getCharacteristicValueAndMods(actor, attribute);
  const externalDefenseMod = getExternalRollModifierFromEffects(actor, "defense");

  const parts = ["1d20"];
  if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
  if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
  if (externalDefenseMod !== 0) parts.push(externalDefenseMod > 0 ? `+ ${externalDefenseMod}` : `- ${Math.abs(externalDefenseMod)}`);

  const roll = await new Roll(parts.join(" ")).roll({ async: true });

  const totalModsShown = mods + externalDefenseMod;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Защита: ${attribute}${totalModsShown ? ` (моды ${totalModsShown})` : ""}`
  });

  return roll;
}

function actorHasEquippedWeaponTag(actor, tag) {
  const items = actor?.items ?? [];
  return items.some(i => {
    if (!i) return false;
    if (i.type !== "meleeweapon" && i.type !== "rangeweapon") return false;

    const sys = getItemSystem(i);
    const equipped = !!(sys?.inHand);
    if (!equipped) return false;

    const tags = Array.isArray(sys?.tags) ? sys.tags : [];
    return tags.includes(tag);
  });
}

async function emitToGM(payload) {
  if (game.user.isGM) {
    await handleGMRequest(payload);
    return;
  }

  const gmIds = game.users?.filter(u => u.isGM && u.active).map(u => u.id) ?? [];
  if (!gmIds.length) {
    ui.notifications.error("Не найден GM для отправки запроса.");
    return;
  }

  await ChatMessage.create({
    content: `<p>Player requested: ${payload.type}</p>`,
    whisper: gmIds,
    flags: {
      Order: {
        rangedBus: { payload }
      }
    }
  });
}

async function onRangedDefenseClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const messageEl = button.closest?.(".message");
  const messageId = messageEl?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение атаки.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!ctx) return ui.notifications.error("В сообщении нет контекста дальнобойной атаки.");

  if (ctx.state !== "awaitingDefense") {
    ui.notifications.warn("Эта атака уже разрешена или ожидает другой шаг.");
    return;
  }

  // Авто-провал: защита не выбирается
  if (ctx.autoFail || (Number(ctx.attackTotal) || 0) < AUTO_FAIL_ATTACK_BELOW) {
    ui.notifications.info("Атака уже завершена (авто-провал). Реакции не применяются.");
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

  let defenseAttr = null;
  if (defenseType === "dodge") defenseAttr = "Dexterity";
  if (defenseType === "block-stamina") defenseAttr = "Stamina";

  if (!defenseAttr) return;

  if (defenseType === "block-stamina") {
    const hasShield = actorHasEquippedWeaponTag(defenderActor, "shield");
    if (!hasShield) {
      ui.notifications.warn("Блок через Выносливость доступен только при экипированном щите (tag: shield).");
      return;
    }
  }

  const defenseRoll = await rollActorCharacteristic(defenderActor, defenseAttr);
  const defenseTotal = Number(defenseRoll.total ?? 0);

  await emitToGM({
    type: "RESOLVE_RANGED_DEFENSE",
    messageId,
    defenseType,
    defenseTotal,
    defenderUserId: game.user.id
  });
}

async function handleGMRequest(payload) {
  try {
    const { type } = payload ?? {};
    if (!type) return;

    if (type === "RESOLVE_RANGED_DEFENSE") return await gmResolveRangedDefense(payload);
    if (type === "APPLY_RANGED_DAMAGE") return await gmApplyRangedDamage(payload);
  } catch (e) {
    console.error("OrderRanged | handleGMRequest error", e, payload);
  }
}

async function gmResolveRangedDefense(payload) {
  try {
    const { messageId, defenseType, defenseTotal } = payload ?? {};
    if (!messageId) return;

    const message = game.messages.get(messageId);
    const ctx = message?.getFlag(FLAG_SCOPE, FLAG_KEY);
    if (!message || !ctx) return;
    if (ctx.state === "resolved") return;

    const attackerToken = canvas.tokens.get(ctx.attackerTokenId);
    const defenderToken = canvas.tokens.get(ctx.defenderTokenId);

    const attackerActor = attackerToken?.actor ?? game.actors.get(ctx.attackerActorId);
    const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
    if (!attackerActor || !defenderActor) return;

    const attackTotal = Number(ctx.attackTotal) || 0;

    // Авто-провал < 10 (на GM стороне тоже фиксируем)
    if (attackTotal < AUTO_FAIL_ATTACK_BELOW) {
      await message.update({
        [`flags.${FLAG_SCOPE}.${FLAG_KEY}.state`]: "resolved",
        [`flags.${FLAG_SCOPE}.${FLAG_KEY}.autoFail`]: true,
        [`flags.${FLAG_SCOPE}.${FLAG_KEY}.hit`]: false
      });

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
        content: `<p><strong>Дальняя атака</strong>: авто-провал (итог ${attackTotal} < ${AUTO_FAIL_ATTACK_BELOW}).</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
      return;
    }

    const def = Number(defenseTotal) || 0;

    // По ТЗ: попадание если Attack >= Defense
    const hit = attackTotal >= def;

    await message.update({
      [`flags.${FLAG_SCOPE}.${FLAG_KEY}.state`]: "resolved",
      [`flags.${FLAG_SCOPE}.${FLAG_KEY}.defenseType`]: defenseType,
      [`flags.${FLAG_SCOPE}.${FLAG_KEY}.defenseTotal`]: def,
      [`flags.${FLAG_SCOPE}.${FLAG_KEY}.hit`]: hit
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
      content: `<p><strong>${defenderToken?.name ?? defenderActor.name}</strong> выбрал защиту: <strong>${defenseType}</strong>. Защита: <strong>${def}</strong>. Итог: <strong>${hit ? "ПОПАДАНИЕ" : "ПРОМАХ"}</strong>.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });


    // Как в melee: кнопки нанесения урона отдельным новым сообщением после результата попадания/промаха
    if (hit) {
      const isCrit = !!ctx.isCrit;
      const critNote = isCrit
        ? `<p style="color:#b00;"><strong>КРИТ:</strong> броня игнорируется.</p>`
        : "";

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attackerActor, token: attackerToken }),
        content: `
      <div class="order-ranged-damage-card">
        <p><strong>Нанести урон цели:</strong> ${defenderToken?.name ?? defenderActor.name}</p>
        ${critNote}
        <button class="order-ranged-apply-damage" data-mode="armor">Урон с учётом брони</button>
        <button class="order-ranged-apply-damage" data-mode="pierce">Урон сквозь броню</button>
      </div>
    `,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
        flags: {
          Order: {
            rangedDamage: {
              // Минимальный контекст для кнопок
              sourceMessageId: messageId,
              defenderTokenId: ctx.defenderTokenId,
              attackerTokenId: ctx.attackerTokenId,
              attackerActorId: ctx.attackerActorId,
              baseDamage: ctx.baseDamage,
              bullets: ctx.bullets,
              isCrit: isCrit
            }
          }
        }
      });
    }


    // Дальше (урон/эффекты) сделаем следующим шагом после твоего "при успехе"
  } catch (e) {
    console.error("OrderRanged | gmResolveRangedDefense error", e, payload);
  }
}

function getKeptD20Result(roll, rollMode) {
  const d20 = roll?.dice?.find(d => d?.faces === 20);
  if (!d20?.results?.length) return null;

  const results = d20.results.map(r => Number(r.result ?? 0));

  if (rollMode === "adv") return Math.max(...results);
  if (rollMode === "dis") return Math.min(...results);

  return results[0] ?? null;
}

function getArmorValueFromItems(actor) {
  const items = actor?.items ?? [];
  const equipped = items.filter(i => {
    if (!i) return false;
    if (i.type !== "Armor") return false;
    const sys = getItemSystem(i);
    return !!(sys?.isEquiped && sys?.isUsed);
  });

  if (!equipped.length) return 0;

  let best = 0;
  for (const a of equipped) {
    const sys = getItemSystem(a);
    const val = Number(sys?.Deffensepotential ?? 0) || 0;
    if (val > best) best = val;
  }
  return best;
}

async function onApplyRangedDamageClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const mode = button.dataset.mode; // "armor" | "pierce"
  if (!mode) return;

  const messageEl = button.closest?.(".message");
  const messageId = messageEl?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение атаки.");

  const message = game.messages.get(messageId);

  // Новый формат: кнопки урона живут в отдельном сообщении
  const dmgCtx = message?.getFlag("Order", "rangedDamage");
  if (!dmgCtx) return ui.notifications.error("В сообщении нет контекста урона дальнобойной атаки.");

  // Кто может нажимать: GM или владелец атакующего
  const attackerToken = canvas.tokens.get(dmgCtx.attackerTokenId);
  const attackerActor = attackerToken?.actor ?? game.actors.get(dmgCtx.attackerActorId);
  if (!(game.user.isGM || attackerActor?.isOwner)) {
    return ui.notifications.warn("Наносить урон может GM или владелец атакующего.");
  }

  await emitToGM({
    type: "APPLY_RANGED_DAMAGE",
    sourceMessageId: dmgCtx.sourceMessageId,  // важное: ссылку на исходную атаку сохраняем
    defenderTokenId: dmgCtx.defenderTokenId,
    baseDamage: dmgCtx.baseDamage,
    bullets: dmgCtx.bullets,
    mode,
    isCrit: !!dmgCtx.isCrit
  });

}

async function gmApplyRangedDamage({ defenderTokenId, baseDamage, bullets, mode, isCrit, sourceMessageId }) {
  try {
    const token = canvas.tokens.get(defenderTokenId);
    const actor = token?.actor;
    if (!token || !actor) return;

    // Anti-double apply: помечаем в исходном сообщении
    if (sourceMessageId) {
      const srcMsg = game.messages.get(sourceMessageId);
      const ctx = srcMsg?.getFlag(FLAG_SCOPE, FLAG_KEY);
      if (ctx?.damageApplied) return;
      if (srcMsg) await srcMsg.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}.damageApplied`]: true });
    }

    const dmg = Math.max(0, Number(baseDamage) || 0);
    const shots = Math.max(1, Number(bullets) || 1);

    // Крит в ranged НЕ меняет урон (только игнор брони и подпись)
    const perShotBase = dmg;


    const armor = getArmorValueFromItems(actor);

    // Отличие ranged:
    // - armor mode: считаем по каждой пуле отдельно: max(0, perShotBase - armor) * shots
    // - pierce: броню игнорируем всегда
    // - крит: броня игнорируется даже в armor mode (по ТЗ)
    let totalDamage = 0;

    if (mode === "pierce") {
      totalDamage = perShotBase * shots;
    } else {
      // mode === "armor"
      if (isCrit) {
        // КРИТ: броня игнорируется
        totalDamage = perShotBase * shots;
      } else {
        const perShotAfterArmor = Math.max(0, perShotBase - armor);
        totalDamage = perShotAfterArmor * shots;
      }
    }

    const sys = getActorSystem(actor);
    const currentHealth = Number(sys?.Health?.value ?? 0);
    const newHealth = Math.max(0, currentHealth - totalDamage);

    await actor.update({ "system.Health.value": newHealth });

    canvas.interface.createScrollingText(token.center, `-${totalDamage}`, {
      fontSize: 32,
      fill: "#ff0000",
      stroke: "#000000",
      strokeThickness: 4,
      jitter: 0.5
    });

    const armorInfo = (mode === "armor" && !isCrit) ? ` (броня ${armor})` : "";
    const critInfo = isCrit ? ` <strong>(КРИТ, броня игнорируется)</strong>` : "";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${token.name}</strong> получает урон: <strong>${totalDamage}</strong>${critInfo}${armorInfo}. (пули: ${shots})</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  } catch (e) {
    console.error("OrderRanged | gmApplyRangedDamage ERROR", e);
  }
}

