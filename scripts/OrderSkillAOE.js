import { castDefensiveSpellDefense, getDefensiveReactionSpells } from "./OrderSpellDefenseReaction.js";
import { rollDefensiveSkillDefense, getDefensiveReactionSkills } from "./OrderSkillDefenseReaction.js";
import { pickTargetsDialog } from "./OrderMultiTargetPicker.js";
import { getDefenseD20Formula, promptDefenseRollSetup } from "./OrderDefenseRollDialog.js";
import { buildConfiguredEffectsListHtml } from "./OrderSpellEffects.js";

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
    .replace(/>/g, "&gt;");
}

function showHealthChangeText(token, amount, { isHeal = false } = {}) {
  const value = Math.max(0, Number(amount) || 0);
  if (!value) return;
  if (!token?.center || typeof canvas?.interface?.createScrollingText !== "function") return;

  canvas.interface.createScrollingText(token.center, `${isHeal ? "+" : "-"}${value}`, {
    fontSize: 32,
    fill: isHeal ? "#00aa00" : "#ff0000",
    stroke: "#000000",
    strokeThickness: 4,
    jitter: 0.5
  });
}

function mapShape(shape) {
  const s = String(shape || "circle");
  if (s === "cone") return "cone";
  if (s === "ray") return "ray";
  return "circle";
}

function normalizeAoEShape(shape) {
  const s = String(shape || "").trim().toLowerCase();
  if (s === "circle") return "circle";
  if (s === "cone") return "cone";
  // Legacy AoE shapes are normalized to ray.
  if (s === "ray" || s === "rect" || s === "wall") return "ray";
  return "circle";
}

function getAoEShapeLabel(shape) {
  if (shape === "circle") return "\u041a\u0440\u0443\u0433";
  if (shape === "cone") return "\u041a\u043e\u043d\u0443\u0441";
  if (shape === "ray") return "\u041f\u0440\u044f\u043c\u043e\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a";
  return shape;
}

function parseDurationRounds(durationValue) {
  const s = String(durationValue ?? "").trim().toLowerCase();
  if (!s) return 0;

  // "3 rounds", "3 раунда", "3"
  const m = s.match(/(\d+)/);
  if (!m) return 0;
  return Number(m[1]) || 0;
}

function shouldGridAlignRectTemplate(docOrData) {
  const t = String(docOrData?.t || "").trim().toLowerCase();
  if (t !== "ray") return false;
  return !!docOrData?.flags?.Order?.templatePlacement?.gridAlignedRect;
}

function getGridAlignedRectOrigin(anchor, directionDeg) {
  const ax = Number(anchor?.x) || 0;
  const ay = Number(anchor?.y) || 0;
  const halfCell = (Number(canvas?.dimensions?.size) || 0) / 2;
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

    try { layer.preview.removeChild(previewObj); } catch { }
    try { previewObj.destroy({ children: true }); } catch { }
    try { priorLayer?.activate?.(); } catch { }
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
  canvas.app.view.addEventListener("wheel", onWheel, wheelListenerOptions);

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
    .off("click.order-skill-aoe-defense")
    .on("click.order-skill-aoe-defense", ".order-skill-aoe-defense", onSkillAoEDefenseClick);

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

  if (type === "RESOLVE_SKILL_AOE_DEFENSE") return gmResolveSkillAoEDefense(payload);
  if (type === "APPLY_SKILL_AOE_DAMAGE") return gmApplyAoEDamage(payload);
}

/* ----------------------------- Entry point ----------------------------- */

export async function startSkillAoEWorkflow({
  casterActor,
  casterToken,
  skillItem,
  impactRoll = null,
  rollSnapshot = null,
  rollMode = "normal",
  manualMod = 0,
  rollFormulaRaw = "",
  rollFormulaValue = 0,
  externalRollMod = 0,
  pipelineMode = false,
  pipelineContinuation = null
}) {
  const s = getSystem(skillItem);
  const delivery = String(s.DeliveryType || "utility").trim().toLowerCase();
  if (!pipelineMode && delivery !== "aoe-template") return false;

  if (!canvas?.ready) {
    ui.notifications.warn("Сцена не готова.");
    return false;
  }

  const shape = normalizeAoEShape(String(s.AreaShape || "circle"));
  const shapeLabel = getAoEShapeLabel(shape);
  const size = Number(s.AreaSize ?? 0) || 0;
  if (!size) {
    ui.notifications.warn("У AoE навыка не задан размер области (AreaSize).");
    return false;
  }

  const t = mapShape(shape);
  const center = casterToken?.center ?? { x: 0, y: 0 };
  const rawShape = String(s.AreaShape || "circle").trim().toLowerCase();
  const gridAlignedRect = shape === "ray" && rawShape !== "wall";

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
        },
        templatePlacement: {
          gridAlignedRect
        }
      }
    }
  };

  const placed = await placeTemplateInteractively(templateData);
  if (!placed) return false;

  const templateId = placed.id;
  const templateObj = await waitForTemplateObject(templateId);
  const targetsInTemplate = templateObj ? getTokensInTemplate(templateObj) : [];
  const pickedTargetIds = await pickTargetsDialog({
    title: "Цели навыка",
    initialTokens: targetsInTemplate,
    allowAddTargets: true
  });
  const targets = (Array.isArray(pickedTargetIds) ? pickedTargetIds : [])
    .map((id) => canvas.tokens.get(String(id)))
    .filter((t) => !!t);

  const impact = getBaseImpactFromSystem(s);
  let baseDamage = impact.signed;
  const perkSkillDmg = Number(casterActor?.system?._perkBonuses?.SkillDamage ?? 0) || 0;
  if (impact.mode === "damage" && perkSkillDmg) baseDamage += perkSkillDmg;

  const isHeal = impact.mode === "heal";
  const requiresDefense = !isHeal;
  const areaPersistent = !!s.AreaPersistent;

  const impactTotal = Number(impactRoll?.total ?? rollSnapshot?.total ?? 0) || 0;
  const nat20 = impactRoll ? isNaturalTwenty(impactRoll) : !!rollSnapshot?.nat20;
  const impactRollHTML = impactRoll ? await impactRoll.render() : String(rollSnapshot?.html ?? "");
  const formulaLine = rollFormulaRaw
    ? `<p><strong>Формула броска:</strong> ${escapeHtml(rollFormulaRaw)} = ${Number(rollFormulaValue ?? 0) || 0}</p>`
    : "";

  const durationRounds = areaPersistent ? parseDurationRounds(s.Duration) : 0;
  const combatId = game.combat?.id ?? null;
  const currentRound = Number(game.combat?.round ?? 0) || 0;
  const expiresAtRound = (areaPersistent && durationRounds > 0 && combatId)
    ? (currentRound + durationRounds)
    : 0;

  if (areaPersistent && expiresAtRound && game.user.isGM) {
    await canvas.scene.updateEmbeddedDocuments("MeasuredTemplate", [{
      _id: templateId,
      "flags.Order.skillAoEExpiry": { combatId, expiresAtRound }
    }]);
  }

  const targetsCtx = targets
    .map((token) => {
      const actor = token?.actor ?? null;
      return {
        tokenId: token?.id ?? null,
        tokenName: token?.name ?? actor?.name ?? "—",
        tokenImg: token?.document?.texture?.src ?? actor?.img ?? "",
        actorId: actor?.id ?? null,
        shieldInHand: actor ? actorHasEquippedWeaponTag(actor, "shield") : false
      };
    })
    .filter((tgt) => !!tgt.tokenId);

  const perTarget = {};
  for (const target of targetsCtx) {
    perTarget[String(target.tokenId)] = {
      state: requiresDefense ? "awaitingDefense" : "resolved",
      defenseType: null,
      defenseTotal: null,
      hit: requiresDefense ? null : true
    };
  }

  const ctx = {
    casterTokenId: casterToken?.id ?? null,
    casterActorId: casterActor?.id ?? null,
    skillId: skillItem?.id ?? null,
    skillName: skillItem?.name ?? null,
    skillImg: skillItem?.img ?? "",
    templateId,
    shapeLabel,
    areaSize: size,

    attackTotal: impactTotal,
    impactTotal,
    nat20,
    rollMode: String(rollMode || "normal"),
    manualMod: Number(manualMod ?? 0) || 0,
    rollFormulaRaw: String(rollFormulaRaw || ""),
    rollFormulaValue: Number(rollFormulaValue ?? 0) || 0,
    externalRollMod: Number(externalRollMod ?? 0) || 0,
    rollHTML: impactRollHTML,
    formulaLine,

    requiresDefense,
    targetTokenIds: targetsCtx.map((tgt) => tgt.tokenId),
    targets: targetsCtx,
    perTarget,

    baseDamage,
    damageMode: impact.mode,
    damageApplied: false,
    areaPersistent
  };

  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<div class="order-aoe-loading">Создаем AoE навык…</div>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      Order: {
        [FLAG_AOE]: ctx,
        ...(pipelineContinuation ? { pipelineContinuation } : {})
      }
    }
  });

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;

  await message.update({
    content: renderSkillAoEContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_AOE}`]: ctx2
  });

  return true;
}

/* ----------------------------- UI handlers ----------------------------- */

function renderSkillAoEResultCell(entry, { requiresDefense = true } = {}) {
  if (!requiresDefense) {
    return `<span class="order-aoe-result order-aoe-result--hit">Авто</span>`;
  }

  if (!entry || entry.state !== "resolved") {
    return `<span class="order-aoe-result order-aoe-result--pending">—</span>`;
  }

  const val = Number(entry.defenseTotal ?? 0) || 0;
  const miss = entry.hit === false;
  const cls = miss ? "order-aoe-result--miss" : "order-aoe-result--hit";
  const title = escapeHtml(formatDefenseEntryTitle(entry));
  return `<span class="order-aoe-result ${cls}" title="${title}">${val}</span>`;
}

function renderSkillAoEDefenseButtons({ tokenId, disabled = false, canBlock = false } = {}) {
  const dis = disabled ? "disabled" : "";
  const base = `class="order-skill-aoe-defense order-aoe-btn" data-defender-token-id="${tokenId}"`;

  return `
    <div class="order-aoe-actions">
      <button ${base} data-defense="dodge" title="Уворот (Dexterity)" ${dis}><i class="fas fa-person-running"></i></button>
      ${canBlock ? `<button ${base} data-defense="block-strength" title="Блок (Strength)" ${dis}><i class="fas fa-shield-halved"></i></button>` : ``}
      ${canBlock ? `<button ${base} data-defense="block-stamina" title="Блок (Stamina)" ${dis}><i class="fas fa-shield"></i></button>` : ``}
      <button ${base} data-defense="spell" title="Защита заклинанием" ${dis}><i class="fas fa-wand-magic-sparkles"></i></button>
      <button ${base} data-defense="skill" title="Защита навыком" ${dis}><i class="fas fa-hand-fist"></i></button>
    </div>
  `;
}

function renderSkillAoEContent(ctx) {
  const skillImg = ctx.skillImg ?? "";
  const skillName = ctx.skillName ?? "AoE";
  const attackTotal = Number(ctx.attackTotal ?? 0) || 0;
  const baseDamage = Number(ctx.baseDamage ?? 0) || 0;
  const isHeal = String(ctx.damageMode || "damage") === "heal";
  const nat20 = !!ctx.nat20;
  const rollHTML = String(ctx.rollHTML ?? "");
  const formulaLine = String(ctx.formulaLine ?? "");
  const requiresDefense = !!ctx.requiresDefense;
  const damageApplied = !!ctx.damageApplied;
  const configuredEffectsHtml = buildConfiguredEffectsListHtml(resolveSkillItemFromCtx(ctx), { title: "Эффекты навыка" });

  const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
  const perTarget = (ctx.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};

  const rows = targets.map((t) => {
    const tokenId = String(t.tokenId);
    const entry = perTarget[tokenId] || {};
    const defenseDisabled = !requiresDefense || String(entry.state) === "resolved";

    return `
      <div class="order-aoe-row" data-token-id="${tokenId}">
        <div class="order-aoe-left">
          <img class="order-aoe-portrait" src="${t.tokenImg ?? ""}" />
          <span class="order-aoe-name">${escapeHtml(t.tokenName ?? "—")}</span>
        </div>
        <div class="order-aoe-right">
          ${renderSkillAoEResultCell(entry, { requiresDefense })}
          ${requiresDefense ? renderSkillAoEDefenseButtons({ tokenId, disabled: defenseDisabled, canBlock: !!t.shieldInHand }) : ""}
        </div>
      </div>
    `;
  }).join("");

  const unresolved = requiresDefense ? getUnresolvedDefenseCount(ctx) : 0;

  return `
    <div class="chat-attack-message order-ranged order-aoe" data-order-skill-aoe="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${skillImg}" alt="${escapeHtml(skillName)}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${escapeHtml(skillName)}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Использующий:</strong> ${escapeHtml(resolveCasterName(ctx))}</p>
        <p><strong>Шаблон:</strong> ${escapeHtml(ctx.shapeLabel || "—")} (${Number(ctx.areaSize ?? 0) || 0})</p>
        <p><strong>Результат броска воздействия:</strong> ${attackTotal}${nat20 ? ` <span style="color:#c00; font-weight:700;">[КРИТ]</span>` : ""}</p>
        ${baseDamage ? `<p><strong>Базовое ${isHeal ? "лечение" : "урон"}:</strong> ${Math.abs(baseDamage)}</p>` : ""}
        ${configuredEffectsHtml}
        ${formulaLine}
        <div class="inline-roll">${rollHTML}</div>
      </div>

      <hr/>
      ${requiresDefense ? `<p><strong>Статус защит:</strong> ${unresolved ? `ожидаются (${unresolved})` : "завершены"}</p>` : `<p><strong>Статус защит:</strong> не требуется (лечение)</p>`}
      ${ctx.areaPersistent ? `<p><strong>Постоянная область:</strong> да</p>` : `<p><strong>Постоянная область:</strong> нет</p>`}

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${baseDamage ? `<button class="order-skill-aoe-apply" data-mode="armor" ${damageApplied ? "disabled" : ""}>${isHeal ? "Лечение по области" : "Урон по попавшим"}</button>` : ""}
        ${baseDamage && !isHeal ? `<button class="order-skill-aoe-apply" data-mode="pierce" ${damageApplied ? "disabled" : ""}>Урон по попавшим сквозь броню</button>` : ""}
      </div>

      <hr/>

      <div class="order-aoe-targets">
        <div class="order-aoe-head">
          <span>Цель</span>
          <span class="order-aoe-head-right">Защита</span>
        </div>
        ${rows || `<div class="order-aoe-empty">Нет целей</div>`}
      </div>
    </div>
  `;
}

async function onSkillAoEDefenseClick(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const messageId = button.closest?.(".message")?.dataset?.messageId;
  if (!messageId) return ui.notifications.error("Не удалось определить сообщение AoE.");

  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return ui.notifications.error("Нет контекста AoE.");
  if (!ctx.requiresDefense) return ui.notifications.warn("Для этого AoE защита не требуется.");

  const defenderTokenId = String(button.dataset.defenderTokenId || "");
  if (!defenderTokenId) return ui.notifications.error("Не удалось определить цель защиты.");

  const entry = ctx?.perTarget?.[defenderTokenId];
  if (!entry) return ui.notifications.warn("Эта цель не входит в область.");
  if (String(entry.state) !== "awaitingDefense") return ui.notifications.warn("Для этой цели защита уже выбрана.");

  const defenderToken = canvas.tokens.get(defenderTokenId);
  const defenderActor = defenderToken?.actor ?? getTargetActorFromCtx(ctx, defenderTokenId);
  if (!defenderActor) return ui.notifications.error("Не найден актер цели.");

  if (!(game.user.isGM || defenderActor.isOwner)) {
    return ui.notifications.warn("Защиту может выбрать только владелец цели (или GM).");
  }

  const defenseType = String(button.dataset.defense || "");

  if (defenseType === "spell") {
    const spellItem = await promptPickDefensiveSpell(defenderActor);
    if (!spellItem) return;

    const res = await castDefensiveSpellDefense({
      actor: defenderActor,
      token: defenderToken,
      spellItem,
      silent: true
    });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_SKILL_AOE_DEFENSE",
      messageId,
      defenderTokenId,
      defenseType: "spell",
      defenseTotal: res.defenseTotal,
      defenseSpellId: res.spellId,
      defenseSpellName: res.spellName,
      defenseCastFailed: res.castFailed,
      defenseCastTotal: res.castTotal
    });
    return;
  }

  if (defenseType === "skill") {
    const skillItem = await promptPickDefensiveSkill(defenderActor);
    if (!skillItem) return;

    const res = await rollDefensiveSkillDefense({
      actor: defenderActor,
      token: defenderToken,
      skillItem,
      scene: "Навыки",
      toMessage: false
    });
    if (!res) return;

    await emitToGM({
      type: "RESOLVE_SKILL_AOE_DEFENSE",
      messageId,
      defenderTokenId,
      defenseType: "skill",
      defenseTotal: res.defenseTotal,
      defenseSkillId: res.skillId,
      defenseSkillName: res.skillName
    });
    return;
  }

  let defenseAttr = null;
  if (defenseType === "dodge") defenseAttr = "Dexterity";
  if (defenseType === "block-strength") defenseAttr = "Strength";
  if (defenseType === "block-stamina") defenseAttr = "Stamina";
  if (!defenseAttr) return;

  if (defenseType === "block-strength" || defenseType === "block-stamina") {
    const hasShield = actorHasEquippedWeaponTag(defenderActor, "shield");
    if (!hasShield) {
      return ui.notifications.warn("Блок доступен только при экипированном щите (tag: shield).");
    }
  }

  const defenseLabel =
    defenseType === "dodge" ? "Уворот (Dexterity)" :
    defenseType === "block-strength" ? "Блок (Strength)" :
    "Блок (Stamina)";
  const defenseSetup = await promptDefenseRollSetup({
    title: `Защитный бросок: ${defenseLabel}`
  });
  if (!defenseSetup) return;

  const defenseRoll = await rollActorCharacteristic(defenderActor, defenseAttr, {
    rollMode: defenseSetup.rollMode,
    manualModifier: defenseSetup.manualModifier
  });

  await emitToGM({
    type: "RESOLVE_SKILL_AOE_DEFENSE",
    messageId,
    defenderTokenId,
    defenseType,
    defenseTotal: Number(defenseRoll?.total ?? 0) || 0
  });
}

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
  if (ctx.requiresDefense && getUnresolvedDefenseCount(ctx) > 0) {
    return ui.notifications.warn("Сначала завершите все броски защиты по целям.");
  }

  await emitToGM({
    type: "APPLY_SKILL_AOE_DAMAGE",
    messageId,
    mode
  });
}

/* ----------------------------- GM apply ----------------------------- */

async function gmResolveSkillAoEDefense({
  messageId,
  defenderTokenId,
  defenseType,
  defenseTotal,
  defenseSpellId,
  defenseSpellName,
  defenseCastFailed,
  defenseCastTotal,
  defenseSkillId,
  defenseSkillName
}) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!message || !ctx || !ctx.requiresDefense) return;

  const tid = String(defenderTokenId || "");
  if (!tid) return;

  const entry = ctx?.perTarget?.[tid];
  if (!entry) return;
  if (String(entry.state) === "resolved") return;

  const attackTotal = Number(ctx.attackTotal ?? ctx.impactTotal ?? 0) || 0;
  const def = Number(defenseTotal ?? 0) || 0;
  const hit = attackTotal >= def;

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.perTarget = {
    ...(ctx2.perTarget || {}),
    [tid]: {
      ...entry,
      state: "resolved",
      defenseType: String(defenseType || ""),
      defenseTotal: def,
      hit,
      defenseSpellId: defenseType === "spell" ? (defenseSpellId || null) : null,
      defenseSpellName: defenseType === "spell" ? (defenseSpellName || null) : null,
      defenseCastFailed: defenseType === "spell" ? !!defenseCastFailed : null,
      defenseCastTotal: defenseType === "spell" ? (Number(defenseCastTotal ?? 0) || 0) : null,
      defenseSkillId: defenseType === "skill" ? (defenseSkillId || null) : null,
      defenseSkillName: defenseType === "skill" ? (defenseSkillName || null) : null
    }
  };

  await message.update({
    content: renderSkillAoEContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_AOE}`]: ctx2
  });
}

async function gmApplyAoEDamage({ messageId, mode }) {
  const message = game.messages.get(messageId);
  const ctx = message?.getFlag(FLAG_SCOPE, FLAG_AOE);
  if (!ctx) return;
  if (ctx.damageApplied) return;
  if (ctx.requiresDefense && getUnresolvedDefenseCount(ctx) > 0) {
    ui.notifications.warn("Нельзя применить урон: не все цели выбрали защиту.");
    return;
  }

  const casterToken = canvas.tokens.get(ctx.casterTokenId);
  const casterActor = casterToken?.actor ?? game.actors.get(ctx.casterActorId);
  if (!casterActor) return;

  const raw = Number(ctx.baseDamage ?? 0) || 0;
  if (!raw) return;

  const isHeal = String(ctx?.damageMode || "damage") === "heal";
  const tokens = getAffectedTargetTokens(ctx);

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
      showHealthChangeText(token, Math.max(0, next - cur), { isHeal: true });
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
    showHealthChangeText(token, applied, { isHeal: false });
  }

  if (!ctx.areaPersistent && ctx.templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [ctx.templateId]);
    } catch (e) {
      console.warn("OrderSkillAoE | Failed to delete template", e);
    }
  }

  const ctx2 = foundry.utils.duplicate(ctx);
  ctx2.messageId = message.id;
  ctx2.damageApplied = true;
  await message.update({
    content: renderSkillAoEContent(ctx2),
    [`flags.${FLAG_SCOPE}.${FLAG_AOE}`]: ctx2
  });

  const name = ctx.skillName || "Навык";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
    content: `<p><strong>${escapeHtml(name)}</strong>: применено ${isHeal ? "лечение" : "урон"} по целям (${tokens.length}). Режим: <strong>${mode}</strong>.</p>`,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}

/* ----------------------------- Helpers ----------------------------- */

function resolveCasterName(ctx) {
  const casterToken = ctx?.casterTokenId ? canvas.tokens.get(ctx.casterTokenId) : null;
  const casterActor = casterToken?.actor ?? (ctx?.casterActorId ? game.actors.get(ctx.casterActorId) : null);
  return casterToken?.name ?? casterActor?.name ?? "—";
}

function resolveSkillItemFromCtx(ctx) {
  const casterToken = ctx?.casterTokenId ? canvas.tokens.get(ctx.casterTokenId) : null;
  const casterActor = casterToken?.actor ?? (ctx?.casterActorId ? game.actors.get(ctx.casterActorId) : null);
  const skillId = String(ctx?.skillId ?? "");
  if (!casterActor || !skillId) return null;
  return casterActor.items?.get?.(skillId) ?? null;
}

function getTargetActorFromCtx(ctx, tokenId) {
  const actorId = ctx?.targets?.find((t) => String(t.tokenId) === String(tokenId))?.actorId;
  return actorId ? game.actors.get(actorId) : null;
}

function getUnresolvedDefenseCount(ctx) {
  if (!ctx?.requiresDefense) return 0;
  const perTarget = (ctx?.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};
  return Object.values(perTarget).filter((entry) => String(entry?.state) !== "resolved").length;
}

function formatDefenseEntryTitle(entry) {
  const kind = String(entry?.defenseType || "");
  if (kind === "spell") {
    const name = entry?.defenseSpellName || "заклинание";
    const castInfo = entry?.defenseCastTotal != null ? `, каст: ${entry.defenseCastTotal}` : "";
    return `Защита: ${name}${castInfo}`;
  }
  if (kind === "skill") return `Защита: ${entry?.defenseSkillName || "навык"}`;
  if (kind === "dodge") return "Защита: уворот";
  if (kind === "block-strength") return "Защита: блок (Strength)";
  if (kind === "block-stamina") return "Защита: блок (Stamina)";
  return "Защита";
}

function getAffectedTargetTokens(ctx) {
  const ids = Array.isArray(ctx?.targetTokenIds) ? ctx.targetTokenIds.map((x) => String(x)) : [];
  if (!ids.length) return [];

  if (!ctx?.requiresDefense) {
    return ids.map((id) => canvas.tokens.get(id)).filter(Boolean);
  }

  const perTarget = (ctx?.perTarget && typeof ctx.perTarget === "object") ? ctx.perTarget : {};
  const hitIds = ids.filter((id) => perTarget[id]?.hit === true);
  return hitIds.map((id) => canvas.tokens.get(id)).filter(Boolean);
}

async function promptPickItem({ title, items = [], emptyWarning = "Нет доступных вариантов." } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    ui.notifications.warn(emptyWarning);
    return null;
  }
  if (list.length === 1) return list[0];

  const options = list.map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("");

  return await new Promise((resolve) => {
    new Dialog({
      title,
      content: `<div class="form-group"><select id="pick-item" style="width:100%;">${options}</select></div>`,
      buttons: {
        ok: { label: "OK", callback: (html) => resolve(list.find((x) => x.id === html.find("#pick-item").val()) || null) },
        cancel: { label: "Отмена", callback: () => resolve(null) }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

async function promptPickDefensiveSpell(actor) {
  const spells = getDefensiveReactionSpells(actor);
  return promptPickItem({
    title: "Выбор защитного заклинания",
    items: spells,
    emptyWarning: "У персонажа нет защитных заклинаний (defensive-reaction)."
  });
}

async function promptPickDefensiveSkill(actor) {
  const skills = getDefensiveReactionSkills(actor);
  return promptPickItem({
    title: "Выбор защитного навыка",
    items: skills,
    emptyWarning: "У персонажа нет защитных навыков (defensive-reaction)."
  });
}

function normalizeTagKeySafe(raw) {
  const fn = game?.OrderTags?.normalize;
  if (typeof fn === "function") return fn(raw);
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function weaponHasTag(weapon, tagKey) {
  const tags = Array.isArray(weapon?.system?.tags) ? weapon.system.tags : [];
  const want = normalizeTagKeySafe(tagKey);
  if (!want) return false;
  return tags.some((t) => normalizeTagKeySafe(t) === want);
}

function actorHasEquippedWeaponTag(actor, tag) {
  if (!actor) return false;
  const want = normalizeTagKeySafe(tag);
  const weapons = (actor.items || []).filter((i) => {
    if (!i) return false;
    if (!(i.type === "weapon" || i.type === "meleeweapon" || i.type === "rangeweapon")) return false;
    const s = getSystem(i);
    return !!(s?.isEquiped && s?.isUsed);
  });
  return weapons.some((w) => weaponHasTag(w, want));
}

function getExternalRollModifierFromEffects(actor, kind = "defense") {
  if (!actor) return 0;
  const key = kind === "attack" ? "flags.Order.roll.attack" : "flags.Order.roll.defense";
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
  const obj = sys?.[key] ?? {};
  const value = Number(obj?.value ?? 0) || 0;
  const localMods = Array.isArray(obj?.modifiers)
    ? obj.modifiers.reduce((acc, m) => acc + (Number(m?.value) || 0), 0)
    : 0;
  const globalMods = Array.isArray(sys?.MaxModifiers)
    ? sys.MaxModifiers.reduce((acc, m) => {
      const modKey = m?.characteristic ?? m?.Characteristic ?? m?.key ?? null;
      if (String(modKey) !== String(key)) return acc;
      return acc + (Number(m?.value) || 0);
    }, 0)
    : 0;
  return { value, mods: localMods + globalMods };
}

async function rollActorCharacteristic(actor, attribute, {
  toMessage = false,
  kind = "defense",
  rollMode = "normal",
  manualModifier = 0
} = {}) {
  const { value, mods } = getCharacteristicValueAndMods(actor, attribute);
  const external = getExternalRollModifierFromEffects(actor, kind);

  const parts = [getDefenseD20Formula(rollMode)];
  if (value !== 0) parts.push(value > 0 ? `+ ${value}` : `- ${Math.abs(value)}`);
  if (mods !== 0) parts.push(mods > 0 ? `+ ${mods}` : `- ${Math.abs(mods)}`);
  if (external !== 0) parts.push(external > 0 ? `+ ${external}` : `- ${Math.abs(external)}`);
  if (manualModifier !== 0) parts.push(manualModifier > 0 ? `+ ${manualModifier}` : `- ${Math.abs(manualModifier)}`);

  const roll = await new Roll(parts.join(" ")).roll({ async: true });

  if (toMessage) {
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Защита: ${attribute}` });
  }

  return roll;
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
