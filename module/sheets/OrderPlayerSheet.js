export default class OrderPlayerSheet extends ActorSheet {
  static get defaultOption() {
    return mergeObject(super.defaultOption, {
      template: "systems/Order/templates/sheets/Player-sheet.hbs",
      classes: ["Order", "sheet", "Player"],
    });
  }
}
