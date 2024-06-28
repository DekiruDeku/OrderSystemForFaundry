Handlebars.registerHelper('isSelected', function(value, selectedValue) {
  return value === selectedValue ? 'selected' : '';
});

export default class OrderItemSheet extends ItemSheet {
  get template() {
    return `systems/Order/templates/sheets/${this.item.type}-sheet.hbs`; // 'data' больше не используется
  }

  getData() {
    const baseData = super.getData();
    let sheetData = {
      owner: this.item.isOwner,
      editable: this.isEditable,
      item: baseData.item,
      data: baseData.item.system, // Используем 'system' вместо 'data'
      config: CONFIG.Order,
      characteristics: ['Accuracy', 'Stealth', 'Strength', 'Dexterity', 'Stamina', 'Will', 'Knowledge', 'Charisma', 'Seduction', 'Leadership', 'Faith', 'Medicine', 'Magic'],
      advantages: this.additionalAdvantages
    };
    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);
    return sheetData;
  }


  activateListeners(html) {
    super.activateListeners(html);

    // Add change event listener for the weapon type dropdown
    html.find('.weapon-type').change(this._onWeaponTypeChange.bind(this));
    html.find('.advantage-modifier-minus').click(this._onModifierChange.bind(this, -1));
    html.find('.advantage-modifier-plus').click(this._onModifierChange.bind(this, 1));
    html.find('.advantage-add-characteristic').click(this._onAddAdvantage.bind(this));
    html.find('.advantage-remove-characteristic').click(this._onRemoveAdvantage.bind(this));
  }

  async _onWeaponTypeChange(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const weaponType = element.value;

    // Update the weapon's data
    await this.object.update({ "data.weaponType": weaponType });
  }

  async _onModifierChange(delta, event) {
    event.preventDefault();
    const input = $(event.currentTarget).siblings('input');
    const value = parseFloat(input.val()) + delta;
    input.val(value).trigger('change');
  }

  async _onAddAdvantage(event) {
    event.preventDefault();
    const form = $(event.currentTarget).closest('form');
    const characteristic = form.find('select.advantage-select').val(); // Получаем выбранное значение
    const value = parseInt(form.find('input[name="data.Advantage"]').val(), 10) || 0; // Получаем значение

    const additionalAdvantages = this.item.system.additionalAdvantages || [];

    // Добавляем новую характеристику с выбранным значением
    additionalAdvantages.push({ Characteristic: characteristic, Value: value });
    await this.item.update({ "system.additionalAdvantages": additionalAdvantages });
  }

  async _onRemoveAdvantage(event) {
    event.preventDefault();
    const index = $(event.currentTarget).closest('.advantage-field').index();
    const additionalAdvantages = this.actor.system.additionalAdvantages;
    additionalAdvantages.splice(index, 1);
    await this.actor.update({ "system.additionalAdvantages": additionalAdvantages });
  }

  async _onAdvantageCharacteristicChange(event) {
    event.preventDefault();
    const select = event.currentTarget;
    const characteristic = select.value;
    await this.item.update({ "system.AdvantageCharacteristic": characteristic });
  }

  async _onAddDisadvantages(event) {
    event.preventDefault();
    const form = $(event.currentTarget).closest('form');
    const characteristic = form.find('select.disadvantage-select').val(); // Получаем выбранное значение
    const value = parseInt(form.find('input[name="data.Disadvantage"]').val(), 10) || 0; // Получаем значение

    const additionalDisadvantages = this.item.system.additionalDisadvantages || [];

    // Добавляем новую характеристику с выбранным значением
    additionalDisadvantages.push({ Characteristic: characteristic, Value: value });
    await this.item.update({ "system.additionalDisdvantages": additionalAdvantages });
  }

  // async _onRemoveAdvantage(event) {
  //   event.preventDefault();
  //   if (window.confirm("Are you sure you want to delete this characteristic?")) {
  //     const index = $(event.currentTarget).closest('.advantage-field').data('index');
  //     const additionalAdvantages = this.item.system.additionalAdvantages || [];
  //     additionalAdvantages.splice(index, 1);
  //     await this.item.update({ "system.additionalAdvantages": additionalAdvantages });
  //   }
  // }

  async _onAdvantageCharacteristicChange(event) {
    event.preventDefault();
    const select = event.currentTarget;
    const characteristic = select.value;
    await this.item.update({ "system.AdvantageCharacteristic": characteristic });
  }

  async _onRemoveAdvantage(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = $(event.currentTarget).closest('.advantage-field').data('index');
    const additionalAdvantages = this.item.system.additionalAdvantages || [];
    additionalAdvantages.splice(itemId, 1);
    let itemName = 'this modificator';

    new Dialog({
      title: `Delete ${itemName}?`,
      content: `<p>Are you sure you want to delete ${itemName}?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Yes",
          callback: () => this.item.update({ "system.additionalAdvantages": additionalAdvantages })
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "No"
        }
      },
      default: "no"
    }).render(true);
  }

}