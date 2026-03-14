import { applyMeleeWeaponDamageBuff } from "./OrderMeleeWeaponBuff.js";
let _debuffCache = null;

const BUFF_KIND_MELEE_DAMAGE_HITS = "melee-damage-hits";
const BUFF_KIND_CHARACTERISTIC_MODIFIER_ROUNDS = "characteristic-modifier-rounds";
const BUFF_KIND_REMOVE_STRESS = "remove-stress";
const BUFF_KIND_REMOVE_MAGIC_FATIGUE = "remove-magic-fatigue";

async function fetchDebuffs() {
    if (_debuffCache) return _debuffCache;
    const resp = await fetch("systems/Order/module/debuffs.json");
    if (!resp.ok) throw new Error("Failed to load debuffs.json");
    _debuffCache = await resp.json();
    return _debuffCache;
}

function getSystem(obj) {
    return obj?.system ?? obj?.data?.system ?? {};
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizeBuffKind(rawKind) {
    return String(rawKind ?? "").trim().toLowerCase();
}

function normalizeCharacteristicKey(rawKey) {
    const raw = String(rawKey ?? "").trim();
    if (!raw) return "";

    const exact = getCharacteristicKeyByName(raw);
    if (exact) return exact;

    const normalized = raw.normalize("NFKD").trim().toLowerCase();
    const aliases = {
        accuracy: "Accuracy",
        меткость: "Accuracy",
        charisma: "Charisma",
        харизма: "Charisma",
        dexterity: "Dexterity",
        ловкость: "Dexterity",
        faith: "Faith",
        вера: "Faith",
        knowledge: "Knowledge",
        знание: "Knowledge",
        leadership: "Leadership",
        лидерство: "Leadership",
        magic: "Magic",
        магия: "Magic",
        medicine: "Medicine",
        медицина: "Medicine",
        seduction: "Seduction",
        соблазнение: "Seduction",
        stamina: "Stamina",
        выносливость: "Stamina",
        stealth: "Stealth",
        скрытность: "Stealth",
        strength: "Strength",
        сила: "Strength",
        will: "Will",
        воля: "Will"
    };

    return aliases[normalized] ?? raw;
}

function getCharacteristicKeyByName(rawKey) {
    const normalizedRaw = String(rawKey ?? "").trim();
    if (!normalizedRaw) return "";

    const orderChars = CONFIG?.Order?.Caracteristics ?? {};
    const byConfig = Object.keys(orderChars).find((key) => String(key) === normalizedRaw);
    if (byConfig) return byConfig;

    const actorTemplateChars = game?.model?.Actor?.Player ?? {};
    const byModel = Object.keys(actorTemplateChars).find((key) => String(key) === normalizedRaw && actorTemplateChars?.[key]?.value !== undefined);
    if (byModel) return byModel;

    return "";
}

function localizeCharacteristic(key) {
    const normalized = normalizeCharacteristicKey(key);
    if (!normalized) return "";
    const localized = game?.i18n?.localize?.(normalized);
    return localized && localized !== normalized ? localized : normalized;
}

function getEffectDurationData(rounds) {
    const safeRounds = Math.max(1, Math.floor(Number(rounds ?? 1) || 1));
    const combat = game?.combat ?? null;
    const duration = { rounds: safeRounds };

    if (combat) {
        if (Number.isFinite(combat.round)) duration.startRound = combat.round;
        if (Number.isFinite(combat.turn)) duration.startTurn = combat.turn;
        if (Number.isFinite(combat.roundTime)) duration.seconds = safeRounds * combat.roundTime;
        if (Number.isFinite(combat.time)) duration.startTime = combat.time;
        if (combat.id) duration.combat = combat.id;
    }

    return duration;
}

export function normalizeConfiguredEffects(rawEffects) {
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

export function buildConfiguredEffectsListHtml(itemLike, { title = "Эффекты" } = {}) {
    const s = getSystem(itemLike);
    const effects = normalizeConfiguredEffects(s?.Effects);
    const rows = [];

    for (const ef of effects) {
        const type = String(ef?.type || "text").trim().toLowerCase();

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
            continue;
        }

        if (type === "buff") {
            const kind = normalizeBuffKind(ef?.buffKind);
            if (kind === BUFF_KIND_MELEE_DAMAGE_HITS) {
                const bonus = Number(ef?.value ?? 0) || 0;
                const hits = Math.max(1, Math.floor(Number(ef?.hits ?? 1) || 1));
                rows.push(`Бафф: урон ближнего оружия ${bonus > 0 ? `+${bonus}` : bonus} (${hits} ударов)`);
                continue;
            }

            if (kind === BUFF_KIND_CHARACTERISTIC_MODIFIER_ROUNDS) {
                const characteristic = localizeCharacteristic(ef?.characteristic) || String(ef?.characteristic ?? "").trim();
                const bonus = Number(ef?.value ?? 0) || 0;
                const rounds = Math.max(1, Math.floor(Number(ef?.rounds ?? 1) || 1));
                rows.push(`Бафф: ${escapeHtml(characteristic || "характеристика")} ${bonus > 0 ? `+${bonus}` : bonus} (${rounds} ходов)`);
                continue;
            }

            if (kind === BUFF_KIND_REMOVE_STRESS) {
                const amount = Math.max(0, Number(ef?.value ?? 0) || 0);
                rows.push(`Эффект: снять стресс ${amount}`);
                continue;
            }

            if (kind === BUFF_KIND_REMOVE_MAGIC_FATIGUE) {
                const amount = Math.max(0, Number(ef?.value ?? 0) || 0);
                rows.push(`Эффект: снять маг. усталость ${amount}`);
                continue;
            }

            if (kind) rows.push(`Бафф: ${escapeHtml(kind)}`);
        }
    }

    const safeTitle = escapeHtml(title || "Эффекты");
    if (!rows.length) return `<p><strong>${safeTitle}:</strong> нет</p>`;

    return `
      <p><strong>${safeTitle}:</strong></p>
      <ul style="margin:0 0 0 18px; padding:0;">
        ${rows.map((row) => `<li>${row}</li>`).join("")}
      </ul>
    `;
}

function getStageChanges(debuff, stateKey) {
    const ch = debuff?.changes;
    if (!ch) return [];

    // Формат: { "1":[...], "2":[...] }
    if (typeof ch === "object" && !Array.isArray(ch)) {
        const arr = ch?.[stateKey];
        return Array.isArray(arr) ? arr.map(c => ({ ...c })) : [];
    }

    // Формат: []
    return [];
}

function normalizeDebuffKeyAndStage(rawKey, rawStage) {
    let key = String(rawKey ?? "").trim();
    let stage = Number(rawStage ?? 1);

    if (!Number.isFinite(stage) || stage <= 0) stage = 1;

    const m = key.match(/^(.+?)[\s:]+(\d+)$/);
    if (m) {
        const keyPart = String(m[1]).trim();
        const stageFromKey = Number(m[2]);
        if (keyPart) key = keyPart;

        const rawStageNum = Number(rawStage);
        const stageWasExplicitlyChanged = Number.isFinite(rawStageNum) && rawStageNum !== 1;

        if (!stageWasExplicitlyChanged) {
            if (Number.isFinite(stageFromKey) && stageFromKey > 0) stage = stageFromKey;
        }
    }

    return { key, stage: Math.max(1, Math.floor(stage)) };
}

async function applyDebuff(actor, debuffKey, stage) {
    const data = await fetchDebuffs();
    const debuff = data?.[debuffKey];
    if (!debuff) {
        ui.notifications?.warn?.(`Debuff '${debuffKey}' не найден в debuffs.json.`);
        return { ok: false, reason: "not_found" };
    }

    const maxState = Object.keys(debuff.states || {}).length || 1;
    const inc = Math.max(1, Math.floor(Number(stage || 1)));

    const existing = actor.effects.find(e => e.getFlag("Order", "debuffKey") === debuffKey);

    const currentState = existing
        ? (Number(existing.getFlag("Order", "stateKey")) || 1)
        : 0;

    const next = Math.min(currentState + inc, maxState);

    if (typeof actor?._addDebuff === "function") {
        const applied = await actor._addDebuff(debuffKey, inc, { cap: maxState });
        if (!applied) return { ok: false, reason: "not_applied" };

        const updated = actor.effects.find(e => e.getFlag("Order", "debuffKey") === debuffKey);
        const finalStage = Number(updated?.getFlag?.("Order", "stateKey") ?? next) || next;
        return { ok: true, stage: finalStage, maxState, name: debuff.name };
    }

    const changes = getStageChanges(debuff, String(next));
    const common = {
        changes,
        label: `${debuff.name}`,
        icon: debuff.icon || "icons/svg/skull.svg",
        "flags.description": debuff.states[String(next)] || "",
        "flags.Order.debuffKey": debuffKey,
        "flags.Order.stateKey": Number(next),
        "flags.Order.maxState": maxState
    };

    if (existing) {
        await existing.update(common);
    } else {
        await actor.createEmbeddedDocuments("ActiveEffect", [{
            label: `${debuff.name}`,
            icon: debuff.icon || "icons/svg/skull.svg",
            changes,
            duration: { rounds: 1 },
            flags: {
                description: debuff.states[String(next)] || "",
                Order: { debuffKey, stateKey: Number(next), maxState }
            }
        }]);
    }

    return { ok: true, stage: next, maxState, name: debuff.name };
}

async function applyCharacteristicModifierBuff(actor, { characteristic, bonus = 0, rounds = 1, label, icon } = {}) {
    if (!actor) return null;

    const characteristicKey = normalizeCharacteristicKey(characteristic);
    if (!characteristicKey) return null;

    const safeBonus = Number(bonus ?? 0) || 0;
    const safeRounds = Math.max(1, Math.floor(Number(rounds ?? 1) || 1));
    if (safeBonus === 0) return null;

    const effectData = {
        label: String(label || `Бафф: ${localizeCharacteristic(characteristicKey)} ${safeBonus > 0 ? `+${safeBonus}` : safeBonus}`),
        icon: icon || "icons/svg/aura.svg",
        changes: [{
            key: `system.${characteristicKey}.tempModifier`,
            mode: CONST.ACTIVE_EFFECT_MODES.ADD,
            value: safeBonus
        }],
        duration: getEffectDurationData(safeRounds),
        flags: {
            Order: {
                buffKey: BUFF_KIND_CHARACTERISTIC_MODIFIER_ROUNDS,
                characteristic: characteristicKey,
                bonus: safeBonus,
                rounds: safeRounds
            }
        }
    };

    const created = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    return created?.[0] ?? null;
}

async function removeActorStress(actor, amount) {
    if (!actor) return { removed: 0, next: 0, current: 0, max: 0 };

    const current = Math.max(0, Number(actor?.system?.Stress?.value ?? 0) || 0);
    const max = Math.max(0, Number(actor?.system?.Stress?.max ?? current) || current);
    const safeAmount = Math.max(0, Number(amount ?? 0) || 0);
    const next = Math.max(0, current - safeAmount);
    const removed = Math.max(0, current - next);

    await actor.update({ "system.Stress.value": next });
    return { removed, next, current, max };
}

async function removeActorMagicFatigue(actor, amount) {
    if (!actor) return { removed: 0, next: 0, current: 0, max: 0 };

    const current = Math.max(0, Number(actor?.system?.ManaFatigue?.value ?? 0) || 0);
    const max = Math.max(0, Number(actor?.system?.ManaFatigue?.max ?? current) || current);
    const safeAmount = Math.max(0, Number(amount ?? 0) || 0);
    const next = Math.max(0, current - safeAmount);
    const removed = Math.max(0, current - next);

    await actor.update({ "system.ManaFatigue.value": next });
    return { removed, next, current, max };
}

/**
 * Apply spell effects list to a single target.
 * effects: array of {type,...}
 */
export async function applySpellEffects({ casterActor, targetActor, spellItem, attackTotal, silent = false }) {
    void silent;
    const s = getSystem(spellItem);
    const raw = s.Effects;

    const effects = (typeof raw === "string")
        ? (raw.trim() ? [{ type: "text", text: raw.trim() }] : [])
        : (Array.isArray(raw) ? raw : []);

    const appliedLogs = [];

    for (const ef of effects) {
        const type = String(ef?.type || "text").trim().toLowerCase();

        if (type === "text") {
            const text = String(ef?.text ?? "").trim();
            if (text) appliedLogs.push(`• ${text}`);
            continue;
        }

        if (type === "debuff") {
            const norm = normalizeDebuffKeyAndStage(ef?.debuffKey, ef?.stage);
            const key = norm.key;
            const stage = norm.stage;

            if (!key) continue;

            const res = await applyDebuff(targetActor, key, stage);
            if (res.ok) appliedLogs.push(`• Дебафф: ${res.name} (+${stage} стад.) → ${res.stage}/${res.maxState}`);
            continue;
        }

        if (type === "buff") {
            const kind = normalizeBuffKind(ef?.buffKind);

            if (kind === BUFF_KIND_MELEE_DAMAGE_HITS) {
                const bonus = Number(ef?.value ?? 0) || 0;
                const hits = Math.max(1, Math.floor(Number(ef?.hits ?? 1) || 1));

                if (bonus !== 0) {
                    const created = await applyMeleeWeaponDamageBuff(targetActor, {
                        bonus,
                        hits,
                        label: spellItem?.name ? `Бафф: ${spellItem.name}` : undefined,
                        icon: spellItem?.img
                    });

                    if (created) {
                        appliedLogs.push(`• Бафф: урон ближнего оружия ${bonus > 0 ? `+${bonus}` : bonus} (${hits} ударов)`);
                    }
                }
                continue;
            }

            if (kind === BUFF_KIND_CHARACTERISTIC_MODIFIER_ROUNDS) {
                const characteristic = normalizeCharacteristicKey(ef?.characteristic);
                const bonus = Number(ef?.value ?? 0) || 0;
                const rounds = Math.max(1, Math.floor(Number(ef?.rounds ?? 1) || 1));
                if (!characteristic || bonus === 0) continue;

                const created = await applyCharacteristicModifierBuff(targetActor, {
                    characteristic,
                    bonus,
                    rounds,
                    label: spellItem?.name ? `Бафф: ${spellItem.name}` : undefined,
                    icon: spellItem?.img
                });

                if (created) {
                    appliedLogs.push(`• Бафф: ${localizeCharacteristic(characteristic)} ${bonus > 0 ? `+${bonus}` : bonus} (${rounds} ходов)`);
                }
                continue;
            }

            if (kind === BUFF_KIND_REMOVE_STRESS) {
                const amount = Math.max(0, Number(ef?.value ?? 0) || 0);
                if (amount <= 0) continue;
                const result = await removeActorStress(targetActor, amount);
                appliedLogs.push(`• Снят стресс: ${result.removed} (${result.current} → ${result.next})`);
                continue;
            }

            if (kind === BUFF_KIND_REMOVE_MAGIC_FATIGUE) {
                const amount = Math.max(0, Number(ef?.value ?? 0) || 0);
                if (amount <= 0) continue;
                const result = await removeActorMagicFatigue(targetActor, amount);
                appliedLogs.push(`• Снята маг. усталость: ${result.removed} (${result.current} → ${result.next})`);
                continue;
            }

            continue;
        }
    }

    const spellName = spellItem?.name ?? "Заклинание";
    const targetName = targetActor?.name ?? "Цель";
    const header = `<p><strong>${spellName}</strong> — применены эффекты к <strong>${targetName}</strong>.</p>`;
    const body = appliedLogs.length ? `<div>${appliedLogs.join("<br/>")}</div>` : `<p>Нет эффектов для применения.</p>`;

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: casterActor }),
        content: `${header}${body}<p style="opacity:.8;font-size:12px;">AttackTotal: ${attackTotal}</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });

    return {
        spellName,
        targetName,
        appliedLogs,
        hasConfiguredEffects: effects.length > 0
    };
}
