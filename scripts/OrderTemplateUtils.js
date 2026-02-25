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

const L_SWING_TAG_KEY = "г-образный взмах";
const L_SWING_AOE_SHAPE = "l-swing";

function normalizeTagKeySafe(raw) {
  const fn = game?.OrderTags?.normalize;
  if (typeof fn === "function") return fn(raw);

  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasTag(tags, tagKey) {
  const arr = Array.isArray(tags) ? tags : [];
  const want = normalizeTagKeySafe(tagKey);
  if (!want) return false;
  return arr.some((tag) => normalizeTagKeySafe(tag) === want);
}

function getDirectionQuarter(directionDeg) {
  const d = normalizeDeg(directionDeg);
  return Math.round(d / 90) % 4;
}

function getCellSizePx() {
  return Number(canvas?.dimensions?.size) || 100;
}

function getCellDistanceUnits() {
  return Number(canvas?.dimensions?.distance) || 1;
}

function shouldGridAlignRectTemplate(docOrData) {
  const t = String(docOrData?.t || "").trim().toLowerCase();
  if (t !== "ray") return false;
  return !!docOrData?.flags?.Order?.templatePlacement?.gridAlignedRect;
}

function getGridAlignedRectOrigin(anchor, directionDeg) {
  const ax = Number(anchor?.x) || 0;
  const ay = Number(anchor?.y) || 0;
  const halfCell = getCellSizePx() / 2;
  if (!halfCell) return { x: ax, y: ay };

  const dirRad = (normalizeDeg(directionDeg) * Math.PI) / 180;
  const ux = Math.cos(dirRad);
  const uy = Math.sin(dirRad);

  return {
    x: ax - ux * halfCell,
    y: ay - uy * halfCell
  };
}

function applyTemplateAnchor(previewDoc, anchor) {
  if (!previewDoc) return;

  const ax = Number(anchor?.x) || 0;
  const ay = Number(anchor?.y) || 0;
  if (shouldGridAlignRectTemplate(previewDoc)) {
    const aligned = getGridAlignedRectOrigin(anchor, Number(previewDoc.direction) || 0);
    previewDoc.updateSource({ x: aligned.x, y: aligned.y });
    return;
  }

  previewDoc.updateSource({ x: ax, y: ay });
}

function isLSwingTemplateData(templateData) {
  const customShape = String(templateData?.flags?.Order?.weaponAoETemplate?.customShape || "").trim().toLowerCase();
  return customShape === L_SWING_AOE_SHAPE;
}

function getLSwingCellOffsetsByQuarter(quarter) {
  // Base shape (quarter 0):
  // 1st cell -> 2nd diagonally up-right -> 3rd diagonally down-right.
  // Rotated by 90-degree steps for wheel-based orientation.
  const offsetsByQuarter = [
    [[0, 0], [1, -1], [2, 0]],
    [[0, 0], [-1, -1], [0, -2]],
    [[0, 0], [-1, 1], [-2, 0]],
    [[0, 0], [1, 1], [0, 2]]
  ];
  return offsetsByQuarter[quarter] || offsetsByQuarter[0];
}

function getLSwingCellRects({ x = 0, y = 0, direction = 0 } = {}) {
  const quarter = getDirectionQuarter(direction);
  const cell = getCellSizePx();
  const half = cell / 2;
  const pivotLeft = Number(x || 0) - half;
  const pivotTop = Number(y || 0) - half;
  const offsets = getLSwingCellOffsetsByQuarter(quarter);

  return offsets.map(([ox, oy]) => {
    const left = pivotLeft + ox * cell;
    const top = pivotTop + oy * cell;
    return {
      left,
      top,
      right: left + cell,
      bottom: top + cell
    };
  });
}

function parseHexColor(value, fallback = 0xffffff) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const clean = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  const num = Number.parseInt(clean, 16);
  return Number.isFinite(num) ? num : fallback;
}

export function mapTemplateShape(shape) {
  const s = String(shape || "circle").trim().toLowerCase();
  if (s === "cone") return "cone";
  if (s === "ray") return "ray";
  if (s === "rect") return "ray";
  return "circle";
}

export async function placeTemplateInteractively(templateData) {
  if (isLSwingTemplateData(templateData)) {
    return placeLSwingTemplateInteractively(templateData);
  }

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
  const wheelListenerOptions = { passive: false, capture: true };
  let anchor = {
    x: Number(previewDoc.x) || 0,
    y: Number(previewDoc.y) || 0
  };
  applyTemplateAnchor(previewDoc, anchor);
  previewObj.refresh();

  const cleanup = () => {
    canvas.stage.off("mousemove", onMove);
    canvas.stage.off("mousedown", onMouseDown);
    window.removeEventListener("keydown", onKeyDown);
    canvas.app.view.removeEventListener("wheel", onWheel, wheelListenerOptions);

    try { layer.preview.removeChild(previewObj); } catch {}
    try { previewObj.destroy({ children: true }); } catch {}
    try { priorLayer?.activate?.(); } catch {}
  };

  const onMove = (event) => {
    const pos = event.data.getLocalPosition(canvas.stage);
    const [cx, cy] = canvas.grid.getCenter(pos.x, pos.y);
    anchor = { x: cx, y: cy };
    applyTemplateAnchor(previewDoc, anchor);
    previewObj.refresh();
  };

  const onWheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const delta = event.deltaY < 0 ? 15 : -15;
    const dir = Number(previewDoc.direction ?? 0) || 0;
    previewDoc.updateSource({ direction: (dir + delta + 360) % 360 });
    applyTemplateAnchor(previewDoc, anchor);
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
  canvas.app.view.addEventListener("wheel", onWheel, wheelListenerOptions);

  return promise;
}

async function placeLSwingTemplateInteractively(templateData) {
  if (!canvas?.ready) {
    ui.notifications?.warn?.("Сцена не готова.");
    return null;
  }

  const priorLayer = canvas.activeLayer;
  const layer = canvas.templates;
  const previewDoc = new MeasuredTemplateDocument(templateData, { parent: canvas.scene });
  const previewGraphics = new PIXI.Graphics();
  const wheelListenerOptions = { passive: false, capture: true };

  layer.activate();
  layer.preview.addChild(previewGraphics);

  const drawPreview = () => {
    const colorHex = parseHexColor(previewDoc.fillColor, parseHexColor(game.user?.color, 0xffffff));
    const cell = getCellSizePx();
    const rects = getLSwingCellRects({
      x: Number(previewDoc.x) || 0,
      y: Number(previewDoc.y) || 0,
      direction: Number(previewDoc.direction) || 0
    });

    previewGraphics.clear();
    previewGraphics.lineStyle(2, colorHex, 0.95);
    previewGraphics.beginFill(colorHex, 0.35);
    for (const r of rects) {
      previewGraphics.drawRect(r.left, r.top, cell, cell);
    }
    previewGraphics.endFill();
  };

  let resolve;
  const promise = new Promise((res) => (resolve = res));

  const cleanup = () => {
    canvas.stage.off("mousemove", onMove);
    canvas.stage.off("mousedown", onMouseDown);
    window.removeEventListener("keydown", onKeyDown);
    canvas.app.view.removeEventListener("wheel", onWheel, wheelListenerOptions);

    try { layer.preview.removeChild(previewGraphics); } catch {}
    try { previewGraphics.destroy({ children: true }); } catch {}
    try { priorLayer?.activate?.(); } catch {}
  };

  const onMove = (event) => {
    const pos = event.data.getLocalPosition(canvas.stage);
    const [cx, cy] = canvas.grid.getCenter(pos.x, pos.y);
    previewDoc.updateSource({ x: cx, y: cy });
    drawPreview();
  };

  const onWheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const delta = event.deltaY < 0 ? 90 : -90;
    const dir = Number(previewDoc.direction ?? 0) || 0;
    previewDoc.updateSource({ direction: (dir + delta + 360) % 360 });
    drawPreview();
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

  drawPreview();
  canvas.stage.on("mousemove", onMove);
  canvas.stage.on("mousedown", onMouseDown);
  window.addEventListener("keydown", onKeyDown);
  canvas.app.view.addEventListener("wheel", onWheel, wheelListenerOptions);

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
  const customShape = String(doc.flags?.Order?.weaponAoETemplate?.customShape || "").trim().toLowerCase();
  if (customShape === L_SWING_AOE_SHAPE) {
    return getLSwingTemplateGeometry(doc);
  }

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

  return { t, customShape: "", origin, distancePx, widthPx, angleDeg, directionDeg, ux, uy, px, py };
}

function pointInTemplate(g, x, y) {
  if (g.customShape === L_SWING_AOE_SHAPE) {
    return pointInCellRects(g.cellRects, x, y);
  }

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

function getLSwingTemplateGeometry(doc) {
  const directionDeg = normalizeDeg(Number(doc.direction) || 0);
  const origin = { x: Number(doc.x) || 0, y: Number(doc.y) || 0 };
  const cellRects = getLSwingCellRects({
    x: origin.x,
    y: origin.y,
    direction: directionDeg
  });

  return {
    t: "rect",
    customShape: L_SWING_AOE_SHAPE,
    origin,
    directionDeg,
    cellRects
  };
}

function pointInCellRects(rects, x, y) {
  const list = Array.isArray(rects) ? rects : [];
  for (const r of list) {
    if (!r) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
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
  const rawShape = String(s.AoEShape || "").trim().toLowerCase();
  const normalizedShape = rawShape === "rect" ? "ray" : rawShape;
  const gridAlignedRect = normalizedShape === "ray" && rawShape !== "wall";
  const lswingEnabled = normalizedShape === L_SWING_AOE_SHAPE && hasTag(s.tags, L_SWING_TAG_KEY);
  const size = lswingEnabled
    ? Math.max(getCellDistanceUnits() * 0.5, 0.5)
    : (Number(s.AoESize ?? 0) || 0);
  if (!size) return null;

  const shape = lswingEnabled ? "circle" : mapTemplateShape(normalizedShape);
  const center = attackerToken.center ?? { x: 0, y: 0 };
  const rawWidth = lswingEnabled
    ? Math.max(getCellDistanceUnits(), 0.5)
    : (Number(s.AoEWidth ?? 0) || 0);
  // Foundry validates MeasuredTemplate.width as a strictly positive number.
  const width = Math.max(rawWidth, 0.5);
  const angle = Number(s.AoEAngle ?? 90) || 90;

  return {
    t: shape,
    user: game.user?.id,
    x: center.x,
    y: center.y,
    direction: 0,
    distance: size,
    width,
    angle,
    fillColor: String(s.AoEColor || game.user?.color || "#ffffff"),
    flags: {
      Order: {
        weaponAoETemplate: {
          attackerActorId: attackerToken.actor?.id ?? null,
          attackerTokenId: attackerToken.id ?? null,
          weaponId: weaponItem.id ?? null,
          customShape: lswingEnabled ? L_SWING_AOE_SHAPE : ""
        },
        templatePlacement: {
          gridAlignedRect
        }
      }
    }
  };
}
