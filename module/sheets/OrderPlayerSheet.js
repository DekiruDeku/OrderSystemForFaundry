export default class OrderPlayerSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player"],
      template: "systems/Order/templates/sheets/Player-sheet.hbs",
    });
  }

  getData() {
    const baseData = super.getData();
    const actorData = baseData.actor || {};
    const systemData = actorData.system || {};
    const items = baseData.items || [];
    let sheetData = {
      owner: this.actor.isOwner,
      editable: this.isEditable,
      actor: actorData,
      data: systemData,
      config: CONFIG.Order,
      weapons: items.filter(item => item.type === "weapon" || item.type === "meleeweapon" || item.type === "rangeweapon"),
      Skills: items.filter(item => item.type === "Skills"),
      armors: items.filter(item => item.type === "Armor"),
      // characteristics: {
      //   Accuracy: baseData.actor.system.Accuracy,
      //   Stealth: baseData.actor.system.Stealth,
      //   Strength: baseData.actor.system.Strength,
      //   Dexterity: baseData.actor.system.Dexterity,
      //   Stamina: baseData.actor.system.Stamina,
      //   Will: baseData.actor.system.Will,
      //   Knowledge: baseData.actor.system.Knowledge,
      //   Charisma: baseData.actor.system.Charisma,
      //   Seduction: baseData.actor.system.Seduction,
      //   Leadership: baseData.actor.system.Leadership,
      //   Faith: baseData.actor.system.Faith,
      //   Medicine: baseData.actor.system.Medicine,
      //   Magic: baseData.actor.system.Magic
      // }
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
    html.find('input[type="text"]').change(this._onInputChange.bind(this));

    this._initializeTabs(html);
  }


  async _onInputChange(event) {
    const input = event.currentTarget;
    const value = parseFloat(input.value) || 0;
    const name = input.name;

    console.log("Updating actor data:", { [name]: value });

    await this.actor.update({ [name]: value });
  }

  async _onBiographyChange(event) {
    const input = event.currentTarget;
    await this.actor.update({ 'system.biography': input.value });
  }

  async _onItemEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);

    item.sheet.render(true);
  }

  async _onItemDelete(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".item").dataset.itemId;
    let itemName = this.actor.items.get(itemId).name;

    new Dialog({
      title: `Delete ${itemName}?`,
      content: `<p>Are you sure you want to delete <strong>${itemName}</strong>?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Yes",
          callback: () => this.actor.deleteEmbeddedDocuments("Item", [itemId])
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "No"
        }
      },
      default: "no"
    }).render(true);
  }

  _initializeTabs(html) {
    const tabLinks = html.find('.tabs_side-menu .navbar');
    const tabs = html.find('.tab-bar');

    const lastActiveTab = localStorage.getItem('lastActiveTab');

    tabLinks.click(event => {
      event.preventDefault();
      const targetTab = $(event.currentTarget).data('tab');

      localStorage.setItem('lastActiveTab', targetTab);

      tabs.removeClass('active');
      tabLinks.removeClass('active');

      $(event.currentTarget).addClass('active');
      html.find(`#${targetTab}`).addClass('active');
    });

    if (lastActiveTab) {
      html.find(`#${lastActiveTab}`).addClass('active');
      tabLinks.filter(`[data-tab="${lastActiveTab}"]`).addClass('active');
    } else {
      tabLinks.first().addClass('active');
      tabs.first().addClass('active');
    }
  }
}

Actors.unregisterSheet("core", ActorSheet);
Actors.registerSheet("core", OrderPlayerSheet, {
  types: ["Player"],
  makeDefault: true,
  label: "Player Sheet"
});
