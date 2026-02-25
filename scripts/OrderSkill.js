import { startSkillAttackWorkflow } from "./OrderSkillCombat.js";
import { startSkillSaveWorkflow } from "./OrderSkillSave.js";
import { startSkillAoEWorkflow } from "./OrderSkillAOE.js";
import { startSkillMassSaveWorkflow } from "./OrderSkillMassSave.js";
import { markSkillUsed } from "./OrderSkillCooldown.js";
import { evaluateRollFormula, evaluateDamageFormula } from "./OrderDamageFormula.js";
import { buildSkillDeliveryPipeline } from "./OrderDeliveryPipeline.js";
import { buildConfiguredEffectsListHtml } from "./OrderSpellEffects.js";

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

function getImpactFormulasFromSkill(skillItem) {
  const s = getSystem(skillItem);

  let rawArr = [];
  const raw = s?.DamageFormulas;

  if (Array.isArray(raw)) {
    rawArr = raw;
  } else if (typeof raw === "string") {
    rawArr = [raw];
  } else if (raw && typeof raw === "object") {
    const keys = Object.keys(raw)
      .filter(k => String(Number(k)) === k)
      .map(k => Number(k))
      .sort((a, b) => a - b);
    rawArr = keys.map(k => raw[k]);
  }

  const out = rawArr.map(v => String(v ?? ""));
  const legacy = String(s?.DamageFormula ?? "").trim();
  if (legacy && !out.some(v => String(v).trim() === legacy)) {
    out.unshift(legacy);
  }

  return out;
}

async function chooseSkillImpactFormula({ actor, skillItem }) {
  const rawList = getImpactFormulasFromSkill(skillItem)
    .map(v => String(v ?? "").trim())
    .filter(Boolean);

  const seen = new Set();
  const list = [];
  for (const f of rawList) {
    if (seen.has(f)) continue;
    seen.add(f);
    list.push(f);
  }

  if (!list.length) return { impactFormulaRaw: "", impactValue: null };
  if (list.length === 1) {
    return { impactFormulaRaw: list[0], impactValue: evaluateDamageFormula(list[0], actor, skillItem) };
  }

  const options = list.map((f, i) => `<option value="${i}">${f}</option>`).join("");
  const content = `
    <form class="order-skill-impact-formula">
      <div class="form-group">
        <label>Формула воздействия:</label>
        <select id="skillImpactFormula">${options}</select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let resolved = false;
    const done = (payload) => {
      if (resolved) return;
      resolved = true;
      resolve(payload || { impactFormulaRaw: "", impactValue: null });
    };

    new Dialog({
      title: `Формула воздействия: ${skillItem?.name ?? ""}`,
      content,
      buttons: {
        ok: {
          label: "OK",
          callback: (html) => {
            const idx = Number(html.find("#skillImpactFormula").val() ?? 0);
            const safeIdx = Number.isFinite(idx) && idx >= 0 && idx < list.length ? idx : 0;
            const impactFormulaRaw = list[safeIdx] || "";
            done({
              impactFormulaRaw,
              impactValue: impactFormulaRaw ? evaluateDamageFormula(impactFormulaRaw, actor, skillItem) : null
            });
          }
        }
      },
      default: "ok",
      close: () => done({ impactFormulaRaw: list[0] || "", impactValue: (list[0] ? evaluateDamageFormula(list[0], actor, skillItem) : null) })
    }).render(true);
  });
}

function buildSkillItemWithSelectedImpact({ actor, skillItem, impactFormulaRaw = "", impactValue = null } = {}) {
  const formula = String(impactFormulaRaw ?? "").trim();
  if (!formula) return skillItem;

  const baseSys = getSystem(skillItem);
  const overriddenSystem = foundry.utils.mergeObject(foundry.utils.duplicate(baseSys), {
    DamageFormula: formula,
    Damage: Math.max(0, Number(impactValue ?? evaluateDamageFormula(formula, actor, skillItem)) || 0)
  }, { inplace: false });

  return new Proxy(skillItem, {
    get(target, prop, receiver) {
      if (prop === "system") return overriddenSystem;
      if (prop === "data" && target?.data) {
        const dataObj = target.data;
        return new Proxy(dataObj, {
          get(dTarget, dProp) {
            if (dProp === "system") return overriddenSystem;
            return Reflect.get(dTarget, dProp);
          }
        });
      }
      return Reflect.get(target, prop, receiver);
    }
  });
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

const SKILL_PIPELINE_FLAG = "pipelineContinuation";
const SKILL_PIPELINE_KIND = "skill";
const SKILL_PIPELINE_BUTTON_CLASS = "order-skill-pipeline-next";
const SKILL_PIPELINE_BUTTON_WRAP = "order-skill-pipeline-next-wrap";

const SKILL_DELIVERY_LABELS = {
  "attack-ranged": "Взаимодействие навыком (дальнее)",
  "attack-melee": "Взаимодействие навыком (ближнее)",
  "save-check": "Проверка цели",
  "aoe-template": "Область (шаблон)",
  "mass-save-check": "Массовая проверка",
  "defensive-reaction": "Защитное (реакция)"
};

function getSkillDeliveryStepLabel(step) {
  const key = String(step || "").trim().toLowerCase();
  return SKILL_DELIVERY_LABELS[key] || key || "доп. тип";
}

function buildSkillContinuationBase({
  actor,
  skillItem,
  rollMode = "normal",
  manualMod = 0,
  rollFormulaRaw = "",
  rollFormulaValue = 0,
  externalRollMod = 0,
  impactFormulaRaw = "",
  impactFormulaValue = null,
  rollSnapshot = null
} = {}) {
  return {
    kind: SKILL_PIPELINE_KIND,
    actorId: actor?.id ?? null,
    itemId: skillItem?.id ?? null,
    rollMode: String(rollMode || "normal"),
    manualMod: Number(manualMod ?? 0) || 0,
    rollFormulaRaw: String(rollFormulaRaw || ""),
    rollFormulaValue: Number(rollFormulaValue ?? 0) || 0,
    externalRollMod: Number(externalRollMod ?? 0) || 0,
    impactFormulaRaw: String(impactFormulaRaw || ""),
    impactFormulaValue: impactFormulaValue == null ? null : (Number(impactFormulaValue ?? 0) || 0),
    rollSnapshot: rollSnapshot && typeof rollSnapshot === "object"
      ? {
        total: Number(rollSnapshot.total ?? 0) || 0,
        nat20: !!rollSnapshot.nat20,
        html: String(rollSnapshot.html ?? "")
      }
      : null,
    nextSteps: [],
    pending: false,
    completed: false
  };
}

function buildSkillContinuationForMessage(base, nextSteps) {
  const steps = Array.isArray(nextSteps)
    ? nextSteps.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!steps.length) return null;
  return {
    ...foundry.utils.duplicate(base),
    nextSteps: steps,
    pending: false,
    completed: false
  };
}

async function buildSkillRollSnapshot(roll) {
  if (!roll) return null;
  return {
    total: Number(roll.total ?? 0) || 0,
    nat20: isNaturalTwenty(roll),
    html: await roll.render()
  };
}

async function runSingleSkillPipelineStep({
  step,
  actor,
  casterToken,
  skillItem,
  roll = null,
  rollSnapshot = null,
  rollMode = "normal",
  manualMod = 0,
  rollFormulaRaw = "",
  rollFormulaValue = 0,
  externalRollMod = 0,
  impactFormulaRaw = "",
  impactFormulaValue = null,
  pipeline = [],
  pipelineContinuation = null
} = {}) {
  const normalizedStep = String(step || "").trim().toLowerCase();
  if (!normalizedStep) return { started: false, defensiveResult: null };

  const effectiveSkillItem = buildSkillItemWithSelectedImpact({
    actor,
    skillItem,
    impactFormulaRaw,
    impactValue: impactFormulaValue
  });

  if (normalizedStep === "attack-ranged" || normalizedStep === "attack-melee") {
    const ok = await startSkillAttackWorkflow({
      attackerActor: actor,
      attackerToken: casterToken,
      skillItem: effectiveSkillItem,
      attackRoll: roll,
      rollSnapshot,
      rollMode,
      manualMod,
      characteristic: null,
      rollFormulaRaw,
      rollFormulaValue,
      pipelineMode: true,
      pipelineDelivery: normalizedStep,
      pipelineContinuation
    });
    return { started: !!ok, defensiveResult: null };
  }

  if (normalizedStep === "save-check") {
    const ok = await startSkillSaveWorkflow({
      casterActor: actor,
      casterToken,
      skillItem: effectiveSkillItem,
      pipelineMode: true,
      pipelineContinuation
    });
    return { started: !!ok, defensiveResult: null };
  }

  if (normalizedStep === "aoe-template") {
    const ok = await startSkillAoEWorkflow({
      casterActor: actor,
      casterToken,
      skillItem: effectiveSkillItem,
      impactRoll: roll,
      rollSnapshot,
      rollMode,
      manualMod,
      rollFormulaRaw,
      rollFormulaValue,
      externalRollMod,
      pipelineMode: true,
      pipelineContinuation
    });
    return { started: !!ok, defensiveResult: null };
  }

  if (normalizedStep === "mass-save-check") {
    const ok = await startSkillMassSaveWorkflow({
      casterActor: actor,
      casterToken,
      skillItem: effectiveSkillItem,
      pipelineMode: true,
      pipelineContinuation
    });
    return { started: !!ok, defensiveResult: null };
  }

  if (normalizedStep === "defensive-reaction") {
    return {
      started: true,
      defensiveResult: {
        roll,
        total: Number(roll?.total ?? rollSnapshot?.total ?? 0) || 0,
        delivery: normalizedStep,
        characteristic: null,
        rollMode,
        manualMod,
        rollFormulaRaw,
        rollFormulaValue,
        pipeline,
        pipelineContinuation: pipelineContinuation
          ? foundry.utils.duplicate(pipelineContinuation)
          : null
      }
    };
  }

  return { started: false, defensiveResult: null };
}

async function runSkillPipelineContinuationFromMessage(message) {
  const continuation = message?.getFlag?.("Order", SKILL_PIPELINE_FLAG);
  if (!continuation || continuation.kind !== SKILL_PIPELINE_KIND) return false;

  const nextSteps = Array.isArray(continuation.nextSteps)
    ? continuation.nextSteps.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!nextSteps.length) return false;

  const actor = game.actors.get(String(continuation.actorId || ""));
  const skillItem = actor?.items?.get(String(continuation.itemId || ""));
  if (!actor || !skillItem) {
    ui.notifications?.warn?.("Не удалось найти навык для продолжения цепочки применения.");
    return false;
  }

  const casterToken = actor.getActiveTokens?.()[0] ?? null;
  let remaining = Array.from(nextSteps);
  const rollSnapshot = continuation.rollSnapshot && typeof continuation.rollSnapshot === "object"
    ? continuation.rollSnapshot
    : null;

  while (remaining.length) {
    const step = String(remaining[0] || "").trim().toLowerCase();
    if (!step) return false;

    const rest = remaining.slice(1);
    const continuationForMessage = rest.length
      ? buildSkillContinuationForMessage(continuation, rest)
      : null;

    const { started, defensiveResult } = await runSingleSkillPipelineStep({
      step,
      actor,
      casterToken,
      skillItem,
      roll: null,
      rollSnapshot,
      rollMode: String(continuation.rollMode || "normal"),
      manualMod: Number(continuation.manualMod ?? 0) || 0,
      rollFormulaRaw: String(continuation.rollFormulaRaw || ""),
      rollFormulaValue: Number(continuation.rollFormulaValue ?? 0) || 0,
      externalRollMod: Number(continuation.externalRollMod ?? 0) || 0,
      impactFormulaRaw: String(continuation.impactFormulaRaw || ""),
      impactFormulaValue: continuation.impactFormulaValue == null ? null : (Number(continuation.impactFormulaValue ?? 0) || 0),
      pipeline: [step, ...rest],
      pipelineContinuation: continuationForMessage
    });

    if (!started) return false;

    if (defensiveResult && rest.length) {
      remaining = rest;
      continue;
    }

    return true;
  }

  return false;
}

let skillPipelineUiRegistered = false;
function registerSkillPipelineUi() {
  if (skillPipelineUiRegistered) return;
  skillPipelineUiRegistered = true;

  Hooks.on("renderChatMessage", (message, html) => {
    const continuation = message?.getFlag?.("Order", SKILL_PIPELINE_FLAG);
    if (!continuation || continuation.kind !== SKILL_PIPELINE_KIND) return;

    const nextSteps = Array.isArray(continuation.nextSteps)
      ? continuation.nextSteps.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean)
      : [];

    html.find(`.${SKILL_PIPELINE_BUTTON_WRAP}`).remove();
    if (!nextSteps.length || continuation.completed) return;

    const nextLabel = getSkillDeliveryStepLabel(nextSteps[0]);
    const disabledAttr = continuation.pending ? "disabled" : "";
    const wrapHtml = `
      <div class="${SKILL_PIPELINE_BUTTON_WRAP}" style="margin-top:8px;">
        <button type="button" class="${SKILL_PIPELINE_BUTTON_CLASS}" ${disabledAttr}>
          Запустить второй тип: ${nextLabel}
        </button>
      </div>
    `;

    const host = html.find(".message-content").first();
    if (!host.length) return;
    host.append(wrapHtml);

    host.find(`.${SKILL_PIPELINE_BUTTON_CLASS}`)
      .off("click.order-skill-pipeline-next")
      .on("click.order-skill-pipeline-next", async (event) => {
        event.preventDefault();
        const btn = $(event.currentTarget);
        if (btn.prop("disabled")) return;
        btn.prop("disabled", true);

        const currentMessage = game.messages.get(message.id);
        if (!currentMessage) return;

        const currentContinuation = currentMessage.getFlag("Order", SKILL_PIPELINE_FLAG);
        if (!currentContinuation || currentContinuation.kind !== SKILL_PIPELINE_KIND) return;
        if (currentContinuation.pending || currentContinuation.completed) return;

        const actor = game.actors.get(String(currentContinuation.actorId || ""));
        if (!actor) {
          ui.notifications?.warn?.("Не найден владелец навыка для продолжения цепочки.");
          return;
        }
        if (!(game.user?.isGM || actor.isOwner)) {
          ui.notifications?.warn?.("Запустить второй тип применения может только владелец навыка или GM.");
          return;
        }

        await currentMessage.setFlag("Order", SKILL_PIPELINE_FLAG, {
          ...currentContinuation,
          pending: true,
          completed: false
        });

        const ok = await runSkillPipelineContinuationFromMessage(currentMessage);
        const latest = currentMessage.getFlag("Order", SKILL_PIPELINE_FLAG) || currentContinuation;
        await currentMessage.setFlag("Order", SKILL_PIPELINE_FLAG, {
          ...latest,
          pending: false,
          completed: !!ok
        });
      });
  });
}

registerSkillPipelineUi();

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
    const effectsPreviewHtml = buildConfiguredEffectsListHtml(skillItem, { title: "Эффекты навыка" });

    const content = `
    <div class="chat-item-message">
      <div class="item-header">
        <img src="${skillItem.img}" alt="${skillItem.name}" width="50" height="50">
        <h3>${skillItem.name}</h3>
      </div>
      <div class="item-details">
        <p><strong>\u0422\u0438\u043f:</strong> utility</p>
        <p><strong>\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435:</strong> ${s.Description || "\u041d\u0435\u0442 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u044f"}</p>
        ${effectsPreviewHtml}
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

  const firstStep = String(deliveryPipeline[0] || "").trim().toLowerCase();
  if (!firstStep) return null;
  const extraSteps = deliveryPipeline.slice(1);

  const rollSteps = new Set(["attack-ranged", "attack-melee", "aoe-template", "defensive-reaction"]);
  const requiresRoll = deliveryPipeline.some((step) => rollSteps.has(step));

  if (!requiresRoll) {
    const { impactFormulaRaw, impactValue } = await chooseSkillImpactFormula({ actor, skillItem });
    const continuationBase = buildSkillContinuationBase({
      actor,
      skillItem,
      rollMode: "normal",
      manualMod: 0,
      rollFormulaRaw: "",
      rollFormulaValue: 0,
      externalRollMod,
      impactFormulaRaw,
      impactFormulaValue: impactValue,
      rollSnapshot: null
    });
    const continuationForFirst = buildSkillContinuationForMessage(continuationBase, extraSteps);

    const { started, defensiveResult } = await runSingleSkillPipelineStep({
      step: firstStep,
      actor,
      casterToken,
      skillItem,
      roll: null,
      rollSnapshot: null,
      rollMode: "normal",
      manualMod: 0,
      rollFormulaRaw: "",
      rollFormulaValue: 0,
      externalRollMod,
      impactFormulaRaw,
      impactFormulaValue: impactValue,
      pipeline: deliveryPipeline,
      pipelineContinuation: continuationForFirst
    });

    if (!started) return null;
    await markUsedOnce();
    if (defensiveResult) return defensiveResult;

    return {
      roll: null,
      total: 0,
      delivery: firstStep,
      characteristic: null,
      rollMode: "normal",
      manualMod: 0,
      rollFormulaRaw: "",
      rollFormulaValue: 0,
      pipeline: deliveryPipeline
    };
  }

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
      const { impactFormulaRaw, impactValue } = await chooseSkillImpactFormula({ actor, skillItem });
      const { roll, rollFormulaValue } = await rollSkillCheck({
        actor,
        skillItem,
        mode,
        manualMod,
        rollFormulaRaw,
        externalRollMod
      });
      const rollSnapshot = await buildSkillRollSnapshot(roll);

      const continuationBase = buildSkillContinuationBase({
        actor,
        skillItem,
        rollMode: mode,
        manualMod,
        rollFormulaRaw,
        rollFormulaValue,
        externalRollMod,
        impactFormulaRaw,
        impactFormulaValue: impactValue,
        rollSnapshot
      });
      const continuationForFirst = buildSkillContinuationForMessage(continuationBase, extraSteps);

      const { started: startedFirst, defensiveResult } = await runSingleSkillPipelineStep({
        step: firstStep,
        actor,
        casterToken,
        skillItem,
        roll,
        rollSnapshot,
        rollMode: mode,
        manualMod,
        rollFormulaRaw,
        rollFormulaValue,
        externalRollMod,
        impactFormulaRaw,
        impactFormulaValue: impactValue,
        pipeline: deliveryPipeline,
        pipelineContinuation: continuationForFirst
      });

      if (!startedFirst) {
        resolve(null);
        return;
      }

      await markUsedOnce();

      if (defensiveResult) {
        resolve(defensiveResult);
        return;
      }

      resolve({
        roll,
        total: Number(roll.total ?? 0) || 0,
        delivery: firstStep,
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
