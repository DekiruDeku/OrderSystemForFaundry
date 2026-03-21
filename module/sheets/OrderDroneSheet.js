import OrderNPCSheet from "./OrderNPCSheet.js";

export default class OrderDroneSheet extends OrderNPCSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player", "NPC", "Drone"],
      template: "systems/Order/templates/sheets/Drone-sheet.hbs"
    });
  }
}
