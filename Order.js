import { Order } from "./module/config.js";
import OrderItemSheet from "./module/sheets/OrderItemSheet.js";
import OrderPlayerSheet from "./module/sheets/OrderPlayerSheet.js";

async function preloadHandlebarsTemplates() {
  const templatePaths = [
    "systems/Order/templates/partials/character-stat-block.hbs",
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
