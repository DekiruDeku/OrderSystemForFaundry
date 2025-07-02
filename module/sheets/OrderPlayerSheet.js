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

    const inventoryItems = [
      ...sheetData.weapons,
      ...sheetData.armors,
      ...sheetData.Consumables,
      ...sheetData.RegularItems
    ];

    const maxSlots = (systemData.inventorySlots || 0) + (systemData.quickAccessSlots || 0);
    const displaySlots = Math.max(maxSlots, inventoryItems.length);
    const slots = [];
    for (let i = 0; i < displaySlots; i++) {
      const item = inventoryItems[i] || null;
      let slotType = i < (systemData.quickAccessSlots || 0) ? "quick" : "carry";
      if (i >= (systemData.carryingCapacity || 0)) slotType = "over";
      slots.push({ item, slotType, empty: !item });
    }

    sheetData.inventoryGrid = slots;

    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);

    let activeTooltip = null;


    // При наведении на ".modifiers-wrapper"
    html.find(".modifiers-wrapper").on("mouseenter", (event) => {
      const target = $(event.currentTarget);
      const tooltip = target.find(".modifiers-tooltip");

      // Если уже есть открытая подсказка — удалим
      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }

      // Скрываем оригинальный блок, чтобы не ломался верстка
      tooltip.hide();

      // Клонируем во всплывающее
      const offset = target.offset();
      activeTooltip = tooltip.clone()
        .appendTo("body")
        .addClass("active-tooltip")
        .css({
          top: offset.top + "px",
          left: offset.left + target.outerWidth() + 5 + "px", // справа от блока
          position: "absolute",
          display: "block",
          zIndex: 9999,
        });
    });

    // Когда уходим мышкой
    html.find(".modifiers-wrapper").on("mouseleave", () => {
      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }
    });

    // Если хотим, чтобы подсказка следовала за мышкой
    html.find(".modifiers-wrapper").on("mousemove", (event) => {
      if (activeTooltip) {
        const mouseX = event.pageX;
        const mouseY = event.pageY;
        activeTooltip.css({
          top: mouseY + "px",
          left: (mouseX + 10) + "px"
        });
      }
    });

    html.find(".roll-dice").on("click", async (event) => {
      event.preventDefault();
      const itemId = event.currentTarget.closest(".item").dataset.itemId;
      const item = this.actor.items.get(itemId);

      if (!item) {
        ui.notifications.warn("Элемент не найден.");
        return;
      }

      // Генерация броска кубика
      const roll = new Roll("1d20");
      const result = await roll.roll({ async: true });

      // Отправка сообщения в чат с использованием стандартного отображения результата
      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: `<h3>${item.name}</h3>`, // Добавляем название скилла/заклинания
      });
    });


    html.find(".skill-card, .spell-card").on("contextmenu", (event) => {
      event.preventDefault();
      const itemId = event.currentTarget.dataset.itemId;
      const item = this.actor.items.get(itemId);

      if (!item) {
        ui.notifications.warn("Элемент не найден.");
        return;
      }

      // Формирование HTML для чата
      const messageContent = `
        <div class="chat-item-message">
          <div class="item-header">
            <img src="${item.img}" alt="${item.name}" width="50" height="50">
            <h3>${item.name}</h3>
          </div>
          <div class="item-details">
            <p><strong>Описание:</strong> ${item.data.system.Description || "Нет описания"}</p>
          </div>
        </div>
      `;

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      });
    });






    // Слушатель нажатия на кнопку "Нанести урон"
    $(document).off('click', '.apply-damage').on('click', '.apply-damage', async (event) => {
      event.preventDefault();

      const button = $(event.currentTarget);
      const damage = parseInt(button.data('damage'), 10);

      // Получаем выделенные токены
      const selectedTokens = canvas.tokens.controlled;

      if (selectedTokens.length === 0) {
        ui.notifications.warn("Никто не выделен. Выберите токен для нанесения урона.");
        return;
      }

      for (const token of selectedTokens) {
        const actor = token.actor;

        if (!actor) {
          ui.notifications.error("У токена нет привязанного актора.");
          continue;
        }

        // Уменьшаем здоровье токена и актора
        const currentHealth = actor.system.Health.value;
        const newHealth = Math.max(0, currentHealth - damage);

        // Обновляем здоровье актера
        await actor.update({ "system.Health.value": newHealth });

        // Визуализация урона с помощью "плавающих" чисел
        canvas.interface.createScrollingText(token.center, `-${damage}`, {
          fontSize: 32,
          fill: "#ff0000", // Красный цвет
          stroke: "#000000", // Чёрная окантовка
          strokeThickness: 4,
          jitter: 0.5, // Лёгкое смещение для эффекта
        });

        // Также уменьшаем здоровье токена
        if (token.document) {
          const tokenHealth = token.document.getFlag("core", "bar1.value") || currentHealth; // bar1 связана со здоровьем
          const newTokenHealth = Math.max(0, tokenHealth - damage);
          await token.document.setFlag("core", "bar1.value", newTokenHealth);
        }
      }
    });


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
    // Открытие окна редактирования заклинания при двойном клике
    html.find(".spell-card.item").on("dblclick", (event) => {
      const itemId = event.currentTarget.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) {
        item.sheet.render(true); // Открываем окно редактирования заклинания
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

    // Обработчик для отображения подсказки для заклинаний
    html.find(".spell-card").on("mouseenter", (event) => {
      const target = $(event.currentTarget);
      const tooltip = target.find(".spell-tooltip");

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

    // Обработчик для скрытия подсказки для заклинаний
    html.find(".spell-card").on("mouseleave", (event) => {
      if (activeTooltip) {
        activeTooltip.remove(); // Удаляем подсказку
        activeTooltip = null; // Сбрасываем активную подсказку
      }
    });

    // Дополнительный обработчик, чтобы подсказка следовала за мышкой
    html.find(".spell-card").on("mousemove", (event) => {
      if (activeTooltip) {
        const offset = $(event.currentTarget).offset();
        activeTooltip.css({
          top: offset.top + "px", // Позиция сверху
          left: offset.left - activeTooltip.outerWidth() - 10 + "px", // Слева от карточки
        });
      }
    });

    // Инвентарь: открытие предмета по двойному клику
    html.find(".inventory-slot[data-item-id]").on("dblclick", (event) => {
      const itemId = event.currentTarget.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) item.sheet.render(true);
    });

    // Подсказка для предметов инвентаря
    html.find(".inventory-slot[data-item-id]").on("mouseenter", (event) => {
      const target = $(event.currentTarget);
      const tooltip = target.find(".inventory-tooltip");

      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }

      tooltip.hide();
      const offset = target.offset();
      activeTooltip = tooltip.clone()
        .appendTo("body")
        .addClass("active-tooltip")
        .css({
          top: offset.top + "px",
          left: offset.left - tooltip.outerWidth() - 10 + "px",
          position: "absolute",
          display: "block",
          zIndex: 9999,
        });
    });

    html.find(".inventory-slot[data-item-id]").on("mouseleave", () => {
      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }
    });

    html.find(".inventory-slot[data-item-id]").on("mousemove", (event) => {
      if (activeTooltip) {
        const offset = $(event.currentTarget).offset();
        activeTooltip.css({
          top: offset.top + "px",
          left: offset.left - activeTooltip.outerWidth() - 10 + "px",
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

    html.find(".roll-attack").click(ev => {
      const itemId = $(ev.currentTarget).data("item-id");
      const weapon = this.actor.items.get(itemId);
      if (!weapon) return;

      const characteristics = weapon.system.RequiresArray.map(req => req.Characteristic);
      if (characteristics.length === 1) {
        // Roll directly if there's only one characteristic
        this._rollAttack(weapon, characteristics[0]);
      } else {
        // Show dialog for multiple characteristics
        this._showAttackRollDialog(weapon, characteristics);
      }
    });

    // Удаление заклинания через крестик
    html.find(".delete-spell").on("click", (event) => {
      event.preventDefault();
      const spellId = event.currentTarget.closest(".spell-card").dataset.itemId;

      new Dialog({
        title: "Удалить заклинание",
        content: "<p>Вы уверены, что хотите удалить это заклинание?</p>",
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: "Да",
            callback: async () => {
              await this.actor.deleteEmbeddedDocuments("Item", [spellId]);
              ui.notifications.info("Заклинание удалено.");
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

    // Подключение обработчиков для других элементов
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
    //console.log(effectToDelete);
    //console.log(itemId);
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

  _rollAttack(weapon, characteristic) {
    const actorData = this.actor.system;
    const charValue = actorData[characteristic]?.value || 0; // Значение характеристики
    const modifiersArray = actorData[characteristic]?.modifiers || [];
    const charMod = modifiersArray.reduce((acc, m) => acc + (Number(m.value) || 0), 0);
    const weaponDamage = weapon.system.Damage || 0; // Урон оружия

    // Проверка наличия характеристики
    if (charValue === null || charValue === undefined) {
      ui.notifications.error(`Characteristic ${characteristic} not found.`);
      return;
    }

    const formula = `1d20 + ${charValue} + ${charMod}`;
    const roll = new Roll(formula);

    roll.roll({ async: true }).then(async (result) => {
      // Создаем красивый HTML-контент
      const messageContent = `
            <div class="chat-attack-message">
                <div class="attack-header">
                    <img src="${weapon.img}" alt="${weapon.name}" width="50" height="50">
                    <h3>${weapon.name}</h3>
                </div>
                <div class="attack-details">
                    <p><strong>Описание:</strong> ${weapon.system.description || "Нет описания"}</p>
                    <p><strong>Урон:</strong> ${weaponDamage}</p>
                    <p><strong>Результат броска:</strong> ${result.result}</p>
                    <div class="inline-roll">
                        ${await result.render()} <!-- Используем стандартный рендер результата броска -->
                    </div>
                </div>
                <button class="apply-damage" data-damage="${weaponDamage}" data-actor-id="${this.actor.id}">Нанести урон</button>
            </div>
        `;

      // Отправляем сообщение в чат
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      });
    });
  }



  _showAttackRollDialog(weapon) {
    const characteristics = weapon.system.AttackCharacteristics || []; // Инициализация

    if (!Array.isArray(characteristics) || characteristics.length === 0) {
      ui.notifications.warn(`No attack characteristics available for ${weapon.name}.`);
      return;
    }

    const options = characteristics
      .map(
        char => `<option value="${char}">${game.i18n.localize(char)}</option>`
      )
      .join("");

    const content = `
      <form>
        <div class="form-group">
          <label for="characteristic">Choose Characteristic:</label>
          <select id="characteristic">${options}</select>
        </div>
      </form>
    `;

    new Dialog({
      title: `Roll Attack for ${weapon.name}`,
      content: content,
      buttons: {
        roll: {
          label: "Roll",
          callback: html => {
            const characteristic = html.find("#characteristic").val();
            this._rollAttack(weapon, characteristic);
          },
        },
        cancel: {
          label: "Cancel",
        },
      },
    }).render(true);
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
      return;
    }

    // Проверка на дубликаты
    if (item && item.type === 'Class' && !this.actor.items.get(item.id)) {
      const existingClass = this.actor.items.find(i => i.type === 'Class');
      if (existingClass) {
        this._deleteClasses(existingClass.id);
        ui.notifications.warn("This character already has a class.");
        return;
      }

      const itemData = foundry.utils.duplicate(item);
      delete itemData._id;
      const [createdItem] = await this.actor.createEmbeddedDocuments('Item', [itemData]);

      this._openSkillSelectionDialog(createdItem);
      return;
    }
    // Проверка на дубликаты
    if (item && item.type === 'Race' && !this.actor.items.get(item.id)) {
      const existingRace = this.actor.items.find(i => i.type === 'Race');
      if (existingRace) {
        this._deleteRaces(existingRace.id);
        ui.notifications.warn("This character already has a race.");
        return;
      }

      const itemData = foundry.utils.duplicate(item);
      delete itemData._id;
      const [createdItem] = await this.actor.createEmbeddedDocuments('Item', [itemData]);

      this._applyRaceBonuses(createdItem);
      return;
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


  //TODO: переделать! это говно а не код! я извращенец но не на столько!
  _calculateSegments(value) {
    switch (value) {
      // Зеркальные отрицательные значения
      case -9: return 24;
      case -8: return 20;
      case -7: return 18;
      case -6: return 16;
      case -5: return 14;
      case -4: return 12;
      case -3: return 10;
      case -2: return 8;
      case -1: return 6;

      // Ноль
      case 0: return 6;

      // Положительные значения
      case 1: return 8;
      case 2: return 10;
      case 3: return 12;
      case 4: return 14;
      case 5: return 16;
      case 6: return 18;
      case 7: return 20;
      case 8: return 24;
      case 9: return 28;

      // Всё остальное
      default: return 35;
    }
  }


  async _applyRaceBonuses(item) {
    //Добавляем актёру все скиллы
    for (let skill of item.system.Skills) {
      const skillData = foundry.utils.duplicate(skill);
      delete skillData._id;
      await this.actor.createEmbeddedDocuments('Item', [skillData]);
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
        case "Stamina":
          await this.actor.update({
            "data.Stamina.value": this.actor.data.system.Stamina.value + charValue
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
    //console.log(selectedSkill);

    if (selectedSkill) {
      const skillData = foundry.utils.duplicate(selectedSkill);
      delete skillData._id;
      await this.actor.createEmbeddedDocuments('Item', [skillData]);
    }

    // Добавление всех скиллов из basePerks
    for (let perk of classItem.system.basePerks) {
      const perkData = foundry.utils.duplicate(perk);
      delete perkData._id;
      await this.actor.createEmbeddedDocuments('Item', [perkData]);
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
        case "Stamina":
          await this.actor.update({
            "data.Stamina.value": this.actor.data.system.Stamina.value + charValue
          });
        default:
          break;
      }
    }

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
            // Если это не Class и не Race — просто удаляем.
            if (itemToDelete.type !== "Class" && itemToDelete.type !== "Race") {
              this.actor.deleteEmbeddedDocuments("Item", [itemId]);
            } else {
              // Если Class или Race
              console.log(itemToDelete);


              // Убираем доп. бонусы к характеристикам (и для Class, и для Race):
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
                  case "Stamina":
                    this.actor.update({
                      "data.Stamina.value": this.actor.data.system.Stamina.value - charValue
                    });
                    break;
                  default:
                    break;
                }
              }
              // Наконец — удаляем сам Item (Class или Race)
              this.actor.deleteEmbeddedDocuments("Item", [itemId]);
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
      content: `
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
          label: "Бросок без модификатора",
          callback: () => this._rollCharacteristic(attribute, null),
        },
        bonus: {
          label: "Бросок с модификатором",
          callback: () => this._rollCharacteristic(attribute, characteristicModifiers),
        },
      },
    });
    dialog.render(true);
  }

  _rollCharacteristic(attribute) {
    const characteristicValue = this.actor.data.system[attribute]?.value || 0;

    // Берём массив
    const modifiersArray = this.actor.data.system[attribute]?.modifiers || [];

    // Суммируем
    const totalModifiers = modifiersArray.reduce((acc, m) => acc + (Number(m.value) || 0), 0);

    const diceFormula = `1d20 + ${characteristicValue} + ${totalModifiers}`;

    const roll = new Roll(diceFormula);
    roll.roll({ async: true }).then(result => {
      result.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: totalModifiers !== 0 ? "Бросок с бонусами" : "Бросок без бонусов",
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
    //console.log(debuffKeys);

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
    let StageChanges = debuff.changes[stateKey];

    const effectData = {
      label: `${debuff.name}`,
      icon: "icons/svg/skull.svg", // Добавьте соответствующую иконку
      changes: StageChanges, // Здесь можно добавить изменения на основе логики
      duration: {
        rounds: 1 // Пример длительности
      },
      flags: {
        description: debuff.states[stateKey]
      }
    };
    //console.log(effectData);

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

Handlebars.registerHelper("add", function(a, b) {
  return (Number(a) || 0) + (Number(b) || 0);
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

Hooks.on("createActiveEffect", async (effect, options, userId) => {
  const actor = effect.parent; // тот, на кого накладывается эффект
  if (!(actor instanceof Actor)) return;

  // Ищем "кастомные" изменения
  for (const change of effect.changes) {
    if (change.mode === 0 && change.key?.startsWith("myCustomEffect.")) {
      handleCustomEffectChange(actor, effect, change, /* isDelete=*/false);
    }
  }
});

Hooks.on("updateActiveEffect", async (effect, changes, options, userId) => {
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;

  // Можно проверить, обновились ли "changes", или просто переработать их заново
  if (changes.changes) {
    // Сначала уберём старые записи (если что-то поменялось),
    // затем добавим новые
    // Но для упрощения тут просто заново пересоздадим логику:

    // 1) Удалим прежние записи, связанные с этим эффектом
    removeCustomEffectEntries(actor, effect);

    // 2) Применим заново
    for (const change of effect.changes) {
      if (change.mode === 0 && change.key?.startsWith("myCustomEffect.")) {
        handleCustomEffectChange(actor, effect, change, /* isDelete=*/false);
      }
    }
  }
});

function handleCustomEffectChange(actor, effect, change, isDelete = false) {
  // Пример: key = "myCustomEffect.strengthMod"
  // => Нужно извлечь "strength" из ключа, чтобы понять, куда писать
  // Разделим строку по точке:
  // "myCustomEffect" [0], "strengthMod" [1]
  const [prefix, charKeyAndSuffix] = change.key.split(".");

  const charKey = charKeyAndSuffix.replace("Mod", ""); // strength
  const modValue = Number(change.value);

  // Создаем объект, который положим в массив:
  const entry = {
    effectId: effect.id,
    effectName: effect.label,
    value: modValue,
    source: prefix
  };

  // Путь к массиву (!!!важно):
  const path = `system.${charKey}.modifiers`;

  let currentArray = getProperty(actor, path);
  if (!Array.isArray(currentArray)) {
    currentArray = [];
  }

  // Добавляем запись
  currentArray.push(entry);

  // И обновляем актёра
  actor.update({ [path]: currentArray });
}


function removeCustomEffectEntries(actor, effect) {
  const charKeys = [
    "Strength",
    "Dexterity",
    "Stamina",
    "Accuracy",
    "Will",
    "Knowledge",
    "Charisma",
    "Seduction",
    "Leadership",
    "Faith",
    "Medicine",
    "Magic",
    "Stealth",
    "Movement"
  ];

  let updates = {};

  for (const charKey of charKeys) {
    const path = `system.${charKey}.modifiers`;
    let arr = getProperty(actor, path);
    if (!Array.isArray(arr) || arr.length === 0) continue;
    // Отфильтруем
    const newArr = arr.filter(entry => entry.effectId !== effect.id);

    if (newArr.length !== arr.length) {
      // Значит, что-то удалили
      updates[path] = newArr;
    }
  }

  // Если есть, что обновлять, делаем update
  if (Object.keys(updates).length > 0) {
    actor.update(updates);
  }
}


Handlebars.registerHelper("sumModifiers", function (modifiers) {
  if (!Array.isArray(modifiers)) return 0;
  return modifiers.reduce((acc, entry) => acc + (Number(entry.value) || 0), 0);
});


Handlebars.registerHelper("length", function (arr) {
  if (!arr) return 0;
  return arr.length;
});

Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;

  // Убираем записи из массивов
  removeCustomEffectEntries(actor, effect);
});


