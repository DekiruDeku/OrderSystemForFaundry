import { Order } from "./module/config.js";
import OrderItemSheet from "./module/sheets/OrderItemSheet.js";
import OrderPlayerSheet from "./module/sheets/OrderPlayerSheet.js";
import OrderNPCSheet from "./module/sheets/OrderNPCSheet.js";
import OrderClassSheet from "./module/sheets/OrderClassSheet.js";
import OrderRaceSheet from "./module/sheets/OrderRaceSheet.js";
import { OrderCombat } from "./scripts/OrderCombat.js";
import { OrderActor } from "./scripts/OrderActor.js";
import { registerTokenDebuffHud } from "./scripts/tokenDebuffHud.js";
import { registerOrderMeleeHandlers, registerOrderMeleeBus } from "./scripts/OrderMelee.js";
import { registerOrderRangedHandlers, registerOrderRangedBus } from "./scripts/OrderRange.js";
import { registerSpiritTrialHooks } from "./scripts/SpiritTrial.js";
import { runOrderSpellMigration } from "./scripts/OrderSpellMigration.js";
import { registerOrderSpellCombatHandlers, registerOrderSpellCombatBus } from "./scripts/OrderSpellCombat.js";
import { registerOrderSpellSaveHandlers, registerOrderSpellSaveBus } from "./scripts/OrderSpellSave.js";
import { registerOrderSpellAoEHandlers, registerOrderSpellAoEBus } from "./scripts/OrderSpellAOE.js";
import { registerOrderSpellMassSaveHandlers, registerOrderSpellMassSaveBus } from "./scripts/OrderSpellMassSave.js";
import { registerOrderSpellSummonHandlers, registerOrderSpellSummonBus, registerOrderSpellSummonExpiryHooks } from "./scripts/OrderSpellSummon.js";
import {
  registerOrderSpellZoneHandlers,
  registerOrderSpellZoneBus,
  registerOrderSpellZoneExpiryHooks
} from "./scripts/OrderSpellObject.js";
import { OrderCleanupMigration } from "./scripts/OrderCleanupMigration.js";
import { registerOrderSpellDefenseReactionUI } from "./scripts/OrderSpellDefenseReaction.js";
import { runOrderSkillMigration } from "./scripts/OrderSkillMigration.js";
import { registerOrderSkillCombatHandlers, registerOrderSkillCombatBus } from "./scripts/OrderSkillCombat.js";
import { registerOrderSkillSaveHandlers, registerOrderSkillSaveBus } from "./scripts/OrderSkillSave.js";
import { registerOrderSkillAoEHandlers, registerOrderSkillAoEBus, registerOrderSkillAoEExpiryHooks } from "./scripts/OrderSkillAOE.js";
import { registerOrderSkillMassSaveHandlers, registerOrderSkillMassSaveBus } from "./scripts/OrderSkillMassSave.js";
import { registerOrderSkillDefenseReactionUI } from "./scripts/OrderSkillDefenseReaction.js";
import { registerOrderSkillCooldownHooks } from "./scripts/OrderSkillCooldown.js";
import { registerOrderHotbarSupport } from "./scripts/OrderHotbar.js";
import { registerOrderTagRegistry } from "./scripts/OrderTagRegistry.js";
import { OrderTagManagerApp } from "./scripts/OrderTagManagerApp.js";
import { registerOrderLevelUpSummaryHooks } from "./scripts/OrderLevelUpSummary.js";
import { registerOrderConsumableBus } from "./scripts/OrderConsumable.js";
import { localizeSaveAbilityList } from "./scripts/OrderSaveAbility.js";


async function preloadHandlebarsTemplates() {
  const templatePaths = [
    "systems/Order/templates/partials/character-stat-block.hbs",
    "systems/Order/templates/partials/biography.hbs",
    "systems/Order/templates/partials/inventory.hbs",
    "systems/Order/templates/partials/skills.hbs",
    "systems/Order/templates/partials/equipment.hbs",
    "systems/Order/templates/partials/weapon-card.hbs",
    "systems/Order/templates/partials/skill-card.hbs",
    "systems/Order/templates/partials/armor-card.hbs",
    "systems/Order/templates/partials/spell-card.hbs",
    "systems/Order/templates/partials/class-card.hbs",
    "systems/Order/templates/partials/skill-in-class-card.hbs",
    "systems/Order/templates/partials/regularItem-card.hbs",
    "systems/Order/templates/partials/consumables-card.hbs",
    "systems/Order/templates/partials/inventory-slot.hbs"
  ];

  return loadTemplates(templatePaths);
}

function isOrderBusChatMessage(message) {
  try {
    const orderFlags = message?.flags?.Order;
    if (!orderFlags || typeof orderFlags !== "object") return false;

    // Hide only transport messages used by "no sockets" bus.
    const BUS_KEYS = new Set(["meleeBus", "rangedBus", "spellBus", "skillBus", "consumableBus"]);
    return Object.keys(orderFlags).some((key) => BUS_KEYS.has(String(key)));
  } catch (_err) {
    return false;
  }
}


const ORDER_MASTERY_ATTRIBUTE_LABELS = {
  Strength: "Сила",
  Dexterity: "Ловкость",
  Stamina: "Выносливость",
  Accuracy: "Меткость",
  Will: "Стойкость духа",
  Knowledge: "Знания",
  Charisma: "Харизма",
  Seduction: "Обольщение",
  Leadership: "Лидерство",
  Faith: "Вера",
  Medicine: "Медицина",
  Magic: "Магия",
  Stealth: "Скрытность"
};

const ORDER_MASTERY_THRESHOLDS = [7, 10];
const ORDER_MASTERY_PENDING_GRANTS = new Set();
const ORDER_MASTERY_RECENT_GRANTS = new Map();
const ORDER_MASTERY_RECENT_GRANT_TTL_MS = 4000;

function normalizeOrderMasteryText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getOrderMasteryPack() {
  try {
    return (
      game.packs.get("Order.perki-masterstva") ||
      game.packs.get(`${game.system?.id || "Order"}.perki-masterstva`) ||
      Array.from(game.packs).find((pack) => {
        const collection = String(pack?.collection || "").toLowerCase();
        const metadataName = String(pack?.metadata?.name || "").toLowerCase();
        const metadataLabel = normalizeOrderMasteryText(pack?.metadata?.label || "");
        return collection.endsWith(".perki-masterstva")
          || metadataName === "perki-masterstva"
          || metadataLabel === normalizeOrderMasteryText("Перки мастерства");
      })
    ) || null;
  } catch (err) {
    console.warn("Order | Failed to resolve mastery perks pack", err);
    return null;
  }
}

async function getOrderMasteryPackDocuments() {
  try {
    if (Array.isArray(game.OrderMasteryPerkDocsCache)) return game.OrderMasteryPerkDocsCache;
    const pack = getOrderMasteryPack();
    if (!pack) return [];
    const docs = await pack.getDocuments();
    game.OrderMasteryPerkDocsCache = Array.isArray(docs) ? docs : [];
    return game.OrderMasteryPerkDocsCache;
  } catch (err) {
    console.warn("Order | Failed to load mastery perks pack documents", err);
    return [];
  }
}

function actorAlreadyHasMasteryPerk(actor, perkDoc) {
  try {
    if (!actor || !perkDoc) return false;
    const sourceId = String(perkDoc?.uuid || "");
    const perkName = normalizeOrderMasteryText(perkDoc?.name || "");
    return (actor.items?.contents ?? actor.items ?? []).some((item) => {
      const itemSourceId = String(item?.flags?.core?.sourceId || "");
      const sameSource = sourceId && itemSourceId === sourceId;
      const sameName = perkName && normalizeOrderMasteryText(item?.name || "") === perkName;
      return Boolean(sameSource || sameName);
    });
  } catch (err) {
    console.warn("Order | Failed to check existing mastery perk", err);
    return false;
  }
}

function getOrderMasteryGrantLockKey(actor, attributeKey, threshold) {
  const actorKey = String(actor?.uuid || actor?.id || "").trim();
  return `${actorKey}:${String(attributeKey || "").trim()}:${Number(threshold || 0) || 0}`;
}

function shouldSkipOrderMasteryGrant(key) {
  if (!key) return true;
  if (ORDER_MASTERY_PENDING_GRANTS.has(key)) return true;

  const recentTs = Number(ORDER_MASTERY_RECENT_GRANTS.get(key) || 0) || 0;
  if (!recentTs) return false;

  const age = Date.now() - recentTs;
  if (age >= 0 && age < ORDER_MASTERY_RECENT_GRANT_TTL_MS) return true;

  ORDER_MASTERY_RECENT_GRANTS.delete(key);
  return false;
}

function lockOrderMasteryGrant(key) {
  if (!key || shouldSkipOrderMasteryGrant(key)) return false;
  ORDER_MASTERY_PENDING_GRANTS.add(key);
  return true;
}

function unlockOrderMasteryGrant(key, markRecent = false) {
  if (!key) return;
  ORDER_MASTERY_PENDING_GRANTS.delete(key);
  if (markRecent) ORDER_MASTERY_RECENT_GRANTS.set(key, Date.now());
}

async function findOrderMasteryPerkDocument(attributeKey, threshold) {
  const docs = await getOrderMasteryPackDocuments();
  if (!docs.length) return null;

  const attributeLabel = ORDER_MASTERY_ATTRIBUTE_LABELS?.[attributeKey] || String(attributeKey || "").trim();
  const attrNorm = normalizeOrderMasteryText(attributeLabel);
  const thresholdText = String(threshold ?? "").trim();

  const candidates = docs.filter((doc) => {
    if (doc?.type !== "Skill") return false;
    const nameNorm = normalizeOrderMasteryText(doc?.name || "");
    if (!nameNorm) return false;
    return nameNorm.includes(attrNorm) && nameNorm.includes(thresholdText);
  });

  if (!candidates.length) return null;

  const startsWith = candidates.find((doc) => {
    const nameNorm = normalizeOrderMasteryText(doc?.name || "");
    return new RegExp(`^${attrNorm}\\s*${thresholdText}(\\b|\\s*-)`).test(nameNorm);
  });
  if (startsWith) return startsWith;

  const exactFolderMatch = candidates.find((doc) => {
    const folderName = normalizeOrderMasteryText(doc?.folder?.name || "");
    return folderName === attrNorm;
  });
  if (exactFolderMatch) return exactFolderMatch;

  return candidates[0] || null;
}

function getOrderMasteryPerkDescriptionRaw(perkDoc = {}) {
  try {
    const directSystem = perkDoc?.system ?? {};
    const legacyData = perkDoc?.data ?? {};
    const objectView = typeof perkDoc?.toObject === "function" ? perkDoc.toObject() : {};
    const objectSystem = objectView?.system ?? {};
    const objectData = objectView?.data ?? {};

    return String(
      directSystem?.Description ??
      directSystem?.Description?.value ??
      directSystem?.description ??
      directSystem?.description?.value ??
      directSystem?.data?.Description ??
      directSystem?.data?.Description?.value ??
      directSystem?.data?.description ??
      directSystem?.data?.description?.value ??
      perkDoc?.Description ??
      perkDoc?.description ??
      perkDoc?.description?.value ??
      legacyData?.Description ??
      legacyData?.Description?.value ??
      legacyData?.description ??
      legacyData?.description?.value ??
      objectSystem?.Description ??
      objectSystem?.Description?.value ??
      objectSystem?.description ??
      objectSystem?.description?.value ??
      objectSystem?.data?.Description ??
      objectSystem?.data?.Description?.value ??
      objectSystem?.data?.description ??
      objectSystem?.data?.description?.value ??
      objectData?.Description ??
      objectData?.Description?.value ??
      objectData?.description ??
      objectData?.description?.value ??
      perkDoc?.flags?.description ??
      ""
    ).trim();
  } catch (err) {
    console.warn("Order | Failed to read mastery perk description", err);
    return "";
  }
}

async function getOrderMasteryPerkDescriptionHtml(perkDoc = {}) {
  const raw = getOrderMasteryPerkDescriptionRaw(perkDoc);
  if (!raw) return "<em>Описание отсутствует.</em>";

  try {
    const enriched = await TextEditor.enrichHTML(raw, { async: true });
    return String(enriched || "").trim() || "<em>Описание отсутствует.</em>";
  } catch (err) {
    console.warn("Order | Failed to enrich mastery perk description", err);
    const escaped = $('<div>').text(raw).html();
    return escaped.replace(/\r?\n/g, "<br>");
  }
}

async function showOrderMasteryPerkDialog({ attributeKey, threshold, perkDoc } = {}) {
  const attributeLabel = ORDER_MASTERY_ATTRIBUTE_LABELS?.[attributeKey] || String(attributeKey || "").trim();
  const perkName = String(perkDoc?.name || "Перк").trim();
  const descriptionHtml = await getOrderMasteryPerkDescriptionHtml(perkDoc);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(true);
    };

    const dialog = new Dialog({
      title: "Получен перк мастерства",
      content: `
        <div class="order-mastery-dialog" style="display:flex; flex-direction:column; gap:10px; padding:4px 2px 2px; color:#eef3ff;">
          <p style="margin:0; line-height:1.35;">Поздравляю! Вы достигли <strong>+${threshold}</strong> показателя <strong>${attributeLabel}</strong>.</p>
          <p style="margin:0; line-height:1.35;">За это вам полагается перк <strong>${perkName}</strong>.</p>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div style="font-weight:700;">Его описание:</div>
            <div class="order-mastery-dialog__description" style="max-height:220px; overflow:auto; padding:8px 10px; border:1px solid rgba(81,238,252,0.22); background:rgba(0,0,0,0.22); line-height:1.35;">${descriptionHtml}</div>
          </div>
          <div style="display:flex; justify-content:center; padding-top:4px;">
            <button type="button" class="order-mastery-dialog__ok" style="min-height:30px; height:30px; padding:4px 18px; flex:0 0 auto; width:auto; line-height:1;">OK</button>
          </div>
        </div>
      `,
      buttons: {},
      close: () => finish()
    }, {
      width: 520,
      height: "auto"
    });

    const renderHookId = Hooks.on("renderDialog", (app, html) => {
      if (app !== dialog) return;
      Hooks.off("renderDialog", renderHookId);

      try {
        const appEl = html.closest(".window-app");
        appEl.addClass("order-mastery-dialog-app");
        html.find(".dialog-buttons").hide();
        html.find(".order-mastery-dialog__ok").on("click", () => {
          finish();
          dialog.close();
        });
      } catch (err) {
        console.warn("Order | Failed to initialize mastery perk dialog", err);
      }
    });

    dialog.render(true, { focus: true });
  });
}

async function grantOrderMasteryPerks(actor, entries = []) {
  if (!actor || actor.type !== "Player" || !Array.isArray(entries) || !entries.length) return;

  const uniqueEntries = [];
  const seen = new Set();
  for (const entry of entries) {
    const attributeKey = String(entry?.attributeKey || "").trim();
    const threshold = Number(entry?.threshold ?? 0) || 0;
    if (!attributeKey || !threshold) continue;
    const uniq = `${attributeKey}:${threshold}`;
    if (seen.has(uniq)) continue;
    seen.add(uniq);
    uniqueEntries.push({ attributeKey, threshold });
  }

  for (const entry of uniqueEntries) {
    const attributeKey = entry.attributeKey;
    const threshold = entry.threshold;
    const grantKey = getOrderMasteryGrantLockKey(actor, attributeKey, threshold);

    if (!lockOrderMasteryGrant(grantKey)) continue;

    try {
      const perkDoc = await findOrderMasteryPerkDocument(attributeKey, threshold);
      if (!perkDoc) {
        ui.notifications?.warn?.(`Не найден перк мастерства для «${ORDER_MASTERY_ATTRIBUTE_LABELS?.[attributeKey] || attributeKey} ${threshold}».`);
        unlockOrderMasteryGrant(grantKey, false);
        continue;
      }

      if (actorAlreadyHasMasteryPerk(actor, perkDoc)) {
        unlockOrderMasteryGrant(grantKey, true);
        continue;
      }

      const itemData = perkDoc.toObject();
      delete itemData._id;
      itemData.folder = null;
      itemData.flags = foundry.utils.mergeObject(itemData.flags || {}, {
        core: { sourceId: perkDoc.uuid }
      });

      await actor.createEmbeddedDocuments("Item", [itemData], { orderMasteryPerkInternal: true });
      unlockOrderMasteryGrant(grantKey, true);
      await showOrderMasteryPerkDialog({ attributeKey, threshold, perkDoc });
    } catch (err) {
      unlockOrderMasteryGrant(grantKey, false);
      console.warn("Order | Failed to grant mastery perk", err);
    }
  }
}

function collectOrderMasteryThresholdCrossings(actor, changed) {
  if (!actor || actor.type !== "Player" || !changed) return [];

  const entries = [];
  for (const attributeKey of Object.keys(ORDER_MASTERY_ATTRIBUTE_LABELS)) {
    const nextRaw = foundry.utils.getProperty(changed, `system.${attributeKey}.value`)
      ?? foundry.utils.getProperty(changed, `data.${attributeKey}.value`);
    if (nextRaw === undefined) continue;

    const prevValue = Number(foundry.utils.getProperty(actor, `system.${attributeKey}.value`)
      ?? foundry.utils.getProperty(actor, `data.${attributeKey}.value`)
      ?? 0) || 0;
    const nextValue = Number(nextRaw) || 0;

    for (const threshold of ORDER_MASTERY_THRESHOLDS) {
      if (prevValue < threshold && nextValue >= threshold) {
        entries.push({ attributeKey, threshold });
      }
    }
  }

  return entries;
}


function _osHexToRgb(hex) {
  const h = String(hex ?? "").trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  const num = Number.parseInt(s, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function applyOrderChatTheme(message, html) {
  try {
    if (!html || !html[0]) return;

    // Base class for CSS scoping
    html.addClass("os-chat");

    // Determine author user and their accent color
    const userDoc = message?.user ?? game.users?.get(message?.user) ?? game.user;
    const isGM = Boolean(userDoc?.isGM);

    html.toggleClass("os-chat--player", !isGM);
    html.toggleClass("os-chat--gm", isGM);

    const accent = String(userDoc?.color || (isGM ? "#38b9e9" : "#6d9ac7"));
    const rgb = _osHexToRgb(accent) || [56, 185, 233];

    html[0].style.setProperty("--os-chat-accent", accent);
    html[0].style.setProperty("--os-chat-accent-rgb", `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`);

    // Whisper / Emote flags for special styling (optional)
    if (Array.isArray(message?.whisper) && message.whisper.length > 0) html.addClass("os-chat--whisper");
    const EMOTE = globalThis?.CONST?.CHAT_MESSAGE_TYPES?.EMOTE;
    if (EMOTE != null && message?.type === EMOTE) html.addClass("os-chat--emote");
  } catch (err) {
    console.warn("Order | Chat theming failed", err);
  }
}

Hooks.on("renderChatMessage", (message, html) => {
  // Hide only transport messages used by "no sockets" bus.
  if (isOrderBusChatMessage(message)) {
    html.hide();
    return;
  }

  // Apply the system chat look & player color accent.
  applyOrderChatTheme(message, html);
});
Hooks.once("init", function () {
  console.log("Order | Initializing system");
  CONFIG.Order = Order;

  // Вот тут добавляем замену стандартного Actor:
  CONFIG.Actor.documentClass = OrderActor;  // <- ВАЖНО!

  CONFIG.Combat.documentClass = OrderCombat;
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("Order", OrderItemSheet, { makeDefault: true });

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("Order", OrderPlayerSheet, {
    types: ["Player"],
    makeDefault: true,
    label: "Player Sheet"
  });
  Actors.registerSheet("Order", OrderNPCSheet, {
    types: ["NPC"],
    makeDefault: true,
    label: "NPC Sheet"
  });

  Items.registerSheet("Order", OrderClassSheet, { types: ["Class"], makeDefault: true });
  Items.registerSheet("Order", OrderRaceSheet, { types: ["Race"], makeDefault: true });

  game.settings.register("Order", "spellMigrationVersion", {
    name: "Spell migration version",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  game.settings.register("Order", "cleanupMigrationVersion", {
    name: "Order Cleanup Migration Version",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });


  registerOrderSpellCombatHandlers();
  preloadHandlebarsTemplates();

  // Global chat handlers for the melee attack / defense flow.
  // Registered once at init to avoid duplicating listeners per sheet.
  registerOrderMeleeHandlers();
  registerOrderRangedHandlers();
  registerTokenDebuffHud();
  // Drag items to hotbar macros + a unified macro runner.
  registerOrderHotbarSupport();

  // Global level-up summary popup for Skills/Spells (when system.Level increases).
  registerOrderLevelUpSummaryHooks();

  // Stress -> Spirit Trial automation
  registerSpiritTrialHooks();

  registerOrderSpellSaveHandlers();
  registerOrderSpellAoEHandlers();
  registerOrderSpellMassSaveHandlers();
  game.settings.register("Order", "aoeDebug", {
    name: "Отладка AOE (консоль)",
    hint: "Выводит подробные логи выбора целей AoE в консоль браузера.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
  registerOrderSpellSummonHandlers();
  registerOrderSpellZoneHandlers();
  registerOrderSpellDefenseReactionUI();
  game.settings.register("Order", "skillMigrationVersion", {
    name: "Skill migration version",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  registerOrderSkillCombatHandlers();
  registerOrderSkillSaveHandlers();
  registerOrderSkillAoEHandlers();
  registerOrderSkillMassSaveHandlers();
  registerOrderSkillDefenseReactionUI();
  registerOrderSkillCooldownHooks();
  registerOrderSkillAoEExpiryHooks();

  Handlebars.registerHelper("isPresetColor", function (color) {
    const c = String(color || "").trim().toLowerCase();
    if (!c) return false;
    const presets = new Set([
      "#e6194b",
      "#3cb44b",
      "#4363d8",
      "#f58231",
      "#911eb4",
      "#42d4f4",
      "#f032e6",
      "#ffe119",
      "#ffffff",
      "#000000"
    ]);
    return presets.has(c);
  });

  // Treat only strict boolean false as "false" (undefined/null -> not false)
  // Useful for templates where missing fields should default to enabled.
  Handlebars.registerHelper("isFalse", function (v) {
    return v === false;
  });

    // Item cards: by default field is visible unless explicitly disabled in displayFields.
    Handlebars.registerHelper("shouldDisplayField", function (displayFields, field) {
        const map = displayFields && typeof displayFields === "object" ? displayFields : {};
        return map[field] !== false;
    });

    Handlebars.registerHelper("formatEffects", function (effects) {
    // Supports both legacy string storage and the new array-based editor.
    if (typeof effects === "string") {
      const text = String(effects ?? "").trim();
      if (!text) return "";
      const escaped = Handlebars.escapeExpression(text);
      return new Handlebars.SafeString(escaped.replace(/\n/g, "<br>"));
    }

    const arr = Array.isArray(effects) ? effects : [];
    if (!arr.length) return "";

    const parts = arr
      .map((ef) => {
        const type = String(ef?.type ?? "").trim().toLowerCase();

        if (type === "text") {
          const text = String(ef?.text ?? "").trim();
          return text ? Handlebars.escapeExpression(text) : null;
        }

        if (type === "debuff") {
          const key = String(ef?.debuffKey ?? "").trim();
          const stage = Number(ef?.stage ?? 0) || 0;
          if (!key) return null;
          const safeKey = Handlebars.escapeExpression(key);
          return stage ? `${safeKey} (стадия ${stage})` : safeKey;
        }

        // Fallback for unknown types
        const fallback = String(ef?.text ?? ef?.debuffKey ?? "").trim();
        return fallback ? Handlebars.escapeExpression(fallback) : null;
      })
      .filter(Boolean);

    return new Handlebars.SafeString(parts.join("<br>"));
  });


// Weapon cards: format "OnHitEffects" (debuff + level) nicely using debuffs.json names.
Handlebars.registerHelper("formatWeaponOnHitEffects", function (effects) {
  const arr = Array.isArray(effects) ? effects : [];
  if (!arr.length) return "";

  const debuffs = game?.OrderDebuffs && typeof game.OrderDebuffs === "object" ? game.OrderDebuffs : {};

  const parts = arr.map((ef) => {
    if (!ef) return null;

    // Legacy string storage
    if (typeof ef === "string") {
      const t = String(ef).trim();
      return t ? Handlebars.escapeExpression(t) : null;
    }

    // New object storage: { debuffKey, stateKey }
    if (typeof ef === "object") {
      const key = String(ef.debuffKey ?? "").trim();
      if (!key) return null;

      const name = String(debuffs?.[key]?.name ?? key).trim();
      const stageRaw = String(ef.stateKey ?? "").trim();
      const stage = stageRaw && stageRaw !== "0" ? stageRaw : "";

      const safeName = Handlebars.escapeExpression(name);
      return stage ? `${safeName} (${Handlebars.escapeExpression(stage)})` : safeName;
    }

    return null;
  }).filter(Boolean);

  return new Handlebars.SafeString(parts.join(", "));
});


  /**
   * True if the passed system-data has at least one non-empty roll formula.
   * Supports both the new array field (RollFormulas) and the legacy string field (RollFormula).
   * Also tolerates RollFormulas stored as an object with numeric keys.
   */
  Handlebars.registerHelper("hasAnyRollFormula", function (systemData) {
    try {
      const s = systemData ?? {};

      // New storage: RollFormulas as array
      if (Array.isArray(s.RollFormulas)) {
        const ok = s.RollFormulas.some((v) => String(v ?? "").trim().length > 0);
        if (ok) return true;
      }

      // Tolerate object-with-numeric-keys storage
      if (s.RollFormulas && typeof s.RollFormulas === "object" && !Array.isArray(s.RollFormulas)) {
        const keys = Object.keys(s.RollFormulas)
          .filter((k) => String(Number(k)) === k)
          .map((k) => Number(k))
          .sort((a, b) => a - b);
        for (const k of keys) {
          const v = String(s.RollFormulas[k] ?? "").trim();
          if (v) return true;
        }
      }

      // Legacy storage: RollFormula as string
      if (String(s.RollFormula ?? "").trim()) return true;

      return false;
    } catch (e) {
      return false;
    }
  });

  Handlebars.registerHelper("formatSaveAbilities", function (systemData) {
    return localizeSaveAbilityList(systemData);
  });

  /**
   * Map DeliveryType value to the same label shown on item sheets.
   * Usage: {{deliveryTypeLabel system.DeliveryType "Skill"}} or "Spell"
   */
  Handlebars.registerHelper("deliveryTypeLabel", function (value, itemType) {
    const v = String(value ?? "").trim();
    if (!v) return "";

    const t = String(itemType ?? "").trim().toLowerCase();
    const isSpell = t === "spell";
    const isSkill = t === "skill";

    const labels = {
      "utility": "Утилити / без цели",
      "attack-ranged": isSpell ? "Взаимодействие заклинанием (дальнее)" : "Взаимодействие навыком (дальнее)",
      "attack-melee": isSpell ? "Взаимодействие заклинанием (ближнее)" : "Взаимодействие навыком (ближнее)",
      "save-check": "Проверка цели",
      "aoe-template": "Область (шаблон)",
      "mass-save-check": "Массовая проверка",
      "defensive-reaction": isSpell ? "Защитное (реакция)" : "Защитный (реакция)",
      "summon": "Призыв",
      "create-object": "Создать объект/стену/зону"
    };

    if (labels[v]) return labels[v];

    // Fallback to localization key if it exists, else raw value
    return game?.i18n?.localize?.(v) ?? v;
  });


  /**
   * Compute a progress percentage for resource bars.
   * Usage: {{barPct current max}}
   */
  Handlebars.registerHelper("barPct", function (value, max) {
    const v = Number(value ?? 0) || 0;
    const m = Number(max ?? 0) || 0;
    if (m <= 0) return 0;
    const pct = (v / m) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  });

  /**
   * Rank limiter helpers.
   * Limiter is +5 on rank 1 and increases by +1 for every rank after the first.
   * Rank 0 (during character creation) is treated as the same base limiter (+5).
   */
  Handlebars.registerHelper("rankLimiter", function (rank) {
    const r = Number(rank ?? 0);
    const rr = Number.isFinite(r) ? r : 0;
    return 5 + Math.max(0, rr - 1);
  });

  Handlebars.registerHelper("rankLimiterTooltip", function (rank) {
    const r = Number(rank ?? 0);
    const rr = Number.isFinite(r) ? r : 0;
    const limit = 5 + Math.max(0, rr - 1);
    return `Лимитер равен +${limit} «Лимитера» для характеристик. Формула: 5 + 1 за каждый ранг после первого.`;
  });

  /**
   * Weapon slot matcher.
   * Supports both legacy codes (main/secondary/melee) and RU labels used in item sheets.
   */
  Handlebars.registerHelper("isWeaponSlot", function (weaponType, expected) {
    const t = String(weaponType ?? "").trim().toLowerCase();
    const e = String(expected ?? "").trim().toLowerCase();

    const map = {
      main: ["main", "primary", "основное оружие", "основное"],
      secondary: ["secondary", "side", "вторичное оружие", "вторичное"],
      melee: ["melee", "cold", "холодное оружие", "холодное"]
    };

    const allowed = map[e] || [e];
    return allowed.includes(t);
  });

  /**
   * Formats "additionalAdvantages" entries for UI pills.
   * Supports legacy {Characteristic, Value} and race bonuses:
   *  - flexible: { flexible: true, value, count }
   *  - fixed pair: { characters: [c1, c2], value, allowSplit: true }
   */
  Handlebars.registerHelper("formatAdditionalAdvantage", function (adv) {
    try {
      const a = adv || {};
      const localize = (key) => {
        const k = String(key ?? "").trim();
        return k ? (game?.i18n?.localize?.(k) ?? k) : "";
      };

      // Race: alternative choice at apply time (choose one of the option objects)
      const altOptions = Array.isArray(a.options) ? a.options : (Array.isArray(a.alternative) ? a.alternative : null);
      if (altOptions && altOptions.length) {
        const fmtOpt = (opt) => {
          const o = opt || {};
          // Flexible selection
          if (o.flexible) {
            const value = Number(o.value ?? o.Value ?? 0) || 0;
            const count = Number(o.count ?? 1) || 1;
            const word = count === 1 ? "характеристику" : (count >= 2 && count <= 4 ? "характеристики" : "характеристик");
            return `${value >= 0 ? "+" : ""}${value} к ${count} ${word}`;
          }
          // Fixed pair
          if (Array.isArray(o.characters) && o.characters.length) {
            const value = Number(o.value ?? o.Value ?? 0) || 0;
            const names = o.characters.map((c) => localize(c)).filter(Boolean);
            if (names.length === 1) return `${names[0]} ${value >= 0 ? "+" : ""}${value}`.trim();
            if (names.length >= 2) return `${names[0]} / ${names[1]} ${value >= 0 ? "+" : ""}${value}`.trim();
          }
          // Legacy/common
          if (o.Characteristic) {
            const name = localize(o.Characteristic);
            const value = Number(o.Value ?? o.value ?? 0) || 0;
            return `${name} ${value >= 0 ? "+" : ""}${value}`.trim();
          }
          return String(o?.label ?? o?.name ?? "").trim() || "Модификатор";
        };

        const parts = altOptions.map(fmtOpt).filter(Boolean);
        if (parts.length) return `Альтернатива: ${parts.join(" ИЛИ ")}`;
      }

      // Legacy/common format used by items/classes/equipment
      if (a.Characteristic) {
        const name = localize(a.Characteristic);
        const val = (a.Value ?? a.value ?? "");
        return `${name} ${val}`.trim();
      }

      // Race: flexible selection at apply time
      if (a.flexible) {
        const value = (a.value ?? a.Value ?? 0);
        const count = (a.count ?? 1);
        const c = Number(count) || 1;
        const word = c === 1 ? "характеристику" : (c >= 2 && c <= 4 ? "характеристики" : "характеристик");
        return `Выбор: ${value} к ${c} ${word}`;
      }

      // Race: fixed pair with split option
      if (Array.isArray(a.characters) && a.characters.length) {
        const value = (a.value ?? a.Value ?? 0);
        const names = a.characters
          .map((c) => localize(c))
          .filter(Boolean);

        if (names.length === 1) return `${names[0]} ${value}`.trim();
        if (names.length >= 2) return `${names[0]} / ${names[1]} ${value}`.trim();
      }

      // Fallback: stringify safe-ish
      const raw = String(a?.label ?? a?.name ?? "").trim();
      return raw || "Модификатор";
    } catch (e) {
      return "Модификатор";
    }


  });

  /**
   * Formats an equipment requirement entry for UI pills.
   * Supports legacy {RequiresCharacteristic, Requires} and extended OR form:
   *  - {RequiresCharacteristic, RequiresCharacteristicAlt, Requires, RequiresOr: true}
   */
  Handlebars.registerHelper("formatRequirement", function (req) {
    try {
      const r = req || {};
      const localize = (key) => {
        const k = String(key ?? "").trim();
        return k ? (game?.i18n?.localize?.(k) ?? k) : "";
      };

      const need = Number(r.Requires ?? r.require ?? 0) || 0;
      const c1 = String(r.RequiresCharacteristic ?? r.Characteristic ?? "").trim();
      const c2 = String(r.RequiresCharacteristicAlt ?? r.RequiresCharacteristic2 ?? "").trim();
      const useOr = Boolean(r.RequiresOr ?? r.useOr ?? r.or);

      if (!c1) return "";

      const left = `${localize(c1)} ${need}`.trim();
      if (useOr && c2) {
        const right = `${localize(c2)} ${need}`.trim();
        return `${left} ИЛИ ${right}`.trim();
      }
      return left;
    } catch (e) {
      return "";
    }
  });


  game.settings.register("Order", "debugDefenseSpell", {
    name: "Order Debug: Defense Spell",
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });
  game.settings.registerMenu("Order", "tagManager", {
    name: "Теги оружия",
    label: "Открыть менеджер тегов",
    hint: "Редактирование названий и описаний тегов (используются в тултипах).",
    icon: "fas fa-tags",
    type: OrderTagManagerApp,
    restricted: true
  });

  // Centralized tags registry (base tags + world overrides).
  // Keeps tag descriptions out of items and enables user-defined tag descriptions.
  registerOrderTagRegistry();

});

Hooks.once("ready", async () => {
  // Add a stable CSS hook so we can theme all system dialogs consistently.
  // (Only affects styling; does not change any behavior.)
  try {
    document.body?.classList?.add("order-system");
  } catch (e) {
    // noop
  }

  // Preload debuffs.json once per session.
  // This is used by weapon sheets (OnHitEffects) and helps avoid repeated fetches.
  try {
    const resp = await fetch("systems/Order/module/debuffs.json");
    if (resp?.ok) {
      const data = await resp.json();
      game.OrderDebuffs = data;
      game.OrderDebuffOptions = Object.entries(data || {})
        .map(([key, def]) => ({ key, label: def?.name || key }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label), "ru"));
    }
  } catch (e) {
    console.warn("Order | debuffs.json preload failed", e);
    game.OrderDebuffs = null;
    game.OrderDebuffOptions = [];
  }

  // Stage 1.5: normalize + add spell fields once per world (GM only)
  registerOrderSpellCombatBus();
  runOrderSpellMigration();
  registerOrderMeleeBus();
  registerOrderRangedBus();
  registerOrderConsumableBus();
  registerOrderSpellSaveBus();
  registerOrderSpellAoEBus();
  registerOrderSpellMassSaveBus();
  registerOrderSpellSummonBus();
  registerOrderSpellSummonExpiryHooks();
  registerOrderSpellZoneBus();
  registerOrderSpellZoneExpiryHooks();
  registerOrderSkillCombatBus();
  registerOrderSkillSaveBus();
  registerOrderSkillAoEBus();
  registerOrderSkillMassSaveBus();
  runOrderSkillMigration();

  // run only for GMs to avoid concurrent updates
  if (!game.user?.isGM) return;
  OrderCleanupMigration.runIfNeeded();
});



Hooks.on("preUpdateActor", (actor, changed, options) => {
  try {
    if (options?.orderMasteryPerkInternal || actor?.type !== "Player") return;
    const entries = collectOrderMasteryThresholdCrossings(actor, changed);
    if (!entries.length) return;
    options.orderMasteryPerkQueue = entries;
    options.orderMasteryTriggerUserId = game.user?.id || null;
  } catch (err) {
    console.warn("Order | Failed to queue mastery perks", err);
  }
});

Hooks.on("updateActor", async (actor, changed, options, userId) => {
  try {
    if (options?.orderMasteryPerkInternal || actor?.type !== "Player") return;
    if (userId && game.user?.id !== userId) return;
    if (options?.orderMasteryTriggerUserId && game.user?.id !== options.orderMasteryTriggerUserId) return;
    const entries = Array.isArray(options?.orderMasteryPerkQueue) ? options.orderMasteryPerkQueue : [];
    if (!entries.length) return;
    await grantOrderMasteryPerks(actor, entries);
  } catch (err) {
    console.warn("Order | Failed to process mastery perks", err);
  }
});

Hooks.on("createItem", async (item, options, userId) => {
  if (item.type !== "Skill") return;

  // Не показываем диалог "Тип навыка" для вложенных (embedded) предметов.
  // Это важно для сценариев, когда навыки добавляются на актёра автоматически
  // (например, при переносе расы/класса или перетаскивании из Item директории).
  // Диалог нужен только при создании исходного Item навыка в каталоге предметов.
  if (item.parent) return;

  const promptRacialSkill = async () => {
    // Открываем диалог сразу после рендеринга листа навыка, чтобы запрос выбора
    // типа был виден поверх него. Promise позволяет дождаться выбора и вернуть
    // флаг, отмеченный пользователем.
    const skillFlags = await new Promise((resolve) => {
      new Dialog({
        title: "Тип навыка",
        content: `
          <div class="form-group"><label><input type="checkbox" name="isRacial"/> Рассовый скилл</label></div>
          <div class="form-group"><label><input type="checkbox" name="isPerk"/> Перк</label></div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px;">
              О.О для получения перка (уровень 0)
              <input type="number" name="perkTrainingPoints" value="8" min="1" step="1" style="width:90px;"/>
            </label>
            <p style="margin:4px 0 0; font-size:12px; opacity:0.85;">Заполняется только если отмечен «Перк».</p>
          </div>
        `,
        buttons: {
          ok: {
            label: "OK",
            callback: (html) => resolve({
              isRacial: html.find('input[name="isRacial"]').is(":checked"),
              isPerk: html.find('input[name="isPerk"]').is(":checked"),
              perkTrainingPoints: Number(html.find('input[name="perkTrainingPoints"]').val() ?? 0)
            })
          }
        },
        default: "ok",
        close: () => resolve({ isRacial: false, isPerk: false, perkTrainingPoints: 0 })
      }).render(true, { focus: true });
    });

    // Если пользователь отметил чекбокс, сохраняем признак "рассовый" в системе
    // данных навыка. Обновление выполняем только в положительном случае, чтобы
    // лишний раз не триггерить сохранение без изменений.
    if (skillFlags?.isRacial) await item.update({ "system.isRacial": true });
    if (skillFlags?.isPerk) {
      const raw = Number(skillFlags?.perkTrainingPoints ?? 0);
      const perkTrainingPoints = Number.isFinite(raw) ? Math.trunc(raw) : 0;
      await item.update({
        "system.isPerk": true,
        "system.perkTrainingPoints": perkTrainingPoints > 0 ? perkTrainingPoints : 8,
        "system.perkBonuses": Array.isArray(item.system?.perkBonuses) ? item.system.perkBonuses : []
      });
    }
  };

  const handleRender = (app) => {
    // Хук может срабатывать для других листов, поэтому фильтруем по ID
    // созданного предмета. Как только нужный лист отрендерился, отписываемся
    // от события, чтобы не открывать диалог повторно, и вызываем запрос.
    if (app.object.id !== item.id) return;
    Hooks.off("renderItemSheet", handleRender);
    promptRacialSkill();
  };

  if (options?.renderSheet === false) {
    // Если лист предмета не рендерится (создание через импорт или API),
    // вызываем диалог сразу после создания, иначе он никогда не появится.
    promptRacialSkill();
  } else {
    // В стандартном сценарии ждём окончания рендеринга листа, чтобы диалог
    // оказался поверх окна навыка и не прятался под ним.
    Hooks.on("renderItemSheet", handleRender);
  }
});

Hooks.on("createItem", async (item, options, userId) => {
  if (item.type !== "Consumables") return;

  const promptConsumableType = async () => {
    const defaultType = item.system?.TypeOfConsumables || "Доппинг";
    const selectedType = await new Promise((resolve) => {
      new Dialog({
        title: "Тип расходника",
        content: `
          <div class="form-group">
            <label for="consumable-type">Выберите тип расходника</label>
            <select id="consumable-type" name="consumable-type">
              <option value="Доппинг" ${defaultType === "Доппинг" ? "selected" : ""}>Доппинг</option>
              <option value="Гранаты" ${defaultType === "Гранаты" ? "selected" : ""}>Гранаты</option>
              <option value="Патроны" ${defaultType === "Патроны" ? "selected" : ""}>Патроны</option>
            </select>
          </div>
        `,
        buttons: {
          ok: {
            label: "OK",
            callback: (html) => resolve(html.find("#consumable-type").val() || defaultType)
          }
        },
        default: "ok",
        close: () => resolve(defaultType)
      }).render(true, { focus: true });
    });

    if (selectedType) await item.update({ "system.TypeOfConsumables": selectedType });
  };

  const handleRender = (app) => {
    if (app.object.id !== item.id) return;
    Hooks.off("renderItemSheet", handleRender);
    promptConsumableType();
  };

  if (options?.renderSheet === false) {
    promptConsumableType();
  } else {
    Hooks.on("renderItemSheet", handleRender);
  }
});

// Assign default inventory slot on item creation
Hooks.on("createItem", async (item) => {
  if (!item.actor || item.actor.type !== "Player") return;
  if (!["weapon", "meleeweapon", "rangeweapon", "Armor", "Consumables", "RegularItem"].includes(item.type)) return;
  if (item.getFlag("Order", "slotType")) return;

  const actor = item.actor;
  const equippedArmor = actor.items.find(i => i.type === "Armor" && i.system.isEquiped);
  const inv = equippedArmor ? Number(equippedArmor.system.inventorySlots || 0) : 0;
  const quick = equippedArmor ? Number(equippedArmor.system.quickAccessSlots || 0) : 0;

  const carryCount = actor.items.filter(it => it.getFlag("Order", "slotType") === "carry").length;
  const quickCount = actor.items.filter(it => it.getFlag("Order", "slotType") === "quick").length;

  let type = "over";
  if (carryCount < inv) type = "carry";
  else if (quickCount < quick) type = "quick";

  await item.setFlag("Order", "slotType", type);
});
