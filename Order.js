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




  preloadHandlebarsTemplates();

  // Global chat handlers for the melee attack / defense flow.
  // Registered once at init to avoid duplicating listeners per sheet.
  registerOrderMeleeHandlers();
  registerOrderRangedHandlers();
  registerTokenDebuffHud();
});

 Hooks.once("ready", () => {
  registerOrderMeleeBus();
  registerOrderRangedBus();
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
