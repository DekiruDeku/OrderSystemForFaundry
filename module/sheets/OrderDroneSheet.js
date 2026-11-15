import OrderNPCSheet from "./OrderNPCSheet.js";

export default class OrderDroneSheet extends OrderNPCSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      // Шаблон общий с листом игрока: ресурсы и инвентарь Дрона внутри него развилками по actor.type.
      classes: ["Order", "sheet", "Player", "NPC", "Drone", "osj"],
      template: "systems/Order/templates/sheets/Player-sheet.hbs"
    });
  }
}
