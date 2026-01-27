import { applySpellEffects } from "./OrderSpellEffects.js";

const FLAG_SCOPE = "Order";
const FLAG_AOE = "spellAoE";

function aoeDebugEnabled() {
  try { return !!game.settings.get("Order", "aoeDebug"); } catch { return false; }
}

function dbg(...args) {
  if (!aoeDebugEnabled()) return;
  console.log("[OrderSpellAoE]", ...args);
}


export function registerOrderSpellAoEHandlers() {
  $(document)
    .off("click.order-spell-aoe-apply")
    .on("click.order-spell-aoe-apply", ".order-spell-aoe-apply", onApplyAoEClick);

  $(document)
    .off("click.order-spell-aoe-effects")
    .on("click.order-spell-aoe-effects", ".order-spell-aoe-effects", onApplyAoEEffectsClick);

  console.log("OrderSpellAoE | Handlers registered");
}

export function registerOrderSpellAoEBus() {
  Hooks.on("createChatMessage", async (message) => {
    try {
      if (!game.user.isGM) return;
      const bus = message.getFlag("Order", "spellBus");
      if (!bus) return;
      await handleGMRequest(bus.payload);
    } catch (e) {
      console.error("OrderSpellAoE | BUS handler error", e);
    }
  });

  console.log("OrderSpellAoE | BUS listener registered");
}

/**
 * Entry point from OrderSpell.js after successful cast.
 */
export async function startSpellAoEWorkflow({ casterActor, casterToken, spellItem, castRoll }) {
  const s = getSystem(spellItem);
  const delivery = String(s.DeliveryType || "utility");
  if (delivery !== "aoe-template") return;

  if (!canvas?.ready) {
    ui.notifications.warn("Сцена не готова.");
    return;
  }

  const shape = String(s.AreaShape || "circle");
  const size = Number(s.AreaSize ?? 0) || 0;
  if (!size) {
    ui.notifications.warn("У AoE заклинания не задан размер области (AreaSize).");
    return;
  }

  const templateData = buildTemplateDataFromSpell({ casterToken, spellItem });
  const placed = await placeTemplateInteractively(templateData);
  if (!placed) {
    dbg("Template placement canceled.");
    return;
  }

  const docId = placed.id;
  dbg("Template document created:", placed);
  dbg("Template id:", docId);

  const templateObj = await waitForTemplateObject(docId);
  dbg("Template object on canvas:", templateObj);

  if (templateObj) {
    try { templateObj.refresh(); } catch { }
    dbg("TemplateObj props:", {
      x: templateObj.x, y: templateObj.y,
      t: templateObj.document?.t,
      distance: templateObj.document?.distance,
      angle: templateObj.document?.angle,
      width: templateObj.document?.width,
      direction: templateObj.document?.direction,
      hasContains: typeof templateObj.contains === "function",
      hasShape: !!templateObj.shape,
      shapeType: templateObj.shape?.constructor?.name
    });

    try {
      const b = templateObj.getBounds?.();
      dbg("Template bounds:", b);
    } catch (e) {
      dbg("Template bounds error:", e);
    }
  }

  const targets = templateObj ? getTokensInTemplate(templateObj) : [];
  dbg("Targets found:", targets.map(t => ({ id: t.id, name: t.name })));




  const baseDamage = Number(s.Damage ?? 0) || 0;
  const nat20 = isNaturalTwenty(castRoll);

  const targetNames = targets.length
    ? targets.map(t => t.name).join(", ")
    : "—";

  const content = `
    <div class="order-spell-aoe-card">
      <div style="display:flex; gap:8px; align-items:center;">
        <img src="${spellItem?.img ?? ""}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${spellItem?.name ?? "AoE"}</h3>
      </div>

      <p><strong>Кастер:</strong> ${casterToken?.name ?? casterActor.name}</p>
      <p><strong>Шаблон:</strong> ${escapeHtml(shape)} (размер ${size})</p>
      <p><strong>Цели в области:</strong> ${escapeHtml(targetNames)}</p>
      ${baseDamage ? `<p><strong>Базовый урон/лечение:</strong> ${baseDamage}${nat20 ? ` <span style="color:#c00;font-weight:700;">[КРИТ ×2]</span>` : ""}</p>` : ""}

      <hr/>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${baseDamage ? `<button class="order-spell-aoe-apply" data-mode="armor">Урон всем с учётом брони</button>` : ""}
        ${baseDamage ? `<button class="order-spell-aoe-apply" data-mode="pierce">Урон всем сквозь броню</button>` : ""}
        <button class="order-spell-aoe-effects">Эффекты всем</button>
      </div>
    </div>
  `;

  const areaPersistent = !!s.AreaPersistent;

  const ctx = {
    casterTokenId: casterToken?.id ?? null,
    casterActorId: casterActor?.id ?? null,
    spellId: spellItem?.id ?? null,
    templateId: docId,
    targetTokenIds: targets.map(t => t.id),

    baseDamage,
    areaPersistent,
    nat20
  };

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { Order: { [FLAG_AOE]: ctx } }
  });
}

/* -------------------------------- UI -------------------------------- */

async function onApplyAoEClick(event) {
  event.preventDefault();

  const mode = event.currentTarget.dataset.mode; // armor | pierce
  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return ui.notifications.error("Нет контекста AoE.");

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить урон может GM или владелец кастера.");
  }

  await emitToGM({
    type: "APPLY_SPELL_AOE_DAMAGE",
    messageId,
    mode
  });
}

async function onApplyAoEEffectsClick(event) {
  event.preventDefault();

  const messageId = event.currentTarget.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return;

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return ui.notifications.error("Нет контекста AoE.");

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!(game.user.isGM || casterActor?.isOwner)) {
    return ui.notifications.warn("Применить эффекты может GM или владелец кастера.");
  }

  await emitToGM({
    type: "APPLY_SPELL_AOE_EFFECTS",
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
    content: `<p>Spell bus: ${payload.type}</p>`,
    whisper: gmIds,
    flags: { Order: { spellBus: { payload } } }
  });
}

async function handleGMRequest(payload) {
  const type = payload?.type;
  if (!type) return;

  if (type === "APPLY_SPELL_AOE_DAMAGE") return gmApplyAoEDamage(payload);
  if (type === "APPLY_SPELL_AOE_EFFECTS") return gmApplyAoEEffects(payload);
}

async function gmApplyAoEDamage({ messageId, mode }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return;

  if (ctx.damageApplied) return;
  await message.update({ [`flags.${FLAG_SCOPE}.${FLAG_AOE}.damageApplied`]: true });

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const spellItem = casterActor.items.get(ctx.spellId);
  if (!spellItem) return ui.notifications.warn("Заклинание не найдено у кастера.");

  const raw = Number(ctx.baseDamage ?? 0) || 0;
  if (!raw) return;

  const critMult = ctx.nat20 ? 2 : 1;
  const isHeal = raw < 0;

  const ids = Array.isArray(ctx.targetTokenIds) ? ctx.targetTokenIds : [];
  const tokens = ids.map(id => canvas.tokens.get(id)).filter(Boolean);

  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;

    if (isHeal) {
      const heal = Math.abs(raw) * critMult;
      await applyHeal(actor, heal);
      continue;
    }

    const damageBase = raw * critMult;
    const armor = (mode === "armor") ? getArmorValueFromItems(actor) : 0;
    const applied = Math.max(0, damageBase - armor);
    await applyDamage(actor, applied);
  }
  // удалить шаблон после применения, если не постоянный
  if (!ctx.areaPersistent && ctx.templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [ctx.templateId]);
    } catch (e) {
      console.warn("OrderSpellAoE | Failed to delete template", e);
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<p><strong>${spellItem.name}</strong>: применено ${isHeal ? "лечение" : "урон"} всем целям (${tokens.length}). Режим: <strong>${mode}</strong>${ctx.nat20 ? " (КРИТ ×2)" : ""}.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

async function gmApplyAoEEffects({ messageId }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return;

  if (ctx.effectsApplied) return;
  await message.update({ [`flags.${FLAG_SCOPE}.${FLAG_AOE}.effectsApplied`]: true });

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const spellItem = casterActor.items.get(ctx.spellId);
  if (!spellItem) return ui.notifications.warn("Заклинание не найдено у кастера.");

  const ids = Array.isArray(ctx.targetTokenIds) ? ctx.targetTokenIds : [];
  const tokens = ids.map(id => canvas.tokens.get(id)).filter(Boolean);

  for (const token of tokens) {
    const actor = token.actor;
    if (!actor) continue;
    await applySpellEffects({ casterActor, targetActor: actor, spellItem, attackTotal: 0 });
  }

  if (!ctx.areaPersistent && ctx.templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [ctx.templateId]);
    } catch (e) {
      console.warn("OrderSpellAoE | Failed to delete template", e);
    }
  }


  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<p><strong>${spellItem.name}</strong>: применены эффекты всем целям (${tokens.length}).</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

/* ----------------------------- Template placement ----------------------------- */

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
    fillColor: game.user.color,
    flags: {
      Order: {
        fromSpell: spellItem.id
      }
    }
  };
}

function mapShape(shape) {
  // Foundry template types: circle, cone, ray, rect
  if (shape === "circle") return "circle";
  if (shape === "cone") return "cone";
  if (shape === "ray") return "ray";
  if (shape === "rect") return "rect";
  // wall пока трактуем как ray (дальше выделим отдельный workflow стен)
  if (shape === "wall") return "ray";
  return "circle";
}

async function placeTemplateInteractively(templateData) {
  // Запоминаем активный слой, чтобы вернуть управление
  const priorLayer = canvas.activeLayer;

  // Preview document/object
  const previewDoc = new MeasuredTemplateDocument(templateData, { parent: canvas.scene });
  const previewObj = new MeasuredTemplate(previewDoc);
  await previewObj.draw();

  // В Foundry v11 preview-контейнер у layer = canvas.templates.preview
  const layer = canvas.templates;
  layer.activate();
  layer.preview.addChild(previewObj);
  previewObj.alpha = 0.6;

  let resolve;
  const promise = new Promise((res) => (resolve = res));

  const cleanup = () => {
    // снять листенеры
    canvas.stage.off("mousemove", onMove);
    canvas.stage.off("mousedown", onMouseDown);
    window.removeEventListener("keydown", onKeyDown);
    canvas.app.view.removeEventListener("wheel", onWheel);

    // убрать preview с контейнера
    try { layer.preview.removeChild(previewObj); } catch { }
    try { previewObj.destroy({ children: true }); } catch { }

    // вернуть предыдущий слой
    try { priorLayer?.activate?.(); } catch { }
  };

  const onMove = (event) => {
    const pos = event.data.getLocalPosition(canvas.stage);
    // Важно: для MeasuredTemplate в v11 корректнее работать от центра клетки
    const [cx, cy] = canvas.grid.getCenter(pos.x, pos.y);
    previewDoc.updateSource({ x: cx, y: cy });
    previewObj.refresh();

  };

  const onWheel = (event) => {
    // rotate by 15 degrees
    const delta = event.deltaY < 0 ? 15 : -15;
    const dir = Number(previewDoc.direction ?? 0) || 0;
    previewDoc.updateSource({ direction: (dir + delta + 360) % 360 });
    previewObj.refresh();
  };

  const confirm = async (event) => {
    event.stopPropagation();
    cleanup();

    // Создаём документ шаблона на сцене
    const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [previewDoc.toObject()]);
    resolve(created?.[0] ?? null);
  };

  const cancel = (event) => {
    if (event) event.stopPropagation();
    cleanup();
    resolve(null);
  };

  const onMouseDown = (event) => {
    // left click confirm, right click cancel
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


function getTokensInTemplate(templateObj) {
  const doc = templateObj.document;
  if (!doc) return [];

  const geom = getTemplateGeometry(doc);
  dbg("Template geometry (computed):", geom);

  const tokens = canvas.tokens.placeables ?? [];
  const out = [];

  for (const tok of tokens) {
    const points = sampleTokenPoints(tok);

    let hitPoint = null;
    for (const p of points) {
      if (pointInTemplate(geom, p.x, p.y)) {
        hitPoint = p;
        break;
      }
    }

    dbg(`Token check: ${tok.name}`, {
      tokenXY: { x: tok.x, y: tok.y, w: tok.w, h: tok.h },
      center: tok.center,
      hit: !!hitPoint,
      hitPoint
    });

    if (hitPoint) out.push(tok);
  }

  return out;
}




function safeBounds(obj) {
  try {
    // PIXI bounds
    const b = obj.getBounds?.();
    if (b && Number.isFinite(b.x)) return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch { }
  try {
    // some objects expose .bounds already
    const b = obj.bounds;
    if (b && Number.isFinite(b.x)) return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch { }
  return null;
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}



/* ----------------------------- Common helpers ----------------------------- */

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function getItemSystem(item) {
  return item?.system ?? item?.data?.system ?? {};
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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getArmorValueFromItems(actor) {
  const items = actor?.items ?? [];
  const equipped = items.filter(i => {
    if (!i) return false;
    if (i.type !== "Armor") return false;
    const sys = getItemSystem(i);
    return !!(sys?.isEquiped && sys?.isUsed);
  });

  let best = 0;
  for (const a of equipped) {
    const sys = getItemSystem(a);
    const val = Number(sys?.Deffensepotential ?? 0) || 0;
    if (val > best) best = val;
  }
  return best;
}

async function applyDamage(actor, amount) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0);
  const next = Math.max(0, cur - (Number(amount) || 0));
  await actor.update({ "system.Health.value": next });
}

async function applyHeal(actor, amount) {
  const sys = getSystem(actor);
  const cur = Number(sys?.Health?.value ?? 0);
  const max = Number(sys?.Health?.max ?? 0);
  const rawNext = cur + (Number(amount) || 0);
  const next = max > 0 ? Math.min(rawNext, max) : rawNext;
  await actor.update({ "system.Health.value": next });
}

async function waitForTemplateObject(templateId, tries = 20, delayMs = 50) {
  for (let i = 0; i < tries; i++) {
    const obj = canvas.templates.placeables.find(t => t.document?.id === templateId);
    if (obj) return obj;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

function getTemplateGeometry(doc) {
  const t = String(doc.t || "circle");

  // Конвертация "единиц сцены" в пиксели
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

  // перпендикуляр (для ray/rect)
  const px = -uy;
  const py = ux;

  return {
    t,
    origin,
    unitsToPx,
    distanceUnits,
    widthUnits,
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

  // circle
  if (g.t === "circle") {
    const r2 = g.distancePx * g.distancePx;
    return (dx * dx + dy * dy) <= r2;
  }

  // cone
  if (g.t === "cone") {
    const dist2 = dx * dx + dy * dy;
    if (dist2 > g.distancePx * g.distancePx) return false;

    const ang = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
    const delta = deltaAngleDeg(ang, g.directionDeg);
    return delta <= (Number(g.angleDeg) || 90) / 2;
  }

  // ray/rect: считаем как прямоугольник вдоль direction
  // localX вдоль направления, localY поперёк
  const localX = dx * g.ux + dy * g.uy;
  const localY = dx * g.px + dy * g.py;

  const len = g.distancePx;
  const halfW = (g.widthPx || (canvas.dimensions.size)) / 2; // fallback: 1 клетка

  // Foundry ray/rect начинается от origin и идёт вперёд
  return (localX >= 0 && localX <= len && Math.abs(localY) <= halfW);
}

function normalizeDeg(a) {
  let x = Number(a) || 0;
  x = x % 360;
  if (x < 0) x += 360;
  return x;
}

function deltaAngleDeg(a, b) {
  // минимальная разница углов (0..180)
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

function sampleTokenPoints(tok) {
  // Используем реальные пиксельные размеры токена на сцене
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

  // 3x3 сетка точек (устойчиво к касанию)
  return [
    { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x3, y: y1 },
    { x: x1, y: y2 }, { x: x2, y: y2 }, { x: x3, y: y2 },
    { x: x1, y: y3 }, { x: x2, y: y3 }, { x: x3, y: y3 }
  ];
}
