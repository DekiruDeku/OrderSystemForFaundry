import { startSkillAttackWorkflow } from "./OrderSkillCombat.js";
import { startSkillSaveWorkflow } from "./OrderSkillSave.js";
import { startSkillAoEWorkflow } from "./OrderSkillAOE.js";
import { markSkillUsed } from "./OrderSkillCooldown.js";
import { evaluateRollFormula } from "./OrderDamageFormula.js";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function buildD20Formula(mode) {
  if (mode === "adv") return "2d20kh1";
  if (mode === "dis") return "2d20kl1";
  return "1d20";
}

function appendSigned(formula, n) {
  const v = Number(n) || 0;
  if (!v) return formula;
  return formula + (v > 0 ? ` + ${v}` : ` - ${Math.abs(v)}`);
}

function sanitizeRollFormulaInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.includes(",")) {
    const last = s.split(",").map(t => t.trim()).filter(Boolean).pop();
    return last || "";
  }
  return s;
}

function getRollFormulasFromSkill(skillItem) {
  const s = getSystem(skillItem);
  const rawArr = Array.isArray(s?.RollFormulas) ? s.RollFormulas : [];
  const out = rawArr.map(v => String(v ?? ""));

  const legacy = String(s?.RollFormula ?? "").trim();
  if (legacy && !out.some(v => String(v).trim() === legacy)) {
    out.unshift(legacy);
  }

  return out;
}

async function chooseSkillRollFormula({ skillItem }) {
  const list = getRollFormulasFromSkill(skillItem)
    .map(v => String(v ?? "").trim())
    .filter(Boolean);

  if (!list.length) return "";

  const defaultLabel = "\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E (\u0442\u043E\u043B\u044C\u043A\u043E \u043A\u0443\u0431)";
  const labelText = "\u0424\u043E\u0440\u043C\u0443\u043B\u0430 \u0431\u0440\u043E\u0441\u043A\u0430";
  const titleText = "\u0424\u043E\u0440\u043C\u0443\u043B\u0430 \u0431\u0440\u043E\u0441\u043A\u0430: ";
  const options = [
    `<option value="">${defaultLabel}</option>`,
    ...list.map((f, i) => `<option value="${i}">${f}</option>`)
  ].join("");

  const content = `
    <form class="order-skill-roll-formula">
      <div class="form-group">
        <label>${labelText}:</label>
        <select id="skillRollFormula">
          ${options}
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    const done = (value) => resolve(String(value ?? ""));

    new Dialog({
      title: `${titleText}${skillItem?.name ?? ""}`,
      content,
      buttons: {
        ok: {
          label: "OK",
          callback: (html) => {
            const raw = String(html.find("#skillRollFormula").val() ?? "");
            if (raw === "") return done("");
            const idx = Number(raw);
            if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return done("");
            return done(list[idx]);
          }
        }
      },
      default: "ok",
      close: () => done("")
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

async function rollSkillCheck({ actor, skillItem, mode, manualMod, rollFormulaRaw }) {
  let formula = buildD20Formula(mode);
  let rollFormulaValue = null;

  const raw = sanitizeRollFormulaInput(rollFormulaRaw);
  if (raw) {
    rollFormulaValue = evaluateRollFormula(raw, actor, skillItem);
    formula = appendSigned(formula, rollFormulaValue);
  }

  formula = appendSigned(formula, manualMod);

  const roll = await new Roll(formula).roll({ async: true });
  return { roll, rollFormulaValue };
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
  const delivery = String(s.DeliveryType || "utility").trim().toLowerCase();
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



  // Save-check / AoE: без окна броска (как у AoE заклинаний)
  if (delivery === "save-check") {
    const ok = await startSkillSaveWorkflow({
      casterActor: actor,
      casterToken: actor.getActiveTokens?.()[0] ?? null,
      skillItem
    });

    // КД запускаем только если workflow реально стартовал
    if (ok) await markSkillUsed({ actor, skillItem });

    return ok ? { roll: null, total: 0, delivery } : null;
  }

  if (delivery === "aoe-template") {
    const ok = await startSkillAoEWorkflow({
      casterActor: actor,
      casterToken: actor.getActiveTokens?.()[0] ?? null,
      skillItem
    });

    // КД запускаем только если шаблон поставили (workflow реально продолжился)
    if (ok) await markSkillUsed({ actor, skillItem });

    return ok ? { roll: null, total: 0, delivery } : null;
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
      const selectedFormula = await chooseSkillRollFormula({ skillItem });
      const rollFormulaRaw = sanitizeRollFormulaInput(selectedFormula);

      // CD стартует всегда при применении (в т.ч. провал/неудача)
      await markSkillUsed({ actor, skillItem });

      // Attack workflow
      if (delivery === "attack-ranged" || delivery === "attack-melee") {
        const { roll, rollFormulaValue } = await rollSkillCheck({ actor, skillItem, mode, manualMod, rollFormulaRaw });
        await startSkillAttackWorkflow({
          attackerActor: actor,
          attackerToken: actor.getActiveTokens?.()[0] ?? null,
          skillItem,
          attackRoll: roll,
          rollMode: mode,
          manualMod,
          characteristic: null,
          rollFormulaRaw,
          rollFormulaValue
        });

        resolve({ roll, total: Number(roll.total ?? 0) || 0, delivery, characteristic: null, rollFormulaRaw, rollFormulaValue });
        return;
      }

      // Defensive reaction: вернём результат (чат можно создавать отдельно в defense workflow)
      if (delivery === "defensive-reaction") {
        const { roll, rollFormulaValue } = await rollSkillCheck({ actor, skillItem, mode, manualMod, rollFormulaRaw });
        resolve({
          roll,
          total: Number(roll.total ?? 0) || 0,
          delivery,
          characteristic: null,
          rollMode: mode,
          manualMod,
          rollFormulaRaw,
          rollFormulaValue
        });
        return;
      }

      // Utility: просто бросок + сообщение
      const { roll, rollFormulaValue } = await rollSkillCheck({ actor, skillItem, mode, manualMod, rollFormulaRaw });
      const rollHTML = await roll.render();

      const baseDamage = Number(s.Damage ?? 0) || 0;
      const nat20 = isNaturalTwenty(roll);

      const formulaLine = rollFormulaRaw
        ? `<p><strong>Формула броска:</strong> ${rollFormulaRaw} = ${rollFormulaValue ?? 0}</p>`
        : "";

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
            ${formulaLine}
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

      resolve({ roll, total: Number(roll.total ?? 0) || 0, delivery, characteristic: null, rollFormulaRaw, rollFormulaValue });
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
