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
    const playerColor = game.user.color || "#ffffff";
    // Получаем эффекты актора
    const activeEffects = baseData.effects;

    // Добавляем эффекты в данные для шаблона
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
      Classes: items.filter(item => item.type === "Class"),
      Races: items.filter(item => item.type === "Race"),
      Consumables: items.filter(item => item.type === "Consumables"),
      RegularItems: items.filter(item => item.type === "RegularItem"),
      effects: activeEffects // Включаем эффекты в данные
    };

    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);

    let activeTooltip = null;


    // Добавляем обработчик клика для кнопок характеристик
    html.find(".roll-characteristic").click(ev => {
      const attribute = ev.currentTarget.dataset.attribute;
      this._openRollDialog(attribute);
    });

     // Обработчик для открытия окна редактирования скилла при двойном клике
  html.find(".skill-card.item").on("dblclick", (event) => {
    const itemId = event.currentTarget.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (item) {
      item.sheet.render(true); // Открываем окно редактирования скилла
    }
  });

  // Обработчик для отображения подсказки
  html.find(".skill-card").on("mouseenter", (event) => {
    const target = $(event.currentTarget);
    const tooltip = target.find(".skill-tooltip");

    // Убираем активную подсказку, если она существует
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
    }

    // Скрываем оригинальную подсказку внутри карточки
    tooltip.hide();

    // Создаем новую подсказку
    const offset = target.offset();
    activeTooltip = tooltip.clone()
      .appendTo("body")
      .addClass("active-tooltip")
      .css({
        top: offset.top + "px", // Позиция сверху
        left: offset.left - tooltip.outerWidth() - 10 + "px", // Слева от карточки
        position: "absolute",
        display: "block",
        zIndex: 9999,
      });
  });

  // Обработчик для скрытия подсказки
  html.find(".skill-card").on("mouseleave", (event) => {
    if (activeTooltip) {
      activeTooltip.remove(); // Удаляем подсказку
      activeTooltip = null; // Сбрасываем активную подсказку
    }
  });

  // Дополнительный обработчик, чтобы скрывать подсказку при движении на другой элемент
  html.find(".skill-card").on("mousemove", (event) => {
    if (activeTooltip) {
      const offset = $(event.currentTarget).offset();
      activeTooltip.css({
        top: offset.top + "px", // Позиция сверху
        left: offset.left - activeTooltip.outerWidth() - 10 + "px", // Слева от карточки
      });
    }
  });
    
     // Обработчик для удаления скилла через крестик
  html.find(".delete-skill").on("click", (event) => {
    event.preventDefault();
    const skillId = event.currentTarget.closest(".skill-card").dataset.itemId;

    new Dialog({
      title: "Удалить скилл",
      content: "<p>Вы уверены, что хотите удалить этот скилл?</p>",
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Да",
          callback: async () => {
            await this.actor.deleteEmbeddedDocuments("Item", [skillId]);
            ui.notifications.info("Скилл удален.");
          },
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "Нет",
        },
      },
      default: "no",
    }).render(true);
  });
    
    
    

    html.find(".item-edit").click(this._onItemEdit.bind(this));
    html.find('textarea[name="biography"]').change(this._onBiographyChange.bind(this));
    html.find('.item-delete').click(this._onItemDelete.bind(this));
    html.find('input[type="text"]').change(this._onInputChange.bind(this));
    html.find('.is-equiped-checkbox').change(this._onEquipChange.bind(this));
    html.find('.apply-debuff').click(() => this._openDebuffDialog(this.actor));
    html.find('.remove-effect').click(this._onRemoveEffect.bind(this));
    this._activateCircleListeners(html);
    this._initializeTabs(html);
  }

  async _onRemoveEffect(event) {
    let element = event.currentTarget;
    let itemId = element.closest(".effect-item").dataset.effectId;
    let effectToDelete = this.actor.effects.get(itemId);
    console.log(effectToDelete);
    console.log(itemId);
    // Удаляем эффект по его ID
    this.actor.deleteEmbeddedDocuments("ActiveEffect", [itemId])
        .then(() => {
            ui.notifications.info("Эффект удалён.");
        })
        .catch(err => {
            console.error(err);
            ui.notifications.error("Не удалось удалить эффект.");
        });
}

  _deleteClasses(classID) {
    const classesarr = this.getData().Classes;
    for (const classItem of classesarr) {
      if (classItem._id != classID) {
        new Promise(resolve => this.actor.deleteEmbeddedDocuments('Item', [classItem._id]));
      }
    }
  }

  _deleteRaces(raceID) {
    const racesarr = this.getData().Races;
    for (const raceItem of racesarr) {
      if (raceItem._id != raceID) {
        new Promise(resolve => this.actor.deleteEmbeddedDocuments('Item', [raceItem._id]));
      }
    }
  }

  async _onDrop(event) {
    event.preventDefault();
    const data = JSON.parse(event.dataTransfer.getData('text/plain'));

    // Проверяем, что это объект типа Item
    if (data.type !== 'Item' || !data.uuid) return;

    // Используем Promise.all для предотвращения дублирования
    const [item] = await Promise.all([fromUuid(data.uuid)]);
    if (item.type != 'Class' && item.type != 'Race') {
      super._onDrop(event);
    }

    // Проверка на дубликаты
    if (item && item.type === 'Class' && !this.actor.items.get(item.id)) {
      // Проверяем, есть ли у персонажа уже класс
      const existingClass = this.actor.items.find(i => i.type === 'Class');
      if (existingClass) {
        this._deleteClasses(existingClass.id);
        ui.notifications.warn("This character already has a class.");
        return;
      }
      else {
        super._onDrop(event);
      }

      // Если класса еще нет, открываем диалог для выбора базовых навыков
      this._openSkillSelectionDialog(item);
    }
    // Проверка на дубликаты
    if (item && item.type === 'Race' && !this.actor.items.get(item.id)) {
      // Проверяем, есть ли у персонажа уже класс
      const existingRace = this.actor.items.find(i => i.type === 'Race');
      if (existingRace) {
        this._deleteRaces(existingRace.id);
        ui.notifications.warn("This character already has a race.");
        return;
      }
      else {
        super._onDrop(event);
      }

      // Если класса еще нет, открываем диалог для выбора базовых навыков
      this._applyRaceBonuses(item);
    }
  }



  _drawCircle(canvas, filledSegments, totalSegments) {
    const ctx = canvas.getContext('2d');
    const radius = Math.min(canvas.width, canvas.height) / 2 - 5; // Радиус круга
    const center = { x: canvas.width / 2, y: canvas.height / 2 }; // Центр круга
  
    // Угол на один сегмент
    const anglePerSegment = (2 * Math.PI) / totalSegments;
  
    // Получаем цвет игрока
    const playerColor = game.user.color || "#ffffff";
  
    // Очистка канваса
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  
    // Устанавливаем чёрный фон
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "#000000"; // Чёрный цвет фона
    ctx.fill();
  
    // Рисуем сегменты
    for (let i = 0; i < totalSegments; i++) {
      const startAngle = i * anglePerSegment - Math.PI / 2; // Начало сектора
      const endAngle = startAngle + anglePerSegment; // Конец сектора
  
      ctx.beginPath();
      ctx.moveTo(center.x, center.y); // Центр круга
      ctx.arc(center.x, center.y, radius, startAngle, endAngle, false); // Сектор
  
      // Если сегмент заполнен
      if (i < filledSegments) {
        ctx.fillStyle = playerColor; // Цвет заполненного сегмента — цвет игрока
      } else {
        ctx.fillStyle = "#000000"; // Незаполненные сегменты остаются чёрными
      }
      ctx.fill();
  
      // Добавляем границы сектора
      ctx.lineWidth = 2; // Толщина линий
      ctx.strokeStyle = "#ffffff"; // Белая граница
      ctx.stroke();
    }
  }
  
  
  _activateCircleListeners(html) {
    // Устанавливаем Canvas для каждой характеристики
    html.find('.circle-progress').each((_, canvas) => {
      const attribute = canvas.dataset.attribute;
      const value = this.actor.data.system[attribute]?.value || 0;
      const filledSegments = this.actor.data.system[attribute]?.filledSegments || 0;
      const totalSegments = this._calculateSegments(value);
  
      // Устанавливаем размеры Canvas
      canvas.width = 75;
      canvas.height = 75;
  
      // Устанавливаем tooltip
      canvas.title = `${filledSegments} / ${totalSegments}`;
  
      // Рисуем круг
      this._drawCircle(canvas, filledSegments, totalSegments);
    });
  
    // Добавляем обработчики кликов на Canvas
    html.find('.circle-progress').on('mousedown', async event => {
      const canvas = event.currentTarget;
      const attribute = canvas.dataset.attribute;
  
      let value = this.actor.data.system[attribute]?.value || 0;
      let filledSegments = this.actor.data.system[attribute]?.filledSegments || 0;
      const totalSegments = this._calculateSegments(value);
  
      if (event.button === 0) {
        // ЛКМ: добавляем сегмент
        filledSegments++;
        if (filledSegments >= totalSegments) {
          filledSegments = 0; // Сбрасываем заполнение
          value++; // Увеличиваем значение характеристики
        }
      } else if (event.button === 2) {
        // ПКМ: убираем сегмент
        if (filledSegments > 0) {
          filledSegments--;
        } else {
          value--; // Уменьшаем значение характеристики
          filledSegments = this._calculateSegments(value) - 1; // Устанавливаем максимальные сегменты для нового значения
        }
      }
  
      // Обновляем данные актора
      await this.actor.update({
        [`data.${attribute}.value`]: value,
        [`data.${attribute}.filledSegments`]: filledSegments,
      });
  
      // Обновляем tooltip
      canvas.title = `${filledSegments} / ${this._calculateSegments(value)}`;
  
      // Перерисовываем круг
      this._drawCircle(canvas, filledSegments, this._calculateSegments(value));
    });
  
    // Следим за изменением значения в поле ввода
    html.find('input[type="text"]').on('change', async event => {
      const input = event.currentTarget;
      const attribute = input.name.match(/data\.(\w+)\.value/)[1];
      const newValue = parseInt(input.value, 10) || 0;
  
      // Сбрасываем текущие заполненные сегменты
      await this.actor.update({
        [`data.${attribute}.value`]: newValue,
        [`data.${attribute}.filledSegments`]: 0,
      });
  
      // Перерисовываем круг
      const canvas = html.find(`.circle-progress[data-attribute="${attribute}"]`)[0];
      if (canvas) {
        canvas.title = `0 / ${this._calculateSegments(newValue)}`;
        this._drawCircle(canvas, 0, this._calculateSegments(newValue));
      }
    });
  }
  
  

  _calculateSegments(value) {
    if (value < 0) return 4;
    if (value === 0) return 6;
    if (value === 1) return 8;
    if (value === 2) return 10;
    if (value === 3) return 12;
    if (value === 4) return 14;
    if (value === 5) return 16;
    if (value === 6) return 18;
    if (value === 7) return 20;
    if (value === 8) return 24;
    if (value === 9) return 28;
    return 35;
  }
  

  async _applyRaceBonuses(item) {
    //Добавляем актёру все скиллы
    for (let skill of item.system.Skills) {
      await this.actor.createEmbeddedDocuments('Item', [skill]);
    }

    //Добавляем актёру все болнусы характеристик
    for (let bonus of item.system.additionalAdvantages) {
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
  }


  async _openSkillSelectionDialog(classItem) {
    const skills = classItem.system.Skills;

    const content = `<form>
      <div class="form-group">
        <label for="skills">${game.i18n.localize("Select Skill")}</label>
        <select id="skills" name="skills">
          ${skills.map(skill => `<option value="${skill._id}">${skill.name}</option>`).join('')}
        </select>
      </div>
    </form>`;

    new Dialog({
      title: "Select Skill",
      content: content,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "OK",
          callback: (html) => this._applyClassBonuses(html, classItem)
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => this._deleteClasses(classItem.id)
        }
      },
      default: "ok"
    }).render(true);
  }

  async _applyClassBonuses(html, classItem) {
    const selectedSkillId = html.find('select[name="skills"]').val();
    const selectedSkill = classItem.system.Skills.find(skill => skill._id === selectedSkillId);
    console.log(selectedSkill);

    if (selectedSkill) {
      await this.actor.createEmbeddedDocuments('Item', [selectedSkill]);
    }

    // Добавление всех скиллов из basePerks
    for (let perk of classItem.system.basePerks) {
      await this.actor.createEmbeddedDocuments('Item', [perk]);
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
    let itemToDelete = this.actor.items.get(itemId);

    new Dialog({
      title: `Delete ${itemName}?`,
      content: `<p>Are you sure you want to delete <strong>${itemName}</strong>?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Yes",
          callback: () => {
            if (itemToDelete.type != "Class" && itemToDelete.type != "Race") {
              this.actor.deleteEmbeddedDocuments("Item", [itemId])
            }
            else {
              console.log(itemToDelete);
              for (let bonus of itemToDelete.system.additionalAdvantages) {
                const charName = bonus.Characteristic;
                const charValue = bonus.Value;
                switch (charName) {
                  case "Accuracy":
                    this.actor.update({
                      "data.Accuracy.value": this.actor.data.system.Accuracy.value - charValue
                    });
                    break;
                  case "Strength":
                    this.actor.update({
                      "data.Strength.value": this.actor.data.system.Strength.value - charValue
                    });
                    break;
                  case "Will":
                    this.actor.update({
                      "data.Will.value": this.actor.data.system.Will.value - charValue
                    });
                    break;
                  case "Dexterity":
                    this.actor.update({
                      "data.Dexterity.value": this.actor.data.system.Dexterity.value - charValue
                    });
                    break;
                  case "Knowledge":
                    this.actor.update({
                      "data.Knowledge.value": this.actor.data.system.Knowledge.value - charValue
                    });
                    break;
                  case "Seduction":
                    this.actor.update({
                      "data.Seduction.value": this.actor.data.system.Seduction.value - charValue
                    });
                    break;
                  case "Charisma":
                    this.actor.update({
                      "data.Charisma.value": this.actor.data.system.Charisma.value - charValue
                    });
                    break;
                  case "Leadership":
                    this.actor.update({
                      "data.Leadership.value": this.actor.data.system.Leadership.value - charValue
                    });
                    break;
                  case "Faith":
                    this.actor.update({
                      "data.Faith.value": this.actor.data.system.Faith.value - charValue
                    });
                    break;
                  case "Medicine":
                    this.actor.update({
                      "data.Medicine.value": this.actor.data.system.Medicine.value - charValue
                    });
                    break;
                  case "Magic":
                    this.actor.update({
                      "data.Magic.value": this.actor.data.system.Magic.value - charValue
                    });
                    break;
                  case "Stealth":
                    this.actor.update({
                      "data.Stealth.value": this.actor.data.system.Stealth.value - charValue
                    });
                    break;
                  default:
                    break;
                }
              }
              this.actor.deleteEmbeddedDocuments("Item", [itemId])
            }
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

  _openRollDialog(attribute) {
    const characteristicModifiers = this.actor.data.system[attribute]?.modifiers;

    const dialog = new Dialog({
      title: `Бросок кубика на ${attribute}`,
      content:`
       <div class="form-group">
          <label for="modifier">Custom Modifier:</label>
          <input type="number" id="modifier" value="0" style="width: 50px;" />
          <select id="modifier-type">
            <option value="circumstance">Circumstance</option>
            <option value="item">Item</option>
            <option value="other">Other</option>
          </select>
          <button id="add-modifier">+ ADD</button>
        </div>
      <p>Выберите вариант броска:</p>
      `,
      buttons: {
        normal: {
          label: "Бросок без бонуса",
          callback: () => this._rollCharacteristic(attribute, null),
        },
        bonus: {
          label: "Бросок с бонусом",
          callback: () => this._rollCharacteristic(attribute, characteristicModifiers),
        },
      },
    })
    dialog.render(true);
  }

  _rollCharacteristic(attribute, characteristicModifiers) {
    const characteristicValue = this.actor.data.system[attribute]?.value;
    if (characteristicValue === undefined) {
        ui.notifications.warn(`Характеристика ${attribute} не найдена у персонажа.`);
        return;
    }

    const diceFormula = characteristicModifiers ? `1d20 + ${characteristicValue} + ${characteristicModifiers}` : `1d20 + ${characteristicValue}`;
    const roll = new Roll(diceFormula);
    roll.roll({async: true}).then(result => {
      result.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: characteristicModifiers ? "Бросок с бонусом" : "Бросок без бонуса",
      });
    });
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

  async _openDebuffDialog(actor) {
    let systemStates = {};

    try {
        // Ждем, пока JSON-файл будет загружен
        const response = await fetch("systems/Order/module/debuffs.json");
        if (!response.ok) throw new Error("Failed to load debuffs.json");
        systemStates = await response.json();
        console.log("States loaded:", systemStates);
    } catch (err) {
        console.error(err);
        ui.notifications.error("Не удалось загрузить состояния дебаффов.");
        return;
    }

    // Получаем ключи дебаффов
    const debuffKeys = Object.keys(systemStates);
    console.log(debuffKeys);

    // Формируем контент диалога
    let content = `<form>`;
    content += `<div class="form-group">
                  <label>Выберите дебафф:</label>
                  <select id="debuff-key">`;
    for (const key of debuffKeys) {
        content += `<option value="${key}">${systemStates[key].name}</option>`;
    }
    content += `</select>
                </div>
                <div class="form-group">
                  <label>Выберите уровень:</label>
                  <select id="debuff-state">
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </div>`;
    content += `</form>`;

    // Создаем и отображаем диалог
    new Dialog({
        title: "Добавить дебафф",
        content: content,
        buttons: {
            apply: {
                label: "Применить",
                callback: (html) => {
                    const debuffKey = html.find("#debuff-key").val();
                    const stateKey = html.find("#debuff-state").val();
                    this.applyDebuff(actor, debuffKey, stateKey);
                }
            }
        }
    }).render(true);
}


  async applyDebuff(actor, debuffKey, stateKey) {

    let systemStates = {};

    try {
        // Ждем, пока JSON-файл будет загружен
        const response = await fetch("systems/Order/module/debuffs.json");
        if (!response.ok) throw new Error("Failed to load debuffs.json");
        systemStates = await response.json();
        console.log("States loaded:", systemStates);
    } catch (err) {
        console.error(err);
        ui.notifications.error("Не удалось загрузить состояния дебаффов.");
        return;
    }

    const debuff = systemStates[debuffKey];
    if (!debuff || !debuff.states[stateKey]) {
      ui.notifications.error("Invalid debuff or state");
      return;
    }

    const effectData = {
      label: `${debuff.name}`,
      icon: "icons/svg/skull.svg", // Добавьте соответствующую иконку
      changes: debuff.changes, // Здесь можно добавить изменения на основе логики
      duration: {
        rounds: 1 // Пример длительности
      },
      flags: {
        description: debuff.states[stateKey]
      }
    };
    console.log(effectData);

    actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  }


}

Handlebars.registerHelper("let", function (...args) {
  const options = args.pop(); // Последний аргумент — это объект Handlebars
  const context = options.data.root;

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    context[key] = value; // Добавляем переменную в контекст
  }

  return options.fn(this); // Выполняем блок внутри хелпера
});

Handlebars.registerHelper("mod", function (a, b) {
  return a % b;
});

Handlebars.registerHelper("sub", function (a, b) {
  return a - b;
});

Handlebars.registerHelper("let", function (...args) {
  const options = args.pop();
  const context = options.data.root;

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    context[key] = value;
  }

  return options.fn(this);
});

Handlebars.registerHelper("range", function (start, end) {
  let result = [];
  for (let i = start; i < end; i++) {
    result.push(i);
  }
  return result;
});


Actors.unregisterSheet("core", ActorSheet);
Actors.registerSheet("core", OrderPlayerSheet, {
  types: ["Player"],
  makeDefault: true,
  label: "Player Sheet"
});
