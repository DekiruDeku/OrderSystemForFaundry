import { applyMeleeWeaponDamageBuff } from "./OrderMeleeWeaponBuff.js";
let _debuffCache = null;

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

    // Если стадию не распарсили нормально — ставим 1
    if (!Number.isFinite(stage) || stage <= 0) stage = 1;

    // Поддержка ввода вида "MagicFatigue 1" или "MagicFatigue:1"
    // В этом случае stage берём из ключа (если явная стадия не задана)
    const m = key.match(/^(.+?)[\s:]+(\d+)$/);
    if (m) {
        const keyPart = String(m[1]).trim();
        const stageFromKey = Number(m[2]);
        if (keyPart) key = keyPart;

        // ВАЖНО:
        // В UI stage почти всегда = 1 по умолчанию, поэтому если в ключе явно указано число,
        // мы считаем его приоритетным (как инкремент), если stage не был явно изменён на другое значение.
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

    // stage воспринимаем как "на сколько стадий повысить" (инкремент)
    const inc = Math.max(1, Math.floor(Number(stage || 1)));

    const existing = actor.effects.find(e => e.getFlag("Order", "debuffKey") === debuffKey);

    const currentState = existing
        ? (Number(existing.getFlag("Order", "stateKey")) || 1)
        : 0;

    // Складываем стадии, не даём превысить maxState (обычно 3)
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

/**
 * Apply spell effects list to a single target.
 * effects: array of {type,...}
 */
export async function applySpellEffects({ casterActor, targetActor, spellItem, attackTotal, silent = false }) {
    const s = getSystem(spellItem);
    const raw = s.Effects;

    // back-compat: string -> single text effect
    const effects = (typeof raw === "string")
        ? (raw.trim() ? [{ type: "text", text: raw.trim() }] : [])
        : (Array.isArray(raw) ? raw : []);

    const appliedLogs = [];

    for (const ef of effects) {
        const type = String(ef?.type || "text");

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
            const kind = String(ef?.buffKind ?? "").trim().toLowerCase();
            if (kind === "melee-damage-hits") {
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
            }
            continue;
        }

    }

    // Лог в чат (как результат применения)
    const spellName = spellItem?.name ?? "Заклинание";
    const targetName = targetActor?.name ?? "Цель";
    const header = `<p><strong>${spellName}</strong> — применены эффекты к <strong>${targetName}</strong>.</p>`;
    const body = appliedLogs.length ? `<div>${appliedLogs.join("<br/>")}</div>` : `<p>Нет эффектов для применения.</p>`;

    if (!silent) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: casterActor }),
            content: `${header}${body}<p style="opacity:.8;font-size:12px;">AttackTotal: ${attackTotal}</p>`,
            type: CONST.CHAT_MESSAGE_TYPES.OTHER
        });
    }
}
