export default class OrderPlayerSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player"],
      template: `systems/Order/templates/sheets/Player-sheet.hbs`,
    });
  }
  getData() {
    const data = super.getData();
    let sheetdata = {
      owner: this.actor.isOwner,
      editable: this.isEditable,
      actor: data.actor, // Используем data.actor вместо data.item
      data: data.actor.data.data,
      config: CONFIG.Order,
    };
    console.log("Data in getData():", data);
    console.log("Data after adding config:", sheetdata);
    return sheetdata;
  }
}

// Регистрация класса листа
Actors.unregisterSheet("core", ActorSheet);
Actors.registerSheet("core", OrderPlayerSheet, {
  types: ["Player"],
  makeDefault: true,
  label: "Player Sheet"
});
