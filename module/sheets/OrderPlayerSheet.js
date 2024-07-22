export default class OrderPlayerSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player"],
      template: "systems/Order/templates/sheets/Player-sheet.hbs"
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
      Skills: items.filter(item => item.type === "Skill"),
      armors: items.filter(item => item.type === "Armor"),
      Spells: items.filter(item => item.type === "Spell"),
      Classes: items.filter(item => item.type === "Class")
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
    html.find('.is-equiped-checkbox').change(this._onEquipChange.bind(this));
    this.element[0].addEventListener('drop', this._onDropClass.bind(this));

    this._initializeTabs(html);
  }

  async _deleteClasses(classID) {
    console.log("items");
    // console.log(items);
    const classesarr = this.getData().Classes;
    console.log(classesarr);
    for (const classItem of classesarr) {
      console.log(classItem);
      await this.actor.deleteEmbeddedDocuments('Item', [classItem._id]);
    }
  }

  async _onDropClass(event) {
    event.preventDefault();
    const data = JSON.parse(event.dataTransfer.getData('text/plain'));

    // Проверяем, что это объект типа Item
    if (data.type !== 'Item' || !data.uuid) return;

    // Используем Promise.all для предотвращения дублирования
    const [item] = await Promise.all([fromUuid(data.uuid)]);

    // Проверка на дубликаты
    if (item && item.type === 'Class' && !this.actor.items.get(item.id)) {
      // Проверяем, есть ли у персонажа уже класс
      const existingClass = this.actor.items.find(i => i.type === 'Class');
      console.log("before if");
      if (existingClass) {
        console.log("after if");
        // setTimeout(this._deleteClasses, 1000, existingClass.id);
        this._deleteClasses(existingClass.id);
        ui.notifications.warn("This character already has a class.");
        return;
      }

      // Если класса еще нет, открываем диалог для выбора базовых навыков
      this._openSkillSelectionDialog(item);
    }
  }


  async _openSkillSelectionDialog(classItem) {
    const skills = classItem.system.Skills;

    const content = `<form>
      <div class="form-group">
        <label for="skills">${game.i18n.localize("Select Base Skill")}</label>
        <select id="skills" name="skills">
          ${skills.map(skill => `<option value="${skill._id}">${skill.name}</option>`).join('')}
        </select>
      </div>
    </form>`;

    new Dialog({
      title: "Select Base Skill",
      content: content,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "OK",
          callback: (html) => this._applyClassBonuses(html, classItem)
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "ok"
    }).render(true);
  }

  async _applyClassBonuses(html, classItem) {
    const selectedSkillId = html.find('select[name="skills"]').val();
    const selectedSkill = classItem.system.Skills.find(skill => skill._id === selectedSkillId);

    if (selectedSkill) {
      await this.actor.createEmbeddedDocuments('Item', [selectedSkill]);
    }

    // Применение бонусов характеристик
    for (let bonus of classItem.system.additionalAdvantages) {
      const charName = bonus.Characteristic;
      const charValue = bonus.Value;
      switch (charName) {
        case "Accuracy":
          await this.actor.update({
            "data.Accuracy.value": this.actor.data.system.Accuracy.value + charValue
          });
          break;
        case "Strength":
          await this.actor.update({
            "data.Strength.value": this.actor.data.system.Strength.value + charValue
          });
          break;
        case "Will":
          await this.actor.update({
            "data.Will.value": this.actor.data.system.Will.value + charValue
          });
          break;
        case "Dexterity":
          await this.actor.update({
            "data.Dexterity.value": this.actor.data.system.Dexterity.value + charValue
          });
          break;
        case "Knowledge":
          await this.actor.update({
            "data.Knowledge.value": this.actor.data.system.Knowledge.value + charValue
          });
          break;
        case "Seduction":
          await this.actor.update({
            "data.Seduction.value": this.actor.data.system.Seduction.value + charValue
          });
          break;
        case "Charisma":
          await this.actor.update({
            "data.Charisma.value": this.actor.data.system.Charisma.value + charValue
          });
          break;
        case "Leadership":
          await this.actor.update({
            "data.Leadership.value": this.actor.data.system.Leadership.value + charValue
          });
          break;
        case "Faith":
          await this.actor.update({
            "data.Faith.value": this.actor.data.system.Faith.value + charValue
          });
          break;
        case "Medicine":
          await this.actor.update({
            "data.Medicine.value": this.actor.data.system.Medicine.value + charValue
          });
          break;
        case "Magic":
          await this.actor.update({
            "data.Magic.value": this.actor.data.system.Magic.value + charValue
          });
          break;
        case "Stealth":
          await this.actor.update({
            "data.Stealth.value": this.actor.data.system.Stealth.value + charValue
          });
          break;
        default:
          break;
      }
    }

    // Применение бонусов здоровья
    await this.actor.update({
      "data.Health.max": this.actor.data.system.Health.max + classItem.data.system.startBonusHp
    });

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

  async _onEquipChange(event) {
    event.preventDefault();
    const isEquiped = event.currentTarget.checked;
    let element = event.currentTarget;
    let itemId = element.closest(".item").dataset.itemId;

    const armorItem = this.actor.items.find(item => item._id === itemId);
    await armorItem.update({ "system.isEquiped": isEquiped });

    // Здесь можно добавить логику для применения параметров к персонажу, когда броня надета
    if (isEquiped) {
      // Применяем параметры брони, например:
      await this.actor.update({
        "data.attributes.armor.value": this.actor.data.system.attributes.armor.value + armorItem.system.Deffensepotential
      });
    } else {
      // Убираем параметры брони
      await this.actor.update({
        "data.attributes.armor.value": this.actor.data.system.attributes.armor.value - armorItem.system.Deffensepotential
      });
    }
  }
}

Actors.unregisterSheet("core", ActorSheet);
Actors.registerSheet("core", OrderPlayerSheet, {
  types: ["Player"],
  makeDefault: true,
  label: "Player Sheet"
});
