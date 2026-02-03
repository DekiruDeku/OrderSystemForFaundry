const FLAG_SCOPE = "Order";
const FLAG_ZONE = "spellZone";

/* ------------------------------- Public API ------------------------------- */

export function registerOrderSpellZoneHandlers() {
    $(document)
        .off("click.order-spell-zone-delete")
        .on("click.order-spell-zone-delete", ".order-spell-zone-delete", onDeleteZoneClick);
    console.log("OrderSpellZones | Handlers registered");
}

export function registerOrderSpellZoneBus() {
    Hooks.on("createChatMessage", async (message) => {
        try {
            if (!game.user.isGM) return;
            const bus = message.getFlag(FLAG_SCOPE, "spellBus");
            if (!bus) return;
            await handleGMRequest(bus.payload);
        } catch (e) {
            console.error("OrderSpellZones | BUS handler error", e);
        }
    });

    console.log("OrderSpellZones | BUS listener registered");
}

export function registerOrderSpellZoneExpiryHooks() {
    Hooks.on("updateCombat", async (combat, changed) => {
        try {
            if (!game.user.isGM) return;
            if (!combat?.started) return;
            if (changed.round === undefined && changed.turn === undefined && changed.active === undefined) return;
            await cleanupExpiredZones(combat);
        } catch (e) {
            console.error("OrderSpellZones | updateCombat cleanup error", e);
        }
    });

    Hooks.on("deleteCombat", async (combat) => {
        try {
            if (!game.user.isGM) return;
            await cleanupCombatZones(combat);
        } catch (e) {
            console.error("OrderSpellZones | deleteCombat cleanup error", e);
        }
    });

    console.log("OrderSpellZones | Expiry hooks registered");
}

/**
 * DeliveryType: "create-object"
 * Creates a visual MeasuredTemplate on the scene, linked to the spell, with optional duration in rounds.
 */
export async function startSpellCreateObjectWorkflow({ casterActor, casterToken, spellItem, castRoll }) {
    const s = getSystem(spellItem);
    const delivery = String(s.DeliveryType || "utility");
    if (delivery !== "create-object") return;

    if (!canvas?.ready) {
        ui.notifications.warn("Сцена не готова.");
        return;
    }

    const size = Number(s.AreaSize ?? 0) || 0;
    if (!size) {
        ui.notifications.warn("Для create-object нужно задать AreaSize.");
        return;
    }

    const templateData = buildTemplateDataFromSpell({ casterToken, spellItem });
    const placed = await placeTemplateInteractively(templateData);
    if (!placed) return;

    const docId = placed.id;

    const durationRounds = parseDurationRounds(s.Duration);

    // привязка к бою (если есть и он на этой сцене)
    const combat = game.combat?.started ? game.combat : null;
    const inSameScene = combat && (combat.scene?.id === canvas.scene.id || combat.scene === canvas.scene);
    const startRound = inSameScene ? Number(combat.round ?? 0) || 0 : null;
    const expiresRound = (inSameScene && durationRounds > 0) ? (startRound + durationRounds) : null;
    const combatId = inSameScene ? combat.id : null;

    // Запишем флаги прямо в шаблон (чтобы чистка работала даже без чат-сообщения)
    try {
        await canvas.scene.updateEmbeddedDocuments("MeasuredTemplate", [{
            _id: docId,
            flags: {
                [FLAG_SCOPE]: {
                    zone: {
                        casterActorId: casterActor?.id ?? null,
                        casterTokenId: casterToken?.id ?? null,
                        spellId: spellItem?.id ?? null,
                        spellName: spellItem?.name ?? "Spell",
                        durationRounds,
                        combatId,
                        startRound,
                        expiresRound,
                        deleteOnExpiry: true
                    }
                }
            }
        }]);
    } catch (e) {
        console.warn("OrderSpellZones | Failed to set flags on MeasuredTemplate", e);
    }

    const nat20 = isNaturalTwenty(castRoll);
    const durationText = durationRounds > 0 ? `${durationRounds} раунд(ов)` : "—";
    const expiryText = (expiresRound !== null) ? ` (исчезнет на раунде ${expiresRound})` : "";

    const content = `
    <div class="order-spell-zone-card">
      <div style="display:flex; gap:8px; align-items:center;">
        <img src="${spellItem?.img ?? ""}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${escapeHtml(spellItem?.name ?? "Zone")} (Область)</h3>
      </div>

      <p><strong>Кастер:</strong> ${escapeHtml(casterToken?.name ?? casterActor?.name ?? "—")}</p>
      <p><strong>Длительность:</strong> ${escapeHtml(durationText)}${escapeHtml(expiryText)}</p>
      <p><strong>Результат каста:</strong> ${Number(castRoll?.total ?? 0) || 0}${nat20 ? ` <span style="color:#c00;font-weight:700;">[КРИТ]</span>` : ""}</p>

      <hr/>
        <button class="order-spell-zone-delete">Удалить область</button>
    </div>
  `;

    const ctx = {
        casterActorId: casterActor?.id ?? null,
        casterTokenId: casterToken?.id ?? null,
        spellId: spellItem?.id ?? null,
        templateId: docId,
        durationRounds,
        combatId,
        startRound,
        expiresRound
    };

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
        content,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
        flags: { [FLAG_SCOPE]: { [FLAG_ZONE]: ctx } }
    });
}

/* ------------------------------- UI handlers ------------------------------ */

async function onDeleteZoneClick(event) {
    event.preventDefault();

    const messageId = event.currentTarget?.closest?.(".message")?.dataset?.messageId;
    if (!messageId) return;

    const message = game.messages.get(messageId);
    const ctx = message?.getFlag(FLAG_SCOPE, FLAG_ZONE);
    if (!ctx) return;

    const casterActor = game.actors.get(ctx.casterActorId);
    if (!(game.user.isGM || casterActor?.isOwner)) {
        return ui.notifications.warn("Удалить область может GM или владелец кастера.");
    }

    await emitToGM({
        type: "DELETE_SPELL_ZONE",
        messageId
    });
}

/* -------------------------------- GM BUS ---------------------------------- */

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

    if (type === "DELETE_SPELL_ZONE") return gmDeleteZone(payload);

}

/* ------------------------------- GM actions -------------------------------- */

async function gmDeleteZone({ messageId }) {
    const message = game.messages.get(messageId);
    const ctx = message?.getFlag(FLAG_SCOPE, FLAG_ZONE);
    if (!ctx) return;

    if (ctx.deleted) return;

    const scene = canvas?.scene;
    if (!scene) return;

    const templateId = ctx.templateId;
    if (templateId) {
        try {
            await scene.deleteEmbeddedDocuments("MeasuredTemplate", [templateId]);
        } catch (e) {
            console.warn("OrderSpellZones | Failed to delete template", e);
        }
    }

    await message.update({ [`flags.${FLAG_SCOPE}.${FLAG_ZONE}.deleted`]: true });
}

/* ------------------------------- Expiry ----------------------------------- */

async function cleanupExpiredZones(combat) {
    const scene = combat.scene ?? game.scenes.get(combat.sceneId) ?? canvas.scene;
    if (!scene) return;

    const round = Number(combat.round ?? 0) || 0;
    const templates = scene.templates?.contents ?? [];

    const expired = templates.filter(t => {
        const f = t.getFlag(FLAG_SCOPE, "zone");
        if (!f) return false;
        if (!f.deleteOnExpiry) return false;
        if (!f.durationRounds || f.durationRounds <= 0) return false;
        if (f.combatId && f.combatId !== combat.id) return false;

        const exp = Number(f.expiresRound ?? null);
        if (exp === null || Number.isNaN(exp)) return false;
        return round >= exp;
    });

    if (!expired.length) return;
    await scene.deleteEmbeddedDocuments("MeasuredTemplate", expired.map(t => t.id));
}

async function cleanupCombatZones(combat) {
    const scene = combat.scene ?? game.scenes.get(combat.sceneId) ?? canvas.scene;
    if (!scene) return;

    const templates = scene.templates?.contents ?? [];
    const toDelete = templates.filter(t => {
        const f = t.getFlag(FLAG_SCOPE, "zone");
        if (!f) return false;
        if (!f.deleteOnExpiry) return false;
        return f.combatId === combat.id;
    });

    if (!toDelete.length) return;
    await scene.deleteEmbeddedDocuments("MeasuredTemplate", toDelete.map(t => t.id));
}

/* ------------------------------- Placement -------------------------------- */

function buildTemplateDataFromSpell({ casterToken, spellItem }) {
    const s = getSystem(spellItem);

    const t = mapShape(String(s.AreaShape || "circle"));
    const distance = Number(s.AreaSize ?? 0) || 0;

    const angle = Number(s.AreaAngle ?? 90) || 90;
    const width = Number(s.AreaWidth ?? 0) || 0;

    const center = casterToken?.center ?? { x: 0, y: 0 };

    return {
        t,
        user: game.user.id,
        x: center.x,
        y: center.y,
        direction: 0,
        distance,
        angle,
        width,
        fillColor: (String(s.AreaColor || "").trim() || game.user.color),
        flags: { [FLAG_SCOPE]: { fromSpell: spellItem.id } }
    };
}

function mapShape(shape) {
    if (shape === "circle") return "circle";
    if (shape === "cone") return "cone";
    if (shape === "ray") return "ray";
    if (shape === "rect") return "rect";
    if (shape === "wall") return "ray"; // визуальная "стена" как луч
    return "circle";
}

async function placeTemplateInteractively(templateData) {
    const priorLayer = canvas.activeLayer;

    const previewDoc = new MeasuredTemplateDocument(templateData, { parent: canvas.scene });
    const previewObj = new MeasuredTemplate(previewDoc);
    await previewObj.draw();

    const layer = canvas.templates;
    layer.activate();
    layer.preview.addChild(previewObj);
    previewObj.alpha = 0.6;

    let resolve;
    const promise = new Promise((res) => (resolve = res));

    const cleanup = () => {
        canvas.stage.off("mousemove", onMove);
        canvas.stage.off("mousedown", onMouseDown);
        window.removeEventListener("keydown", onKeyDown);
        canvas.app.view.removeEventListener("wheel", onWheel);

        try { layer.preview.removeChild(previewObj); } catch { }
        try { previewObj.destroy({ children: true }); } catch { }

        try { priorLayer?.activate?.(); } catch { }
    };

    const onMove = (event) => {
        const pos = event.data.getLocalPosition(canvas.stage);
        const [cx, cy] = canvas.grid.getCenter(pos.x, pos.y);
        previewDoc.updateSource({ x: cx, y: cy });
        previewObj.refresh();
    };

    const onWheel = (event) => {
        const delta = event.deltaY < 0 ? 15 : -15;
        const dir = Number(previewDoc.direction ?? 0) || 0;
        previewDoc.updateSource({ direction: (dir + delta + 360) % 360 });
        previewObj.refresh();
    };

    const confirm = async (event) => {
        event.stopPropagation();
        cleanup();
        const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [previewDoc.toObject()]);
        resolve(created?.[0] ?? null);
    };

    const cancel = (event) => {
        if (event) event.stopPropagation();
        cleanup();
        resolve(null);
    };

    const onMouseDown = (event) => {
        if (event.data.button === 0) return confirm(event);
        return cancel(event);
    };

    const onKeyDown = (ev) => {
        if (ev.key === "Escape") cancel();
    };

    canvas.stage.on("mousemove", onMove);
    canvas.stage.on("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    canvas.app.view.addEventListener("wheel", onWheel, { passive: true });

    return promise;
}

/* ------------------------------- Helpers ---------------------------------- */

function getSystem(obj) {
    return obj?.system ?? obj?.data?.system ?? {};
}

function parseDurationRounds(durationValue) {
    const raw = String(durationValue ?? "").trim();
    if (!raw) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    const r = Math.trunc(n);
    return Math.max(0, Math.min(r, 9999));
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

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
