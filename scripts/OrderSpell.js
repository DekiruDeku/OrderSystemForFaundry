import { startSpellAttackWorkflow } from "./OrderSpellCombat.js";
import { startSpellSaveWorkflow } from "./OrderSpellSave.js";
import { startSpellAoEWorkflow } from "./OrderSpellAOE.js";
import { startSpellMassSaveWorkflow } from "./OrderSpellMassSave.js";
import { startSpellSummonWorkflow } from "./OrderSpellSummon.js";
import { startSpellCreateObjectWorkflow } from "./OrderSpellObject.js";
import { buildCombatRollFlavor, formatSigned } from "./OrderRollFlavor.js";
import { evaluateRollFormula, evaluateDamageFormula } from "./OrderDamageFormula.js";
import { buildSpellDeliveryPipeline } from "./OrderDeliveryPipeline.js";
import { applySpellEffects } from "./OrderSpellEffects.js";


/**
 * OrderSpell.js
 * Spell casting workflow (MVP): dialog -> roll -> apply ManaFatigue -> log to chat
 */

function getSystem(obj) {
    return obj?.system ?? obj?.data?.system ?? {};
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeSpellEffects(rawEffects) {
    if (typeof rawEffects === "string") {
        const text = rawEffects.trim();
        return text ? [{ type: "text", text }] : [];
    }
    return Array.isArray(rawEffects) ? rawEffects : [];
}

function normalizeDebuffDisplay(rawKey, rawStage) {
    let key = String(rawKey ?? "").trim();
    let stage = Number(rawStage ?? 1);
    if (!Number.isFinite(stage) || stage <= 0) stage = 1;

    const m = key.match(/^(.+?)[\s:]+(\d+)$/);
    if (m) {
        const keyPart = String(m[1] ?? "").trim();
        const stageFromKey = Number(m[2] ?? 1);
        if (keyPart) key = keyPart;

        const explicitStage = Number(rawStage);
        const stageWasExplicit = Number.isFinite(explicitStage) && explicitStage !== 1;
        if (!stageWasExplicit && Number.isFinite(stageFromKey) && stageFromKey > 0) {
            stage = stageFromKey;
        }
    }

    return { key, stage: Math.max(1, Math.floor(stage)) };
}

function buildSpellEffectsListHtml(spellItem) {
    const s = getSystem(spellItem);
    const effects = normalizeSpellEffects(s?.Effects);
    const rows = [];

    for (const ef of effects) {
        const type = String(ef?.type || "text");
        if (type === "text") {
            const text = String(ef?.text ?? "").trim();
            if (text) rows.push(escapeHtml(text));
            continue;
        }
        if (type === "debuff") {
            const norm = normalizeDebuffDisplay(ef?.debuffKey, ef?.stage);
            if (!norm.key) continue;
            const stageText = norm.stage > 1 ? ` (+${norm.stage} стад.)` : "";
            rows.push(`Дебафф: ${escapeHtml(norm.key)}${stageText}`);
        }
        if (type === "buff") {
            const kind = String(ef?.buffKind ?? "").trim().toLowerCase();
            if (kind === "melee-damage-hits") {
                const bonus = Number(ef?.value ?? 0) || 0;
                const hits = Math.max(1, Math.floor(Number(ef?.hits ?? 1) || 1));
                rows.push(`Бафф: урон ближнего оружия ${bonus > 0 ? `+${bonus}` : bonus} на ${hits} ударов`);
            }
        }
    }

    if (!rows.length) {
        return `<p><strong>Эффекты заклинания:</strong> нет</p>`;
    }

    return `
      <p><strong>Эффекты заклинания:</strong></p>
      <ul style="margin:0 0 0 18px; padding:0;">
        ${rows.map((row) => `<li>${row}</li>`).join("")}
      </ul>
    `;
}

function D(...args) {
    try {
        if (!game.settings.get("Order", "debugDefenseSpell")) return;
    } catch { }
    console.log("[Order][SpellCast]", ...args);
}

const SPELL_PIPELINE_FLAG = "pipelineContinuation";
const SPELL_PIPELINE_KIND = "spell";
const SPELL_PIPELINE_BUTTON_CLASS = "order-spell-pipeline-next";
const SPELL_PIPELINE_BUTTON_WRAP = "order-spell-pipeline-next-wrap";

const SPELL_DELIVERY_LABELS = {
    "attack-ranged": "Взаимодействие заклинанием (дальнее)",
    "attack-melee": "Взаимодействие заклинанием (ближнее)",
    "save-check": "Проверка цели",
    "aoe-template": "Область (шаблон)",
    "mass-save-check": "Массовая проверка",
    "summon": "Призыв",
    "create-object": "Создание объекта"
};

function getSpellDeliveryStepLabel(step) {
    const key = String(step || "").trim().toLowerCase();
    return SPELL_DELIVERY_LABELS[key] || key || "доп. тип";
}

function buildSpellContinuationBase({
    actor,
    spellItem,
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
        kind: SPELL_PIPELINE_KIND,
        actorId: actor?.id ?? null,
        itemId: spellItem?.id ?? null,
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

function buildSpellContinuationForMessage(base, nextSteps) {
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

async function buildSpellRollSnapshot(roll) {
    if (!roll) return null;
    return {
        total: Number(roll.total ?? 0) || 0,
        nat20: isNaturalTwenty(roll),
        html: await roll.render()
    };
}

async function runSingleSpellPipelineStep({
    step,
    actor,
    casterToken,
    spellItem,
    roll = null,
    rollSnapshot = null,
    rollMode = "normal",
    manualMod = 0,
    rollFormulaRaw = "",
    rollFormulaValue = 0,
    impactFormulaRaw = "",
    impactFormulaValue = null,
    pipelineContinuation = null
} = {}) {
    const normalizedStep = String(step || "").trim().toLowerCase();
    if (!normalizedStep || normalizedStep === "defensive-reaction") {
        return false;
    }

    const effectiveSpellItem = buildSpellItemWithSelectedImpact({
        actor,
        spellItem,
        impactFormulaRaw,
        impactValue: impactFormulaValue
    });

    if (normalizedStep === "attack-ranged" || normalizedStep === "attack-melee") {
        return !!(await startSpellAttackWorkflow({
            casterActor: actor,
            casterToken,
            spellItem: effectiveSpellItem,
            castRoll: roll,
            rollSnapshot,
            rollMode,
            manualMod,
            rollFormulaRaw,
            rollFormulaValue,
            pipelineMode: true,
            pipelineDelivery: normalizedStep,
            pipelineContinuation
        }));
    }

    if (normalizedStep === "save-check") {
        return !!(await startSpellSaveWorkflow({
            casterActor: actor,
            casterToken,
            spellItem: effectiveSpellItem,
            castRoll: roll,
            rollSnapshot,
            rollMode,
            manualMod,
            rollFormulaRaw,
            rollFormulaValue,
            pipelineMode: true,
            pipelineContinuation
        }));
    }

    if (normalizedStep === "aoe-template") {
        return !!(await startSpellAoEWorkflow({
            casterActor: actor,
            casterToken,
            spellItem: effectiveSpellItem,
            castRoll: roll,
            rollSnapshot,
            rollMode,
            manualMod,
            rollFormulaRaw,
            rollFormulaValue,
            pipelineMode: true,
            pipelineContinuation
        }));
    }

    if (normalizedStep === "mass-save-check") {
        return !!(await startSpellMassSaveWorkflow({
            casterActor: actor,
            casterToken,
            spellItem: effectiveSpellItem,
            castRoll: roll,
            rollSnapshot,
            rollMode,
            manualMod,
            rollFormulaRaw,
            rollFormulaValue,
            pipelineMode: true,
            pipelineContinuation
        }));
    }

    if (normalizedStep === "summon") {
        await startSpellSummonWorkflow({
            casterActor: actor,
            casterToken,
            spellItem: effectiveSpellItem,
            castRoll: roll,
            pipelineMode: true
        });
        return true;
    }

    if (normalizedStep === "create-object") {
        await startSpellCreateObjectWorkflow({
            casterActor: actor,
            casterToken,
            spellItem: effectiveSpellItem,
            castRoll: roll,
            pipelineMode: true
        });
        return true;
    }

    return false;
}

async function runSpellPipelineContinuationFromMessage(message) {
    const continuation = message?.getFlag?.("Order", SPELL_PIPELINE_FLAG);
    if (!continuation || continuation.kind !== SPELL_PIPELINE_KIND) return false;

    const nextSteps = Array.isArray(continuation.nextSteps)
        ? continuation.nextSteps.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean)
        : [];
    if (!nextSteps.length) return false;

    const actor = game.actors.get(String(continuation.actorId || ""));
    const spellItem = actor?.items?.get(String(continuation.itemId || ""));
    if (!actor || !spellItem) {
        ui.notifications?.warn?.("Не удалось найти заклинание для продолжения цепочки применения.");
        return false;
    }

    const casterToken = actor.getActiveTokens?.()[0] ?? null;
    const step = nextSteps[0];
    const rest = nextSteps.slice(1);
    const continuationForMessage = rest.length
        ? buildSpellContinuationForMessage(continuation, rest)
        : null;

    return await runSingleSpellPipelineStep({
        step,
        actor,
        casterToken,
        spellItem,
        roll: null,
        rollSnapshot: continuation.rollSnapshot ?? null,
        rollMode: String(continuation.rollMode || "normal"),
        manualMod: Number(continuation.manualMod ?? 0) || 0,
        rollFormulaRaw: String(continuation.rollFormulaRaw || ""),
        rollFormulaValue: Number(continuation.rollFormulaValue ?? 0) || 0,
        impactFormulaRaw: String(continuation.impactFormulaRaw || ""),
        impactFormulaValue: continuation.impactFormulaValue == null ? null : (Number(continuation.impactFormulaValue ?? 0) || 0),
        pipelineContinuation: continuationForMessage
    });
}

let spellPipelineUiRegistered = false;
function registerSpellPipelineUi() {
    if (spellPipelineUiRegistered) return;
    spellPipelineUiRegistered = true;

    Hooks.on("renderChatMessage", (message, html) => {
        const continuation = message?.getFlag?.("Order", SPELL_PIPELINE_FLAG);
        if (!continuation || continuation.kind !== SPELL_PIPELINE_KIND) return;

        const nextSteps = Array.isArray(continuation.nextSteps)
            ? continuation.nextSteps.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean)
            : [];

        html.find(`.${SPELL_PIPELINE_BUTTON_WRAP}`).remove();
        if (!nextSteps.length || continuation.completed) return;

        const nextLabel = getSpellDeliveryStepLabel(nextSteps[0]);
        const disabledAttr = continuation.pending ? "disabled" : "";
        const wrapHtml = `
          <div class="${SPELL_PIPELINE_BUTTON_WRAP}" style="margin-top:8px;">
            <button type="button" class="${SPELL_PIPELINE_BUTTON_CLASS}" ${disabledAttr}>
              Запустить второй тип: ${nextLabel}
            </button>
          </div>
        `;

        const host = html.find(".message-content").first();
        if (!host.length) return;
        host.append(wrapHtml);

        host.find(`.${SPELL_PIPELINE_BUTTON_CLASS}`)
            .off("click.order-spell-pipeline-next")
            .on("click.order-spell-pipeline-next", async (event) => {
                event.preventDefault();
                const btn = $(event.currentTarget);
                if (btn.prop("disabled")) return;
                btn.prop("disabled", true);

                const currentMessage = game.messages.get(message.id);
                if (!currentMessage) return;

                const currentContinuation = currentMessage.getFlag("Order", SPELL_PIPELINE_FLAG);
                if (!currentContinuation || currentContinuation.kind !== SPELL_PIPELINE_KIND) return;
                if (currentContinuation.pending || currentContinuation.completed) return;

                const actor = game.actors.get(String(currentContinuation.actorId || ""));
                if (!actor) {
                    ui.notifications?.warn?.("Не найден владелец заклинания для продолжения цепочки.");
                    return;
                }
                if (!(game.user?.isGM || actor.isOwner)) {
                    ui.notifications?.warn?.("Запустить второй тип применения может только владелец заклинания или GM.");
                    return;
                }

                await currentMessage.setFlag("Order", SPELL_PIPELINE_FLAG, {
                    ...currentContinuation,
                    pending: true,
                    completed: false
                });

                const ok = await runSpellPipelineContinuationFromMessage(currentMessage);
                const latest = currentMessage.getFlag("Order", SPELL_PIPELINE_FLAG) || currentContinuation;
                await currentMessage.setFlag("Order", SPELL_PIPELINE_FLAG, {
                    ...latest,
                    pending: false,
                    completed: !!ok
                });
            });
    });
}

registerSpellPipelineUi();


function getManaFatigue(actor) {
    const sys = getSystem(actor);
    // В системе Order ManaFatigue находится в корне system (см. Player-sheet.hbs / OrderActor.js)
    return sys?.ManaFatigue ?? null;
}

export async function castSpellInteractive({ actor, spellItem, silent = false, externalRollMod = 0 } = {}) {
    if (!actor || !spellItem) return null;
    D("castSpellInteractive START", {
        user: game.user?.name,
        actor: actor?.name,
        spell: spellItem?.name,
        usageCost: Number(getSystem(spellItem)?.UsageCost ?? 0) || 0,
        delivery: String(getSystem(spellItem)?.DeliveryType || "")
    });


    const s = getSystem(spellItem);
    const usageCost = Number(s.UsageCost ?? 0) || 0;

    const ok = await confirmOverFatigue({ actor, usageCost, spellName: spellItem.name });
    D("confirmOverFatigue result", ok);
    if (!ok) {
        D("castSpellInteractive RETURN null (over-fatigue cancelled)");
        return null;
    }

    if (!ok) return null;

    const content = `
    <form class="order-spell-cast">
      <div class="form-group">
        <label>Ручной модификатор к броску:</label>
        <input type="number" id="spellManualMod" value="0" />
      </div>
      <div style="font-size:12px; opacity:0.85; margin-top:6px;">
        Стоимость применения (МУ): <strong>${usageCost}</strong>
      </div>
    </form>
  `;

    return await new Promise((resolve) => {
        let resolved = false;
        let started = false;
        const done = (v) => {
            D("Dialog done()", v ? { total: v.total, castFailed: v.castFailed, delivery: v.delivery } : null);

            if (resolved) return;
            resolved = true;
            resolve(v);
        };

        const doCast = async (html, mode) => {
            started = true;
            const manualMod = Number(html.find("#spellManualMod").val() ?? 0) || 0;

            const selectedFormula = await chooseSpellRollFormula({ spellItem });
            const { impactFormulaRaw, impactValue } = await chooseSpellImpactFormula({ actor, spellItem });
            const rollMeta = buildSpellCastRoll({ actor, spellItem, mode, manualMod, rollFormulaRaw: selectedFormula, externalRollMod });
            D("doCast", { mode, manualMod, formula: rollMeta.formula, rollFormulaRaw: rollMeta.rollFormulaRaw, rollFormulaValue: rollMeta.rollFormulaValue });

            const roll = await new Roll(rollMeta.formula).roll({ async: true });
            const rollHTML = await roll.render();

            const nat20 = isNaturalTwenty(roll);

            // МУ всегда списываем
            await applyManaFatigueCost({ actor, usageCost });

            // порог
            const threshold = Number(s.UsageThreshold);
            const hasThreshold = !Number.isNaN(threshold) && threshold !== 0;

            let outcomeText = "";
            if (hasThreshold) outcomeText = roll.total >= threshold ? "Успех" : "Провал";

            const delivery = String(s.DeliveryType || "utility");
            const deliveryLower = delivery.trim().toLowerCase();
            const thresholdCheckFailed = hasThreshold ? (roll.total < threshold) : false;
            const castFailed = deliveryLower === "utility" ? false : thresholdCheckFailed;
            const deliveryPipeline = buildSpellDeliveryPipeline(s);
            const startsWorkflow = deliveryPipeline.some((step) => [
                "attack-ranged",
                "attack-melee",
                "save-check",
                "aoe-template",
                "mass-save-check",
                "summon",
                "create-object"
            ].includes(step));

            // как и было: запускаем workflow только если не провал
            let workflowStarted = false;
            if (!castFailed && deliveryPipeline.length) {
                const casterToken = actor.getActiveTokens?.()[0] ?? null;
                const firstStep = String(deliveryPipeline[0] || "").trim().toLowerCase();
                const extraSteps = deliveryPipeline.slice(1);
                const rollSnapshot = await buildSpellRollSnapshot(roll);
                const continuationBase = buildSpellContinuationBase({
                    actor,
                    spellItem,
                    rollMode: mode,
                    manualMod,
                    rollFormulaRaw: rollMeta.rollFormulaRaw,
                    rollFormulaValue: rollMeta.rollFormulaValue,
                    externalRollMod: Number(rollMeta.externalRollMod ?? 0) || 0,
                    impactFormulaRaw,
                    impactFormulaValue: impactValue,
                    rollSnapshot
                });
                const continuationForFirst = buildSpellContinuationForMessage(continuationBase, extraSteps);

                workflowStarted = await runSingleSpellPipelineStep({
                    step: firstStep,
                    actor,
                    casterToken,
                    spellItem,
                    roll,
                    rollSnapshot,
                    rollMode: mode,
                    manualMod,
                    rollFormulaRaw: rollMeta.rollFormulaRaw,
                    rollFormulaValue: rollMeta.rollFormulaValue,
                    impactFormulaRaw,
                    impactFormulaValue: impactValue,
                    pipelineContinuation: continuationForFirst
                });
            }

            // Variant 2: Utility buffs are applied to the caster via ActiveEffect (melee weapon only).
            // We do it here (after successful cast and after pipeline steps) and silently (no extra chat spam).
            try {
                const effectsList = normalizeSpellEffects(s?.Effects);
                const hasBuff = effectsList.some(e => String(e?.type || "").trim().toLowerCase() === "buff");
                if (!castFailed && deliveryLower === "utility" && hasBuff) {
                    await applySpellEffects({
                        casterActor: actor,
                        targetActor: actor,
                        spellItem,
                        attackTotal: Number(roll.total ?? 0) || 0,
                        silent: true
                    });
                }
            } catch (err) {
                console.error("OrderSpell | Failed to apply utility buff effects", err);
            }

            // правило как было: если startsWorkflow && успех — отдельное сообщение каста не делаем
            const shouldCreateCastMessage = !(startsWorkflow && !castFailed && workflowStarted);
            const shouldShowEffectsInCastMessage = ["utility", "attack-ranged", "attack-melee"].includes(deliveryLower);

            const mf = getManaFatigue(actor);
            const mfValue = Number(mf?.value ?? 0) || 0;
            const mfMax = Number(mf?.max ?? 0) || 0;

            const rollFormulaExtra = rollMeta.rollFormulaRaw
                ? [`формула: ${rollMeta.rollFormulaRaw} = ${formatSigned(rollMeta.rollFormulaValue)}`]
                : [];

            const castFlavor = buildCombatRollFlavor({
                scene: "Магия",
                action: "Каст",
                source: `Заклинание: ${spellItem.name}`,
                rollMode: mode,
                characteristic: rollMeta.rollFormulaRaw ? "формула" : "Magic",
                applyModifiers: true,
                manualMod,
                effectsMod: Number(rollMeta.externalRollMod ?? 0) || 0,
                extra: [
                    ...rollFormulaExtra,
                    ...((!Number.isNaN(threshold) && threshold) ? [`порог: ${threshold}`] : [])
                ],
                isCrit: nat20
            });

            const utilityUsageThresholdLine = (deliveryLower === "utility" && hasThreshold)
                ? `<p><strong>Порог условия применения:</strong> ${threshold}. Итог каста: ${roll.total}. ${thresholdCheckFailed ? "<strong>Провал</strong>." : "<strong>Успех</strong>."}</p>`
                : "";

            const messageContent = `
        <div class="chat-item-message">
          <div class="item-header">
            <img src="${spellItem.img}" alt="${spellItem.name}" width="50" height="50">
            <h3>${spellItem.name}</h3>
          </div>
          <div class="item-details">
            <p><strong>Описание:</strong> ${s.Description || "Нет описания"}</p>
            <p><strong>Урон:</strong> ${s.Damage ?? "-"}</p>
            <p><strong>Дистанция:</strong> ${s.Range ?? "-"}</p>
            <p><strong>Стоимость (МУ):</strong> ${usageCost}</p>
            <p><strong>Магическая усталость:</strong> ${mfValue}${mfMax ? ` / ${mfMax}` : ""}</p>
            <p class="order-roll-flavor">${castFlavor}</p>
            <p><strong>Результат броска:</strong> ${roll.total}${outcomeText ? ` (${outcomeText})` : ""}${nat20 ? " <span style=\"color:#c00; font-weight:700;\">[КРИТ]</span>" : ""}</p>
            ${utilityUsageThresholdLine}
            <div class="inline-roll">${rollHTML}</div>
            ${shouldShowEffectsInCastMessage ? buildSpellEffectsListHtml(spellItem) : ""}
          </div>
        </div>
      `;

            if (shouldCreateCastMessage && !silent) {
                await ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    content: messageContent,
                    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
                    flags: {
                        Order: {
                            spellCast: {
                                actorId: actor.id,
                                spellId: spellItem.id,
                                mode,
                                manualMod,
                                usageCost,
                                total: roll.total,
                                nat20,
                                rollFormulaRaw: rollMeta.rollFormulaRaw,
                                rollFormulaValue: rollMeta.rollFormulaValue
                            }
                        }
                    }
                });
            }

            return {
                roll,
                total: Number(roll.total ?? 0) || 0,
                nat20,
                rollMode: mode,
                manualMod,
                usageCost,
                hasThreshold,
                threshold: hasThreshold ? threshold : 0,
                castFailed,
                delivery,
                rollFormulaRaw: rollMeta.rollFormulaRaw,
                rollFormulaValue: rollMeta.rollFormulaValue
            };
        };

        new Dialog({
            title: `Применить заклинание: ${spellItem.name}`,
            content,
            buttons: {
                normal: { label: "Обычный", callback: (html) => { started = true; doCast(html, "normal").then(done); } },
                adv: { label: "Преимущество", callback: (html) => { started = true; doCast(html, "adv").then(done); } },
                dis: { label: "Помеха", callback: (html) => { started = true; doCast(html, "dis").then(done); } },

            },
            default: "normal",
            close: () => {
                if (!started) return done(null);   // закрыли, не начав каст
                // если каст уже стартовал — игнорируем close, ждём doCast.then(done)
            }
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

async function confirmOverFatigue({ actor, usageCost, spellName }) {
    if (!usageCost) return true;

    const mf = getManaFatigue(actor);
    const cur = Number(mf?.value ?? 0) || 0;
    const max = Number(mf?.max ?? 0) || 0;

    if (max <= 0) return true;
    if (cur + usageCost <= max) return true;

    return await new Promise((resolve) => {
        const content = `
      <p>После применения <strong>${spellName}</strong> магическая усталость превысит максимум.</p>
      <p>Вы можете применить заклинание, но получите/усилите дебафф <strong>Магическая усталость</strong> (+1 стадия).</p>
      <p>Продолжить?</p>
    `;
        new Dialog({
            title: "Магическая усталость превышена",
            content,
            buttons: {
                yes: { label: "Применить со штрафом", callback: () => resolve(true) },
                no: { label: "Отмена", callback: () => resolve(false) }
            },
            default: "no",
            close: () => resolve(false)
        }).render(true);
    });
}

/**
 * Applies ManaFatigue.value += usageCost (clamped to max).
 * If it would exceed max, increase MagicFatigue debuff stage by 1 (up to 3).
 *
 * We call `increaseDebuffStage` via passed-in callbacks, because in your system
 * debuffs are implemented with your own helper logic (applyDebuff etc.).
 */
async function applyManaFatigueCost({ actor, usageCost }) {
    const cost = Number(usageCost ?? 0) || 0;
    if (!cost) return;

    const mf = getManaFatigue(actor);
    const cur = Number(mf?.value ?? 0) || 0;
    const max = Number(mf?.max ?? 0) || 0;

    // Если превышаем максимум — повышаем стадию дебаффа "MagicFatigue" (+1 до 3)
    if (max > 0 && cur + cost > max) {
        await increaseDebuffStage(actor, "MagicFatigue");
    }

    const newVal = max > 0 ? Math.min(cur + cost, max) : (cur + cost);
    await actor.update({ "system.ManaFatigue.value": newVal });
}


function buildSpellCastRoll({ actor, spellItem, mode, manualMod, rollFormulaRaw, externalRollMod = 0 }) {
    let d20 = "1d20";
    if (mode === "adv") d20 = "2d20kh1";
    else if (mode === "dis") d20 = "2d20kl1";

    const raw = sanitizeRollFormulaInput(rollFormulaRaw);
    const source = raw || "Magic";
    const value = evaluateRollFormula(source, actor, spellItem);
    const custom = Number(manualMod ?? 0) || 0;
    const external = Number(externalRollMod ?? 0) || 0;

    const parts = [d20];
    const add = (n) => {
        const v = Number(n) || 0;
        if (!v) return;
        parts.push(v > 0 ? `+ ${v}` : `- ${Math.abs(v)}`);
    };

    add(value);
    add(external);
    add(custom);

    return {
        formula: parts.join(" "),
        rollFormulaRaw: raw,
        rollFormulaValue: Number(value) || 0,
        externalRollMod: external
    };
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

function getRollFormulasFromSpell(spellItem) {
    const s = getSystem(spellItem);

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

    const out = rawArr.map(v => String(v ?? ""));

    const legacy = String(s?.RollFormula ?? "").trim();
    if (legacy && !out.some(v => String(v).trim() === legacy)) {
        out.unshift(legacy);
    }

    return out;
}

function getImpactFormulasFromSpell(spellItem) {
    const s = getSystem(spellItem);

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

async function chooseSpellImpactFormula({ actor, spellItem }) {
    const rawList = getImpactFormulasFromSpell(spellItem)
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
        return { impactFormulaRaw: list[0], impactValue: evaluateDamageFormula(list[0], actor, spellItem) };
    }

    const options = list.map((f, i) => `<option value="${i}">${f}</option>`).join("");
    const content = `
    <form class="order-spell-impact-formula">
      <div class="form-group">
        <label>Формула воздействия:</label>
        <select id="spellImpactFormula">${options}</select>
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
            title: `Формула воздействия: ${spellItem?.name ?? ""}`,
            content,
            buttons: {
                ok: {
                    label: "OK",
                    callback: (html) => {
                        const idx = Number(html.find("#spellImpactFormula").val() ?? 0);
                        const safeIdx = Number.isFinite(idx) && idx >= 0 && idx < list.length ? idx : 0;
                        const impactFormulaRaw = list[safeIdx] || "";
                        done({
                            impactFormulaRaw,
                            impactValue: impactFormulaRaw ? evaluateDamageFormula(impactFormulaRaw, actor, spellItem) : null
                        });
                    }
                }
            },
            default: "ok",
            close: () => done({ impactFormulaRaw: list[0] || "", impactValue: (list[0] ? evaluateDamageFormula(list[0], actor, spellItem) : null) })
        }).render(true);
    });
}

function buildSpellItemWithSelectedImpact({ actor, spellItem, impactFormulaRaw = "", impactValue = null } = {}) {
    const formula = String(impactFormulaRaw ?? "").trim();
    if (!formula) return spellItem;

    const baseSys = getSystem(spellItem);
    const overriddenSystem = foundry.utils.mergeObject(foundry.utils.duplicate(baseSys), {
        DamageFormula: formula,
        Damage: Math.max(0, Number(impactValue ?? evaluateDamageFormula(formula, actor, spellItem)) || 0)
    }, { inplace: false });

    return new Proxy(spellItem, {
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

async function chooseSpellRollFormula({ spellItem }) {
    const rawList = getRollFormulasFromSpell(spellItem)
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

    const defaultLabel = "По умолчанию (Magic)";
    const labelText = "Формула броска";
    const titleText = "Формула броска: ";
    const options = [
        `<option value="">${defaultLabel}</option>`,
        ...list.map((f, i) => `<option value="${i}">${f}</option>`)
    ].join("");

    const content = `
    <form class="order-spell-roll-formula">
      <div class="form-group">
        <label>${labelText}:</label>
        <select id="spellRollFormula">
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
            title: `${titleText}${spellItem?.name ?? ""}`,
            content,
            buttons: {
                ok: {
                    label: "OK",
                    callback: (html) => {
                        const raw = String(html.find("#spellRollFormula").val() ?? "");
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

/**
 * Public entry: starts spell cast dialog and resolves roll+cost+log.
 * `helpers` lets us use your existing debuff implementation without duplicating it.
 */
export async function startSpellCast({ actor, spellItem } = {}) {
    await castSpellInteractive({ actor, spellItem });
}


let _debuffDataCache = null;

async function fetchDebuffData() {
    if (_debuffDataCache) return _debuffDataCache;
    try {
        const response = await fetch("systems/Order/module/debuffs.json");
        if (!response.ok) throw new Error("Failed to load debuffs.json");
        _debuffDataCache = await response.json();
        return _debuffDataCache;
    } catch (err) {
        console.error(err);
        ui.notifications?.error?.("Не удалось загрузить debuffs.json (для дебаффов).");
        return null;
    }
}

function getStageChanges(debuff, stateKey) {
    // В твоём debuffs.json changes иногда как объект по стадиям, иногда пустой массив.
    const ch = debuff?.changes;
    if (!ch) return [];

    // Формат 1: { "1": [...], "2": [...] }
    if (typeof ch === "object" && !Array.isArray(ch)) {
        const arr = ch?.[stateKey];
        return Array.isArray(arr) ? arr.map(c => ({ ...c })) : [];
    }

    // Формат 2: [] (как у MagicFatigue сейчас)
    return [];
}

async function increaseDebuffStage(actor, debuffKey) {
    const systemStates = await fetchDebuffData();
    if (!systemStates) return;

    const debuff = systemStates[debuffKey];
    if (!debuff) {
        ui.notifications?.warn?.(`Не найден дебафф '${debuffKey}' в debuffs.json.`);
        return;
    }

    const maxState = Object.keys(debuff.states || {}).length || 1;

    // Ищем существующий эффект по флагу (как у тебя в OrderPlayerSheet.applyDebuff)
    const existingEffect = actor.effects.find(e => e.getFlag("Order", "debuffKey") === debuffKey);

    const currentState = existingEffect
        ? (Number(existingEffect.getFlag("Order", "stateKey")) || 1)
        : 0;

    const nextState = Math.min(Math.max(currentState + 1, 1), maxState);

    const stageChanges = getStageChanges(debuff, String(nextState));

    const updateData = {
        changes: stageChanges,
        label: `${debuff.name}`,
        icon: debuff.icon || "icons/svg/skull.svg",
        "flags.description": debuff.states[String(nextState)] || "",
        "flags.Order.debuffKey": debuffKey,
        "flags.Order.stateKey": Number(nextState),
        "flags.Order.maxState": maxState
    };

    if (existingEffect) {
        await existingEffect.update(updateData);
    } else {
        const effectData = {
            label: `${debuff.name}`,
            icon: debuff.icon || "icons/svg/skull.svg",
            changes: stageChanges,
            duration: { rounds: 1 }, // как у тебя в applyDebuff
            flags: {
                description: debuff.states[String(nextState)] || "",
                Order: { debuffKey, stateKey: Number(nextState), maxState }
            }
        };
        await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    }
}
