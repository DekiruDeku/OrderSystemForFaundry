import { startSpellCast } from "./OrderSpell.js";
import { startSkillUse } from "./OrderSkill.js";
import { startRangedAttack } from "./OrderRange.js";
import { createMeleeAttackMessage } from "./OrderMelee.js";

const MODULE_ID = "Order";

/**
 * Enables dragging items from the Order actor sheet to the Foundry hotbar.
 * When a macro is executed:
 *  - Skills/Spells/Weapons that can roll will perform the roll flow.
 *  - Everything else logs a simple message to chat.
 */
export function registerOrderHotbarSupport() {
  // 1) Hotbar drop handler (intercepts the default Item->Macro creation)
  // IMPORTANT: Foundry Hooks are synchronous; returning a Promise does NOT block default behavior.
  // Therefore this handler MUST be sync and return false immediately when we decide to handle the drop.
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    try {
      if (!data || data.type !== "Item" || !data.uuid) return;

      // Resolve synchronously (v11 has fromUuidSync). For embedded items dragged from an actor sheet
      // this should be available instantly.
      const item = (typeof fromUuidSync === "function") ? fromUuidSync(data.uuid) : null;
      if (!item) return;

      // Only handle embedded items (dragged from actor sheets)
      if (!(item.parent instanceof Actor)) return;

      // Fire-and-forget (we already returned false to cancel default macro creation)
      _createOrAssignItemMacro(item, slot);
      return false;
    } catch (err) {
      console.error("Order | hotbarDrop handler error", err);
    }
  });

  // 2) Public macro API (called by the created macros)
  Hooks.once("ready", () => {
    try {
      game.Order = game.Order || {};
      game.Order.macros = game.Order.macros || {};
      game.Order.macros.useItem = _useOrderItemMacro;
    } catch (err) {
      console.error("Order | Could not register macro API", err);
    }
  });
}

async function _createOrAssignItemMacro(item, slot) {
  const uuid = item.uuid;
  const command = `(async () => { await game.Order?.macros?.useItem?.("${uuid}"); })();`;

  let macro = game.macros?.find((m) => m?.type === "script" && m?.command === command);
  if (!macro) {
    macro = await Macro.create(
      {
        name: item.name,
        type: "script",
        img: item.img,
        command,
        flags: {
          [MODULE_ID]: {
            itemMacro: { uuid }
          }
        }
      },
      { displaySheet: false }
    );
  } else {
    // Keep macro visuals in sync (helps when items were dragged before and macro got a default icon)
    const updates = {};
    if (macro.name !== item.name) updates.name = item.name;
    if (macro.img !== item.img) updates.img = item.img;
    if (Object.keys(updates).length) await macro.update(updates);
  }

  await game.user.assignHotbarMacro(macro, slot);
  return macro;
}

async function _useOrderItemMacro(uuid) {
  const item = await fromUuid(uuid);
  if (!item) {
    ui.notifications?.warn?.("Предмет не найден.");
    return;
  }

  const actor = item.parent;
  if (!actor) {
    ui.notifications?.warn?.("Актёр не найден.");
    return;
  }

  // --- Roll-capable entities ---
  if (item.type === "Skill") {
    return startSkillUse({ actor, skillItem: item });
  }

  if (item.type === "Spell") {
    return startSpellCast({ actor, spellItem: item });
  }

  if (item.type === "rangeweapon") {
    return startRangedAttack({ attackerActor: actor, weapon: item });
  }

  if (["weapon", "meleeweapon"].includes(item.type)) {
    return _showMeleeAttackRollDialog({ actor, weapon: item });
  }

  // --- No dice -> just a chat log ---
  return _logItemToChat({ actor, item });
}

function _logItemToChat({ actor, item }) {
  const speaker = ChatMessage.getSpeaker({ actor });
  const desc = _extractDescription(item);

  const content = `
    <div class="chat-item-message">
      <div class="item-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${item.img}" alt="${item.name}" width="36" height="36" style="border:0;"/>
        <h3 style="margin:0;">${item.name}</h3>
      </div>
      <p style="margin:6px 0 0 0;"><em>Действие выполнено.</em></p>
      ${desc ? `<hr/><div>${desc}</div>` : ""}
    </div>
  `;

  return ChatMessage.create({ speaker, content });
}

function _extractDescription(item) {
  const sys = item?.system ?? {};
  const candidate =
    sys.Description ??
    sys.description ??
    sys.details ??
    sys?.data?.Description ??
    sys?.data?.description ??
    "";
  const text = String(candidate ?? "").trim();
  return text ? TextEditor.enrichHTML(text, { async: false }) : "";
}

/* -------------------------------------------- */
/*  Melee weapon macro (dialog + roll + flow)    */
/* -------------------------------------------- */

function _showMeleeAttackRollDialog({ actor, weapon }) {
  const chars = Array.isArray(weapon.system?.AttackCharacteristics)
    ? weapon.system.AttackCharacteristics
    : [];

  const hasChars = chars.length > 0;
  const options = chars
    .map((c) => `<option value="${c}">${game.i18n.localize(c)}</option>`)
    .join("");

  const charSelect = hasChars
    ? `<div class="form-group">
         <label for="characteristic">Характеристика броска:</label>
         <select id="characteristic">${options}</select>
       </div>`
    : "";

  const content = `
    <form>
      ${charSelect}
      ${hasChars ? "" : "<p>Нужно добавить характеристику в оружие</p>"}

      <div class="form-group">
        <label for="modifier">Ручной модификатор:</label>
        <input type="number" id="modifier" value="0" step="1" style="width: 80px;" />
      </div>

      <div class="form-group">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="applyMods" checked />
          Применять активные эффекты (моды характеристики)
        </label>
      </div>

      <div class="form-group" style="display:flex; align-items:center; gap:8px;">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="stealthAttack" />
          Скрытная атака (Stealth с помехой vs Knowledge цели)
        </label>
      </div>

      <p>Выберите вариант броска:</p>
    </form>
  `;

  const dialog = new Dialog({
    title: `Бросок атаки — ${weapon.name}`,
    content,
    buttons: {
      normal: {
        label: "Обычный",
        callback: (html) => {
          const characteristic = html.find("#characteristic").val();
          const customMod = html.find("#modifier").val();
          const applyMods = html.find("#applyMods").is(":checked");
          const stealthAttack = html.find("#stealthAttack").is(":checked");
          _rollMeleeAttack({ actor, weapon, characteristic, applyMods, customModifier: customMod, rollMode: "normal", stealthAttack });
        }
      },
      adv: {
        label: "Преимущество",
        callback: (html) => {
          const characteristic = html.find("#characteristic").val();
          const customMod = html.find("#modifier").val();
          const applyMods = html.find("#applyMods").is(":checked");
          const stealthAttack = html.find("#stealthAttack").is(":checked");
          _rollMeleeAttack({ actor, weapon, characteristic, applyMods, customModifier: customMod, rollMode: "adv", stealthAttack });
        }
      },
      dis: {
        label: "Помеха",
        callback: (html) => {
          const characteristic = html.find("#characteristic").val();
          const customMod = html.find("#modifier").val();
          const applyMods = html.find("#applyMods").is(":checked");
          const stealthAttack = html.find("#stealthAttack").is(":checked");
          _rollMeleeAttack({ actor, weapon, characteristic, applyMods, customModifier: customMod, rollMode: "dis", stealthAttack });
        }
      }
    },
    default: "normal"
  });

  if (!hasChars) {
    Hooks.once("renderDialog", (app, html) => {
      if (app === dialog) {
        html.find('button[data-button="normal"]').prop("disabled", true);
        html.find('button[data-button="adv"]').prop("disabled", true);
        html.find('button[data-button="dis"]').prop("disabled", true);
      }
    });
  }

  dialog.render(true);
}

async function _rollMeleeAttack({ actor, weapon, characteristic, applyMods = true, customModifier = 0, rollMode = "normal", stealthAttack = false }) {
  const dice = rollMode === "adv" ? "2d20kh1" : rollMode === "dis" ? "2d20kl1" : "1d20";

  const actorData = actor.system ?? {};
  const charValue = Number(actorData?.[characteristic]?.value ?? 0) || 0;
  const modifiersArray = applyMods ? (actorData?.[characteristic]?.modifiers || []) : [];
  const charMod = applyMods
    ? modifiersArray.reduce((acc, m) => acc + (Number(m?.value) || 0), 0)
    : 0;

  const attackEffectMod = applyMods ? _getExternalRollModifier(actor, "attack") : 0;
  // Same rule as in the sheet: apply penalties from OTHER unmet requirements.
  const requirementMod = applyMods ? _getWeaponRequirementPenalty({ actor, weapon, excludeCharacteristic: characteristic }) : 0;

  const totalMod = charMod + attackEffectMod + requirementMod + (Number(customModifier) || 0);
  const parts = [dice];
  if (charValue !== 0) parts.push(charValue > 0 ? `+ ${charValue}` : `- ${Math.abs(charValue)}`);
  if (totalMod !== 0) parts.push(totalMod > 0 ? `+ ${totalMod}` : `- ${Math.abs(totalMod)}`);
  const formula = parts.join(" ");

  const result = await new Roll(formula).roll({ async: true });
  try {
    if (typeof AudioHelper !== "undefined" && CONFIG?.sounds?.dice) {
      AudioHelper.play({ src: CONFIG.sounds.dice });
    }
  } catch (e) {
    // noop
  }

  const targets = Array.from(game.user.targets || []);
  if (targets.length !== 1) {
    ui.notifications.warn("Для атаки ближнего боя выбери ровно одну цель (клавиша T).");
    return;
  }
  const defenderToken = targets[0];

  const controlled = Array.from(canvas.tokens.controlled || []);
  const attackerToken = controlled.find((t) => t.actor?.id === actor.id) || controlled[0] || null;
  if (!attackerToken) {
    ui.notifications.warn("Выдели своего токена (controlled), чтобы совершить атаку.");
    return;
  }

  const weaponDamage = weapon.system?.Damage || 0;

  await createMeleeAttackMessage({
    attackerActor: actor,
    attackerToken,
    defenderToken,
    weapon,
    characteristic,
    rollMode,
    applyModifiers: applyMods,
    customModifier,
    attackRoll: result,
    damage: weaponDamage,
    stealthAttack
  });
}

function _getExternalRollModifier(actor, kind) {
  const key = kind === "attack" ? "flags.Order.roll.attack" : "flags.Order.roll.defense";

  return Array.from(actor.effects ?? []).reduce((total, effect) => {
    if (!effect || effect.disabled) return total;
    const changes = Array.isArray(effect.changes) ? effect.changes : [];
    const bonus = changes
      .filter((c) => c.key === key)
      .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
    return total + bonus;
  }, 0);
}

function _getWeaponRequirementPenalty({ actor, weapon, excludeCharacteristic = null }) {
  const reqs = Array.isArray(weapon.system?.RequiresArray) ? weapon.system.RequiresArray : [];
  const exclude = excludeCharacteristic ? String(excludeCharacteristic) : null;

  return reqs.reduce((penalty, r) => {
    const char = r?.RequiresCharacteristic;
    if (!char) return penalty;
    if (exclude && char === exclude) return penalty;

    const need = Number(r?.Requires) || 0;
    const have = Number(actor.system?.[char]?.value ?? 0) || 0;
    return penalty - Math.max(0, need - have);
  }, 0);
}
