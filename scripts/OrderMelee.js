import { castDefensiveSpellDefense, getDefensiveReactionSpells } from "./OrderSpellDefenseReaction.js";
import { rollDefensiveSkillDefense, getDefensiveReactionSkills } from "./OrderSkillDefenseReaction.js";
import { buildCombatRollFlavor } from "./OrderRollFlavor.js";
import { collectMeleeWeaponDamageBuffs, spendMeleeWeaponDamageBuff } from "./OrderMeleeWeaponBuff.js";



/**
 * OrderSystem - Melee Attack / Defense flow (Foundry VTT v11)
 *
 * NEW APPROACH:
 * - No sockets.
 * - Players send "requests to GM" as a hidden/whisper ChatMessage with flags.
 * - GM listens via Hooks.on("createChatMessage") and processes requests.
 */

const FLAG_SCOPE = "Order";
const FLAG_KEY = "attack";

// "bus" message flags: flags.Order.bus = { scope:"OrderMelee", payload:{...} }
const BUS_SCOPE = "OrderMelee";

const AUTO_FAIL_ATTACK_BELOW = 10;

const ORDER_DEBUG = true; // <-- выключишь потом

function dbg(...args) {
  if (!ORDER_DEBUG) return;
  console.log("OrderMelee[DBG]", ...args);
}
function dgw(...args) {
  if (!ORDER_DEBUG) return;
  console.warn("OrderMelee[DBG]", ...args);
}
function dge(...args) {
  if (!ORDER_DEBUG) return;
  console.error("OrderMelee[DBG]", ...args);
}


/* -------------------------------------------- */
/*  Public API                                   */
/* -------------------------------------------- */

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
  $(document)
    .off("click.order-spend-melee-buff")
    .on("click.order-spend-melee-buff", ".order-spend-melee-buff", onSpendMeleeBuffClick);

  console.log("OrderMelee | Handlers registered");
}

/**
 * Register GM-side bus listener through createChatMessage hook.
 * Call once from Hooks.once("ready", ...).
 */
export function registerOrderMeleeBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;

      const bus = message.getFlag("Order", "meleeBus");
      //await handleGMRequest(bus.payload);
      if (!bus) return;

      console.log("OrderMelee | BUS received:", bus);

      // bus.payload должен содержать то, что ты хочешь отдать в gmResolveDefense/gmApplyDamage/...
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderMelee | BUS createChatMessage handler error", e);
    }
  });

  console.log("OrderMelee | BUS listener registered");
}

function hasShieldInHand(actor) {
  if (!actor) return false;

  return (actor.items ?? []).some(it => {
    if (!it) return false;
    if (it.type !== "meleeweapon" && it.type !== "rangeweapon") return false;

    const sys = getItemSystem(it);
    const tags = Array.isArray(sys?.tags) ? sys.tags : [];
    const hasShieldTag = tags.some(t => String(t).toLowerCase() === "shield");

    // ключевое: для оружия проверяем только inHand
    return hasShieldTag && !!sys?.inHand;
  });
}

function renderSpendMeleeBuffPanel(attackerActor) {
  const info = collectMeleeWeaponDamageBuffs(attackerActor);
  if (!info.effects.length) return "";

  const rows = info.effects.map(e => {
    const spellName = String(e.label ?? "Бафф").replace(/^Бафф:\s*/i, "").trim();
    const bonusText = `${e.bonus > 0 ? `+${e.bonus}` : e.bonus}`;
    const leftText = `
      <div style="font-weight:600; line-height:1.15; margin-bottom:2px;">
        ${spellName}
      </div>
      <div style="opacity:.9; line-height:1.15;">
        Бонус: ${bonusText} &nbsp;|&nbsp; Осталось: ${e.hitsRemaining}
      </div>
    `;

    return `
      <div style="
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:8px;
        margin:6px 0;
        min-width:0;
      ">
        <div style="
          flex:1 1 140px;
          min-width:0;
          white-space:normal;
          word-break:normal;
          overflow-wrap:break-word;
        ">
          ${leftText}
        </div>

        <button type="button"
                class="order-spend-melee-buff"
                data-actor-id="${attackerActor.id}"
                data-effect-id="${e.id}"
                data-spend="1"
                style="
                  flex:0 0 auto;
                  max-width:100%;
                  height:28px;
                  line-height:28px;
                  padding:0 10px;
                ">
          Списать 1 удар
        </button>
      </div>
    `;
  }).join("");

  // Без заголовков, просто блок с лёгкой рамкой
  return `
    <div class="order-melee-buff-spend" style="
      margin:6px 0 10px 0;
      padding:6px 8px;
      border:1px dashed rgba(255,255,255,.22);
      border-radius:6px;
      max-width:100%;
      box-sizing:border-box;
    ">
      ${rows}
    </div>
  `;
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



async function _onBusChatMessage(message) {
  try {
    if (!game.user.isGM) return;

    const bus = message?.flags?.[FLAG_SCOPE]?.bus;
    if (!bus) return;
    if (bus.scope !== BUS_SCOPE) return;

    console.log("OrderMelee | GM received BUS request:", bus.payload);

    // Process on GM
    await handleGMRequest(bus.payload);
  } catch (e) {
    console.error("OrderMelee | BUS handler ERROR", e);
  }
}

function hasWeaponTag(actor, tag) {
  if (!actor) return false;
  const t = String(tag).toLowerCase();

  return (actor.items ?? []).some(it => {
    if (it.type !== "meleeweapon") return false;

    const tags = Array.isArray(it.system?.tags) ? it.system.tags : [];
    const hasTag = tags.some(x => String(x).toLowerCase() === t);
    if (!hasTag) return false;

    // Мягкое условие “щит доступен”
    const sys = it.system ?? {};
    const equipped = !!sys.isEquiped;              // главное
    const used = (sys.isUsed === undefined) ? true : !!sys.isUsed;  // если поля нет — считаем true

    return equipped && used;
  });
}

async function rollInline(actor, { dice = "1d20", characteristicKey = null } = {}) {
  const parts = [dice];

  if (characteristicKey) {
    const { value, mods } = getCharacteristicValueAndMods(actor, characteristicKey);
    if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
    if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
  }

  return await new Roll(parts.join(" ")).roll({ async: true });
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
  rollMode = "normal",
  applyModifiers,
  customModifier,
  attackRoll,
  damage,
  stealthAttack = false
}) {
  const attackTotal = Number(attackRoll?.total ?? 0);
  const autoFail = attackTotal < AUTO_FAIL_ATTACK_BELOW;
  const _meleeBuff = collectMeleeWeaponDamageBuffs(attackerActor);
  const weaponDamage = (Number(damage ?? 0) || 0)
    + (Number(attackerActor?.system?._perkBonuses?.WeaponDamage ?? 0) || 0)
    + (Number(_meleeBuff.totalBonus ?? 0) || 0);
  const attackD20 = getKeptD20Result(attackRoll);
  const attackNat20 = attackD20 === 20;

  let stealth = null;

  if (stealthAttack) {
    const attackerStealthRoll = await rollInline(defenderToken?.actor ? attackerActor : attackerActor, {
      dice: "2d20kl1",
      characteristicKey: "Stealth"
    });

    const defenderActorResolved = defenderToken?.actor ?? game.actors.get(defenderToken?.actor?.id ?? null);
    const defenderKnowledgeRoll = await rollInline(defenderActorResolved, {
      dice: "1d20",
      characteristicKey: "Knowledge"
    });

    const stealthTotal = Number(attackerStealthRoll.total ?? 0);
    const knowledgeTotal = Number(defenderKnowledgeRoll.total ?? 0);

    stealth = {
      enabled: true,
      stealthTotal,
      knowledgeTotal,
      success: stealthTotal >= knowledgeTotal,
      stealthHTML: await attackerStealthRoll.render(),
      knowledgeHTML: await defenderKnowledgeRoll.render()
    };
  }

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
    applyModifiers: !!applyModifiers,
    customModifier: Number(customModifier) || 0,

    attackTotal,
    attackNat20,
    attackD20,
    damage: weaponDamage,

    autoFail,
    state: autoFail ? "resolved" : "awaitingDefense",
    hit: autoFail ? false : undefined,
    createdAt: Date.now(),
    stealthEnabled: !!stealth?.enabled,
    stealthTotal: Number(stealth?.stealthTotal ?? 0),
    knowledgeTotal: Number(stealth?.knowledgeTotal ?? 0),
    stealthSuccess: !!stealth?.success,
    rollMode: rollMode ?? "normal"
  };

  const charText = applyModifiers
    ? (game.i18n?.localize?.(characteristic) ?? characteristic)
    : "Без характеристики";

  const rollHTML = attackRoll ? await attackRoll.render() : "";

  const cardFlavor = buildCombatRollFlavor({
    scene: "Ближний бой",
    action: stealthAttack ? "Атака (скрытная)" : "Атака",
    source: `Оружие: ${weapon?.name ?? "—"}`,
    rollMode,
    characteristic,
    applyModifiers: !!applyModifiers,
    manualMod: Number(customModifier) || 0,
    effectsMod: (applyModifiers ? getExternalRollModifierFromEffects(attackerActor, "attack") : 0),
    isCrit: attackNat20
  });

  const shieldAvailable = hasShieldInHand(defenderToken?.actor);
  const staminaBlockBtn = shieldAvailable
    ? `<button class="order-defense" data-defense="block-stamina">Блок (Stamina)</button>`
    : "";

  const defenderActorResolved = defenderToken?.actor ?? game.actors.get(defenderToken?.actor?.id ?? null);
  const canBlockStamina = hasWeaponTag(defenderActorResolved, "shield");
  console.log("BLOCK STAMINA CHECK", {
    defender: defenderActorResolved?.name,
    canBlockStamina,
    items: defenderActorResolved?.items?.map(i => ({ name: i.name, type: i.type, tags: i.system?.tags, eq: i.system?.isEquiped, used: i.system?.isUsed }))
  });



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
        ${autoFail ? `<p style="color:#b00;"><strong>Авто-провал:</strong> итог < ${AUTO_FAIL_ATTACK_BELOW}</p>` : ""}
        <p class="order-roll-flavor">${cardFlavor}</p>
        <div class="inline-roll">${rollHTML}</div>
        ${stealth?.enabled ? `<hr/>
        <div class="stealth-block">
        <p><strong>Скрытная атака:</strong></p>
        <p><strong>Stealth (помеха):</strong> ${stealth.stealthTotal}</p>
      <div class="inline-roll">${stealth.stealthHTML}</div>
        <p><strong>Knowledge цели:</strong> ${stealth.knowledgeTotal}</p>
      <div class="inline-roll">${stealth.knowledgeHTML}</div>
        <p><strong>Итог:</strong> ${stealth.success ? "УСПЕХ" : "ПРОВАЛ"}</p>
    ${stealth.success ? `<p><em>Если атака попадёт — урон x1.5 (округление вверх).</em></p>` : ""}
      </div>
      ` : ""}
      </div>

      <hr/>

      ${autoFail
      ? `<p style="color:#b00;"><strong>Атака автоматически провалена</strong> (итог ${attackTotal} < ${AUTO_FAIL_ATTACK_BELOW}). Реакции цели не применяются.</p>`
      : `
      <div class="defense-buttons">
        <p><strong>Защита цели:</strong> выбери реакцию</p>
        <button class="order-defense" data-defense="dodge">Уворот (Dexterity)</button>

      <button class="order-defense" data-defense="block">
        Блок (Strength)
      </button>
      

      ${staminaBlockBtn}

      <button class="order-defense" data-defense="preempt">Удар на опережение</button>
      </div>
      <div class="order-defense-spell-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
        <select class="order-defense-spell-select" style="min-width:220px;"></select>
        <button class="order-defense" data-defense="spell">Защита заклинанием</button>
      </div>
      <div class="order-defense-skill-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
        <select class="order-defense-skill-select" style="flex:1; min-width:180px;"></select>
        <button class="order-defense" data-defense="skill" style="flex:0 0 auto; white-space:nowrap;">
          Защита навыком
        </button>
      </div>

    `
    }
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
/*  AoE (multi-target) attack message creation   */
/* -------------------------------------------- */

function renderAoEDefenseButtons({ tokenId, disabled = false, showStaminaBlock = false } = {}) {
  const dis = disabled ? 'disabled' : '';
  const base = `class="order-defense order-aoe-btn" data-defender-token-id="${tokenId}"`;

  // Иконки: dodge / block / block-stamina / spell / skill
  // preempt в AoE пока НЕ поддерживаем (двухшаговая логика на одного из многих).
  return `
    <div class="order-aoe-actions">
      <button ${base} data-defense="dodge" title="Уворот (Dexterity)" ${dis}><i class="fas fa-person-running"></i></button>
      <button ${base} data-defense="block" title="Блок (Strength)" ${dis}><i class="fas fa-shield-halved"></i></button>
      ${showStaminaBlock ? `<button ${base} data-defense="block-stamina" title="Блок (Stamina)" ${dis}><i class="fas fa-shield"></i></button>` : ``}
      <button ${base} data-defense="spell" title="Защита заклинанием" ${dis}><i class="fas fa-wand-magic-sparkles"></i></button>
      <button ${base} data-defense="skill" title="Защита навыком" ${dis}><i class="fas fa-hand-fist"></i></button>
    </div>
  `;
}

function renderAoEDamageButtons({ tokenId, baseDamage, sourceMessageId, criticalPossible, disabled = false } = {}) {
  if (!baseDamage || baseDamage <= 0) return "";
  const dis = disabled ? 'disabled' : '';

  const mk = (crit, mode, icon, title) =>
    `<button class="order-apply-damage order-aoe-btn" data-crit="${crit ? "1" : "0"}" data-mode="${mode}" data-token-id="${tokenId}" data-dmg="${baseDamage}" data-src="${sourceMessageId}" title="${title}" ${dis}>${icon}</button>`;

  // Нормал: броня / сквозь броню
  const normal = `
    ${mk(false, "armor", `<i class="fas fa-shield"></i>`, "Урон с учётом брони")}
    ${mk(false, "true", `<i class="fas fa-bolt"></i>`, "Урон сквозь броню")}
  `;

  // Крит: x2 (если доступен нат.20)
  const crit = criticalPossible ? `
    ${mk(true, "armor", `<span class="order-aoe-x2">x2</span><i class="fas fa-shield"></i>`, "Крит с учётом брони (x2)")}
    ${mk(true, "true", `<span class="order-aoe-x2">x2</span><i class="fas fa-bolt"></i>`, "Крит сквозь броню (x2)")}
  ` : "";

  return `<div class="order-aoe-damage">${normal}${crit}</div>`;
}


function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDefenseEntryTitle(entry) {
  const kind = String(entry?.defenseType || "");
  if (kind === "spell") {
    const name = entry?.defenseSpellName || "заклинание";
    const total = entry?.defenseCastTotal;
    const failed = entry?.defenseCastFailed;
    let castInfo = "";
    if (total != null) {
      const status = (failed === true) ? "провал" : (failed === false ? "успех" : "");
      castInfo = `, каст: ${total}${status ? ` (${status})` : ""}`;
    }
    return `Защита: ${name}${castInfo}`;
  }
  if (kind === "skill") return `Защита: ${entry?.defenseSkillName || "навык"}`;
  if (kind === "dodge") return "Защита: уворот";
  if (kind === "block" || kind === "block-strength") return "Защита: блок (Strength)";
  if (kind === "block-stamina") return "Защита: блок (Stamina)";
  return "Защита";
}

function renderAoEResultCell(entry, { autoFail = false } = {}) {
  if (autoFail) return `<span class="order-aoe-result order-aoe-result--miss" title="Авто-провал атаки">Авто</span>`;

  if (!entry || entry.state !== "resolved") {
    return `<span class="order-aoe-result order-aoe-result--pending" title="Ожидается защита">—</span>`;
  }

  const val = Number(entry.defenseTotal ?? 0) || 0;
  const miss = entry.hit === false; // зелёный = промах по цели (успешная защита)
  const cls = miss ? "order-aoe-result--miss" : "order-aoe-result--hit";
  const title = escapeHtml(formatDefenseEntryTitle(entry));
  return `<span class="order-aoe-result ${cls}" title="${title}">${val}</span>`;
}

function renderMeleeAoEContent(ctx) {
  const weaponImg = ctx.weaponImg ?? "";
  const weaponName = ctx.weaponName ?? "Атака";
  const attackTotal = Number(ctx.attackTotal ?? 0) || 0;
  const weaponDamage = Number(ctx.damage ?? 0) || 0;

  const autoFail = !!ctx.autoFail;

  const charText = ctx.applyModifiers
    ? (game.i18n?.localize?.(ctx.characteristic) ?? ctx.characteristic)
    : "Без характеристики";

  const rollHTML = String(ctx.attackRollHTML ?? "");
  const cardFlavor = String(ctx.cardFlavor ?? "");

  const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
  const perTarget = (ctx.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};

  const rows = targets.map(t => {
    const tokenId = String(t.tokenId);
    const name = t.tokenName ?? "—";
    const img = t.tokenImg ?? "";

    const entry = perTarget[tokenId] || {};
    const showStaminaBlock = !!t.shieldInHand;

    const defenseDisabled = autoFail || entry.state === "resolved";
    const dmgDisabled = !!entry.damageApplied;

    const dmgButtons = (entry.state === "resolved" && entry.hit === true)
      ? renderAoEDamageButtons({
        tokenId,
        baseDamage: Number(entry.baseDamage ?? ctx.damage ?? 0) || 0,
        sourceMessageId: ctx.messageId ?? "",
        criticalPossible: !!ctx.attackNat20,
        disabled: dmgDisabled
      })
      : "";

    const dmgState = entry.damageApplied
      ? `<span class="order-aoe-damage-applied" title="Урон уже применён"><i class="fas fa-check"></i></span>`
      : "";

    return `
      <div class="order-aoe-row" data-token-id="${tokenId}">
        <div class="order-aoe-left">
          <img class="order-aoe-portrait" src="${img}" />
          <span class="order-aoe-name">${name}</span>
        </div>

        <div class="order-aoe-right">
          ${renderAoEResultCell(entry, { autoFail })}
          ${renderAoEDefenseButtons({ tokenId, disabled: defenseDisabled, showStaminaBlock })}
          ${dmgButtons}
          ${dmgState}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="chat-attack-message order-melee order-aoe" data-order-attack="1" data-order-aoe="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${weaponImg}" alt="${weaponName}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${weaponName}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Характеристика атаки:</strong> ${charText}</p>
        <p><strong>Урон (потенциал):</strong> ${weaponDamage}</p>
        <p><strong>Результат атаки:</strong> ${attackTotal}${ctx.attackNat20 ? ' <span style="color:#b00;"><strong>(КРИТ 20)</strong></span>' : ""}</p>
        ${autoFail ? `<p style="color:#b00;"><strong>Авто-провал:</strong> итог &lt; ${AUTO_FAIL_ATTACK_BELOW}. По всем целям промах.</p>` : ""}
        <p class="order-roll-flavor">${cardFlavor}</p>
        <div class="inline-roll">${rollHTML}</div>
      </div>

      <hr/>

      <div class="order-aoe-targets">
        <div class="order-aoe-head">
          <span>Цель</span>
          <span class="order-aoe-head-right">Защита / Урон</span>
        </div>
        ${rows || `<div class="order-aoe-empty">Нет целей</div>`}
      </div>
    </div>
  `;
}

/**
 * Создать PF2-подобную карточку массовой атаки ближним оружием:
 * - один общий бросок атаки
 * - список целей, каждая цель кидает защиту и отображается результат/кнопки урона в одной карточке
 */
export async function createMeleeAoEAttackMessage({
  attackerActor,
  attackerToken,
  targetTokens = [],
  weapon,
  characteristic,
  rollMode = "normal",
  applyModifiers,
  customModifier,
  attackRoll,
  damage,
  stealthAttack = false
}) {
  const attackTotal = Number(attackRoll?.total ?? 0);
  const autoFail = attackTotal < AUTO_FAIL_ATTACK_BELOW;
  const _meleeBuff = collectMeleeWeaponDamageBuffs(attackerActor);
  const weaponDamage = (Number(damage ?? 0) || 0)
    + (Number(attackerActor?.system?._perkBonuses?.WeaponDamage ?? 0) || 0)
    + (Number(_meleeBuff.totalBonus ?? 0) || 0);

  const attackD20 = getKeptD20Result(attackRoll);
  const attackNat20 = attackD20 === 20;

  const rollHTML = attackRoll ? await attackRoll.render() : "";

  const cardFlavor = buildCombatRollFlavor({
    scene: "Ближний бой",
    action: stealthAttack ? "Атака (скрытная, AoE)" : "Атака (AoE)",
    source: `Оружие: ${weapon?.name ?? "—"}`,
    rollMode,
    characteristic,
    applyModifiers: !!applyModifiers,
    manualMod: Number(customModifier) || 0,
    effectsMod: (applyModifiers ? getExternalRollModifierFromEffects(attackerActor, "attack") : 0),
    isCrit: attackNat20
  });

  // Стабильные данные целей, чтобы карточка не ломалась если токен исчезнет.
  const targets = (Array.isArray(targetTokens) ? targetTokens : []).map(t => {
    const actor = t?.actor ?? null;
    const shield = hasShieldInHand(actor);
    return {
      tokenId: t?.id ?? null,
      tokenName: t?.name ?? (actor?.name ?? "—"),
      tokenImg: t?.document?.texture?.src ?? actor?.img ?? "",
      actorId: actor?.id ?? null,
      shieldInHand: !!shield
    };
  }).filter(t => !!t.tokenId);

  const perTarget = {};
  for (const t of targets) {
    perTarget[String(t.tokenId)] = {
      state: autoFail ? "resolved" : "awaitingDefense",
      defenseType: null,
      defenseTotal: null,
      hit: autoFail ? false : null,
      damageApplied: false,
      baseDamage: weaponDamage
    };
  }

  const ctx = {
    isAoE: true,
    attackerTokenId: attackerToken?.id ?? null,
    attackerActorId: attackerActor?.id ?? null,

    weaponId: weapon?.id ?? null,
    weaponName: weapon?.name ?? "",
    weaponImg: weapon?.img ?? "",
    weaponUuid: weapon?.uuid ?? null,

    characteristic: characteristic ?? null,
    applyModifiers: !!applyModifiers,
    customModifier: Number(customModifier) || 0,

    attackTotal,
    attackNat20,
    attackD20,
    damage: weaponDamage,

    autoFail,
    createdAt: Date.now(),
    rollMode: rollMode ?? "normal",

    // для рендера
    attackRollHTML: rollHTML,
    cardFlavor,

    targets,
    perTarget
  };

  // создаём сначала, чтобы узнать message.id -> для data-src
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    content: `<div class="order-aoe-loading">Создаём AoE атаку…</div>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { [FLAG_SCOPE]: { [FLAG_KEY]: ctx } }
  });

  // допишем messageId и перерендерим уже нормально
  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;

  const content = renderMeleeAoEContent(ctx2);

  await message.update({
    content,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}`]: ctx2
  });

  return message;
}

/* -------------------------------------------- */
/*  Client click handlers                        */
/* -------------------------------------------- */

async function promptPickItem({ title, items = [], emptyWarning = "Нет доступных вариантов." } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    ui.notifications.warn(emptyWarning);
    return null;
  }
  if (list.length === 1) return list[0];

  const options = list.map(i => `<option value="${i.id}">${i.name}</option>`).join("");

  return await new Promise(resolve => {
    new Dialog({
      title,
      content: `<div class="form-group"><select id="pick-item" style="width:100%;">${options}</select></div>`,
      buttons: {
        ok: { label: "OK", callback: html => resolve(list.find(x => x.id === html.find("#pick-item").val()) || null) },
        cancel: { label: "Отмена", callback: () => resolve(null) }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

async function promptPickDefensiveSpell(actor) {
  const spells = getDefensiveReactionSpells(actor);
  return await promptPickItem({
    title: "Выбор защитного заклинания",
    items: spells,
    emptyWarning: "У персонажа нет защитных заклинаний (defensive-reaction)."
  });
}

async function promptPickDefensiveSkill(actor) {
  const skills = getDefensiveReactionSkills(actor);
  return await promptPickItem({
    title: "Выбор защитного навыка",
    items: skills,
    emptyWarning: "У персонажа нет защитных навыков (defensive-reaction)."
  });
}

async function onDefenseClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const messageEl = button.closest?.(".message");
  const messageId = messageEl?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение атаки.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!ctx) return ui.notifications.error("В сообщении нет контекста атаки.");

  const isAoE = !!ctx.isAoE;

  // Какая цель защищается:
  const defenderTokenId = isAoE
    ? String(button.dataset.defenderTokenId || "")
    : String(ctx.defenderTokenId || "");

  if (isAoE && !defenderTokenId) {
    ui.notifications.error("Не удалось определить цель AoE защиты.");
    return;
  }

  // Проверяем состояние (в AoE состояние хранится на каждой цели отдельно)
  if (isAoE) {
    const entry = ctx?.perTarget?.[defenderTokenId];
    if (!entry) {
      ui.notifications.warn("Эта цель не найдена в списке AoE атаки.");
      return;
    }
    if (ctx.autoFail) {
      ui.notifications.info("Атака уже завершена (авто-провал). Реакции не применяются.");
      return;
    }
    if (String(entry.state) !== "awaitingDefense") {
      ui.notifications.warn("Для этой цели защита уже выбрана или атака разрешена.");
      return;
    }
  } else {
    const st = String(ctx?.state || "");
    if (!(st === "awaitingDefense" || st === "awaitingPreemptDefense")) {
      ui.notifications.warn("Эта атака уже разрешена или ожидает другой шаг.");
      return;
    }
    if (ctx.autoFail || ctx.state === "resolved") {
      ui.notifications.info("Атака уже завершена (авто-провал или уже разрешена). Реакции не применяются.");
      return;
    }
  }

  // Resolve defender token/actor
  const defenderToken = defenderTokenId ? canvas.tokens.get(defenderTokenId) : canvas.tokens.get(ctx.defenderTokenId);
  const defenderActorId = isAoE
    ? (ctx.targets?.find(t => String(t.tokenId) === defenderTokenId)?.actorId ?? null)
    : (ctx.defenderActorId ?? null);

  const defenderActor = defenderToken?.actor ?? (defenderActorId ? game.actors.get(defenderActorId) : null);
  if (!defenderActor) return ui.notifications.error("Не найден защитник.");

  // Защиту выбирает владелец цели (или GM)
  if (!(defenderActor.isOwner || game.user.isGM)) {
    ui.notifications.warn("Защиту может выбрать только владелец цели (или GM).");
    return;
  }

  const defenseType = String(button.dataset.defense || "");

  // PREEMPT пока не делаем для AoE (двухшаговая логика ломает общий стейт)
  if (isAoE && defenseType === "preempt") {
    ui.notifications.warn("Удар на опережение для AoE будет добавлен отдельным шагом.");
    return;
  }

  if (defenseType === "spell") {
    // AoE: выбираем заклинание в диалоге (без dropdown в карточке)
    const spellItem = isAoE
      ? await promptPickDefensiveSpell(defenderActor)
      : (() => {
        const select = messageEl?.querySelector?.(".order-defense-spell-select");
        const spellId = String(select?.value || "");
        return spellId ? defenderActor.items.get(spellId) : null;
      })();

    if (!spellItem) return;

    const res = await castDefensiveSpellDefense({
      actor: defenderActor,
      token: defenderToken,
      spellItem,
      silent: isAoE
    });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_DEFENSE",
      messageId,
      defenderTokenId: isAoE ? defenderTokenId : undefined,
      defenseType: "spell",
      defenseTotal: res.defenseTotal,
      defenderUserId: game.user.id,

      defenseSpellId: res.spellId,
      defenseSpellName: res.spellName,
      defenseCastFailed: res.castFailed,
      defenseCastTotal: res.castTotal
    });
    return;
  }

  if (defenseType === "skill") {
    const skillItem = isAoE
      ? await promptPickDefensiveSkill(defenderActor)
      : (() => {
        const select = messageEl?.querySelector?.(".order-defense-skill-select");
        const skillId = String(select?.value || "");
        return skillId ? defenderActor.items.get(skillId) : null;
      })();

    if (!skillItem) return;

    const res = await rollDefensiveSkillDefense({
      actor: defenderActor,
      token: defenderToken,
      skillItem,
      scene: "Ближний бой",
      toMessage: !isAoE
    });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_DEFENSE",
      messageId,
      defenderTokenId: isAoE ? defenderTokenId : undefined,
      defenseType: "skill",
      defenseTotal: res.defenseTotal,
      defenderUserId: game.user.id,

      defenseSkillId: res.skillId,
      defenseSkillName: res.skillName
    });
    return;
  }

  // Обычная защита характеристикой
  let attr = null;
  if (defenseType === "dodge") attr = "Dexterity";
  if (defenseType === "block" || defenseType === "block-strength") attr = "Strength";
  if (defenseType === "block-stamina") attr = "Stamina";

  if (!attr) {
    ui.notifications.warn("Неизвестный тип защиты.");
    return;
  }

  const label =
    defenseType === "dodge" ? "Уворот" :
      defenseType === "block-strength" ? "Блок (Strength)" :
        defenseType === "block-stamina" ? "Блок (Stamina)" :
          "Блок";

  const roll = await rollActorCharacteristic(defenderActor, attr, {
    scene: "Ближний бой",
    action: "Защита",
    source: label,
    toMessage: !isAoE,
    kind: "defense"
  });

  const total = Number(roll.total ?? 0);

  await emitToGM({
    type: "RESOLVE_DEFENSE",
    messageId,
    defenderTokenId: isAoE ? defenderTokenId : undefined,
    defenseType,
    defenseTotal: total,
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
  if (defenseType === "spell") {
    const msgEl = btn.closest?.(".message");
    const select = msgEl?.querySelector?.(".order-defense-spell-select");
    const spellId = String(select?.value || "");
    if (!spellId) return ui.notifications.warn("Выберите защитное заклинание в списке.");

    // 1) Достаём исходное сообщение атаки (srcMessageId)
    const srcMsg = game.messages.get(srcMessageId);
    const srcCtx = srcMsg?.getFlag("Order", "attack");
    if (!srcMsg || !srcCtx) {
      return ui.notifications.error("Не найден контекст исходной атаки для преемпта.");
    }

    // 2) Атакующий = тот, кто сейчас защищается против удара на опережение
    const attackerTokenId = srcCtx.attackerTokenId ?? srcCtx.casterTokenId ?? null;
    const attackerActorId = srcCtx.attackerActorId ?? srcCtx.casterActorId ?? null;

    const attackerToken = attackerTokenId ? canvas.tokens.get(attackerTokenId) : null;
    const attackerActor = attackerToken?.actor ?? (attackerActorId ? game.actors.get(attackerActorId) : null);

    if (!attackerActor) {
      console.warn("Order | preempt spell defense: attacker not found", { attackerTokenId, attackerActorId, srcCtx });
      return ui.notifications.error("Не найден атакующий для защиты против преемпта.");
    }

    const spellItem = attackerActor.items.get(spellId);
    if (!spellItem) return ui.notifications.warn("Выбранное заклинание не найдено у атакующего.");

    const res = await castDefensiveSpellDefense({
      actor: attackerActor,
      token: attackerToken,
      spellItem
    });

    if (!res) return;

    // КРИТИЧНО: для преемпта нужен PREEMPT_DEFENSE (meleeBus)
    await emitToGM({
      type: "PREEMPT_DEFENSE",
      srcMessageId,
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
    const msgEl = btn.closest?.(".message");
    const select = msgEl?.querySelector?.(".order-defense-skill-select");
    const skillId = String(select?.value || "");
    if (!skillId) return ui.notifications.warn("Выберите защитный навык в списке.");

    // атакующий = тот, кто сейчас защищается от удара на опережение
    const skillItem = attackerActor.items.get(skillId);
    if (!skillItem) return ui.notifications.warn("Выбранный навык не найден у атакующего.");

    const res = await rollDefensiveSkillDefense({
      actor: attackerActor,
      token: attackerToken,
      skillItem,
      contextLabel: "Удар на опережение"
    });
    if (!res) return;

    await emitToGM({
      type: "PREEMPT_DEFENSE",
      srcMessageId,
      defenseType: "skill",
      defenseTotal: res.defenseTotal,
      userId: game.user.id,

      defenseSkillId: res.skillId,
      defenseSkillName: res.skillName
    });
    return;
  }

  const label =
    defenseType === "dodge" ? "Уворот" :
      defenseType === "block-strength" ? "Блок (Strength)" :
        defenseType === "block-stamina" ? "Блок (Stamina)" :
          "Защита";

  const roll = await rollActorCharacteristic(attackerActor, attr, {
    scene: "Удар на опережение",
    action: "Защита",
    source: label,
    kind: "defense"
  });

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
  const isCrit = btn.dataset.crit === "1";

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

async function onSpendMeleeBuffClick(event) {
  event.preventDefault();

  const btn = event.currentTarget;
  const attackerActorId = btn.dataset.actorId;
  const effectId = btn.dataset.effectId;
  const spend = Number(btn.dataset.spend ?? 1) || 1;

  if (!attackerActorId || !effectId) {
    ui.notifications.warn("Не удалось списать бафф: не найден actorId/effectId.");
    return;
  }

  await emitToGM({
    type: "SPEND_MELEE_DAMAGE_BUFF",
    attackerActorId,
    effectId,
    spend,
    userId: game.user.id
  });
}

/* -------------------------------------------- */
/*  BUS (no sockets)                             */
/* -------------------------------------------- */

async function emitToGM(payload) {
  // If GM is clicking, handle immediately too.
  if (game.user.isGM) {
    console.log("OrderMelee | Local GM handleGMRequest()", payload);
    await handleGMRequest(payload);
    return;
  }

  // Send as a hidden/whisper message to GM with flags.
  const gmIds = getActiveGMIds();
  if (!gmIds.length) {
    ui.notifications.error("Не найден GM для отправки запроса.");
    return;
  }

  console.log("OrderMelee | BUS emit -> whisper GM", { gmIds, payload });

  await ChatMessage.create({
    content: `<p>Player requested: ${payload.type}</p>`,
    whisper: gmIds,
    flags: {
      Order: {
        meleeBus: {
          payload
        }
      }
    }
  });
}

/* -------------------------------------------- */
/*  GM dispatcher                                */
/* -------------------------------------------- */

export async function handleGMRequest(payload) {
  try {
    const { type } = payload ?? {};
    if (!type) return;

    if (type === "RESOLVE_DEFENSE") return await gmResolveDefense(payload);
    if (type === "APPLY_DAMAGE") return await gmApplyDamage(payload);
    if (type === "PREEMPT_DEFENSE") return await gmResolvePreemptDefense(payload);
    if (type === "SPEND_MELEE_DAMAGE_BUFF") return await gmSpendMeleeDamageBuff(payload);
  } catch (e) {
    console.error("OrderMelee | handleGMRequest ERROR", e, payload);
  }
}

async function gmSpendMeleeDamageBuff({ attackerActorId, effectId, spend = 1, userId } = {}) {
  try {
    const actor = game.actors.get(attackerActorId);
    if (!actor) {
      ui.notifications.warn("Не найден актёр для списания баффа.");
      return;
    }

    const res = await spendMeleeWeaponDamageBuff(actor, effectId, spend);

    if (!res?.ok) {
      ui.notifications.warn("Не удалось списать бафф (не найден/не тот эффект).");
      return;
    }

    const msg = res.deleted
      ? `Бафф урона ближнего оружия: заряды закончились — эффект снят.`
      : `Бафф урона ближнего оружия: осталось ударов ${res.hitsRemaining}.`;

    // Чтобы игрок видел результат (и ГМ тоже)
    await ChatMessage.create({
      content: `<p>${msg}</p>`,
      whisper: userId ? [userId, ...getActiveGMIds()] : getActiveGMIds()
    });

  } catch (e) {
    console.error("OrderMelee | gmSpendMeleeDamageBuff ERROR", e);
  }
}

/* -------------------------------------------- */
/*  Rolls / helpers                              */
/* -------------------------------------------- */

function getActorSystem(actor) {
  return actor?.system ?? actor?.data?.system ?? {};
}
function getItemSystem(item) {
  return item?.system ?? item?.data?.system ?? {};
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
      if (String(k) === String(key)) return acc + v;
      return acc;
    }, 0);
  }

  return { value, mods: localSum + globalSum };
}

async function rollActorCharacteristic(actor, attribute, {
  scene = "Ближний бой",
  action = "Защита",
  source = null,
  toMessage = true,
  kind = null
} = {}) {
  const sys = getActorSystem(actor);
  const char = sys?.[attribute];
  if (!char) throw new Error(`actor.system.${attribute} missing`);

  const base = Number(char.value || 0);
  const mods = Array.isArray(char.modifiers) ? char.modifiers : [];
  const modSum = mods.reduce((acc, m) => acc + (Number(m.value) || 0), 0);

  const externalMod = kind ? getExternalRollModifierFromEffects(actor, kind) : 0;
  const roll = await new Roll(`1d20 + ${base} + ${modSum} + ${externalMod}`).roll({ async: true });

  const parts = [];
  parts.push(`<p><strong>${scene}</strong> — ${action}</p>`);
  parts.push(`<p><strong>${actor.name}</strong> (${attribute}): ${base} + модификаторы ${modSum}</p>`);
  if (externalMod) parts.push(`<p><strong>Effects:</strong> ${externalMod > 0 ? "+" : ""}${externalMod}</p>`);
  if (source) parts.push(`<p><em>${source}</em></p>`);
  const flavor = parts.join("");

  if (toMessage) {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor
    });
  }

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

async function promptAttackRollSettings({
  title,
  defaultRollMode = "normal",     // "normal" | "adv" | "dis"
  defaultApplyModifiers = true,   // true = "с активными эффектами"
  defaultCustomModifier = 0
}) {
  return new Promise((resolve) => {
    let resolved = false;

    const content = `
      <form>
        <div class="form-group">
          <label><strong>Режим броска</strong></label>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <label style="display:flex; align-items:center; gap:6px;">
              <input type="radio" name="rollMode" value="normal" ${defaultRollMode === "normal" ? "checked" : ""}>
              Обычный
            </label>
            <label style="display:flex; align-items:center; gap:6px;">
              <input type="radio" name="rollMode" value="adv" ${defaultRollMode === "adv" ? "checked" : ""}>
              Преимущество
            </label>
            <label style="display:flex; align-items:center; gap:6px;">
              <input type="radio" name="rollMode" value="dis" ${defaultRollMode === "dis" ? "checked" : ""}>
              Помеха
            </label>
          </div>
        </div>

        <hr>

        <div class="form-group" style="display:flex; align-items:center; gap:8px;">
          <label style="margin:0;"><strong>Модификаторы характеристики</strong></label>
          <label style="display:flex; align-items:center; gap:6px; margin:0;">
            <input type="checkbox" name="applyMods" ${defaultApplyModifiers ? "checked" : ""}>
            Применять активные эффекты (моды)
          </label>
        </div>

        <div class="form-group">
          <label><strong>Ручной модификатор</strong> (число)</label>
          <input type="number" name="customMod" value="${Number(defaultCustomModifier) || 0}" step="1" style="width:100%;">
        </div>
      </form>
    `;

    new Dialog({
      title,
      content,
      buttons: {
        ok: {
          label: "Подтвердить",
          callback: (html) => {
            const rollMode = html.find('input[name="rollMode"]:checked').val() || "normal";
            const applyModifiers = html.find('input[name="applyMods"]').is(":checked");
            const customModifier = Number(html.find('input[name="customMod"]').val()) || 0;

            resolved = true;
            resolve({ rollMode, applyModifiers, customModifier });
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


function _diceFormulaForMode(mode) {
  if (mode === "adv") return "2d20kh1";
  if (mode === "dis") return "2d20kl1";
  return "1d20";
}

async function rollActorAttackConfigured(actor, {
  scene = "Ближний бой",
  action = "Атака",
  source = null,

  characteristicKey,
  rollMode = "normal",
  applyModifiers = true,
  customModifier = 0
}) {
  const parts = [_diceFormulaForMode(rollMode)];

  // Внешние влияния (дебаффы/эффекты) на атаку — учитываем ТОЛЬКО если applyModifiers=true
  const externalAttackMod = applyModifiers ? getExternalRollModifierFromEffects(actor, "attack") : 0;

  if (applyModifiers && characteristicKey) {
    const { value, mods } = getCharacteristicValueAndMods(actor, characteristicKey);
    if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
    if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
  }

  if (externalAttackMod !== 0) parts.push(externalAttackMod > 0 ? `+ ${externalAttackMod}` : `- ${Math.abs(externalAttackMod)}`);

  if (customModifier) parts.push(customModifier > 0 ? `+ ${customModifier}` : `- ${Math.abs(customModifier)}`);

  const roll = await new Roll(parts.join(" ")).roll({ async: true });
  const nat20 = isNat20(roll);

  const flavor = buildCombatRollFlavor({
    scene,
    action,
    source,
    rollMode,
    characteristic: characteristicKey,
    applyModifiers,
    manualMod: customModifier,
    effectsMod: externalAttackMod,
    isCrit: nat20
  });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor
  });

  return roll;
}




async function rollActorAttackWithDisadvantage(actor, weapon, characteristicKeyOrNull) {
  const charKey = characteristicKeyOrNull;
  const dmg = Number(getItemSystem(weapon)?.Damage ?? 0);

  const parts = ["2d20kl1"]; // disadvantage
  if (charKey) {
    const { value, mods } = getCharacteristicValueAndMods(actor, charKey);
    console.log("OrderMelee | Preempt roll uses:", { charKey, value, mods });

    if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
    if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
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
    const {
      messageId,
      defenderTokenId,          // важно для AoE
      defenseType,
      defenseTotal,
      defenderUserId,           // может быть
      defenseSpellId,
      defenseSpellName,
      defenseCastFailed,
      defenseCastTotal,
      defenseSkillId,
      defenseSkillName
    } = payload ?? {};

    if (!messageId) return;

    const message = game.messages.get(messageId);
    const ctx = message?.flags?.[FLAG_SCOPE]?.[FLAG_KEY];
    if (!message || !ctx) return;

    const isAoE = !!ctx.isAoE || !!defenderTokenId;

    // -------------------------------------------------------
    // AoE / PF2 flow: НИКАКИХ отдельных сообщений в чат.
    // Мы обновляем flags и content ОДНОГО исходного сообщения.
    // -------------------------------------------------------
    if (isAoE) {
      const tid = String(defenderTokenId || "");
      if (!tid) return;

      // Если автофейл — у нас все цели уже должны быть resolved+miss, но защиту на всякий случай игнорируем
      const attackTotal = Number(ctx.attackTotal ?? 0) || 0;
      const autoFail = (attackTotal < AUTO_FAIL_ATTACK_BELOW) || !!ctx.autoFail;

      const perTarget = (ctx.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};
      const entry = perTarget[tid];
      if (!entry) return;

      if (String(entry.state) === "resolved") return; // уже обработано

      // Resolve tokens/actors
      const attackerToken = canvas.tokens.get(ctx.attackerTokenId);
      const attackerActor = attackerToken?.actor ?? game.actors.get(ctx.attackerActorId);

      const defenderToken = canvas.tokens.get(tid);
      const defenderActor =
        defenderToken?.actor ??
        (() => {
          const actorId = ctx.targets?.find(t => String(t.tokenId) === tid)?.actorId;
          return actorId ? game.actors.get(actorId) : null;
        })();

      if (!attackerActor || !defenderActor) return;

      // preempt в AoE пока не поддерживаем (клиент его не отправляет)
      if (defenseType === "preempt") return;

      // Если автофейл — просто помечаем цель как промах (зелёный)
      const defenseNum = Number(defenseTotal ?? 0) || 0;
      const hit = autoFail ? false : (attackTotal > defenseNum);

      // Базовый урон для этой цели (уже с учётом перков WeaponDamage мы кладём в baseDamage при создании AoE-карточки)
      let baseDamage = Number(entry.baseDamage ?? ctx.damage ?? 0) || 0;

      // Если скрытная атака успешна — x1.5 (округление вверх), как в одиночной логике
      if (ctx.stealthEnabled && ctx.stealthSuccess) {
        baseDamage = Math.ceil(baseDamage * 1.5);
      }

      // Обновляем entry
      const newEntry = {
        ...entry,
        state: "resolved",
        defenseType: String(defenseType || ""),
        defenseTotal: defenseNum,
        hit: hit,
        // доп. инфо для дебага/будущего UI
        defenseSpellId: defenseType === "spell" ? (defenseSpellId || null) : null,
        defenseSpellName: defenseType === "spell" ? (defenseSpellName || null) : null,
        defenseCastFailed: defenseType === "spell" ? !!defenseCastFailed : null,
        defenseCastTotal: defenseType === "spell" ? (Number(defenseCastTotal ?? 0) || 0) : null,
        defenseSkillId: defenseType === "skill" ? (defenseSkillId || null) : null,
        defenseSkillName: defenseType === "skill" ? (defenseSkillName || null) : null,
        baseDamage
      };

      // Если попадание — применяем on-hit эффекты/нат20 теги (как в одиночной атаке), но БЕЗ создания сообщений
      if (hit) {
        // Resolve weapon
        let weapon = null;

        if (ctx.weaponUuid) {
          try { weapon = await fromUuid(ctx.weaponUuid); } catch (e) { /* ignore */ }
        }
        if (!weapon && ctx.weaponId) {
          weapon = attackerActor.items?.get?.(ctx.weaponId) ?? null;
        }
        if (!weapon && ctx.weaponName) {
          weapon = attackerActor.items?.find?.(i => i?.name === ctx.weaponName) ?? null;
        }

        try {
          await applyWeaponOnHitEffects({
            weapon,
            targetActor: defenderActor,
            attackTotal
          });
        } catch (e) {
          console.warn("OrderMelee | AoE applyWeaponOnHitEffects failed", e);
        }

        try {
          await applyWeaponNatD20TagEffects({
            weapon,
            attackerActor,
            targetActor: defenderActor,
            attackD20: ctx.attackD20,
            characteristicKey: ctx.characteristic,
            attackerToken,
            targetToken: defenderToken
          });
        } catch (e) {
          console.warn("OrderMelee | AoE applyWeaponNatD20TagEffects failed", e);
        }
      }

      // Собираем новый ctx (важно: messageId нужен для кнопок урона в строках)
      const ctx2 = foundry.utils.duplicate(ctx);
      ctx2.messageId = message.id;
      ctx2.perTarget = {
        ...(ctx2.perTarget || {}),
        [tid]: newEntry
      };

      // Перерендерим PF2-карточку
      // ВАЖНО: renderMeleeAoEContent должен быть в этом файле (мы добавляли его в AoE блок)
      const content = (typeof renderMeleeAoEContent === "function")
        ? renderMeleeAoEContent(ctx2)
        : message.content; // fallback, если ты ещё не вставил renderer

      await message.update({
        content,
        [`flags.${FLAG_SCOPE}.${FLAG_KEY}`]: ctx2
      });

      return;
    }

    // -------------------------------------------------------
    // Одиночный flow (как было раньше) — оставляем чат-сообщения
    // -------------------------------------------------------
    if (ctx.state === "resolved") return;

    // Resolve tokens/actors
    const attackerToken = canvas.tokens.get(ctx.attackerTokenId);
    const defenderToken = canvas.tokens.get(ctx.defenderTokenId);

    const attackerActor = attackerToken?.actor ?? game.actors.get(ctx.attackerActorId);
    const defenderActor = defenderToken?.actor ?? game.actors.get(ctx.defenderActorId);
    if (!attackerActor || !defenderActor) return;

    // Preempt flow (оставляем как есть)
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

    const attackTotal = Number(ctx.attackTotal) || 0;
    const autoFail = attackTotal < AUTO_FAIL_ATTACK_BELOW;

    if (autoFail || ctx.autoFail) {
      await message.update({
        "flags.Order.attack.state": "resolved",
        "flags.Order.attack.autoFail": true,
        "flags.Order.attack.hit": false
      });
      return;
    }

    const hit = attackTotal > Number(defenseTotal);

    const defenseLabel =
      defenseType === "spell" ? `заклинание: ${defenseSpellName || "—"}` :
        defenseType === "skill" ? `навык: ${defenseSkillName || "—"}` :
          defenseType;

    let extraSpellInfo = "";
    if (defenseType === "spell") {
      extraSpellInfo = `<p><strong>Каст:</strong> ${defenseCastFailed ? "провал" : "успех"} (бросок: ${defenseCastTotal ?? "—"})</p>`;
    }

    await message.update({
      "flags.Order.attack.state": "resolved",
      "flags.Order.attack.defenseType": defenseType,
      "flags.Order.attack.defenseTotal": Number(defenseTotal) || 0,
      "flags.Order.attack.hit": hit,
      "flags.Order.attack.criticalPossible": !!ctx.attackNat20,
      "flags.Order.attack.criticalForced": false,
      "flags.Order.attack.defenseSpellId": defenseType === "spell" ? (defenseSpellId || null) : null,
      "flags.Order.attack.defenseSpellName": defenseType === "spell" ? (defenseSpellName || null) : null,
      "flags.Order.attack.defenseCastFailed": defenseType === "spell" ? !!defenseCastFailed : null,
      "flags.Order.attack.defenseCastTotal": defenseType === "spell" ? (Number(defenseCastTotal ?? 0) || 0) : null,
      "flags.Order.attack.defenseSkillId": defenseType === "skill" ? (defenseSkillId || null) : null,
      "flags.Order.attack.defenseSkillName": defenseType === "skill" ? (defenseSkillName || null) : null
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
      content: `<p><strong>${defenderToken?.name ?? defenderActor.name}</strong> выбрал защиту: <strong>${defenseLabel}</strong>. Защита: <strong>${Number(defenseTotal) || 0}</strong>. ${extraSpellInfo} Итог: <strong>${hit ? "ПОПАДАНИЕ" : "ПРОМАХ"}</strong>${ctx.attackNat20 ? ' <span style="color:#b00;"><strong>(ДОСТУПЕН КРИТ)</strong></span>' : ""}.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    if (!hit) return;

    // Resolve weapon
    let weapon = null;
    if (ctx.weaponUuid) {
      try { weapon = await fromUuid(ctx.weaponUuid); } catch (e) { /* ignore */ }
    }
    if (!weapon && ctx.weaponId) weapon = attackerActor.items?.get?.(ctx.weaponId) ?? null;
    if (!weapon && ctx.weaponName) weapon = attackerActor.items?.find?.(i => i?.name === ctx.weaponName) ?? null;

    await applyWeaponOnHitEffects({ weapon, targetActor: defenderActor, attackTotal });

    await applyWeaponNatD20TagEffects({
      weapon,
      attackerActor,
      targetActor: defenderActor,
      attackD20: ctx.attackD20,
      characteristicKey: ctx.characteristic,
      attackerToken,
      targetToken: defenderToken
    });

    let baseDamage = Number(ctx.damage) || 0;
    if (ctx.stealthEnabled && ctx.stealthSuccess) {
      baseDamage = Math.ceil(baseDamage * 1.5);
    }

    await createDamageButtonsMessage({
      attackerActor,
      defenderTokenId: ctx.defenderTokenId,
      baseDamage,
      sourceMessageId: messageId,
      criticalPossible: !!ctx.attackNat20,
      criticalForced: false
    });

  } catch (e) {
    console.error("OrderMelee | gmResolveDefense ERROR", e, payload);
  }
}


async function gmStartPreemptFlow({ message, ctx, attackerActor, defenderActor, attackerToken, defenderToken, preempt }) {
  try {
    let meleeWeapon = null;
    if (preempt?.weaponId) meleeWeapon = defenderActor.items.get(preempt.weaponId);
    if (!meleeWeapon) meleeWeapon = findEquippedMeleeWeapon(defenderActor);

    if (!meleeWeapon) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
        content: `<p><strong>${defenderToken?.name ?? defenderActor.name}</strong> пытался совершить <strong>Удар на опережение</strong>, но нет ближнего оружия (meleeweapon) в экипировке. Считается провалом.</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });

      await message.update({
        "flags.Order.attack.state": "resolved",
        "flags.Order.attack.defenseType": "preempt",
        "flags.Order.attack.preempt": { result: "no-weapon" },
        "flags.Order.attack.hit": true,
        "flags.Order.attack.criticalPossible": true,
        "flags.Order.attack.criticalForced": true,
        "flags.Order.attack.autoFail": autoFail
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

    const preemptChar = preempt?.characteristic ?? null;

    const preemptRoll = await rollActorAttackConfigured(defenderActor, {
      scene: "Удар на опережение",
      action: "Атака",
      source: `Оружие: ${meleeWeapon?.name ?? "—"}`,
      characteristicKey: preemptChar,
      rollMode: preempt?.rollMode ?? "dis",
      applyModifiers: preempt?.applyModifiers ?? true,
      customModifier: Number(preempt?.customModifier) || 0
    });
    const preemptTotal = Number(preemptRoll.total ?? 0);
    const preemptAutoFail = preemptTotal < AUTO_FAIL_ATTACK_BELOW;
    const preemptNat20 = isNat20(preemptRoll);

    const attackerTotal = Number(ctx.attackTotal) || 0;

    if (preemptAutoFail) {
      await message.update({
        "flags.Order.attack.state": "resolved",
        "flags.Order.attack.defenseType": "preempt",
        "flags.Order.attack.preemptTotal": preemptTotal,
        "flags.Order.attack.preemptChar": preemptChar,
        "flags.Order.attack.preemptWeaponId": meleeWeapon.id,
        "flags.Order.attack.preemptAutoFail": true,

        // по твоему правилу провал преемпта => исходная атака успешна и критическая
        "flags.Order.attack.hit": true,
        "flags.Order.attack.criticalPossible": true,
        "flags.Order.attack.criticalForced": true
      });

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
        content: `<p><strong>Удар на опережение — авто-провал</strong> (итог ${preemptTotal} &lt; ${AUTO_FAIL_ATTACK_BELOW}). Атака врага считается успешной и <strong>критической</strong> (по правилу).</p>`,
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
          <div class="order-defense-spell-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
            <select class="order-defense-spell-select" data-src="${message.id}" style="min-width:220px;"></select>
            <button class="order-defense-vs-preempt" data-defense="spell" data-src="${message.id}">
            Защита заклинанием
            </button>
          </div>
          <div class="order-defense-skill-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
            <select class="order-defense-skill-select" data-src="${message.id}" style="flex:1; min-width:180px;"></select>
            <button class="order-defense-vs-preempt" data-defense="skill" data-src="${message.id}" style="flex:0 0 auto; white-space:nowrap;">
              Защита навыком
            </button>
          </div>

          ${preemptNat20 ? `<p style="color:#b00;"><strong>На преемпте доступен крит (нат.20)</strong></p>` : ""}
        </div>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  } catch (e) {
    console.error("OrderMelee | gmStartPreemptFlow ERROR", e, { preempt, ctx });
  }
}

function getWeaponEffectThreshold(weapon) {
  const sys = weapon?.system ?? weapon?.data?.system ?? {};
  const raw = sys?.EffectThreshold ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function getWeaponOnHitEffects(weapon) {
  const sys = weapon?.system ?? weapon?.data?.system ?? {};
  const raw = sys?.OnHitEffects;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .filter(([k]) => /^\d+$/.test(String(k)))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, v]) => v);
  }
  return [];
}

async function fetchDebuffsData() {
  const response = await fetch("systems/Order/module/debuffs.json");
  if (!response.ok) throw new Error("Failed to load debuffs.json");
  return await response.json();
}

let _debuffsCache = null;
let _debuffsCachePromise = null;

async function fetchDebuffsDataCached({ force = false } = {}) {
  if (!force && _debuffsCache) return _debuffsCache;

  // если уже грузим — возвращаем один и тот же промис, чтобы не было гонок
  if (!force && _debuffsCachePromise) return _debuffsCachePromise;

  _debuffsCachePromise = (async () => {
    const data = await fetchDebuffsData();
    _debuffsCache = data;
    _debuffsCachePromise = null;
    return _debuffsCache;
  })();

  return _debuffsCachePromise;
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
  const sys = getItemSystem(weapon);
  const tags = Array.isArray(sys?.tags) ? sys.tags : [];
  const want = normalizeTagKeySafe(tagKey);
  return tags.some(t => normalizeTagKeySafe(t) === want);
}

async function applyWeaponOnHitEffects({ weapon, targetActor, attackTotal, _debug = {} }) {
  try {
    if (!weapon || !targetActor) {
      dgw("applyWeaponOnHitEffects: missing weapon/target", { weapon, targetActor, _debug });
      return;
    }

    const threshold = getWeaponEffectThreshold(weapon);
    const effects = getWeaponOnHitEffects(weapon);

    dbg("applyWeaponOnHitEffects: enter", {
      _debug,
      weapon: weapon.name,
      weaponId: weapon.id,
      target: targetActor.name,
      attackTotal,
      threshold,
      effects
    });

    if (!effects.length) {
      dbg("applyWeaponOnHitEffects: no effects on weapon", { weapon: weapon.name, _debug });
      return;
    }

    if (Number(attackTotal) <= Number(threshold)) {
      dbg("applyWeaponOnHitEffects: threshold not passed -> skip", { attackTotal, threshold, _debug });
      return;
    }

    // ВАЖНО: показать, кто выполняет (должен быть GM!)
    dbg("applyWeaponOnHitEffects: executor", {
      user: game.user.name,
      isGM: game.user.isGM,
      activeGM: game.users.filter(u => u.isGM && u.active).map(u => u.name)
    });

    let debuffs;
    try {
      debuffs = await fetchDebuffsDataCached();
      dbg("applyWeaponOnHitEffects: debuffs loaded keys=", Object.keys(debuffs || {}).length);
    } catch (e) {
      dge("applyWeaponOnHitEffects: debuffs.json load failed", e);
      ui.notifications?.error?.("Не удалось загрузить debuffs.json для эффектов оружия.");
      return;
    }

    // Полезно: какие эффекты уже есть на цели
    const currentOrderEffects = (targetActor.effects || []).map(ae => ({
      id: ae.id,
      label: ae.label,
      disabled: ae.disabled,
      debuffKey: ae?.flags?.Order?.debuffKey ?? ae?._source?.flags?.Order?.debuffKey ?? null,
      stateKey: ae?.flags?.Order?.stateKey ?? ae?._source?.flags?.Order?.stateKey ?? null
    }));
    dbg("Target current Order effects:", currentOrderEffects);

    for (const entry of effects) {
      try {
        const debuffKey = entry?.debuffKey;
        const stateKeyRaw = entry?.stateKey ?? 1;
        const incomingLevel = Math.max(1, Math.min(3, Number(stateKeyRaw) || 1));
        const stateKey = String(incomingLevel);

        if (!debuffKey) {
          dgw("OnHitEffects entry without debuffKey", { entry, weapon: weapon.name });
          continue;
        }

        const debuff = debuffs?.[debuffKey];
        if (!debuff) {
          dgw("Unknown debuffKey in debuffs.json", { debuffKey, entry, known: Object.keys(debuffs || {}).slice(0, 20) });
          continue;
        }

        const existingEffect = (targetActor.effects || []).find(ae =>
          (ae?.flags?.Order?.debuffKey ?? ae?._source?.flags?.Order?.debuffKey) === debuffKey
        ) ?? null;

        const existingLevelRaw = existingEffect
          ? (existingEffect?.flags?.Order?.stateKey ?? existingEffect?._source?.flags?.Order?.stateKey ?? 0)
          : 0;

        const existingLevel = Math.max(0, Math.min(3, Number(existingLevelRaw) || 0));
        const newLevel = Math.min(3, existingLevel + incomingLevel);
        const finalStateKey = String(newLevel);

        if (typeof targetActor?._applyDebuff === "function") {
          const applied = await targetActor._applyDebuff(debuffKey, finalStateKey);
          if (applied) {
            dbg("Debuff applied via actor._applyDebuff", { debuffKey, newLevel, target: targetActor.name });
          } else {
            dgw("Debuff was not applied via actor._applyDebuff", { debuffKey, newLevel, target: targetActor.name });
          }
          continue;
        }

        const finalChanges = Array.isArray(debuff.changes?.[finalStateKey])
          ? debuff.changes[finalStateKey].map(ch => ({ ...ch }))
          : [];

        dbg("Debuff resolve", {
          debuffKey,
          debuffName: debuff.name,
          incomingLevel,
          existing: existingEffect ? { id: existingEffect.id, label: existingEffect.label, existingLevel } : null,
          newLevel,
          finalStateKey,
          finalChangesLen: finalChanges.length
        });

        const updateData = {
          label: `${debuff.name}`,
          icon: debuff.icon || "icons/svg/skull.svg",
          changes: finalChanges,
          "flags.description": debuff.states?.[finalStateKey] ?? "",
          "flags.Order.debuffKey": debuffKey,
          "flags.Order.stateKey": newLevel,
          "flags.Order.maxState": 3
        };

        // КРИТИЧЕСКАЯ проверка прав на изменение цели
        dbg("Permission check", {
          target: targetActor.name,
          isOwner: targetActor.isOwner,
          userIsGM: game.user.isGM
        });

        if (existingEffect) {
          dbg("Updating existing ActiveEffect", { effectId: existingEffect.id, updateData });
          await existingEffect.update(updateData);
        } else {
          dbg("Creating new ActiveEffect", { effectData: updateData });
          await targetActor.createEmbeddedDocuments("ActiveEffect", [{
            label: `${debuff.name}`,
            icon: debuff.icon || "icons/svg/skull.svg",
            changes: finalChanges,
            duration: { rounds: 1 },
            flags: {
              description: debuff.states?.[finalStateKey] ?? "",
              Order: { debuffKey, stateKey: newLevel, maxState: 3 }
            }
          }]);
        }

        dbg("Debuff applied OK", { debuffKey, newLevel, target: targetActor.name });

      } catch (errEntry) {
        dge("applyWeaponOnHitEffects: entry failed", { entry }, errEntry);
      }
    }

  } catch (err) {
    dge("applyWeaponOnHitEffects: fatal", err);
  }
}

async function applyWeaponNatD20TagEffects({
  weapon,
  attackerActor,
  targetActor,
  attackD20,
  characteristicKey,
  attackerToken,
  targetToken
}) {
  if (!weapon || !attackerActor || !targetActor) return;

  const nat = Number(attackD20);
  if (!Number.isFinite(nat) || nat <= 0) return;

  // Быстрый helper: безопасно добавить стадии (кап 3)
  const addDebuff = async (debuffKey, addStates) => {
    if (typeof targetActor._addDebuff === "function") {
      await targetActor._addDebuff(debuffKey, Number(addStates) || 1);
    } else if (typeof targetActor._applyDebuff === "function") {
      // fallback (на всякий): без стакания, но лучше чем ничего
      await targetActor._applyDebuff(debuffKey, String(Math.min(3, Number(addStates) || 1)));
    }
  };

  // --- BLEEDING / TRAUMA по nat d20 ---
  if (weaponHasTag(weapon, "зловещая острота") && nat >= 20) {
    await addDebuff("Bleeding", 2);
  }

  if (weaponHasTag(weapon, "заточенный клинок") && nat >= 20) {
    await addDebuff("Bleeding", 1);
  }
  if (weaponHasTag(weapon, "бритвенная острота") && nat >= 19) {
    await addDebuff("Bleeding", 1);
  }
  if (weaponHasTag(weapon, "невероятная острота") && nat >= 18) {
    await addDebuff("Bleeding", 1);
  }

  if (weaponHasTag(weapon, "тяжелый клинок") && nat >= 20) {
    await addDebuff("Trauma", 1);
  }
  if (weaponHasTag(weapon, "крушащий клинок") && nat >= 19) {
    await addDebuff("Trauma", 1);
  }
  if (weaponHasTag(weapon, "b1g-boy") && nat >= 18) {
    await addDebuff("Trauma", 1);
  }

  // --- ИДЕАЛЬНЫЙ БАЛАНС (20+) ---
  if (weaponHasTag(weapon, "идеальный баланс") && nat >= 20) {
    if (String(characteristicKey) === "Dexterity") {
      await addDebuff("Bleeding", 1);
    } else if (String(characteristicKey) === "Strength") {
      await addDebuff("Trauma", 1);
    }
  }

  // --- ВЕСКИЙ АРГУМЕНТ (19+) ---
  // Saving throw: Stamina vs DC = 8 + (Strength value + Strength mods)
  if (weaponHasTag(weapon, "веский аргумент") && nat >= 19) {
    const { value, mods } = getCharacteristicValueAndMods(attackerActor, "Strength");
    const dc = 8 + (Number(value) || 0) + (Number(mods) || 0);

    const saveRoll = await rollActorCharacteristic(targetActor, "Stamina", {
      scene: "Веский аргумент",
      action: "Проверка",
      source: `DC ${dc}`
    });

    const total = Number(saveRoll?.total ?? 0) || 0;
    const pass = total >= dc;

    if (!pass) {
      await addDebuff("Stunned", 1);
    }

    const aName = attackerToken?.name ?? attackerActor.name ?? "Атакующий";
    const tName = targetToken?.name ?? targetActor.name ?? "Цель";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: targetActor, token: targetToken }),
      content: `
        <p><strong>Веский аргумент:</strong> ${aName} → ${tName}.<br/>
        Проверка <strong>Stamina</strong>: <strong>${total}</strong> vs DC <strong>${dc}</strong> → 
        ${pass ? "успех (без оглушения)" : "<strong>провал</strong>: цель получает <strong>Оглушение +1</strong>"}
        </p>
      `,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  }
}

async function gmResolvePreemptDefense({ srcMessageId,
  defenseType,
  defenseTotal,
  userId,                 // если есть
  defenseSkillId,
  defenseSkillName,
  defenseSpellId,
  defenseSpellName,
  defenseCastFailed,
  defenseCastTotal }) {
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

    const defenseLabel =
      defenseType === "spell"
        ? `заклинание: ${defenseSpellName || "—"}`
        : defenseType === "skill"
          ? `навык: ${defenseSkillName || "—"}`
          : defenseType;

    await message.update({
      "flags.Order.attack.state": "resolved",
      "flags.Order.attack.preemptDefenseType": defenseType,
      "flags.Order.attack.preemptDefenseTotal": defendTotal,
      "flags.Order.attack.preemptHit": preemptHit,
      "flags.Order.attack.preemptDefenseSpellId": defenseType === "spell" ? (defenseSpellId || null) : null,
      "flags.Order.attack.preemptDefenseSpellName": defenseType === "spell" ? (defenseSpellName || null) : null,
      "flags.Order.attack.preemptDefenseCastFailed": defenseType === "spell" ? !!defenseCastFailed : null,
      "flags.Order.attack.preemptDefenseCastTotal": defenseType === "spell" ? (Number(defenseCastTotal ?? 0) || 0) : null,
      "flags.Order.attack.preemptDefenseSkillId": defenseType === "skill" ? (defenseSkillId || null) : null,
      "flags.Order.attack.preemptDefenseSkillName": defenseType === "skill" ? (defenseSkillName || null) : null
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: `<p><strong>${attackerActor.name}</strong> защищается против Удара на опережение: <strong>${defenseLabel}</strong>. Защита: <strong>${defendTotal}</strong>. Итог: <strong>${preemptHit ? "ПОПАДАНИЕ по атакующему" : "ПРОМАХ"}</strong>.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    if (preemptHit) {
      const weapon = defenderActor.items.get(ctx.preemptWeaponId);

      dbg("PREEMPT HIT -> applyWeaponOnHitEffects", {
        target: attackerActor.name,
        weaponName: weapon?.name,
        preemptTotal: Number(ctx.preemptTotal) || 0,
        src: srcMessageId
      });

      await applyWeaponOnHitEffects({
        weapon,
        targetActor: attackerActor,                 // цель преемпта
        attackTotal: Number(ctx.preemptTotal) || 0
      });

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
      ${renderSpendMeleeBuffPanel(attackerActor)}
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
    return !!(sys?.isEquiped && sys?.isUsed);
  });

  if (!equipped.length) return 0;

  let best = 0;
  for (const a of equipped) {
    const sys = getItemSystem(a);
    const val = Number(sys?.Deffensepotential ?? 0) || 0;
    if (val > best) best = val;
  }
  return best + (Number(actor?.system?._perkBonuses?.Armor ?? 0) || 0);
}

async function gmApplyDamage({ defenderTokenId, baseDamage, mode, isCrit, sourceMessageId }) {
  try {
    const token = canvas.tokens.get(defenderTokenId);
    const actor = token?.actor;
    if (!token || !actor) return;

    let srcMsg = null;
    let ctx = null;
    if (sourceMessageId) {
      srcMsg = game.messages.get(sourceMessageId);
      ctx = srcMsg?.flags?.Order?.attack ?? null;
    }

    const isAoE = !!ctx?.isAoE;

    // anti-double apply
    if (srcMsg && ctx) {
      if (isAoE) {
        const entry = ctx?.perTarget?.[defenderTokenId];
        if (entry?.damageApplied) return;

        await srcMsg.update({
          [`flags.Order.attack.perTarget.${defenderTokenId}.damageApplied`]: true
        });

        const ctx2 = foundry.utils.duplicate(ctx);
        ctx2.perTarget = foundry.utils.mergeObject(foundry.utils.duplicate(ctx.perTarget || {}), {
          [defenderTokenId]: {
            ...(ctx.perTarget?.[defenderTokenId] || {}),
            damageApplied: true
          }
        }, { inplace: false });

        const content = renderMeleeAoEContent(ctx2);
        await srcMsg.update({ content });
      } else {
        if (ctx?.damageApplied) return;
        await srcMsg.update({ "flags.Order.attack.damageApplied": true });
      }
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

    // Для AoE НЕ создаём отдельные сообщения, чтобы не спамить чат
    if (!isAoE) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><strong>${token.name}</strong> получает урон: <strong>${finalDamage}</strong>${isCrit ? " <strong>(КРИТ x2)</strong>" : ""}${mode === "armor" ? ` (броня ${armor})` : ""}.</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
    }
  } catch (e) {
    console.error("OrderMelee | gmApplyDamage ERROR", e);
  }
}

function getActiveGMIds() {
  // active=true чтобы не слать оффлайн ГМу (опционально, но полезно)
  return game.users
    .filter(u => u.isGM && u.active)
    .map(u => u.id);
}


export async function createMeleeAttackWithDialog({
  attackerActor,
  attackerToken,
  defenderToken,
  weapon,
  damage
}) {
  const availableChars = getAvailableCharacteristics(attackerActor);

  const chosenChar = await promptSelectCharacteristic({
    title: "Атака: выбрать характеристику",
    choices: availableChars,
    defaultKey: availableChars[0]?.key
  });

  if (!chosenChar) return null;

  const cfg = await promptAttackRollSettings({
    title: "Атака: настройка броска",
    defaultRollMode: "normal",
    defaultApplyModifiers: true,
    defaultCustomModifier: 0
  });

  if (!cfg) return null;

  const attackRoll = await rollActorAttackConfigured(attackerActor, {
    scene: "Ближний бой",
    action: "Атака",
    source: `Оружие: ${weapon?.name ?? "—"}`,
    characteristicKey: chosenChar,
    rollMode: cfg.rollMode,
    applyModifiers: cfg.applyModifiers,
    customModifier: cfg.customModifier
  });

  // ВАЖНО: createMeleeAttackMessage ожидает characteristic/applyModifiers/customModifier — заполняем
  return await createMeleeAttackMessage({
    attackerActor,
    attackerToken,
    defenderToken,
    weapon,
    characteristic: chosenChar,
    applyModifiers: cfg.applyModifiers,
    customModifier: cfg.customModifier,
    attackRoll,
    damage,
    rollMode: cfg.rollMode
  });
}

function getKeptD20Result(roll) {
  try {
    if (!roll) return null;
    const terms = roll.terms ?? [];
    for (const t of terms) {
      if (!t || typeof t !== "object") continue;
      if (t.faces !== 20) continue;

      const results = t.results ?? [];
      const active = results.filter(r => r?.active !== false);
      const used = active.length ? active : results;

      const r0 = used?.[0];
      const val = Number(r0?.result);
      return Number.isFinite(val) ? val : null;
    }
  } catch (e) {
    console.warn("OrderMelee | getKeptD20Result error", e);
  }
  return null;
}
