export default class OrderPlayerSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player"],
      template: `systems/Order/templates/sheets/Player-sheet.hbs`,
    });
  }

  getData() {
    const data = super.getData();
    data.biography = this.actor.data.data.biography || "";
    let sheetdata = {
      owner: this.actor.isOwner,
      editable: this.isEditable,
      actor: data.actor, // Используем data.actor вместо data.item
      data: data.actor.data.data,
      config: CONFIG.Order,
      weapons: data.items.filter(function (item) { return item.type == "weapon" })
    };
    console.log("Data in getData():", data);
    console.log("Data after adding config:", sheetdata);
    return sheetdata;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('textarea[name="biography"]').change(this._onBiographyChange.bind(this));
}

async _onBiographyChange(event) {
    const input = event.currentTarget;
    await this.actor.update({ 'data.biography': input.value });
}

  activateListeners(html) {
    super.activateListeners(html);
    // Initialize tab switching
    this._initializeTabs(html);
  }

  _initializeTabs(html) {
    // Get all navigation links and tab content elements
    const tabLinks = html.find('.tabs_side-menu .navbar');
    const tabs = html.find('.tab-bar');

    // Add click event listener to each tab link
    tabLinks.click(event => {
      event.preventDefault();
      const targetTab = $(event.currentTarget).data('tab');

      // Remove 'active' class from all tabs and links
      tabs.removeClass('active');
      tabLinks.removeClass('active');

      // Add 'active' class to the clicked link and corresponding tab
      $(event.currentTarget).addClass('active');
      html.find(`#${targetTab}`).addClass('active');
    });

    // Activate the first tab by default
    tabLinks.first().addClass('active');
    tabs.first().addClass('active');
  }
}

// Регистрация класса листа
Actors.unregisterSheet("core", ActorSheet);
Actors.registerSheet("core", OrderPlayerSheet, {
  types: ["Player"],
  makeDefault: true,
  label: "Player Sheet"
});
