import { startSkillAttackWorkflow } from "./OrderSkillCombat.js";
import { startSkillSaveWorkflow } from "./OrderSkillSave.js";
import { startSkillAoEWorkflow } from "./OrderSkillAOE.js";
import { markSkillUsed } from "./OrderSkillCooldown.js";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function buildD20Formula(mode) {
  if (mode === "adv") return "2d20kh1";
  if (mode === "dis") return "2d20kl1";
  return "1d20";
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

function appendSigned(formula, n) {
  const v = Number(n) || 0;
  if (!v) return formula;
  return formula + (v > 0 ? ` + ${v}` : ` - ${Math.abs(v)}`);
}

async function pickCharacteristicFromSkill(skillItem) {
  const s = getSystem(skillItem);
  const chars = Array.isArray(s.Characteristics) ? s.Characteristics.filter(Boolean) : [];

  if (!chars.length) {
    ui.notifications.warn(`У навыка "${skillItem.name}" не заданы характеристики. Бросок будет 1d20.`);
    return null;
  }
  if (chars.length === 1) return String(chars[0]);

  const content = `
    <form class="order-skill-pick-char">
      <div class="form-group">
        <label>Выбери характеристику:</label>
        <select name="char">
          ${chars.map(c => `<option value="${c}">${c}</option>`).join("")}
        </select>
      </div>
      <div style="font-size:12px; opacity:.85; margin-top:6px;">
        Если закрыть окно — будет использована первая характеристика.
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let resolved = false;
    const done = (v) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };

    new Dialog({
      title: `Характеристика навыка: ${skillItem.name}`,
      content,
      buttons: {
        ok: {
          label: "OK",
          callback: (html) => {
            const v = String(html.find('select[name="char"]').val() || "");
            done(v || String(chars[0]));
          }
        }
      },
      default: "ok",
      close: () => done(String(chars[0])) // default
    }).render(true);
  });
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

async function rollSkillCheck({ actor, skillItem, mode, manualMod, characteristic }) {
  let formula = buildD20Formula(mode);

  if (characteristic) {
    const { value, mods } = getCharacteristicValueAndMods(actor, characteristic);
    formula = appendSigned(formula, value);
    formula = appendSigned(formula, mods);
  }

  formula = appendSigned(formula, manualMod);

  const roll = await new Roll(formula).roll({ async: true });
  return roll;
}

/**
 * Основная функция применения навыка.
 * - attack-* => отдельный бросок атаки, и старт combat-workflow
 * - defensive-reaction => бросок навыка (для защиты)
 * - save-check / aoe-template => workflow по аналогии со Spell (без каста/стоимости)
 * - utility => просто бросок навыка и чат-сообщение
 */
export async function startSkillUse({ actor, skillItem } = {}) {
  if (!actor || !skillItem) return null;

  const s = getSystem(skillItem);
  const delivery = String(s.DeliveryType || "utility");
  if (delivery === "utility") {
    // стартуем КД (если в бою)
    await markSkillUsed({ actor, skillItem });

    const s = getSystem(skillItem);
    const content = `
    <div class="chat-item-message">
      <div class="item-header">
        <img src="${skillItem.img}" alt="${skillItem.name}" width="50" height="50">
        <h3>${skillItem.name}</h3>
      </div>
      <div class="item-details">
        <p><strong>Тип:</strong> utility</p>
        <p><strong>Описание:</strong> ${s.Description || "Нет описания"}</p>
      </div>
    </div>
  `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    return { roll: null, total: 0, delivery: "utility" };
  }


  // Для атак и defensive-reaction нужен выбор характеристики (если есть)
  let characteristic = null;
  if (delivery === "attack-ranged" || delivery === "attack-melee" || delivery === "defensive-reaction") {
    characteristic = await pickCharacteristicFromSkill(skillItem);
  }

  const content = `
    <form class="order-skill-use">
      <div class="form-group">
        <label>Ручной модификатор:</label>
        <input type="number" id="skillManualMod" value="0" />
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let started = false;

    const doRoll = async (html, mode) => {
      started = true;
      const manualMod = Number(html.find("#skillManualMod").val() ?? 0) || 0;

      // CD стартует всегда при применении (в т.ч. провал/неудача)
      await markSkillUsed({ actor, skillItem });

      // Attack workflow
      if (delivery === "attack-ranged" || delivery === "attack-melee") {
        const roll = await rollSkillCheck({ actor, skillItem, mode, manualMod, characteristic });
        await startSkillAttackWorkflow({
          attackerActor: actor,
          attackerToken: actor.getActiveTokens?.()[0] ?? null,
          skillItem,
          attackRoll: roll,
          rollMode: mode,
          manualMod,
          characteristic
        });

        resolve({ roll, total: Number(roll.total ?? 0) || 0, delivery, characteristic });
        return;
      }

      // Defensive reaction: вернём результат (чат можно создавать отдельно в defense workflow)
      if (delivery === "defensive-reaction") {
        const roll = await rollSkillCheck({ actor, skillItem, mode, manualMod, characteristic });
        resolve({ roll, total: Number(roll.total ?? 0) || 0, delivery, characteristic });
        return;
      }

      // Save-check / AoE: без броска "каста", просто стартуем workflow (но CD уже запустили)
      if (delivery === "save-check") {
        await startSkillSaveWorkflow({
          casterActor: actor,
          casterToken: actor.getActiveTokens?.()[0] ?? null,
          skillItem
        });
        resolve({ roll: null, total: 0, delivery });
        return;
      }

      if (delivery === "aoe-template") {
        await startSkillAoEWorkflow({
          casterActor: actor,
          casterToken: actor.getActiveTokens?.()[0] ?? null,
          skillItem
        });
        resolve({ roll: null, total: 0, delivery });
        return;
      }

      // Utility: просто бросок + сообщение
      const roll = await rollSkillCheck({ actor, skillItem, mode, manualMod, characteristic });
      const rollHTML = await roll.render();

      const baseDamage = Number(s.Damage ?? 0) || 0;
      const nat20 = isNaturalTwenty(roll);

      const messageContent = `
        <div class="chat-item-message">
          <div class="item-header">
            <img src="${skillItem.img}" alt="${skillItem.name}" width="50" height="50">
            <h3>${skillItem.name}</h3>
          </div>
          <div class="item-details">
            <p><strong>Тип:</strong> ${delivery}</p>
            <p><strong>Описание:</strong> ${s.Description || "Нет описания"}</p>
            ${baseDamage ? `<p><strong>Урон/лечение:</strong> ${baseDamage}</p>` : ""}
            <p><strong>Результат броска:</strong> ${roll.total}${nat20 ? ` <span style="color:#c00;font-weight:700;">[КРИТ]</span>` : ""}</p>
            <div class="inline-roll">${rollHTML}</div>
          </div>
        </div>
      `;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: messageContent,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });

      resolve({ roll, total: Number(roll.total ?? 0) || 0, delivery, characteristic });
    };

    new Dialog({
      title: `Применить навык: ${skillItem.name}`,
      content,
      buttons: {
        normal: { label: "Обычный", callback: (html) => doRoll(html, "normal") },
        adv: { label: "Преимущество", callback: (html) => doRoll(html, "adv") },
        dis: { label: "Помеха", callback: (html) => doRoll(html, "dis") }
      },
      default: "normal",
      close: () => {
        if (!started) resolve(null);
      }
    }).render(true);
  });
}
