import { Order } from "./module/config.js";
import OrderItemSheet from "./module/sheets/OrderItemSheet.js";
import OrderPlayerSheet from "./module/sheets/OrderPlayerSheet.js";
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
import { registerOrderSkillDefenseReactionUI } from "./scripts/OrderSkillDefenseReaction.js";
import { registerOrderSkillCooldownHooks } from "./scripts/OrderSkillCooldown.js";
import { registerOrderCharacterCreationWizard } from "./scripts/OrderCharacterCreationWizard.js";


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

Hooks.once("init", function () {
  console.log("Order | Initializing system");
  CONFIG.Order = Order;

  // Вот тут добавляем замену стандартного Actor:
  CONFIG.Actor.documentClass = OrderActor;  // <- ВАЖНО!

  CONFIG.Combat.documentClass = OrderCombat;
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("Order", OrderItemSheet, { makeDefault: true });

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("Order", OrderPlayerSheet, { makeDefault: true });

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
  registerOrderCharacterCreationWizard();

  // Stress -> Spirit Trial automation
  registerSpiritTrialHooks();

  registerOrderSpellSaveHandlers();
  registerOrderSpellAoEHandlers();
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


  game.settings.register("Order", "debugDefenseSpell", {
    name: "Order Debug: Defense Spell",
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });

});

Hooks.once("ready", () => {
  // Stage 1.5: normalize + add spell fields once per world (GM only)
  registerOrderSpellCombatBus();
  runOrderSpellMigration();
  registerOrderMeleeBus();
  registerOrderRangedBus();
  registerOrderSpellSaveBus();
  registerOrderSpellAoEBus();
  registerOrderSpellSummonBus();
  registerOrderSpellSummonExpiryHooks();
  registerOrderSpellZoneBus();
  registerOrderSpellZoneExpiryHooks();
  registerOrderSkillCombatBus();
  registerOrderSkillSaveBus();
  registerOrderSkillAoEBus();
  runOrderSkillMigration();

  // run only for GMs to avoid concurrent updates
  if (!game.user?.isGM) return;
  OrderCleanupMigration.runIfNeeded();
});


Hooks.on("createItem", async (item, options, userId) => {
  if (item.type !== "Skill") return;

  const promptRacialSkill = async () => {
    // Открываем диалог сразу после рендеринга листа навыка, чтобы запрос выбора
    // типа был виден поверх него. Promise позволяет дождаться выбора и вернуть
    // флаг, отмеченный пользователем.
    const isRacial = await new Promise((resolve) => {
      new Dialog({
        title: "Тип навыка",
        content: `<div class="form-group"><label><input type="checkbox" name="isRacial"/> Рассовый скилл</label></div>`,
        buttons: {
          ok: {
            label: "OK",
            callback: (html) => resolve(html.find('input[name="isRacial"]').is(":checked"))
          }
        },
        default: "ok",
        close: () => resolve(false)
      }).render(true, { focus: true });
    });

    // Если пользователь отметил чекбокс, сохраняем признак "рассовый" в системе
    // данных навыка. Обновление выполняем только в положительном случае, чтобы
    // лишний раз не триггерить сохранение без изменений.
    if (isRacial) await item.update({ "system.isRacial": true });
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
