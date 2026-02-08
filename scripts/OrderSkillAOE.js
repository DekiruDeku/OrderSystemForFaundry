const FLAG_SCOPE = "Order";
const FLAG_AOE = "skillAoE";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}


function getBaseImpactFromSystem(sys) {
  const amount = Math.max(0, Number(sys?.Damage ?? 0) || 0);
  const mode = String(sys?.DamageMode || "damage").toLowerCase() === "heal" ? "heal" : "damage";
  return { amount, mode, signed: mode === "heal" ? -amount : amount };
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mapShape(shape) {
  const s = String(shape || "circle");
  if (s === "cone") return "cone";
  if (s === "ray") return "ray";
  if (s === "rect") return "rect";
  if (s === "wall") return "ray"; // условно, как у spell
  return "circle";
}

function parseDurationRounds(durationValue) {
  const s = String(durationValue ?? "").trim().toLowerCase();
  if (!s) return 0;

  // "3 rounds", "3 раунда", "3"
  const m = s.match(/(\d+)/);
  if (!m) return 0;
  return Number(m[1]) || 0;
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
    if (event.data.button === 0) return confirm(event); // ЛКМ
    return cancel(event); // ПКМ
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




async function waitForTemplateObject(docId) {
  for (let i = 0; i < 20; i++) {
    const obj = canvas.templates?.placeables?.find(t => t.document?.id === docId);
    if (obj) return obj;
    await new Promise(r => setTimeout(r, 50));
  }
  return null;
}



function getTokensInTemplate(templateObj) {
  const doc = templateObj.document;
  if (!doc) return [];

  const geom = getTemplateGeometry(doc);

  const tokens = canvas.tokens?.placeables ?? [];
  const out = [];

  for (const tok of tokens) {
    const points = sampleTokenPoints(tok);

    let hit = false;
    for (const p of points) {
      if (pointInTemplate(geom, p.x, p.y)) {
        hit = true;
        break;
      }
    }
    if (hit) out.push(tok);
  }

  return out;
}

function getTemplateGeometry(doc) {
  const t = String(doc.t || "circle");

  const unitsToPx = canvas.dimensions.size / canvas.dimensions.distance;
  const origin = { x: Number(doc.x) || 0, y: Number(doc.y) || 0 };

  const distanceUnits = Number(doc.distance) || 0;
  const widthUnits = Number(doc.width) || 0;
  const angleDeg = Number(doc.angle) || 0;
  const directionDeg = normalizeDeg(Number(doc.direction) || 0);

  const distancePx = distanceUnits * unitsToPx;
  const widthPx = widthUnits * unitsToPx;

  const dirRad = (directionDeg * Math.PI) / 180;
  const ux = Math.cos(dirRad);
  const uy = Math.sin(dirRad);

  const px = -uy;
  const py = ux;

  return {
    t,
    origin,
    unitsToPx,
    distancePx,
    widthPx,
    angleDeg,
    directionDeg,
    ux, uy,
    px, py
  };
}

function pointInTemplate(g, x, y) {
  const dx = x - g.origin.x;
  const dy = y - g.origin.y;

  if (g.t === "circle") {
    const r2 = g.distancePx * g.distancePx;
    return (dx * dx + dy * dy) <= r2;
  }

  if (g.t === "cone") {
    const dist2 = dx * dx + dy * dy;
    if (dist2 > g.distancePx * g.distancePx) return false;

    const ang = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
    const delta = deltaAngleDeg(ang, g.directionDeg);
    return delta <= (Number(g.angleDeg) || 90) / 2;
  }

  const localX = dx * g.ux + dy * g.uy;
  const localY = dx * g.px + dy * g.py;

  const len = g.distancePx;
  const halfW = (g.widthPx || canvas.dimensions.size) / 2;

  return (localX >= 0 && localX <= len && Math.abs(localY) <= halfW);
}

function normalizeDeg(a) {
  let x = Number(a) || 0;
  x = x % 360;
  if (x < 0) x += 360;
  return x;
}

function deltaAngleDeg(a, b) {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

function sampleTokenPoints(tok) {
  const x = Number(tok.x) || 0;
  const y = Number(tok.y) || 0;
  const w = Number(tok.w) || 0;
  const h = Number(tok.h) || 0;

  if (!w || !h) {
    const c = tok.center ?? { x, y };
    return [{ x: c.x, y: c.y }];
  }

  const pad = 2;
  const x1 = x + pad;
  const x2 = x + w / 2;
  const x3 = x + w - pad;

  const y1 = y + pad;
  const y2 = y + h / 2;
  const y3 = y + h - pad;

  return [
    { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x3, y: y1 },
    { x: x1, y: y2 }, { x: x2, y: y2 }, { x: x3, y: y2 },
    { x: x1, y: y3 }, { x: x2, y: y3 }, { x: x3, y: y3 }
  ];
}


/* ----------------------------- Handlers + Bus ----------------------------- */

export function registerOrderSkillAoEHandlers() {
  $(document)
    .off("click.order-skill-aoe-apply")
    .on("click.order-skill-aoe-apply", ".order-skill-aoe-apply", onApplyAoEClick);

  console.log("OrderSkillAoE | Handlers registered");
}

export function registerOrderSkillAoEBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;
      const bus = message.getFlag("Order", "skillBus");
      if (!bus) return;
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderSkillAoE | BUS handler error", e);
    }
  });

  console.log("OrderSkillAoE | BUS listener registered");
}

async function emitToGM(payload) {
  if (game.user.isGM) return handleGMRequest(payload);

  const gmIds = game.users?.filter(u => u.isGM && u.active).map(u => u.id) ?? [];
  if (!gmIds.length) {
    ui.notifications.error("Не найден GM для отправки запроса.");
    return;
  }

  await ChatMessage.create({
    content: `<p>Шина навыка: ${payload.type}</p>`,
    whisper: gmIds,
    flags: { Order: { skillBus: { payload } } }
  });
}

async function handleGMRequest(payload) {
  const type = payload?.type;
  if (!type) return;

  if (type === "APPLY_SKILL_AOE_DAMAGE") return gmApplyAoEDamage(payload);
}

/* ----------------------------- Entry point ----------------------------- */

export async function startSkillAoEWorkflow({ casterActor, casterToken, skillItem }) {
  const s = getSystem(skillItem);
  const delivery = String(s.DeliveryType || "utility").trim().toLowerCase();
  if (delivery !== "aoe-template") return false;

  if (!canvas?.ready) {
    ui.notifications.warn("Сцена не готова.");
    return false;
  }

  const shape = String(s.AreaShape || "circle");
  const size = Number(s.AreaSize ?? 0) || 0;
  if (!size) {
    ui.notifications.warn("У AoE навыка не задан размер области (AreaSize).");
    return;
  }

  const t = mapShape(shape);

  const center = casterToken?.center ?? { x: 0, y: 0 };

  const templateData = {
    t,
    user: game.user.id,
    x: center.x,
    y: center.y,
    direction: 0,
    distance: size,
    width: Number(s.AreaWidth ?? 0) || 0,
    angle: Number(s.AreaAngle ?? 90) || 90,
    fillColor: String(s.AreaColor || game.user?.color || "#ffffff"),
    flags: {
      Order: {
        skillAoETemplate: {
          casterActorId: casterActor?.id ?? null,
          skillId: skillItem?.id ?? null
        }
      }
    }
  };

  const placed = await placeTemplateInteractively(templateData);
  if (!placed) return false;

  const templateId = placed.id;
  const templateObj = await waitForTemplateObject(templateId);

  const targets = templateObj ? getTokensInTemplate(templateObj) : [];
  const targetNames = targets.length ? targets.map(tk => tk.name).join(", ") : "—";

  const impact = getBaseImpactFromSystem(s);
  let baseDamage = impact.signed;
  const perkSkillDmg = Number(casterActor?.system?._perkBonuses?.SkillDamage ?? 0) || 0;
  if (impact.mode === "damage" && perkSkillDmg) baseDamage += perkSkillDmg;
  const areaPersistent = !!s.AreaPersistent;

  // Duration expiry for persistent templates
  const durationRounds = areaPersistent ? parseDurationRounds(s.Duration) : 0;
  const combatId = game.combat?.id ?? null;
  const currentRound = Number(game.combat?.round ?? 0) || 0;
  const expiresAtRound = (areaPersistent && durationRounds > 0 && combatId)
    ? (currentRound + durationRounds)
    : 0;

  // запишем expiry прямо в MeasuredTemplate flags (если есть)
  if (areaPersistent && expiresAtRound && game.user.isGM) {
    await canvas.scene.updateEmbeddedDocuments("MeasuredTemplate", [{
      _id: templateId,
      "flags.Order.skillAoEExpiry": { combatId, expiresAtRound }
    }]);
  }

  const content = `
    <div class="order-skill-aoe-card">
      <div style="display:flex; gap:8px; align-items:center;">
        <img src="${skillItem?.img ?? ""}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${skillItem?.name ?? "AoE"}</h3>
      </div>

      <p><strong>Использующий:</strong> ${casterToken?.name ?? casterActor.name}</p>
      <p><strong>Шаблон:</strong> ${escapeHtml(shape)} (размер ${size})</p>
      <p><strong>Цели в области:</strong> ${escapeHtml(targetNames)}</p>
      ${areaPersistent ? `<p><strong>Постоянная область:</strong> да</p>` : `<p><strong>Постоянная область:</strong> нет</p>`}
      ${areaPersistent && durationRounds ? `<p><strong>Длительность:</strong> ${durationRounds} раунд(ов) (до раунда ${expiresAtRound})</p>` : ""}
      ${baseDamage ? `<p><strong>Базовое ${impact.mode === "heal" ? "лечение" : "урон"}:</strong> ${Math.abs(baseDamage)}</p>` : ""}

      <hr/>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${baseDamage ? `<button class="order-skill-aoe-apply" data-mode="armor">${impact.mode === "heal" ? "Лечение всем" : "Урон всем с учётом брони"}</button>` : ""}
        ${baseDamage && impact.mode !== "heal" ? `<button class="order-skill-aoe-apply" data-mode="pierce">Урон всем сквозь броню</button>` : ""}
      </div>
    </div>
  `;

  const ctx = {
    casterTokenId: casterToken?.id ?? null,
    casterActorId: casterActor?.id ?? null,
    skillId: skillItem?.id ?? null,
    skillName: skillItem?.name ?? null,
    templateId,
    targetTokenIds: targets.map(tk => tk.id),
    baseDamage,
    damageMode: impact.mode,
    areaPersistent
  };

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { Order: { [FLAG_AOE]: ctx } }
  });
  return true;
}

/* ----------------------------- UI handlers ----------------------------- */

async function onApplyAoEClick(event) {
  event.preventDefault();

  const mode = event.currentTarget.dataset.mode;
  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return ui.notifications.error("Нет контекста AoE.");

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить урон может GM или владелец использующего.");
  }

  await emitToGM({
    type: "APPLY_SKILL_AOE_DAMAGE",
    messageId,
    mode
  });
}

/* ----------------------------- GM apply ----------------------------- */

async function gmApplyAoEDamage({ messageId, mode }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return;

  if (ctx.damageApplied) return;
  await message.update({ [`flags.${FLAG_SCOPE}.${FLAG_AOE}.damageApplied`]: true });

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const raw = Number(ctx.baseDamage ?? 0) || 0;
  if (!raw) return;

  const isHeal = String(ctx?.damageMode || "damage") === "heal";

  const ids = Array.isArray(ctx.targetTokenIds) ? ctx.targetTokenIds : [];
  const tokens = ids.map(id => canvas.tokens.get(id)).filter(Boolean);

  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;

    if (isHeal) {
      const heal = Math.abs(raw);
      const sys = getSystem(actor);
      const cur = Number(sys?.Health?.value ?? 0) || 0;
      const max = Number(sys?.Health?.max ?? 0) || 0;
      const next = max ? Math.min(max, cur + heal) : (cur + heal);
      await actor.update({ "system.Health.value": next });
      continue;
    }

    const armor = (mode === "armor")
      ? (actor?.items?.contents ?? []).reduce((best, it) => {
        if (!it || it.type !== "Armor") return best;
        const sys = getSystem(it);
        if (!(sys?.isEquiped && sys?.isUsed)) return best;
        const v = Number(sys?.Deffensepotential ?? 0) || 0;
        return Math.max(best, v);
      }, 0)
      : 0;

    const applied = Math.max(0, raw - armor);
    const sys = getSystem(actor);
    const cur = Number(sys?.Health?.value ?? 0) || 0;
    const next = Math.max(0, cur - applied);
    await actor.update({ "system.Health.value": next });
  }

  // удалить шаблон после применения, если не постоянный
  if (!ctx.areaPersistent && ctx.templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [ctx.templateId]);
    } catch (e) {
      console.warn("OrderSkillAoE | Failed to delete template", e);
    }
  }
  const name = ctx.skillName || "Навык";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<p><strong>${escapeHtml(name)}</strong>: применено ${isHeal ? "лечение" : "урон"} всем целям (${tokens.length}). Режим: <strong>${mode}</strong>.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

/**
 * Expiry hook: удаляет persistent AoE templates по Duration.
 * Хранение: flags.Order.skillAoEExpiry = { combatId, expiresAtRound }
 */
export function registerOrderSkillAoEExpiryHooks() {
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isGM) return;
    if (!("round" in changed)) return;

    const combatId = combat.id;
    const round = Number(combat.round ?? 0) || 0;

    const docs = canvas.scene?.templates ?? null;
    const all = docs?.contents ?? [];
    const toDelete = [];

    for (const t of all) {
      const exp = t.getFlag("Order", "skillAoEExpiry");
      if (!exp) continue;
      if (exp.combatId !== combatId) continue;
      const r = Number(exp.expiresAtRound ?? 0) || 0;
      if (r && round >= r) toDelete.push(t.id);
    }

    if (toDelete.length) {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", toDelete);
    }
  });

  Hooks.on("deleteCombat", async () => {
    if (!game.user?.isGM) return;
    // ничего не чистим: templates удалятся вручную или останутся (если так нужно)
  });

  console.log("OrderSkillAoE | Expiry hooks registered");
}
