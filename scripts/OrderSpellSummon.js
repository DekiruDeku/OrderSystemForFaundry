/**
 * OrderSpellSummon.js
 * DeliveryType: "summon"
 *
 * Workflow:
 * 1) After successful cast (UsageThreshold passed), player chooses placement points on canvas.
 * 2) Actual token creation is executed by GM (or directly if caster is GM) via the same spell-bus pattern
 *    used in AoE/Save (to avoid permissions issues).
 * 3) Summons can auto-expire after N rounds (optional). Expiration is handled by GM via updateCombat hook.
 */

const FLAG_SCOPE = "Order";
const FLAG_SUMMON = "spellSummon";

export function registerOrderSpellSummonHandlers() {
    // Dismiss button in the chat card
    $(document)
        .off("click.order-spell-summon-dismiss")
        .on("click.order-spell-summon-dismiss", ".order-spell-summon-dismiss", onDismissClick);

    console.log("OrderSpellSummon | Handlers registered");
}

export function registerOrderSpellSummonBus() {
    Hooks.on("createChatMessage", async (message) => {
        try {
            if (!game.user.isGM) return;
            const bus = message.getFlag(FLAG_SCOPE, "spellBus");
            if (!bus) return;
            await handleGMRequest(bus.payload);
        } catch (e) {
            console.error("OrderSpellSummon | BUS handler error", e);
        }
    });

    console.log("OrderSpellSummon | BUS listener registered");
}

export function registerOrderSpellSummonExpiryHooks() {
    // Remove summons when combat round advances
    Hooks.on("updateCombat", async (combat, changed) => {
        try {
            if (!game.user.isGM) return;
            if (!combat?.started) return;
            if (changed.round === undefined && changed.turn === undefined && changed.active === undefined) return;
            await cleanupExpiredSummons(combat);
        } catch (e) {
            console.error("OrderSpellSummon | updateCombat cleanup error", e);
        }
    });

    // If combat is deleted, optionally cleanup summons tied to it
    Hooks.on("deleteCombat", async (combat) => {
        try {
            if (!game.user.isGM) return;
            await cleanupCombatSummons(combat);
        } catch (e) {
            console.error("OrderSpellSummon | deleteCombat cleanup error", e);
        }
    });

    console.log("OrderSpellSummon | Expiry hooks registered");
}

/**
 * Entry point from OrderSpell.js after successful cast.
 */
export async function startSpellSummonWorkflow({ casterActor, casterToken, spellItem, castRoll, pipelineMode = false }) {
    const s = getSystem(spellItem);
    const delivery = String(s.DeliveryType || "utility");
    if (!pipelineMode && delivery !== "summon") return;

    if (!canvas?.ready) {
        ui.notifications.warn("Сцена не готова.");
        return;
    }

    const summonUuid = String(s.SummonActorUuid || "").trim();
    if (!summonUuid) {
        ui.notifications.warn("У заклинания призыва не задан SummonActorUuid (UUID актёра). Открой лист Spell и задай его.");
        return;
    }

    const count = clampInt(Number(s.SummonCount ?? 1) || 1, 1, 50);
    const durationRounds = parseDurationRounds(s.Duration);
    const deleteOnExpiry = s.SummonDeleteOnExpiry !== false;

    // Resolve disposition
    const disposition = resolveDisposition(String(s.SummonDisposition || "same-as-caster"), casterToken);

    // Auto-place summons near caster (no mouse interaction)
    const placements = generatePlacementsNearCaster(casterToken, count);
    if (!placements.length) {
        ui.notifications.warn("Не удалось определить позицию кастера для призыва.");
        return;
    }


    const payload = {
        type: "CREATE_SPELL_SUMMON_TOKENS",
        casterActorId: casterActor?.id ?? null,
        casterTokenId: casterToken?.id ?? null,
        spellId: spellItem?.id ?? null,
        spellName: spellItem?.name ?? "Spell",
        spellImg: spellItem?.img ?? "",
        summonUuid,
        placements,
        disposition,
        durationRounds,
        deleteOnExpiry,
        castTotal: Number(castRoll?.total ?? 0) || 0,
        nat20: isNaturalTwenty(castRoll),
        userId: game.user?.id ?? null
    };

    if (game.user.isGM) {
        await gmCreateSummons(payload);
    } else {
        await emitToGM(payload);
    }
}

/* -------------------------------- UI -------------------------------- */

async function onDismissClick(event) {
    event.preventDefault();

    const messageId = event.currentTarget?.closest?.(".message")?.dataset?.messageId;
    if (!messageId) return;

    // Permissions: caster owner or GM
    const message = game.messages.get(messageId);
    const ctx = message?.getFlag(FLAG_SCOPE, FLAG_SUMMON);
    if (!ctx) return;

    const casterActor = game.actors.get(ctx.casterActorId);
    if (!(game.user.isGM || casterActor?.isOwner)) {
        return ui.notifications.warn("Отпустить призыв может GM или владелец кастера.");
    }

    await emitToGM({
        type: "DISMISS_SPELL_SUMMON_TOKENS",
        messageId
    });
}

/* -------------------------------- GM BUS -------------------------------- */

async function emitToGM(payload) {
    if (game.user.isGM) return handleGMRequest(payload);

    const gmIds = game.users?.filter(u => u.isGM && u.active).map(u => u.id) ?? [];
    if (!gmIds.length) {
        ui.notifications.error("Не найден GM для отправки запроса.");
        return;
    }

    await ChatMessage.create({
        content: `<p>Шина заклинания: ${payload.type}</p>`,
        whisper: gmIds,
        flags: { [FLAG_SCOPE]: { spellBus: { payload } } }
    });
}

async function handleGMRequest(payload) {
    const type = payload?.type;
    if (!type) return;

    if (type === "CREATE_SPELL_SUMMON_TOKENS") return gmCreateSummons(payload);
    if (type === "DISMISS_SPELL_SUMMON_TOKENS") return gmDismissSummons(payload);
}

/* -------------------------------- GM actions -------------------------------- */

async function gmCreateSummons(payload) {
    if (!canvas?.ready) return;

    const {
        casterActorId,
        casterTokenId,
        spellId,
        spellName,
        spellImg,
        summonUuid,
        placements,
        disposition,
        durationRounds,
        deleteOnExpiry,
        castTotal,
        nat20,
        userId
    } = payload;

    const casterToken = canvas.tokens.get(casterTokenId) ?? null;
    const casterActor = casterToken?.actor ?? game.actors.get(casterActorId);

    // Load base actor (import from compendium if needed)
    const baseActor = await getOrImportSummonActor(summonUuid);
    if (!baseActor) {
        ui.notifications.error("Не удалось загрузить актёра для призыва (SummonActorUuid). ");
        return;
    }

    // Compute expiry (combat-based)
    const combat = game.combat?.started ? game.combat : null;
    const inSameScene = combat && (combat.scene?.id === canvas.scene?.id || combat.scene === canvas.scene);
    const startRound = inSameScene ? Number(combat.round ?? 0) || 0 : null;
    const expiresRound = (inSameScene && durationRounds > 0)
        ? startRound + durationRounds
        : null;
    const combatId = inSameScene ? combat.id : null;

    // Build token datas
    const tokenDatas = [];
    for (const p of placements) {
        const { x, y } = snapPosition(p.x, p.y);

        const proto = baseActor.prototypeToken?.toObject ? baseActor.prototypeToken.toObject() : {};

        // TokenDocument expects top-left coordinates
        const finalPos = toTopLeft(x, y);

        const data = {
            ...proto,
            x: finalPos.x,
            y: finalPos.y,
            actorId: baseActor.id,
            actorLink: false,
            disposition,
            flags: {
                ...(proto.flags ?? {}),
                [FLAG_SCOPE]: {
                    summon: {
                        casterActorId: casterActor?.id ?? casterActorId,
                        casterTokenId,
                        spellId,
                        summonUuid,
                        createdBy: userId,
                        durationRounds,
                        deleteOnExpiry,
                        combatId,
                        startRound,
                        expiresRound
                    }
                }
            }
        };

        // Optional: grant caster's user ownership via ActorDelta if possible.
        // Safe fallback: if schema rejects it, Foundry will ignore unknown keys.
        if (userId) {
            data.delta = data.delta ?? {};
            data.delta.ownership = data.delta.ownership ?? {};
            data.delta.ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        }

        tokenDatas.push(data);
    }

    // Create tokens on scene
    let created = [];
    try {
        created = await canvas.scene.createEmbeddedDocuments("Token", tokenDatas);
        // --- Auto-add to combat (own initiative) ---
        // --- Auto-add to combat (team initiative system: no roll) ---
        const combat = game.combat ?? null;
        const inThisScene = combat && (combat.scene?.id === canvas.scene.id || combat.scene === canvas.scene);

        if (combat && inThisScene) {
            try {
                const newTokenIds = created.map(d => d.id);

                // Create combatants for each summoned token (skip if already exists)
                const existingTokenIds = new Set(combat.combatants.map(c => c.tokenId).filter(Boolean));
                const toCreate = newTokenIds
                    .filter(tid => !existingTokenIds.has(tid))
                    .map(tid => ({ tokenId: tid, sceneId: canvas.scene.id }));

                if (toCreate.length) {
                    await combat.createEmbeddedDocuments("Combatant", toCreate);
                }

                // Assign team initiative based on TOKEN disposition
                // Hostile or Secret => enemies, Friendly or Neutral => players
                const teamInit = getTeamInitiativesFromCombat(combat);

                for (const tokenId of newTokenIds) {
                    const tokenDoc = canvas.scene.tokens.get(tokenId);
                    if (!tokenDoc) continue;

                    const teamKey = getTeamKeyFromDisposition(tokenDoc.disposition);
                    const initValue = teamKey === "enemies" ? teamInit.enemies : teamInit.players;

                    const combatant = combat.combatants.find(c => c.tokenId === tokenId);
                    if (!combatant) continue;

                    await combatant.update({ initiative: initValue });
                }
            } catch (e) {
                console.error("OrderSpellSummon | Failed to add summons to combat / set team initiative", e);
                ui.notifications?.warn?.("Не удалось автоматически добавить призыв в бой или выставить инициативу команды.");
            }
        }
    } catch (e) {
        console.error("OrderSpellSummon | createEmbeddedDocuments(Token) failed", e);
        ui.notifications.error("Не удалось создать токены призыва. Проверь права на создание токенов.");
        return;
    }

    const tokenIds = created.map(d => d.id);
    const tokenNames = created.map(d => d.name || baseActor.name);

    const durationText = durationRounds > 0 ? `${durationRounds} раунд(ов)` : "—";
    const expiryText = (expiresRound !== null)
        ? ` (исчезнет на раунде ${expiresRound})`
        : "";

    const content = `
    <div class="order-spell-summon-card">
      <div style="display:flex; gap:8px; align-items:center;">
        <img src="${spellImg}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${escapeHtml(spellName)} (Призыв)</h3>
      </div>

      <p><strong>Кастер:</strong> ${escapeHtml(casterToken?.name ?? casterActor?.name ?? "—")}</p>
      <p><strong>Призвано:</strong> ${escapeHtml(baseActor.name)} × ${tokenIds.length}</p>
      <p><strong>Длительность:</strong> ${escapeHtml(durationText)}${escapeHtml(expiryText)}</p>
      <p><strong>Результат каста:</strong> ${castTotal}${nat20 ? ` <span style="color:#c00;font-weight:700;">[КРИТ]</span>` : ""}</p>

      ${tokenNames.length ? `<p><strong>Токены:</strong> ${escapeHtml(tokenNames.join(", "))}</p>` : ""}

      <hr/>
      <button class="order-spell-summon-dismiss">Отпустить призыв</button>
    </div>
  `;

    const ctx = {
        casterActorId: casterActor?.id ?? casterActorId,
        casterTokenId,
        spellId,
        summonUuid,
        tokenIds,
        durationRounds,
        deleteOnExpiry,
        combatId,
        startRound,
        expiresRound
    };

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
        content,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
        flags: { [FLAG_SCOPE]: { [FLAG_SUMMON]: ctx } }
    });
}

async function gmDismissSummons({ messageId }) {
    const message = game.messages.get(messageId);
    const ctx = message?.getFlag(FLAG_SCOPE, FLAG_SUMMON);
    if (!ctx) return;

    if (ctx.dismissed) return;

    const tokenIds = Array.isArray(ctx.tokenIds) ? ctx.tokenIds : [];
    const scene = canvas?.scene;
    if (!scene) return;

    const existing = tokenIds
        .map(id => scene.tokens.get(id))
        .filter(Boolean);

    if (existing.length) {
        await scene.deleteEmbeddedDocuments("Token", existing.map(t => t.id));
    }

    await message.update({ [`flags.${FLAG_SCOPE}.${FLAG_SUMMON}.dismissed`]: true });
    ui.notifications.info("Призыв отпущен.");
}

/* -------------------------------- Expiry -------------------------------- */

async function cleanupExpiredSummons(combat) {
    const scene = combat.scene ?? game.scenes.get(combat.sceneId) ?? canvas.scene;
    if (!scene) return;

    const round = Number(combat.round ?? 0) || 0;
    const tokens = scene.tokens.contents;

    const expired = tokens.filter(t => {
        const f = t.getFlag(FLAG_SCOPE, "summon");
        if (!f) return false;
        if (!f.deleteOnExpiry) return false;
        if (!f.durationRounds || f.durationRounds <= 0) return false;
        if (f.combatId && f.combatId !== combat.id) return false;
        const exp = Number(f.expiresRound ?? null);
        if (exp === null || Number.isNaN(exp)) return false;
        return round >= exp;
    });

    if (!expired.length) return;

    await scene.deleteEmbeddedDocuments("Token", expired.map(t => t.id));
}

async function cleanupCombatSummons(combat) {
    const scene = combat.scene ?? game.scenes.get(combat.sceneId) ?? canvas.scene;
    if (!scene) return;

    const tokens = scene.tokens.contents;
    const toDelete = tokens.filter(t => {
        const f = t.getFlag(FLAG_SCOPE, "summon");
        if (!f) return false;
        if (!f.deleteOnExpiry) return false;
        return f.combatId === combat.id;
    });

    if (!toDelete.length) return;
    await scene.deleteEmbeddedDocuments("Token", toDelete.map(t => t.id));
}

/* -------------------------------- Helpers -------------------------------- */

function getSystem(obj) {
    return obj?.system ?? obj?.data?.system ?? {};
}

function clampInt(v, min, max) {
    const n = Math.trunc(Number(v));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function resolveDisposition(setting, casterToken) {
    const s = String(setting || "same-as-caster");
    if (s === "same-as-caster") {
        return casterToken?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    }
    if (s === "friendly") return CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    if (s === "neutral") return CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    if (s === "hostile") return CONST.TOKEN_DISPOSITIONS.HOSTILE;
    return casterToken?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
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

async function getOrImportSummonActor(uuid) {
    const doc = await fromUuid(uuid);
    if (!doc) return null;

    // If actor already in world, use it.
    if (doc.documentName === "Actor" && game.actors.get(doc.id)) return doc;

    // If it's a compendium actor (not present in world), import once and cache by a flag.
    const cached = game.actors.contents.find(a => a.getFlag(FLAG_SCOPE, "tempSummonSourceUuid") === uuid);
    if (cached) return cached;

    if (!game.user.isGM) {
        // Only GM can import Actors into the world.
        return null;
    }

    const data = doc.toObject();
    // Make it obvious this is a cached import
    data.name = data.name || "Summon";
    data.flags = data.flags ?? {};
    data.flags[FLAG_SCOPE] = data.flags[FLAG_SCOPE] ?? {};
    data.flags[FLAG_SCOPE].tempSummonSourceUuid = uuid;

    const created = await Actor.create(data, { renderSheet: false });
    return created;
}


function snapPosition(x, y) {
    if (!canvas?.grid) return { x, y };
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return { x, y };
    const [tx, ty] = canvas.grid.getCenter(x, y);
    return { x: tx, y: ty };
}

function toTopLeft(x, y) {
    if (!canvas?.grid) return { x, y };
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return { x, y };
    const [tx, ty] = canvas.grid.getTopLeft(x, y);
    return { x: tx, y: ty };
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function parseDurationRounds(durationValue) {
    // Duration у Spell хранится строкой, но для призыва трактуем как "раунды"
    const raw = String(durationValue ?? "").trim();
    if (!raw) return 0;

    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;

    return clampInt(n, 0, 9999);
}

function generatePlacementsNearCaster(casterToken, count) {
    if (!casterToken || !canvas?.grid) return [];

    // Берём центр кастера и раскладываем призывы "кольцами" вокруг
    const base = casterToken.center;
    const size = canvas.dimensions.size; // размер клетки в пикселях
    const step = size; // шаг = 1 клетка

    const offsets = [
        { x: 0, y: 0 },
        { x: step, y: 0 }, { x: -step, y: 0 }, { x: 0, y: step }, { x: 0, y: -step },
        { x: step, y: step }, { x: step, y: -step }, { x: -step, y: step }, { x: -step, y: -step },
        { x: 2 * step, y: 0 }, { x: -2 * step, y: 0 }, { x: 0, y: 2 * step }, { x: 0, y: -2 * step },
        { x: 2 * step, y: step }, { x: 2 * step, y: -step }, { x: -2 * step, y: step }, { x: -2 * step, y: -step },
    ];

    const out = [];
    for (let i = 0; i < count; i++) {
        const o = offsets[i] ?? {
            // если призывов много — раскладываем дальше по спирали
            x: (i % 6) * step,
            y: Math.floor(i / 6) * step
        };

        const x = base.x + o.x;
        const y = base.y + o.y;

        // снапаем в центр клетки
        const [cx, cy] = canvas.grid.getCenter(x, y);
        out.push({ x: cx, y: cy });
    }

    return out;
}

function getTeamKeyFromDisposition(disposition) {
    // Foundry token dispositions: FRIENDLY, NEUTRAL, HOSTILE, SECRET
    if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) return "enemies";
    if (disposition === CONST.TOKEN_DISPOSITIONS.SECRET) return "enemies";
    // Friendly + Neutral => players
    return "players";
}

/**
 * In your system team initiative is fixed per team:
 * - First team: 10
 * - Second team: 9
 *
 * But which team is first is stored in OrderCombat flag "teamInitiative".
 * If flag exists and combat initialized, we compute correct mapping.
 * Fallback: infer from existing combatants or use defaults (players=10, enemies=9).
 */
function getTeamInitiativesFromCombat(combat) {
    // Default mapping (if combat not initialized)
    let players = 10;
    let enemies = 9;

    try {
        const st = combat.getFlag("Order", "teamInitiative");
        const firstTeam = st?.firstTeam;

        if (firstTeam === "players") {
            players = 10; enemies = 9;
            return { players, enemies };
        }
        if (firstTeam === "enemies") {
            enemies = 10; players = 9;
            return { players, enemies };
        }
    } catch {
        // ignore
    }

    // Fallback: infer from current combatants initiatives, if any
    try {
        const pcs = combat.combatants.filter(c => c.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY || c.token?.disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL);
        const ens = combat.combatants.filter(c => c.token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE || c.token?.disposition === CONST.TOKEN_DISPOSITIONS.SECRET);

        const pcInit = pcs.map(c => c.initiative).filter(v => Number.isFinite(v));
        const enInit = ens.map(c => c.initiative).filter(v => Number.isFinite(v));

        if (pcInit.length) players = pcInit[0];
        if (enInit.length) enemies = enInit[0];
    } catch {
        // ignore
    }

    return { players, enemies };
}
