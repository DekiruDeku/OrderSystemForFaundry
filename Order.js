import { Order } from "./module/config.js";
import OrderItemSheet from "./module/sheets/OrderItemSheet.js";
import OrderPlayerSheet from "./module/sheets/OrderPlayerSheet.js";

async function preloadHandlebarsTemplates() {
  const templatePaths = [
    "systems/Order/templates/partials/character-stat-block.hbs",
    "systems/Order/templates/partials/biography.hbs",,
    "systems/Order/templates/partials/inventory.hbs",
    "systems/Order/templates/partials/skills.hbs",
    "systems/Order/templates/partials/equipment.hbs",
    "systems/Order/templates/partials/weapon-card.hbs",
    "systems/Order/templates/partials/skill-card.hbs",
    "systems/Order/templates/partials/armor-card.hbs",
    "systems/Order/templates/partials/spell-card.hbs",
    "systems/Order/templates/partials/class-card.hbs",
    "systems/Order/templates/partials/skill-in-class-card.hbs",
  ];

  return loadTemplates(templatePaths);
}

Hooks.once("init", function () {
  console.log("Order | Just Einstein pls work");
  CONFIG.Order = Order;
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("Order", OrderItemSheet, { makeDefault: true });
  
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("Order", OrderPlayerSheet, { makeDefault: true });
  preloadHandlebarsTemplates();
});
