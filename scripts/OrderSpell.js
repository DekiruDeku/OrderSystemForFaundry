import { startSpellAttackWorkflow } from "./OrderSpellCombat.js";
import { startSpellSaveWorkflow } from "./OrderSpellSave.js";


/**
 * OrderSpell.js
 * Spell casting workflow (MVP): dialog -> roll -> apply ManaFatigue -> log to chat
 */

function getSystem(obj) {
    return obj?.system ?? obj?.data?.system ?? {};
}

function getManaFatigue(actor) {
    const sys = getSystem(actor);
    // В системе Order ManaFatigue находится в корне system (см. Player-sheet.hbs / OrderActor.js)
    return sys?.ManaFatigue ?? null;
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


function buildMagicRollFormula({ actor, mode, manualMod }) {
    let d20 = "1d20";
    if (mode === "adv") d20 = "2d20kh1";
    else if (mode === "dis") d20 = "2d20kl1";

    const sys = getSystem(actor);
    const magicData = sys?.Magic ?? {};
    const magicVal = Number(magicData.value ?? 0) || 0;
    const magicMods = (magicData.modifiers || []).reduce((acc, m) => acc + (Number(m?.value) || 0), 0);
    const custom = Number(manualMod ?? 0) || 0;

    const parts = [d20];
    const add = (n) => {
        if (!n) return;
        parts.push(n > 0 ? `+ ${n}` : `- ${Math.abs(n)}`);
    };

    add(magicVal);
    add(magicMods);
    add(custom);

    return parts.join(" ");
}

/**
 * Public entry: starts spell cast dialog and resolves roll+cost+log.
 * `helpers` lets us use your existing debuff implementation without duplicating it.
 */
export async function startSpellCast({ actor, spellItem, helpers = {} } = {}) {
    if (!actor || !spellItem) return;

    const s = getSystem(spellItem);
    const usageCost = Number(s.UsageCost ?? 0) || 0;

    const ok = await confirmOverFatigue({ actor, usageCost, spellName: spellItem.name });
    if (!ok) return;

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

    const doCast = async (html, mode) => {
        const manualMod = Number(html.find("#spellManualMod").val() ?? 0) || 0;

        const formula = buildMagicRollFormula({ actor, mode, manualMod });
        const roll = await new Roll(formula).roll({ async: true });
        const rollHTML = await roll.render();

        const nat20 = isNaturalTwenty(roll);

        // Apply mana fatigue (always, even if cast fails)
        await applyManaFatigueCost({ actor, usageCost });

        // Outcome vs UsageThreshold (if provided and non-zero)
        let outcomeText = "";
        const threshold = Number(s.UsageThreshold);
        const hasThreshold = !Number.isNaN(threshold) && threshold !== 0;
        const castFailed = hasThreshold ? (roll.total < threshold) : false;



        if (!isNaN(threshold) && threshold !== 0) {
            outcomeText = roll.total >= threshold ? "Успех" : "Провал";
        }

        const delivery = String(s.DeliveryType || "utility");
        const startsWorkflow = (
            delivery === "attack-ranged" ||
            delivery === "attack-melee" ||
            delivery === "save-check"
        );



        if (!castFailed && startsWorkflow) {
            const casterToken = actor.getActiveTokens?.()[0] ?? null;
            await startSpellAttackWorkflow({
                casterActor: actor,
                casterToken,
                spellItem,
                castRoll: roll,
                rollMode: mode,
                manualMod
            });
        }
        if (!castFailed) {
            const casterToken = actor.getActiveTokens?.()[0] ?? null;

            if (delivery === "attack-ranged" || delivery === "attack-melee") {
                await startSpellAttackWorkflow({
                    casterActor: actor,
                    casterToken,
                    spellItem,
                    castRoll: roll,
                    rollMode: mode,
                    manualMod
                });
            }

            if (delivery === "save-check") {
                await startSpellSaveWorkflow({
                    casterActor: actor,
                    casterToken,
                    spellItem,
                    castRoll: roll
                });
            }
        }

        // Если это attack-заклинание и каст успешен — отдельное сообщение каста не создаём,
        // потому что всё будет в атакующем сообщении с защитой.
        const shouldCreateCastMessage = !(startsWorkflow && !castFailed);

        const mf = getManaFatigue(actor);
        const mfValue = Number(mf?.value ?? 0) || 0;
        const mfMax = Number(mf?.max ?? 0) || 0;

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
          <p><strong>Результат броска:</strong> ${roll.total}${outcomeText ? ` (${outcomeText})` : ""}${nat20 ? " <span style=\"color:#c00; font-weight:700;\">[КРИТ]</span>" : ""}</p>
          <div class="inline-roll">${rollHTML}</div>
        </div>
      </div>
    `;

        if (shouldCreateCastMessage) {
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
                            nat20
                        }
                    }
                }
            });
        }

    };

    new Dialog({
        title: `Применить заклинание: ${spellItem.name}`,
        content,
        buttons: {
            normal: { label: "Обычный", callback: (html) => doCast(html, "normal") },
            adv: { label: "Преимущество", callback: (html) => doCast(html, "adv") },
            dis: { label: "Помеха", callback: (html) => doCast(html, "dis") }
        },
        default: "normal"
    }).render(true);
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
