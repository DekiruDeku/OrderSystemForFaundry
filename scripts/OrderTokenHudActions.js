import { evaluateRollFormula, evaluateDamageFormula } from "./OrderDamageFormula.js";
import { buildSkillDeliveryPipeline } from "./OrderDeliveryPipeline.js";

/**
 * OrderTokenHudActions.js — данные и бросок для вкладки «Базовые действия» HUD токена.
 *
 * Читает компендиум «Базовые действия» (Order.bazovye-dejstviya), группирует по папкам
 * компендиума, тип папки (основное / бонусное / мгновенное / защита) — по ключевому слову.
 * Разметку и клики рисует OrderTokenHud.js; здесь только загрузка, бросок формулы
 * (с атакой по одной цели) и карточка в чат.
 */

const COMPENDIUM_NAME = "Order.bazovye-dejstviya";
const TEMPLATE_RE = /\/\s*_+\s*действие шаблон/i;

/* Keyword → action type mapping (checked via .includes on lowercase folder name) */
const ACTION_TYPE_KEYWORDS = [
  { kw: "основн", type: "main",  icon: "fa-solid fa-fist-raised",    color: "#3cb44b" },
  { kw: "бонусн", type: "bonus", icon: "fa-solid fa-plus-circle",    color: "#38b9e9" },
  { kw: "мгновен", type: "instant", icon: "fa-solid fa-bolt-lightning", color: "#ffe119" },
  { kw: "защит",  type: "defense", icon: "fa-solid fa-shield-alt",    color: "#f58231" }
];

function _detectActionType(folderName) {
  const lower = (folderName || "").toLowerCase();
  for (const entry of ACTION_TYPE_KEYWORDS) {
    if (lower.includes(entry.kw)) return entry;
  }
  return { kw: "", type: "other", icon: "fa-solid fa-folder", color: "#888" };
}

let _cache = null;       // { folderName: { items: [...], meta: {...} } }
let _folderOrder = [];   // sorted folder names
let _loadingPromise = null;

/* ═══════════════════════════════════════════════════════════════════════════
   COMPENDIUM LOADING (Foundry v11 LevelDB)
   ═══════════════════════════════════════════════════════════════════════════ */

async function _loadActions({ force = false } = {}) {
  // TokenHUD must reflect the current compendium state, not a snapshot cached at world startup.
  // If a load is already in progress, wait for it first. A forced refresh then performs
  // a fresh getDocuments() call against the compendium.
  if (_loadingPromise) {
    await _loadingPromise;
    if (!force) return _cache;
  }

  if (!force && _cache) return _cache;

  _loadingPromise = (async () => {
    try {
      const pack = game.packs.get(COMPENDIUM_NAME);
      if (!pack) {
        console.warn("OrderTokenHudActions | Compendium not found:", COMPENDIUM_NAME);
        return null;
      }

      const docs = await pack.getDocuments();

      // Collect all folder names from documents
      const folderNames = new Map(); // id → name
      for (const item of docs) {
        const folder = item.folder;
        if (folder && typeof folder === "object" && folder.id && folder.name) {
          folderNames.set(folder.id, folder.name);
        }
      }

      // Also try pack.folders
      try {
        const pf = pack.folders?.contents ?? pack.folders ?? [];
        const iter = typeof pf[Symbol.iterator] === "function" ? pf
          : (typeof pf.values === "function" ? Array.from(pf.values()) : []);
        for (const f of iter) {
          if (f?.id && f?.name) folderNames.set(f.id, f.name);
        }
      } catch (e) { /* ok */ }

      console.log("OrderTokenHudActions | Found folders:", [...folderNames.values()]);

      // Build a completely fresh snapshot from the compendium every forced load.
      const nextCache = {};
      for (const [, name] of folderNames) {
        if (!nextCache[name]) {
          nextCache[name] = { items: [], meta: _detectActionType(name) };
        }
      }

      // Sort folder order to match ACTION_TYPE_KEYWORDS order
      const nextFolderOrder = Object.keys(nextCache).sort((a, b) => {
        const ai = ACTION_TYPE_KEYWORDS.findIndex(e => a.toLowerCase().includes(e.kw));
        const bi = ACTION_TYPE_KEYWORDS.findIndex(e => b.toLowerCase().includes(e.kw));
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      // Fill items
      for (const item of docs) {
        if (TEMPLATE_RE.test(item.name)) continue;

        let folderName = null;
        const folder = item.folder;
        if (folder && typeof folder === "object") {
          folderName = folder.name || folderNames.get(folder.id) || null;
        } else if (typeof folder === "string") {
          folderName = folderNames.get(folder) || null;
        }

        if (folderName && nextCache[folderName]) {
          nextCache[folderName].items.push({
            name: item.name,
            img: item.img || "icons/svg/item-bag.svg",
            uuid: item.uuid,
            desc: String(item.system?.Description || item.system?.description || "")
          });
        }
      }

      // Swap the snapshot only after a successful complete read, so the HUD never sees
      // a half-built cache while the compendium is loading.
      _cache = nextCache;
      _folderOrder = nextFolderOrder;

      console.log("OrderTokenHudActions | Loaded:", Object.fromEntries(
        Object.entries(_cache).map(([k, v]) => [k, v.items.length])
      ));
      return _cache;
    } catch (e) {
      console.error("OrderTokenHudActions | Failed to load compendium", e);
      return null;
    }
  })();

  try {
    return await _loadingPromise;
  } finally {
    _loadingPromise = null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function _getControlledToken() {
  return canvas?.tokens?.controlled?.[0] ?? null;
}

function _getControlledActor() {
  return _getControlledToken()?.actor ?? null;
}

function _escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function _collectIndexedSystemStrings(rawValue, legacyValue = "") {
  let rawArr = [];

  if (Array.isArray(rawValue)) {
    rawArr = rawValue;
  } else if (typeof rawValue === "string") {
    rawArr = [rawValue];
  } else if (rawValue && typeof rawValue === "object") {
    const keys = Object.keys(rawValue)
      .filter((k) => String(Number(k)) === k)
      .map((k) => Number(k))
      .sort((a, b) => a - b);
    rawArr = keys.map((k) => rawValue[k]);
  }

  const out = rawArr
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

  const legacy = String(legacyValue ?? "").trim();
  if (legacy && !out.includes(legacy)) out.unshift(legacy);

  return out;
}

function _collectRollFormulas(item) {
  const s = item?.system ?? item?.data?.system ?? {};
  return _collectIndexedSystemStrings(s?.RollFormulas, s?.RollFormula);
}

function _collectImpactFormulas(item) {
  const s = item?.system ?? item?.data?.system ?? {};
  return _collectIndexedSystemStrings(s?.DamageFormulas, s?.DamageFormula);
}

function _looksLikeStandaloneDiceFormula(raw) {
  const src = String(raw ?? "").trim();
  if (!src) return false;
  return /(^|[^A-Za-zА-Яа-яЁё])\d*d\d+/i.test(src);
}

function _isNaturalTwenty(roll) {
  try {
    const d20 = roll?.dice?.find((d) => d?.faces === 20);
    if (!d20) return false;
    const active = (d20.results || []).find((r) => r.active);
    return Number(active?.result) === 20;
  } catch {
    return false;
  }
}

function _getActionImpactMeta({ actor, item } = {}) {
  if (!actor || !item) {
    return { impactFormulaRaw: "", impactValue: null, baseDamage: 0, damageMode: "damage", hasDefendableImpact: false };
  }

  const s = item?.system ?? item?.data?.system ?? {};
  const formulas = _collectImpactFormulas(item);
  const impactFormulaRaw = String(formulas[0] ?? "").trim();
  const damageMode = String(s?.DamageMode || "damage").toLowerCase() === "heal" ? "heal" : "damage";

  let impactValue = null;
  if (impactFormulaRaw) {
    try {
      impactValue = Number(evaluateDamageFormula(impactFormulaRaw, actor, item) ?? 0) || 0;
    } catch (e) {
      console.warn("OrderTokenHudActions | impact formula error", e);
      impactValue = 0;
    }
  } else if (s?.Damage !== undefined && s?.Damage !== null && String(s.Damage).trim() !== "") {
    impactValue = Number(s.Damage ?? 0) || 0;
  }

  const absImpact = Math.max(0, Number(impactValue ?? 0) || 0);
  const baseDamage = damageMode === "heal" ? -absImpact : absImpact;
  const hasDefendableImpact = !!impactFormulaRaw && damageMode === "damage" && absImpact > 0;

  return { impactFormulaRaw, impactValue: absImpact, baseDamage, damageMode, hasDefendableImpact };
}

function _detectActionDelivery(item) {
  const s = item?.system ?? item?.data?.system ?? {};
  try {
    const pipeline = buildSkillDeliveryPipeline(s);
    const attackStep = pipeline.find((step) => step === "attack-ranged" || step === "attack-melee");
    if (attackStep) return attackStep;
  } catch (e) {
    console.warn("OrderTokenHudActions | delivery pipeline parse failed", e);
  }

  const direct = String(s?.DeliveryType || "").trim().toLowerCase();
  if (direct === "attack-ranged" || direct === "attack-melee") return direct;
  return "attack-melee";
}

function _buildActionRollFlavor({ item, description = "", rollFormulaRaw = "", rollFormulaValue = null, usedDirectDiceFormula = false } = {}) {
  const formulaLine = rollFormulaRaw
    ? `<div style="font-size:11px;opacity:0.85;margin-top:4px;"><strong>Формула броска:</strong> ${_escHtml(rollFormulaRaw)}${usedDirectDiceFormula ? "" : ` = ${Number(rollFormulaValue ?? 0) || 0}`}</div>`
    : "";

  return `<div style="display:flex;gap:8px;align-items:flex-start;">
    <img src="${item?.img || "icons/svg/item-bag.svg"}" width="36" height="36" style="border:0;border-radius:3px;flex-shrink:0;"/>
    <div>
      <strong>${_escHtml(item?.name || "Действие")}</strong>
      ${description ? `<br/><span style="font-size:11px;opacity:0.8;">${_escHtml(description)}</span>` : ""}
      ${formulaLine}
    </div>
  </div>`;
}

async function _buildActionAttackContent({
  actor,
  attackerToken,
  defenderToken,
  item,
  roll,
  attackTotal,
  nat20,
  rollFormulaRaw = "",
  rollFormulaValue = 0,
  usedDirectDiceFormula = false,
  impactFormulaRaw = "",
  impactValue = 0,
  delivery = "attack-melee"
} = {}) {
  const description = String(item?.system?.Description || item?.system?.description || "").trim();
  const rollHTML = roll ? await roll.render() : "";

  const hasShield = !!defenderToken?.actor?.items?.some?.((i) => {
    if (!i || (i.type !== "meleeweapon" && i.type !== "rangeweapon")) return false;
    const sys = i?.system ?? i?.data?.system ?? {};
    if (!sys?.inHand) return false;
    const tags = Array.isArray(sys?.tags) ? sys.tags : [];
    return tags.includes("shield");
  });

  const rangedStrengthBlockBtn = (delivery === "attack-ranged" && hasShield)
    ? `<button class="order-skill-defense" data-defense="block-strength">Блок (Strength)</button>`
    : "";
  const rangedStaminaBlockBtn = (delivery === "attack-ranged" && hasShield)
    ? `<button class="order-skill-defense" data-defense="block-stamina">Блок (Stamina)</button>`
    : "";

  const defenseBlock = `
    <hr/>
    <div class="defense-buttons">
      <p><strong>Защита цели:</strong> выбери реакцию</p>
      <button class="order-skill-defense" data-defense="dodge">Уворот (Dexterity)</button>
      ${delivery === "attack-ranged"
        ? `${rangedStrengthBlockBtn}${rangedStaminaBlockBtn}`
        : `<button class="order-skill-defense" data-defense="block-stamina">Блок (Stamina)</button><button class="order-skill-defense" data-defense="block-strength">Блок (Strength)</button>`}

      <div class="order-defense-skill-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
        <select class="order-defense-skill-select" style="flex:1; min-width:180px;"></select>
        <button class="order-skill-defense" data-defense="skill" style="flex:0 0 auto; white-space:nowrap;">
          Защита навыком
        </button>
      </div>

      <div class="order-defense-spell-row" style="display:none; gap:6px; align-items:center; margin-top:6px;">
        <select class="order-defense-spell-select" style="flex:1; min-width:180px;"></select>
        <button class="order-skill-defense" data-defense="spell" style="flex:0 0 auto; white-space:nowrap;">
          Защита заклинанием
        </button>
      </div>
    </div>
  `;

  const formulaLine = rollFormulaRaw
    ? `<p><strong>Формула броска:</strong> ${_escHtml(rollFormulaRaw)}${usedDirectDiceFormula ? "" : ` = ${Number(rollFormulaValue ?? 0) || 0}`}</p>`
    : "";
  const impactLine = impactFormulaRaw
    ? `<p><strong>Формула воздействия:</strong> ${_escHtml(impactFormulaRaw)} = ${Number(impactValue ?? 0) || 0}</p>`
    : "";

  return `
    <div class="chat-attack-message order-skill" data-order-skill-attack="1">
      <div class="attack-header" style="display:flex; gap:8px; align-items:center;">
        <img src="${item?.img || "icons/svg/item-bag.svg"}" width="50" height="50" style="object-fit:cover;">
        <h3 style="margin:0;">${_escHtml(item?.name || "Действие")}</h3>
      </div>

      <div class="attack-details">
        <p><strong>Атакующий:</strong> ${_escHtml(attackerToken?.name || actor?.name || "—")}</p>
        <p><strong>Цель:</strong> ${_escHtml(defenderToken?.name || defenderToken?.actor?.name || "—")}</p>
        <p><strong>Тип:</strong> ${_escHtml(delivery)}</p>
        ${description ? `<p><strong>Описание:</strong> ${_escHtml(description)}</p>` : ""}
        ${formulaLine}
        ${impactLine}
        <p><strong>Результат атаки:</strong> ${Number(attackTotal ?? 0) || 0}${nat20 ? ` <span style="color:#c00; font-weight:700;">[КРИТ]</span>` : ""}</p>
        <div class="inline-roll">${rollHTML || ""}</div>
        <p><strong>Базовое воздействие:</strong> ${Math.abs(Number(impactValue ?? 0) || 0)}</p>
      </div>

      ${defenseBlock}
    </div>
  `;
}

async function _createActionAttackMessage({ actor, item, roll, rollFormulaRaw = "", rollFormulaValue = 0, usedDirectDiceFormula = false } = {}) {
  const attackerToken = _getControlledToken();
  const targets = Array.from(game.user?.targets ?? []);
  if (!actor || !item || !roll || targets.length !== 1) return false;

  const defenderToken = targets[0];
  const defenderActor = defenderToken?.actor;
  if (!defenderActor) return false;

  const nat20 = _isNaturalTwenty(roll);
  const impactMeta = _getActionImpactMeta({ actor, item });
  if (!impactMeta.hasDefendableImpact) return false;

  const delivery = _detectActionDelivery(item);
  const attackTotal = Number(roll?.total ?? 0) || 0;

  const ctx = {
    attackerTokenId: attackerToken?.id ?? null,
    attackerActorId: actor?.id ?? null,

    defenderTokenId: defenderToken?.id ?? null,
    defenderActorId: defenderActor?.id ?? null,

    skillId: item?.id ?? null,
    skillName: item?.name ?? "",
    skillImg: item?.img ?? "",
    delivery,
    effectThreshold: Number(item?.system?.EffectThreshold ?? 0) || 0,

    attackTotal,
    nat20,
    rollMode: "normal",
    manualMod: 0,
    characteristic: rollFormulaRaw ? "формула" : null,

    baseDamage: impactMeta.baseDamage,
    damageMode: impactMeta.damageMode,
    state: "awaitingDefense",
    hit: undefined,
    createdAt: Date.now()
  };

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: attackerToken }),
    content: await _buildActionAttackContent({
      actor,
      attackerToken,
      defenderToken,
      item,
      roll,
      attackTotal,
      nat20,
      rollFormulaRaw,
      rollFormulaValue,
      usedDirectDiceFormula,
      impactFormulaRaw: impactMeta.impactFormulaRaw,
      impactValue: impactMeta.impactValue,
      delivery
    }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      Order: {
        skillAttack: ctx
      }
    }
  });

  return true;
}

async function _tryRollItemFormula({ actor, item } = {}) {
  if (!actor || !item) return false;

  const formulas = _collectRollFormulas(item);
  if (!formulas.length) return false;

  const raw = String(formulas[0] ?? "").trim();
  if (!raw) return false;

  const description = String(item.system?.Description || item.system?.description || "").substring(0, 400);

  try {
    if (_looksLikeStandaloneDiceFormula(raw)) {
      const directRoll = await new Roll(raw, actor.getRollData?.() ?? {}).roll();
      const usedAttackFlow = await _createActionAttackMessage({
        actor,
        item,
        roll: directRoll,
        rollFormulaRaw: raw,
        rollFormulaValue: 0,
        usedDirectDiceFormula: true
      });
      if (usedAttackFlow) return true;

      await directRoll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: _buildActionRollFlavor({
          item,
          description,
          rollFormulaRaw: raw,
          usedDirectDiceFormula: true
        })
      });
      return true;
    }

    const rollFormulaValue = Number(evaluateRollFormula(raw, actor, item) ?? 0) || 0;
    let d20Formula = "1d20";
    if (rollFormulaValue) d20Formula += rollFormulaValue > 0 ? ` + ${rollFormulaValue}` : ` - ${Math.abs(rollFormulaValue)}`;

    const roll = await new Roll(d20Formula).roll();
    const usedAttackFlow = await _createActionAttackMessage({
      actor,
      item,
      roll,
      rollFormulaRaw: raw,
      rollFormulaValue,
      usedDirectDiceFormula: false
    });
    if (usedAttackFlow) return true;

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: _buildActionRollFlavor({
        item,
        description,
        rollFormulaRaw: raw,
        rollFormulaValue
      })
    });
    return true;
  } catch (e) {
    console.warn("OrderTokenHudActions | formula roll error", e);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   API для OrderTokenHud.js
   ═══════════════════════════════════════════════════════════════════════════ */

const _plain = (s) => {
  const d = document.createElement("div");
  d.innerHTML = String(s ?? "");
  return String(d.textContent ?? "").replace(/\s+/g, " ").trim();
};

/**
 * Папки компендиума в порядке типов. Компендиум перечитывается при каждом вызове,
 * как и раньше при открытии вкладки.
 * @returns {Promise<Array<{folder:string,type:string,items:Array<{id:string,name:string,img:string,desc:string}>}>>}
 */
export async function loadBaseActions() {
  const cache = await _loadActions({ force: true });
  if (!cache) return [];
  return _folderOrder
    .filter((name) => cache[name])
    .map((name) => ({
      folder: name,
      type: cache[name].meta?.type ?? "other",
      items: cache[name].items.map((it) => ({ id: it.uuid, name: it.name, img: it.img, desc: _plain(it.desc) }))
    }));
}

/** Бросок формулы предмета или карточка в чат, если формулы нет. Флаги ОСН/БОН ставит HUD. */
export async function useBaseActionItem(actor, uuid) {
  if (!actor || !uuid) return;
  try {
    const item = await fromUuid(uuid);
    if (!item) return;
    const rolled = await _tryRollItemFormula({ actor, item });
    if (rolled) return;
    const desc = String(item.system?.Description || item.system?.description || "").substring(0, 400);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div style="display:flex;gap:8px;align-items:flex-start;">
        <img src="${item.img}" width="36" height="36" style="border:0;border-radius:3px;flex-shrink:0;"/>
        <div>
          <strong>${_escHtml(item.name)}</strong>
          ${desc ? `<br/><span style="font-size:11px;opacity:0.8;">${_escHtml(desc)}</span>` : ""}
        </div>
      </div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (e) {
    console.warn("OrderTokenHudActions | chat error", e);
  }
}

/** ПКМ по действию: лист предмета из компендиума. */
export async function openBaseActionSheet(uuid) {
  try { (await fromUuid(uuid))?.sheet?.render(true); } catch (e) { /* документ недоступен */ }
}
