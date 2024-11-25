Handlebars.registerHelper('isSelected', function (value, selectedValue) {
  return value === selectedValue ? 'selected' : '';
});

export default class OrderItemSheet extends ItemSheet {


  get template() {
    return `systems/Order/templates/sheets/${this.item.type}-sheet.hbs`; // 'data' больше не используется
  }

  getData() {
    const baseData = super.getData();

    const attackCharacteristics = baseData.item.system.AttackCharacteristics || [];
    
    // Преобразуем объекты в строки
    baseData.item.system.AttackCharacteristics = attackCharacteristics.map((char) =>
      typeof char === "string" ? char : char.Characteristic || char.toString()
    );
  
    const selectedCharacteristic =
      this.item.system._selectedAttackCharacteristic || "";
  
    let sheetData = {
      owner: this.item.isOwner,
      editable: this.isEditable,
      item: baseData.item,
      data: baseData.item.system, // Используем 'system' вместо 'data'
      config: CONFIG.Order,
      characteristics: [
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
      ],
      advantages: this.additionalAdvantages,
      selectedCharacteristic, // Передаём временный выбор для отображения
    };
  
    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);
  
    return sheetData;
  }


  activateListeners(html) {
    super.activateListeners(html);

    // Слушатели для кругов навыков и заклинаний
    this._activateSkillListeners(html);

    
  // Слушатель для изменения dropdown
  html.find(".attack-select").change(async (ev) => {
    const selectedCharacteristic = $(ev.currentTarget).val();

    console.log("Selected characteristic:", selectedCharacteristic);

    // Немедленно обновляем значение в данных объекта
    await this.item.update({ "system._selectedAttackCharacteristic": selectedCharacteristic });

    console.log("Updated temporary selected characteristic:", selectedCharacteristic);
  });

  // Логика добавления характеристики
  html.find(".add-attack-characteristic").click(async (ev) => {
    const currentArray = this.item.system.AttackCharacteristics || [];
    const selectedCharacteristic = this.item.system._selectedAttackCharacteristic;

    if (!selectedCharacteristic) {
      ui.notifications.warn("Please select a characteristic before adding.");
      return;
    }

    // Проверка на дубликаты
    if (!currentArray.includes(selectedCharacteristic)) {
      currentArray.push(selectedCharacteristic);

      // Обновляем список характеристик
      await this.item.update({ "system.AttackCharacteristics": currentArray });
    } else {
      ui.notifications.warn("This characteristic is already added.");
    }

    // Перерендериваем интерфейс
    this.render(true);
  });

    // Обработчик изменения уровня вручную
    html.find('input[name="data.Level"]').on('change', async event => {
      const input = event.currentTarget;
      const newLevel = parseInt(input.value, 10) || 0;
      const circle = parseInt(this.object.system.Circle, 10) || 1;

      // Сбрасываем текущие заполненные сегменты
      await this.object.update({
        "data.Level": newLevel,
        "data.filledSegments": 0
      });

      // Перерисовываем круг
      const canvas = html.find('.circle-progress-skill')[0];
      if (canvas) {
        canvas.title = `0 / ${this._calculateSkillSegments(newLevel, circle)}`;
        this._drawCircle(canvas, 0, this._calculateSkillSegments(newLevel, circle));
      }
    });
    

    html.find(".requires-add-characteristic").click(ev => {
      const char = html.find(".requires-select").val();
      const currentArray = this.item.system.RequiresArray || [];
      currentArray.push({ Characteristic: char });
      this.item.update({ "system.RequiresArray": currentArray });
    });

    // Слушатели для других элементов
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
    html.find('.modify-advantage-button').click(() => this._addingParameters());
    html.find('.modify-require-button').click(() => this._addingRequires());
    html.find(".open-attack-dialog").click(() => this._showAttackDialog());
    html.find(".open-attack-dialog").click(() => this._onRemoveAttackCharacteristic());
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

  async _onAddAdvantage(data) {
    // Берём текущий массив дополнительных преимуществ
    const additionalAdvantages = this.item.system.additionalAdvantages || [];

    // Добавляем новое значение в массив
    additionalAdvantages.push(data);

    // Сохраняем обновлённый массив в систему Foundry
    await this.item.update({ "system.additionalAdvantages": additionalAdvantages });

    // Уведомляем пользователя
    ui.notifications.info("Характеристика успешно добавлена!");
  }


  _calculateSkillSegments(level, circle) {
    const segments = {
      1: [12, 12, 14, 16, 18], // Первый круг
      2: [14, 16, 18, 22, 26, 32, 38], // Второй круг
      3: [16, 20, 24, 30, 36, 44, 52, 62, 72], // Третий круг
      4: [18, 24, 30, 38, 46, 56, 66, 78, 90, 104, 118] // Четвёртый круг
    };

    if (circle in segments && level >= 0 && level < segments[circle].length) {
      return segments[circle][level];
    }

    // Если круг или уровень некорректны, возвращаем 0 делений
    return 0;
  }

  _getMaxLevelForCircle(circle) {
    const maxLevels = {
      1: 5,
      2: 7,
      3: 9,
      4: 11
    };
    return maxLevels[circle] || 0;
  }


  _drawCircle(canvas, filledSegments, totalSegments, isMaxLevel) {
    const ctx = canvas.getContext('2d');
    const radius = Math.min(canvas.width, canvas.height) / 2 - 5; // Радиус круга
    const center = { x: canvas.width / 2, y: canvas.height / 2 }; // Центр круга

    // Угол на один сегмент
    const anglePerSegment = (2 * Math.PI) / totalSegments;

    // Очистка канваса
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Устанавливаем чёрный фон круга
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "#000000"; // Чёрный цвет фона
    ctx.fill();

    // Если уровень максимальный, рисуем галочку
    if (isMaxLevel) {
      ctx.strokeStyle = "#00ff00"; // Зелёный цвет для галочки
      ctx.lineWidth = 4;

      // Рисуем галочку
      ctx.beginPath();
      ctx.moveTo(center.x - radius / 3, center.y); // Линия вниз
      ctx.lineTo(center.x - radius / 6, center.y + radius / 4);
      ctx.lineTo(center.x + radius / 3, center.y - radius / 6); // Линия вверх
      ctx.stroke();

      return; // Не рисуем сегменты, если уровень максимальный
    }

    // Рисуем сегменты
    for (let i = 0; i < totalSegments; i++) {
      const startAngle = i * anglePerSegment - Math.PI / 2; // Начало сектора
      const endAngle = startAngle + anglePerSegment; // Конец сектора

      ctx.beginPath();
      ctx.moveTo(center.x, center.y); // Центр круга
      ctx.arc(center.x, center.y, radius, startAngle, endAngle, false); // Сектор

      // Если сегмент заполнен
      if (i < filledSegments) {
        ctx.fillStyle = game.user.color || "#ffffff"; // Цвет заполнения
      } else {
        ctx.fillStyle = "#000000"; // Цвет незаполненного сегмента
      }
      ctx.fill();

      // Добавляем границы сегмента
      ctx.lineWidth = 2; // Толщина линий
      ctx.strokeStyle = "#ffffff"; // Белая граница
      ctx.stroke();
    }
  }



  _activateSkillListeners(html) {
    html.find('.circle-progress-skill').each((_, canvas) => {
      const circle = parseInt(canvas.dataset.circle, 10) || 1;
      const level = parseInt(canvas.dataset.level, 10) || 0;
      const filledSegments = parseInt(canvas.dataset.filled || 0, 10);
      const totalSegments = this._calculateSkillSegments(level, circle);
      const isMaxLevel = (level >= this._getMaxLevelForCircle(circle)); // Проверяем, достигнут ли максимум

      // Устанавливаем размеры Canvas
      canvas.width = 75;
      canvas.height = 75;

      // Устанавливаем tooltip
      canvas.title = isMaxLevel ? "Максимальный уровень" : `${filledSegments} / ${totalSegments}`;

      // Рисуем круг
      this._drawCircle(canvas, filledSegments, totalSegments, isMaxLevel);
    });

    // Добавляем обработчики кликов на Canvas
    html.find('.circle-progress-skill').on('mousedown', async event => {
      const canvas = event.currentTarget;
      const circle = parseInt(canvas.dataset.circle, 10) || 1;
      let level = parseInt(canvas.dataset.level, 10) || 0;
      let filledSegments = parseInt(canvas.dataset.filled, 10) || 0;
      const totalSegments = this._calculateSkillSegments(level, circle);
      const isMaxLevel = (level >= this._getMaxLevelForCircle(circle));

      if (event.button === 0 && !isMaxLevel) {
        // ЛКМ: добавляем сегмент
        filledSegments++;
        if (filledSegments >= totalSegments) {
          filledSegments = 0; // Сбрасываем заполнение
          level++; // Увеличиваем уровень
        }
      } else if (event.button === 2) {
        // ПКМ: убираем сегмент
        if (isMaxLevel) {
          // Если максимальный уровень, убираем галочку и уменьшаем уровень
          level--;
          filledSegments = this._calculateSkillSegments(level, circle) - 1;
        } else if (filledSegments > 0) {
          filledSegments--;
        } else if (level > 0) {
          level--; // Уменьшаем уровень
          filledSegments = this._calculateSkillSegments(level, circle) - 1; // Устанавливаем максимальные сегменты для нового уровня
        }
      }

      // Обновляем данные предмета
      await this.object.update({
        "data.Level": level,
        "data.filledSegments": filledSegments
      });

      // Обновляем tooltip
      canvas.title = `${filledSegments} / ${this._calculateSkillSegments(level, circle)}`;

      // Перерисовываем круг
      this._drawCircle(canvas, filledSegments, this._calculateSkillSegments(level, circle), level >= this._getMaxLevelForCircle(circle));
    });
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

  async _onAddRequire(data) {
    // Берём текущий массив дополнительных преимуществ
    const additionalAdvantages = this.item.system.RequiresArray || [];

    // Добавляем новое значение в массив
    additionalAdvantages.push(data);

    // Сохраняем обновлённый массив в систему Foundry
    await this.item.update({ "system.RequiresArray": additionalAdvantages });

    // Уведомляем пользователя
    ui.notifications.info("Характеристика успешно добавлена!");
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

  async _addingParameters() {
    const template = Handlebars.compile(`
    <div class="advantage-field">
        <select name="data.AdvantageCharacteristic" class="advantage-select">
            {{#each characteristics}}
            <option value="{{this}}" {{#if (isSelected this ../data.AdvantageCharacteristic)}}selected{{/if}}>{{this}}</option>
            {{/each}}
        </select>
        <div class="advantage-modifier">
            <button type="button" class="advantage-modifier-minus">-</button>
            <input name="data.Parameters" type="text" value="{{data.Parameters}}" data-type="Number" readonly />
            <button type="button" class="advantage-modifier-plus">+</button>
        </div>
    </div>
`);
    const html = template(this.getData());

    new Dialog({
      title: "Добавление новых параметров",
      content: html,
      buttons: {
        save: {
          label: "Сохранить",
          callback: (html) => {
            // Собираем данные из формы
            const characteristic = html.find(".advantage-select").val();
            const parametersValue = parseInt(html.find("input[name='data.Parameters']").val(), 10) || 0;

            // Создаём объект для записи
            const data = { Characteristic: characteristic, Value: parametersValue };

            // Передаём объект в функцию
            this._onAddAdvantage(data);
          },
        },
        cancel: { label: "Отмена" }
      },
      default: "ok",
      render: (html) => {
        html.find(".advantage-modifier-plus").on("click", () => {
          const input = html.find("input[name='data.Parameters']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue + 1);
        });

        html.find(".advantage-modifier-minus").on("click", () => {
          const input = html.find("input[name='data.Parameters']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue - 1);
        });
      }
    }).render(true);
  }

  async _addingRequires() {
    const template = Handlebars.compile(`
    <div class="requires-field">
            <select name="data.RequiresCharacteristic" class="requires-select">
              {{#each characteristics as |Characteristic|}}
              <option value="{{Characteristic}}" {{#if (isSelected Characteristic
                ../data.RequiresCharacteristic)}}selected{{/if}}>{{Characteristic}}</option>
              {{/each}}
            </select>
            <div class="requires-modifier">
              <button type="button" class="requires-modifier-minus">-</button>
              <input name="data.Requires" type="text" value="{{data.Requires}}" data-type="Number" readonly />
              <button type="button" class="requires-modifier-plus">+</button>
            </div>
          </div>
`);
    const html = template(this.getData());

    const dialog = new Dialog({
      title: "Управление требованиями",
      content: html,
      buttons: {
        save: {
          label: "Сохранить",
          callback: (html) => {
            const characteristic = html.find(".requires-select").val();
            const requiresValue = parseInt(html.find("input[name='data.Requires']").val(), 10) || 0;

            const data = { RequiresCharacteristic: characteristic, Requires: requiresValue };

            this._onAddRequire(data);
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "save",
      render: (html) => {
        html.find(".requires-modifier-plus").on("click", () => {
          const input = html.find("input[name='data.Requires']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue + 1);
        });

        html.find(".requires-modifier-minus").on("click", () => {
          const input = html.find("input[name='data.Requires']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue - 1);
        });
      }
    }).render(true);
  }

  async _showAttackDialog(actor) {
    const template = Handlebars.compile(`
    <td>
  <div class="attack-characteristics">
  <select name="attack-characteristic" class="attack-select">
    {{#each characteristics}}
      <option value="{{this}}" {{#if (eq ../selectedCharacteristic this)}}selected{{/if}}>
        {{this}}
      </option>
    {{/each}}
  </select>
</div>
`);
    const html = template(this.getData());

    const dialog = new Dialog({
      title: "Настройки характеристики атаки",
      content: html,
      buttons: {
        save: {
          label: "Сохранить",
          callback: async (html) => {
            const currentArray = this.item.system.AttackCharacteristics || [];
            const selectedCharacteristic = html.find(".attack-select").val();

            if (!selectedCharacteristic) {
              ui.notifications.warn("Please select a characteristic before adding.");
              return;
            }

            if (!currentArray.includes(selectedCharacteristic)) {
              currentArray.push(selectedCharacteristic);

              // Обновляем список характеристик
              await this.item.update({ "system.AttackCharacteristics": currentArray });
            } else {
              ui.notifications.warn("This characteristic is already added.");
            }

            this.render(true);
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "save",
    }).render(true);
  }
}