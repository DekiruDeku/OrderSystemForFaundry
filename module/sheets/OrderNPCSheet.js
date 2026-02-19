import OrderPlayerSheet from "./OrderPlayerSheet.js";

export default class OrderNPCSheet extends OrderPlayerSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player", "NPC"],
      template: "systems/Order/templates/sheets/NPC-sheet.hbs"
    });
  }
}
