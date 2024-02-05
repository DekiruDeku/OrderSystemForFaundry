import { Order } from "./module/config.js";
import OrderItemSheet from "./module/sheets/OrderItemSheet.js";

async function preloadHandlebarsTemplates() {
  const templatePaths = [
    "systems/Order/templates/partials/charcter-stat-block.hbs",
  ];

  return loadTemplates(templatePaths);
}

Hooks.once("init", function () {
  console.log("Order | Just Einstein pls work");
  CONFIG.Order = Order;
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("Order", OrderItemSheet, { makeDefault: true });
  Actors.unregisterSheet("core", ItemSheet);
  Actors.registerSheet("Order", OrderItemSheet, { makeDefault: true });
  preloadHandlebarsTemplates();
});
