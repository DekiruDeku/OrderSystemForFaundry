import { castSpellInteractive } from "./OrderSpell.js";

const DEF_DELIVERY = "defensive-reaction";

function getSystem(obj) {
    return obj?.system ?? obj?.data?.system ?? {};
}

function D(...args) {
    try {
        if (!game.settings.get("Order", "debugDefenseSpell")) return;
    } catch { /* ignore */ }
    console.log("[Order][SpellDefenseReaction]", ...args);
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

function normalizeFormula(raw) {
    const f = String(raw ?? "").trim();
    return f
        .replace(/магия/gi, "Magic")
        .replace(/ловкость/gi, "Dexterity")
        .replace(/выносливость/gi, "Stamina")
        .replace(/сила/gi, "Strength")
        .replace(/знания/gi, "Knowledge")
        .replace(/\s+/g, " ")
        .trim();
}

function substituteStatsInFormula(formula, actor) {
    let out = normalizeFormula(formula);
    const stats = ["Magic", "Dexterity", "Stamina", "Strength", "Knowledge"];

    for (const stat of stats) {
        const { value, mods } = getCharacteristicValueAndMods(actor, stat);
        const total = (Number(value) || 0) + (Number(mods) || 0);
        const rep = total < 0 ? `(${total})` : String(total);
        out = out.replace(new RegExp(`\\b${stat}\\b`, "g"), rep);
    }
    return out;
}

export function getDefensiveReactionSpells(actor) {
    const items = actor?.items?.contents ?? [];
    return items
        .filter(i => i?.type === "Spell" && String(i.system?.DeliveryType || "") === DEF_DELIVERY)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
}

export async function castDefensiveSpellDefense({ actor, token, spellItem, silent = false }) {
    // 1) каст как обычно
    const externalDefenseMod = getExternalRollModifierFromEffects(actor, "defense");
    const cast = await castSpellInteractive({ actor, spellItem, silent, externalRollMod: externalDefenseMod });
    if (!cast) return null; // отмена

    const castFailed = !!cast.castFailed;

    // 2) если каст провален — защита не сработала
    if (castFailed) {
        return {
            spellId: spellItem.id,
            spellName: spellItem.name,
            castFailed: true,
            castTotal: cast.total,
            defenseTotal: 0
        };
    }

    // 3) защита = результат каста
    return {
        spellId: spellItem.id,
        spellName: spellItem.name,
        castFailed: false,
        castTotal: cast.total,
        defenseTotal: Number(cast.total ?? 0) || 0
    };
}



/**
 * UI: заполняет dropdown и показывает кнопку, если у нужного актёра есть defensive-reaction.
 */
export function registerOrderSpellDefenseReactionUI() {
    Hooks.on("renderChatMessage", (message, html) => {
        const selects = html.find(".order-defense-spell-select");
        if (!selects?.length) return;

        const getCtx = (m) =>
            m?.getFlag?.("Order", "attack") ||
            m?.getFlag?.("Order", "rangedAttack") ||
            m?.getFlag?.("Order", "spellAttack") ||
            m?.getFlag?.("Order", "skillAttack") ||
            null;

        selects.each((_, el) => {
            try {
                const $el = $(el);
                const row = $el.closest(".order-defense-spell-row");
                if (!row.length) return;

                const srcId = String(el.dataset?.src || message.id);
                const srcMsg = game.messages.get(srcId);
                const ctx = getCtx(srcMsg || message);
                if (!ctx) return;

                // нормальная защита или против преемпта
                const isPreempt = (srcId !== message.id) && (String(ctx.state) === "awaitingPreemptDefense");

                const actorId = isPreempt ? ctx.attackerActorId : ctx.defenderActorId;
                const tokenId = isPreempt ? ctx.attackerTokenId : ctx.defenderTokenId;

                const t = canvas.tokens?.get(tokenId);
                const actor = t?.actor ?? game.actors.get(actorId);
                if (!actor) return;

                if (!(actor.isOwner || game.user.isGM)) return;

                // показываем только если реально ожидается защита
                if (!isPreempt && String(ctx.state) !== "awaitingDefense") return;
                if (isPreempt && String(ctx.state) !== "awaitingPreemptDefense") return;

                const spells = getDefensiveReactionSpells(actor);
                if (!spells.length) {
                    row.hide();
                    return;
                }

                // если уже заполнено — не трогаем (чтобы не сбрасывать выбор)
                if (!$el.children().length) {
                    for (const sp of spells) {
                        $el.append(`<option value="${sp.id}">${sp.name}</option>`);
                    }
                }

                row.css("display", "flex");
            } catch (e) {
                console.error("OrderDefenseSpell | renderChatMessage error", e);
            }
        });
    });

    console.log("OrderDefenseSpell | UI hook registered");
}

function sanitizeFormulaInput(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    if (s.includes(",")) {
        const last = s.split(",").map(t => t.trim()).filter(Boolean).pop();
        return last || "";
    }
    return s;
}
