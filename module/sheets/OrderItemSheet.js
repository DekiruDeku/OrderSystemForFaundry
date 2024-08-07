Handlebars.registerHelper('isSelected', function (value, selectedValue) {
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
    html.find('.is-equiped-checkbox').change(this._onEquipChange.bind(this));
    html.find('.is-used-checkbox').change(this._onUsedChange.bind(this));
    html.find('.requires-modifier-minus').click(this._onModifierChange.bind(this, -1));
    html.find('.requires-modifier-plus').click(this._onModifierChange.bind(this, 1));
    html.find('.requires-add-characteristic').click(this._onAddRequire.bind(this));
    html.find('.requires-remove-characteristic').click(this._onRemoveRequire.bind(this));
    
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
    const value = parseInt(form.find('input[name="data.Parameters"]').val(), 10) || 0; // Получаем значение

    const additionalAdvantages = this.item.system.additionalAdvantages || [];

    // Добавляем новую характеристику с выбранным значением
    additionalAdvantages.push({ Characteristic: characteristic, Value: value });
    await this.item.update({ "system.additionalAdvantages": additionalAdvantages });
  }



  async _onAdvantageCharacteristicChange(event) {
    event.preventDefault();
    const select = event.currentTarget;
    const characteristic = select.value;
    await this.item.update({ "system.AdvantageCharacteristic": characteristic });
  }


  async _onRemoveAdvantage(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = $(event.currentTarget).closest('.advantage-char').data('index');
    itemId = parseInt(itemId);
    const additionalAdvantages = this.item.system.additionalAdvantages || [];

    let itemName = 'this modificator';

    new Dialog({
      title: `Delete ${itemName}?`,
      content: `<p>Are you sure you want to delete ${itemName}?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Yes",

          callback: () => {
            additionalAdvantages.splice(itemId, 1);
            this.item.update({ "system.additionalAdvantages": additionalAdvantages })
          }
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "No"
        }
      },
      default: "no"
    }).render(true);
  }

  async _onEquipChange(event) {
    event.preventDefault();
    const isEquiped = event.currentTarget.checked;

    await this.item.update({ "system.isEquiped": isEquiped });

    // Здесь можно добавить логику для применения параметров к персонажу, когда броня надета
    if (isEquiped) {
      // Применяем параметры
    } else {
      // Убираем параметры
    }
  }

  async _onUsedChange(event) {
    event.preventDefault();
    const isUsed = event.currentTarget.checked;

    await this.item.update({ "system.isUsed": isUsed });

    // Здесь можно добавить логику для применения параметров к персонажу, когда броня надета
    if (isUsed) {
      // Применяем параметры
    } else {
      // Убираем параметры
    }
  }

  async _onAddRequire(event) {
    event.preventDefault();
    const form = $(event.currentTarget).closest('form');
    const characteristic = form.find('select.requires-select').val(); // Получаем выбранное значение
    const value = parseInt(form.find('input[name="data.Requires"]').val(), 10) || 0; // Получаем значение

    const RequiresArray = this.item.system.RequiresArray || [];

    // Добавляем новую характеристику с выбранным значением
    RequiresArray.push({ Characteristic: characteristic, Value: value });
    await this.item.update({ "system.RequiresArray": RequiresArray });
  }


  async _onRemoveRequire(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = $(element).closest('.requires-char').data('index');
    const RequiresArray = this.item.system.RequiresArray || [];
    itemId = parseInt(itemId);

    if (itemId >= 0 && itemId < RequiresArray.length) {
      let itemName = 'this requirement';

      new Dialog({
        title: `Delete ${itemName}?`,
        content: `<p>Are you sure you want to delete ${itemName}?</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: "Yes",
            callback: () => {
              RequiresArray.splice(itemId, 1);
              this.item.update({ "system.RequiresArray": RequiresArray });
            }
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


  async _onRequiresCharacteristicChange(event) {
    event.preventDefault();
    const select = event.currentTarget;
    const characteristic = select.value;
    await this.item.update({ "system.RequiresCharacteristic": characteristic });
  }

}