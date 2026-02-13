/**
 * OrderTemplateUtils.js
 * Foundry v11.
 * Интерактивная постановка шаблона и выбор токенов внутри шаблона.
 */

function dbg(...args) {
  try {
    if (!game.settings.get("Order", "aoeDebug")) return;
  } catch {
    return;
  }
  console.log("[Order][TemplateUtils]", ...args);
}

export function mapTemplateShape(shape) {
  const s = String(shape || "circle").trim().toLowerCase();
  if (s === "cone") return "cone";
  if (s === "ray") return "ray";
  if (s === "rect") return "rect";
  return "circle";
}

export async function placeTemplateInteractively(templateData) {
  if (!canvas?.ready) {
    ui.notifications?.warn?.("Сцена не готова.");
    return null;
  }

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

    try { layer.preview.removeChild(previewObj); } catch {}
    try { previewObj.destroy({ children: true }); } catch {}
    try { priorLayer?.activate?.(); } catch {}
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
    event?.stopPropagation?.();
    cleanup();

    const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [previewDoc.toObject()]);
    resolve(created?.[0] ?? null);
  };

  const cancel = (event) => {
    event?.stopPropagation?.();
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

export async function waitForTemplateObject(docId) {
  for (let i = 0; i < 20; i++) {
    const obj = canvas.templates?.placeables?.find((t) => t.document?.id === docId);
    if (obj) return obj;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

export function getTokensInTemplate(templateObj, { excludeTokenIds = [] } = {}) {
  const doc = templateObj?.document;
  if (!doc) return [];

  const excluded = new Set((excludeTokenIds || []).map(String));
  const geom = getTemplateGeometry(doc);

  const tokens = canvas.tokens?.placeables ?? [];
  const out = [];

  for (const tok of tokens) {
    if (excluded.has(String(tok?.id))) continue;

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

  dbg("getTokensInTemplate", { templateId: doc.id, type: doc.t, found: out.map((t) => t.name) });
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

  return { t, origin, distancePx, widthPx, angleDeg, directionDeg, ux, uy, px, py };
}

function pointInTemplate(g, x, y) {
  const dx = x - g.origin.x;
  const dy = y - g.origin.y;

  if (g.t === "circle") {
    const r2 = g.distancePx * g.distancePx;
    return dx * dx + dy * dy <= r2;
  }

  if (g.t === "cone") {
    const dist2 = dx * dx + dy * dy;
    if (dist2 > g.distancePx * g.distancePx) return false;

    const ang = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
    const delta = deltaAngleDeg(ang, g.directionDeg);
    return delta <= (Number(g.angleDeg) || 90) / 2;
  }

  // ray/rect -> local coords
  const localX = dx * g.ux + dy * g.uy;
  const localY = dx * g.px + dy * g.py;

  const len = g.distancePx;
  const halfW = (g.widthPx || canvas.dimensions.size) / 2;

  return localX >= 0 && localX <= len && Math.abs(localY) <= halfW;
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

export function buildWeaponAoETemplateData({ weaponItem, attackerToken } = {}) {
  if (!weaponItem || !attackerToken) return null;

  const s = weaponItem.system ?? weaponItem.data?.system ?? {};
  const size = Number(s.AoESize ?? 0) || 0;
  if (!size) return null;

  const shape = mapTemplateShape(s.AoEShape);
  const center = attackerToken.center ?? { x: 0, y: 0 };

  return {
    t: shape,
    user: game.user?.id,
    x: center.x,
    y: center.y,
    direction: 0,
    distance: size,
    width: Number(s.AoEWidth ?? 0) || 0,
    angle: Number(s.AoEAngle ?? 90) || 90,
    fillColor: String(s.AoEColor || game.user?.color || "#ffffff"),
    flags: {
      Order: {
        weaponAoETemplate: {
          attackerActorId: attackerToken.actor?.id ?? null,
          attackerTokenId: attackerToken.id ?? null,
          weaponId: weaponItem.id ?? null
        }
      }
    }
  };
}