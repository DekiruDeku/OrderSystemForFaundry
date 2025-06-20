import { Order } from "./module/config.js";
import OrderItemSheet from "./module/sheets/OrderItemSheet.js";
import OrderPlayerSheet from "./module/sheets/OrderPlayerSheet.js";
import OrderClassSheet from "./module/sheets/OrderClassSheet.js";
import OrderRaceSheet from "./module/sheets/OrderRaceSheet.js";
import { OrderCombat } from "./scripts/OrderCombat.js";
import { OrderActor } from "./scripts/OrderActor.js";


async function preloadHandlebarsTemplates() {
  const templatePaths = [
    "systems/Order/templates/partials/character-stat-block.hbs",
    "systems/Order/templates/partials/biography.hbs", ,
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
    "systems/Order/templates/partials/consumables-card.hbs"
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
});

Hooks.on("createItem", async (item, options, userId) => {
  if (item.type !== "Skill" || !options?.renderSheet) return;
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
    }).render(true);
  });
  if (isRacial) await item.update({ "system.isRacial": true });
});
