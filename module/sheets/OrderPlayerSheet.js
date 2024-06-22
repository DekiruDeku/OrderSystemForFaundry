export default class OrderPlayerSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player"],
      template: `systems/Order/templates/sheets/Player-sheet.hbs`,
    });
  }

  getData() {
    const baseData = super.getData();
    baseData.biography = this.actor.system.biography || ""; // Используем system вместо data
    let sheetData = {
      owner: this.actor.isOwner,
      editable: this.isEditable,
      actor: baseData.actor,
      data: baseData.actor.system, // Используем system вместо data
      config: CONFIG.Order,
      weapons: baseData.items.filter(function (item) {
        return item.type === "weapon" || item.type === "meleeweapon" || item.type === "rangeweapon";
      })
    };
    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find(".item-edit").click(this._onItemEdit.bind(this));
    html.find('textarea[name="biography"]').change(this._onBiographyChange.bind(this));
    html.find('.item-delete').click(this._onItemDelete.bind(this));
    html.find('input[type="text"]').change(this._onInputChange.bind(this)); // Обработка изменений в input
    this._initializeTabs(html);
  }

  _onItemEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId); // Используем .items.get() вместо .getOwnedItem()

    item.sheet.render(true);
  }

  onItemDelete(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".item").dataset.itemId;
    return this.actor.deleteEmbeddedDocuments("Item", [itemId]);
  }


  async _onBiographyChange(event) {
    const input = event.currentTarget;
    await this.actor.update({ 'system.biography': input.value }); // Используем system вместо data
  }

  async _onInputChange(event) {
    const input = event.currentTarget;
    const value = parseFloat(input.value) || 0; // Преобразование в число, если это необходимо
    const name = input.name;

    console.log("Updating actor data:", { [name]: value });

    // Обновляем данные актора
    await this.actor.update({ [name]: value });
  }

  _initializeTabs(html) {
    // Get all navigation links and tab content elements
    const tabLinks = html.find('.tabs_side-menu .navbar');
    const tabs = html.find('.tab-bar');

    // Retrieve the last active tab from localStorage
    const lastActiveTab = localStorage.getItem('lastActiveTab');

    // Add click event listener to each tab link
    tabLinks.click(event => {
        event.preventDefault();
        const targetTab = $(event.currentTarget).data('tab');

        // Store the last active tab in localStorage
        localStorage.setItem('lastActiveTab', targetTab);

        // Remove 'active' class from all tabs and links
        tabs.removeClass('active');
        tabLinks.removeClass('active');

        // Add 'active' class to the clicked link and corresponding tab
        $(event.currentTarget).addClass('active');
        html.find(`#${targetTab}`).addClass('active');
    });

    // Activate the last active tab by default, if it exists
    if (lastActiveTab) {
        html.find(`#${lastActiveTab}`).addClass('active');
        tabLinks.filter(`[data-tab="${lastActiveTab}"]`).addClass('active');
    } else {
        // If no last active tab is found, activate the first tab by default
        tabLinks.first().addClass('active');
        tabs.first().addClass('active');
    }
}

}

// Регистрация класса листа
Actors.unregisterSheet("core", ActorSheet);
Actors.registerSheet("core", OrderPlayerSheet, {
  types: ["Player"],
  makeDefault: true,
  label: "Player Sheet"
});
