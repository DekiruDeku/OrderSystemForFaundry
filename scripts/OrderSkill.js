import { startSkillAttackWorkflow } from "./OrderSkillCombat.js";
import { startSkillSaveWorkflow } from "./OrderSkillSave.js";
import { startSkillAoEWorkflow } from "./OrderSkillAOE.js";
import { startSkillMassSaveWorkflow } from "./OrderSkillMassSave.js";
import { markSkillUsed } from "./OrderSkillCooldown.js";
import { evaluateRollFormula } from "./OrderDamageFormula.js";
import { buildSkillDeliveryPipeline } from "./OrderDeliveryPipeline.js";

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

  let rawArr = [];
  const raw = s?.RollFormulas;

  if (Array.isArray(raw)) {
    rawArr = raw;
  } else if (typeof raw === "string") {
    rawArr = [raw];
  } else if (raw && typeof raw === "object") {
    // Back-compat: some documents may store arrays as objects with numeric keys.
    const keys = Object.keys(raw)
      .filter(k => String(Number(k)) === k)
      .map(k => Number(k))
      .sort((a, b) => a - b);
    rawArr = keys.map(k => raw[k]);
  }

  // Normalize to strings
  const out = rawArr.map(v => String(v ?? ""));

  // Legacy single-formula field
  const legacy = String(s?.RollFormula ?? "").trim();
  if (legacy && !out.some(v => String(v).trim() === legacy)) {
    out.unshift(legacy);
  }

  return out;
}

async function chooseSkillRollFormula({ skillItem }) {
  // Collect formulas from system data. Support both array and object forms.
  const rawList = getRollFormulasFromSkill(skillItem)
    .map(v => String(v ?? "").trim())
    .filter(Boolean);

  // Deduplicate while preserving order.
  const seen = new Set();
  const list = [];
  for (const f of rawList) {
    if (seen.has(f)) continue;
    seen.add(f);
    list.push(f);
  }

  if (!list.length) return "";

  // If exactly one formula is defined, always use it without asking.
  if (list.length === 1) return list[0];

  const defaultLabel = "\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e (\u0442\u043e\u043b\u044c\u043a\u043e \u043a\u0443\u0431)";
  const labelText = "\u0424\u043e\u0440\u043c\u0443\u043b\u0430 \u0431\u0440\u043e\u0441\u043a\u0430";
  const titleText = "\u0424\u043e\u0440\u043c\u0443\u043b\u0430 \u0431\u0440\u043e\u0441\u043a\u0430: ";
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
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(String(value ?? ""));
    };

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

async function rollSkillCheck({ actor, skillItem, mode, manualMod, rollFormulaRaw, externalRollMod = 0 }) {
  let formula = buildD20Formula(mode);
  let rollFormulaValue = null;

  const raw = sanitizeRollFormulaInput(rollFormulaRaw);
  if (raw) {
    rollFormulaValue = evaluateRollFormula(raw, actor, skillItem);
    formula = appendSigned(formula, rollFormulaValue);
  }

  formula = appendSigned(formula, externalRollMod);
  formula = appendSigned(formula, manualMod);

  const roll = await new Roll(formula).roll({ async: true });
  return { roll, rollFormulaValue };
}

/**
 * Main entry point for skill usage.
 * - attack-* => attack roll + combat workflow
 * - defensive-reaction => standalone defensive skill roll
 * - save-check / aoe-template / mass-save-check => dedicated save/aoe workflows
 * - utility => chat message only
 */
export async function startSkillUse({ actor, skillItem, externalRollMod = 0 } = {}) {
  if (!actor || !skillItem) return null;

  const s = getSystem(skillItem);
  const deliveryPipeline = buildSkillDeliveryPipeline(s);
  const primaryDelivery = String(deliveryPipeline[0] || "utility").trim().toLowerCase();
  const casterToken = actor.getActiveTokens?.()[0] ?? null;

  let cooldownStarted = false;
  const markUsedOnce = async () => {
    if (cooldownStarted) return;
    await markSkillUsed({ actor, skillItem });
    cooldownStarted = true;
  };

  if (primaryDelivery === "utility") {
    await markUsedOnce();

    const content = `
    <div class="chat-item-message">
      <div class="item-header">
        <img src="${skillItem.img}" alt="${skillItem.name}" width="50" height="50">
        <h3>${skillItem.name}</h3>
      </div>
      <div class="item-details">
        <p><strong>\u0422\u0438\u043f:</strong> utility</p>
        <p><strong>\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435:</strong> ${s.Description || "\u041d\u0435\u0442 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u044f"}</p>
      </div>
    </div>
  `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    return { roll: null, total: 0, delivery: "utility", pipeline: deliveryPipeline };
  }

  if (deliveryPipeline.length === 1 && primaryDelivery === "save-check") {
    const ok = await startSkillSaveWorkflow({
      casterActor: actor,
      casterToken,
      skillItem,
      pipelineMode: true
    });

    if (ok) await markUsedOnce();
    return ok ? { roll: null, total: 0, delivery: primaryDelivery, pipeline: deliveryPipeline } : null;
  }
  if (deliveryPipeline.length === 1 && primaryDelivery === "mass-save-check") {
    const ok = await startSkillMassSaveWorkflow({
      casterActor: actor,
      casterToken,
      skillItem,
      pipelineMode: true
    });

    if (ok) await markUsedOnce();
    return ok ? { roll: null, total: 0, delivery: primaryDelivery, pipeline: deliveryPipeline } : null;
  }

  const rollSteps = new Set(["attack-ranged", "attack-melee", "aoe-template", "defensive-reaction"]);
  const attackOrDefSteps = new Set(["attack-ranged", "attack-melee", "defensive-reaction"]);
  const requiresRoll = deliveryPipeline.some((step) => rollSteps.has(step));
  if (!requiresRoll) return null;

  const content = `
    <form class="order-skill-use">
      <div class="form-group">
        <label>\u0420\u0443\u0447\u043d\u043e\u0439 \u043c\u043e\u0434\u0438\u0444\u0438\u043a\u0430\u0442\u043e\u0440:</label>
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
      const { roll, rollFormulaValue } = await rollSkillCheck({ actor, skillItem, mode, manualMod, rollFormulaRaw, externalRollMod });

      if (deliveryPipeline.some((step) => attackOrDefSteps.has(step))) {
        await markUsedOnce();
      }

      let startedAny = false;
      let defensiveResult = null;

      for (const step of deliveryPipeline) {
        if (step === "attack-ranged" || step === "attack-melee") {
          startedAny = true;
          await startSkillAttackWorkflow({
            attackerActor: actor,
            attackerToken: casterToken,
            skillItem,
            attackRoll: roll,
            rollMode: mode,
            manualMod,
            characteristic: null,
            rollFormulaRaw,
            rollFormulaValue,
            pipelineMode: true,
            pipelineDelivery: step
          });
          continue;
        }

        if (step === "save-check") {
          const ok = await startSkillSaveWorkflow({
            casterActor: actor,
            casterToken,
            skillItem,
            pipelineMode: true
          });

          if (ok) {
            startedAny = true;
            await markUsedOnce();
          }
          continue;
        }

        if (step === "aoe-template") {
          const ok = await startSkillAoEWorkflow({
            casterActor: actor,
            casterToken,
            skillItem,
            impactRoll: roll,
            rollMode: mode,
            manualMod,
            rollFormulaRaw,
            rollFormulaValue,
            externalRollMod,
            pipelineMode: true
          });

          if (ok) {
            startedAny = true;
            await markUsedOnce();
          }
          continue;
        }

        if (step === "mass-save-check") {
          const ok = await startSkillMassSaveWorkflow({
            casterActor: actor,
            casterToken,
            skillItem,
            pipelineMode: true
          });

          if (ok) {
            startedAny = true;
            await markUsedOnce();
          }
          continue;
        }

        if (step === "defensive-reaction") {
          startedAny = true;
          defensiveResult = {
            roll,
            total: Number(roll.total ?? 0) || 0,
            delivery: step,
            characteristic: null,
            rollMode: mode,
            manualMod,
            rollFormulaRaw,
            rollFormulaValue,
            pipeline: deliveryPipeline
          };
        }
      }

      if (!startedAny) {
        resolve(null);
        return;
      }

      if (defensiveResult) {
        resolve(defensiveResult);
        return;
      }

      resolve({
        roll,
        total: Number(roll.total ?? 0) || 0,
        delivery: primaryDelivery,
        characteristic: null,
        rollMode: mode,
        manualMod,
        rollFormulaRaw,
        rollFormulaValue,
        pipeline: deliveryPipeline
      });
    };

    new Dialog({
      title: `\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u043d\u0430\u0432\u044b\u043a: ${skillItem.name}`,
      content,
      buttons: {
        normal: { label: "\u041e\u0431\u044b\u0447\u043d\u044b\u0439", callback: (html) => doRoll(html, "normal") },
        adv: { label: "\u041f\u0440\u0435\u0438\u043c\u0443\u0449\u0435\u0441\u0442\u0432\u043e", callback: (html) => doRoll(html, "adv") },
        dis: { label: "\u041f\u043e\u043c\u0435\u0445\u0430", callback: (html) => doRoll(html, "dis") }
      },
      default: "normal",
      close: () => {
        if (!started) resolve(null);
      }
    }).render(true);
  });
}
