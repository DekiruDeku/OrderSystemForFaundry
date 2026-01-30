Handlebars.registerHelper('isSelected', function (value, selectedValue) {
  return value === selectedValue ? 'selected' : '';
});

const DEFAULT_FIELD_LABELS = {
  SkillType: "Тип навыка",
  EnemyInteractionType: "Тип взаимодействия с врагом",
  TriggerType: "Тип срабатывания",
  AttackArea: "Дальность/Радиус/Зона Атаки",
  Description: "Описание",
  EffectConditions: "Условия срабатывания эффекта",
  Effects: "Эффекты",
  Damage: "Урон",
  Multiplier: "Множитель",
  UsageConditions: "Условия применения",
  UsageCost: "Стоимость применения",
  Cooldown: "Время перезарядки",
  SpellType: "Тип заклинания",
  Duration: "Длительность",
  EffectThreshold: "Порог срабатывания эффекта",
  LevelOfFatigue: "Уровень усталости",
  Circle: "Круг",
};

export default class OrderItemSheet extends ItemSheet {


  get template() {
    return `systems/Order/templates/sheets/${this.item.type}-sheet.hbs`; // 'data' больше не используется
  }

  getData() {
    const baseData = super.getData();

    const attackCharacteristics = baseData.item.system.AttackCharacteristics || [];

    baseData.item.system.additionalFields = baseData.item.system.additionalFields || [];
    baseData.item.system.displayFields = baseData.item.system.displayFields || {};
    baseData.item.system.hiddenDefaults = baseData.item.system.hiddenDefaults || {};

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
      // Spell-specific selectors (stage 1.5)
      enemyInteractionTypes: [
        { value: "none", label: "—" },
        { value: "guaranteed", label: "Гарантированное" },
        { value: "contested", label: "Оспариваемое" }
      ],
      spellDeliveryTypes: [
        { value: "utility", label: "Утилити / без цели" },
        { value: "attack-ranged", label: "Атака заклинанием (дальняя)" },
        { value: "attack-melee", label: "Атака заклинанием (ближняя)" },
        { value: "save-check", label: "Проверка цели" },
        { value: "aoe-template", label: "Область (шаблон)" },
        { value: "defensive-reaction", label: "Защитное (реакция)" },
        { value: "summon", label: "Призыв" },
        { value: "create-object", label: "Создать объект/стену/зону" }
      ],
      areaShapeTypes: [
        { value: "circle", label: "Круг" },
        { value: "cone", label: "Конус" },
        { value: "ray", label: "Линия" },
        { value: "rect", label: "Прямоугольник" },
        { value: "wall", label: "Стена" }
      ]
    };

    // Spell: options for summon UI (world Actors list)
    if (this.item.type === "Spell") {
      const actors = (game?.actors?.contents ?? [])
        .map(a => ({ uuid: `Actor.${a.id}`, name: a.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      sheetData.summonActorOptions = actors;
    }


    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);

    return sheetData;
  }


  activateListeners(html) {
    super.activateListeners(html);

    // Слушатели для кругов навыков и заклинаний
    this._activateSkillListeners(html);

    if (this.item.type === "Consumables") {
      this._initializeConsumableTypeControls(html);
    }

    html.find('.add-field').click(this._onAddField.bind(this));
    html.find('.additional-field-input').on('change', this._onAdditionalFieldChange.bind(this));
    html.find('.fields-table input, .fields-table select').on('change', this._onFieldChange.bind(this));
    html.find('.field-label').on('click', this._onFieldLabelClick.bind(this));

    html.find('.in-hand-checkbox').change(this._onInHandChange.bind(this));
    html.find(".tag-add").on("click", (ev) => this._onAddWeaponTag(ev, html));
    html.find(".tag-remove").on("click", (ev) => this._onRemoveWeaponTag(ev));

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
    // html.find(".remove-attack-characteristic").click(async ev => {
    //   const index = $(ev.currentTarget).closest(".attack-char").data("index");
    //   const currentArray = this.item.system.AttackCharacteristics || [];
    //   currentArray.splice(index, 1);
    //   await this.item.update({ "system.AttackCharacteristics": currentArray });
    //
    //   // Принудительное обновление интерфейса
    //   this.render(true);
    // });

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
    html.find(".remove-attack-characteristic").click(this._onRemoveAttackCharacteristic.bind(this));
    html.find('.is-equiped-checkbox').change(this._onEquipChange.bind(this));
    html.find('.is-used-checkbox').change(this._onUsedChange.bind(this));
    html.find('.requires-modifier-minus').click(this._onModifierChange.bind(this, -1));
    html.find('.requires-modifier-plus').click(this._onModifierChange.bind(this, 1));
    html.find('.requires-add-characteristic').click(this._onAddRequire.bind(this));
    html.find('.requires-remove-characteristic').click(this._onRemoveRequire.bind(this));
    html.find('.modify-advantage-button').click(() => this._addingParameters());
    html.find('.modify-require-button').click(() => this._addingRequires());
    html.find(".open-attack-dialog").click(() => this._showAttackDialog());
    html.find(".add-weapon-effect").click(() => this._addWeaponOnHitEffect());
    html.find(".remove-weapon-effect").click(this._removeWeaponOnHitEffect.bind(this));
    if (this.item.type === "rangeweapon") {
      html.find(".reload-rangeweapon").click(this._onReloadRangeWeapon.bind(this));
    }


    if (this.item.type === "rangeweapon") {
      html.find(".add-accurate-effect").click(() => this._addAccurateHitEffectText());
      html.find(".remove-accurate-effect").click(this._removeAccurateHitEffectText.bind(this));
    }

    // Ограничение множителя в зависимости от круга
    const multiplierInput = html.find('input[name="data.Multiplier"]');
    if (multiplierInput.length) {
      const circleInput = html.find('input[name="data.Circle"]');
      const enforceMultiplierLimit = async () => {
        const circle = this._parseCircleValue(circleInput);
        const maxMultiplier = this._getMaxLevelForCircle(circle);
        const currentMultiplier = parseFloat(multiplierInput.val());

        if (maxMultiplier > 0 && currentMultiplier > maxMultiplier) {
          multiplierInput.val(maxMultiplier);
          await this.item.update({ "system.Multiplier": maxMultiplier });
          ui.notifications.warn(`Максимально допустимое значение множителя для круга ${circle} — ${maxMultiplier}.`);
        }
      };

      multiplierInput.on('change', enforceMultiplierLimit);

      if (circleInput.length) {
        circleInput.on('change', enforceMultiplierLimit);
      }
    }

    if (this.item.type === "Skill") {
      html.find('.select-characteristics').click(this._onSelectCharacteristics.bind(this));
    }

    if (this.item.type === "Spell") {
      // Stage 1.5: DeliveryType controls which extra fields are visible.
      // We keep it client-side (no forced re-render) for smoother editing.
      this._toggleSpellDeliveryFields(html);
      html.find('.spell-delivery-select').off('change').on('change', this._onSpellDeliveryTypeChange.bind(this, html));
      html.find('.set-threshold').click(this._onSetThreshold.bind(this));

      // Effects editor (Stage 3.1)
      html.find(".effect-add").off("click").on("click", this._onSpellEffectAdd.bind(this));
      html.find(".effect-remove").off("click").on("click", this._onSpellEffectRemove.bind(this));
      html.find(".effect-type").off("change").on("change", this._onSpellEffectTypeChange.bind(this, html));
      html.find(".effect-text, .effect-debuffKey, .effect-stage")
        .off("change")
        .on("change", this._onSpellEffectFieldChange.bind(this));

      // Summon helper: dropdown writes selected Actor UUID into the text field.
      html.find(".summon-actor-pick").off("change").on("change", async (ev) => {
        const uuid = String($(ev.currentTarget).val() || "");
        if (!uuid) return;
        // Update the input value for UX
        html.find('input[name="data.SummonActorUuid"]').val(uuid);
        // Persist to item immediately (so user doesn't forget to save)
        await this.item.update({ "system.SummonActorUuid": uuid });
      });

    }
  }

  _toggleSpellDeliveryFields(html) {
    const delivery = String(this.item.system?.DeliveryType || "utility");
    // Hide all conditional rows first
    html.find('.spell-delivery-row').hide();

    if (delivery === "save-check") {
      html.find(".spell-delivery-save").show();
      return;
    }

    if (delivery === "aoe-template" || delivery === "create-object") {
      html.find(".spell-delivery-aoe").show();
      return;
    }

    if (delivery === "summon") {
      html.find(".spell-delivery-summon").show();
      return;
    }
  }


  async _onSpellDeliveryTypeChange(html, ev) {
    ev.preventDefault();
    const value = String(ev.currentTarget.value || 'utility');
    await this.item.update({ 'system.DeliveryType': value });
    // Update visibility without a full re-render.
    this._toggleSpellDeliveryFields(html);
  }


  async _onInHandChange(event) {
    event.preventDefault();
    const inHand = event.currentTarget.checked;

    const actor = this.item.actor;
    if (actor) {
      const updates = [{ _id: this.item.id, "system.inHand": inHand }];

      if (inHand) {
        const weaponType = this.item.system?.weaponType;
        const otherWeapons = actor.items.filter(i => (
          ["weapon", "meleeweapon", "rangeweapon"].includes(i.type) &&
          i.id !== this.item.id &&
          i.system?.inHand &&
          (!weaponType || i.system?.weaponType === weaponType)
        ));

        for (const w of otherWeapons) {
          updates.push({ _id: w.id, "system.inHand": false });
        }
      }

      await actor.updateEmbeddedDocuments("Item", updates);
    } else {
      await this.item.update({ "system.inHand": inHand });
    }
  }

  async _onWeaponTypeChange(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const weaponType = element.value;

    // Update the weapon's data
    await this.object.update({ "system.weaponType": weaponType });
  }

  async _onSelectCharacteristics(event) {
    event.preventDefault();
    const current = this.item.system.Characteristics || [];
    const chars = [
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
      "Stealth"
    ];

    const checkboxes = chars
      .map(c => `<label><input type="checkbox" name="char" value="${c}" ${current.includes(c) ? "checked" : ""}/> ${c}</label>`)
      .join('<br/>');

    new Dialog({
      title: "Выберите характеристики",
      content: `<form>${checkboxes}</form>`,
      buttons: {
        ok: {
          label: "OK",
          callback: html => {
            const selected = Array.from(html.find('input[name="char"]:checked')).map(i => i.value);
            this.item.update({ "system.Characteristics": selected });
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "ok"
    }).render(true);
  }

  async _onSetThreshold(event) {
    event.preventDefault();
    const current = this.item.system.UsageThreshold || 0;
    new Dialog({
      title: "Порог условия применения",
      content: `<div class="form-group"><input type="number" id="threshold" value="${current}" /></div>`,
      buttons: {
        ok: {
          label: "OK",
          callback: html => {
            const val = parseInt(html.find('#threshold').val()) || 0;
            this.item.update({ "system.UsageThreshold": val });
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "ok"
    }).render(true);
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
      0: 3,
      1: 5,
      2: 7,
      3: 9,
      4: 11
    };
    return maxLevels[circle] || 0;
  }

  _parseCircleValue(circleInput) {
    if (circleInput?.length) {
      const circleFromInput = parseInt(circleInput.val(), 10);
      if (!Number.isNaN(circleFromInput)) return circleFromInput;
    }

    const circleFromData = parseInt(this.item.system?.Circle, 10);
    return Number.isNaN(circleFromData) ? 0 : circleFromData;
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
            this.item.update({ "system.additionalAdvantages": additionalAdvantages });
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

  async _onAddField(ev) {
    ev.preventDefault();
    const fields = duplicate(this.item.system.additionalFields || []);
    const hiddenAdditional = fields.map((f, i) => ({ ...f, index: i })).filter(f => f.hidden);
    const hiddenDefaults = Object.keys(this.item.system.hiddenDefaults || {});

    if (hiddenAdditional.length > 0 || hiddenDefaults.length > 0) {
      let options = "";
      for (let f of hiddenAdditional) {
        options += `<option value="a-${f.index}">${f.name}</option>`;
      }
      for (let d of hiddenDefaults) {
        const label = DEFAULT_FIELD_LABELS[d] || d;
        options += `<option value="d-${d}">${label}</option>`;
      }

      new Dialog({
        title: "Скрытые поля",
        content: `<div class=\"form-group\"><label>Поле: <select name=\"field\">${options}</select></label></div>`,
        buttons: {
          show: {
            label: "Показать",
            callback: async html => {
              const choice = html.find('select[name=\"field\"]').val();
              if (!choice) return;
              if (choice.startsWith('a-')) {
                const idx = Number(choice.slice(2));
                if (fields[idx]) {
                  fields[idx].hidden = false;
                  if (fields[idx].value === '-') fields[idx].value = '';
                }
                await this.item.update({ "system.additionalFields": fields });
              } else if (choice.startsWith('d-')) {
                const name = choice.slice(2);
                const hidden = this.item.system.hiddenDefaults || {};
                let stored = hidden[name]?.value ?? "";
                if (stored === '-') stored = '';
                await this.item.update({
                  [`system.${name}`]: stored,
                  [`system.hiddenDefaults.-=${name}`]: null
                });
              }
              this.render(true);
              if (this.item.parent?.sheet) {
                this.item.parent.sheet.render(false);
              }
            }
          },
          add: {
            label: "Добавить новое",
            callback: () => this._addNewField()
          }
        },
        default: "show"
      }).render(true);
    } else {
      this._addNewField();
    }
  }

  _addNewField() {
    new Dialog({
      title: "Новое поле",
      content: '<div class="form-group"><label>Название: <input type="text" name="field-name"/></label></div>',
      buttons: {
        ok: {
          label: "ОК",
          callback: async html => {
            const name = html.find('input[name="field-name"]').val().trim();
            if (!name) return;
            const fields = duplicate(this.item.system.additionalFields || []);
            fields.push({ name, value: "", hidden: false, show: false });
            await this.item.update({ "system.additionalFields": fields });
            this.render(true);
          }
        }
      },
      default: "ok"
    }).render(true);
  }

  async _onAdditionalFieldChange(ev) {
    const index = Number(ev.currentTarget.dataset.index);
    const value = ev.currentTarget.value;
    const fields = duplicate(this.item.system.additionalFields || []);
    if (!fields[index]) return;
    if (value === '-') {
      fields[index].hidden = true;
      // keep previous value to restore when unhidden
    } else {
      fields[index].value = value;
    }
    await this.item.update({ "system.additionalFields": fields });
    this.render(true);
    if (this.item.parent?.sheet) {
      this.item.parent.sheet.render(false);
    }
  }

  async _onFieldChange(ev) {
    const input = ev.currentTarget;
    const name = input.name?.replace('data.', '');
    const value = (input.type === 'checkbox') ? input.checked : input.value;
    if (value === '-') {
      const hidden = duplicate(this.item.system.hiddenDefaults || {});
      hidden[name] = { value: this.item.system[name] };
      await this.item.update({ [`system.${name}`]: "", "system.hiddenDefaults": hidden });
    } else {
      await this.item.update({ [`system.${name}`]: value });
    }
    this.render(true);
    if (this.item.parent?.sheet) {
      this.item.parent.sheet.render(false);
    }
  }

  async _onFieldLabelClick(ev) {
    const label = ev.currentTarget;
    const type = label.dataset.type;
    if (type === 'additional') {
      const index = Number(label.dataset.index);
      const fields = duplicate(this.item.system.additionalFields || []);
      if (fields[index]) {
        fields[index].show = !fields[index].show;
        await this.item.update({ "system.additionalFields": fields });
        label.classList.toggle('selected', fields[index].show);
      }
    } else {
      const field = label.dataset.field;
      const display = duplicate(this.item.system.displayFields || {});
      display[field] = !display[field];
      await this.item.update({ "system.displayFields": display });
      label.classList.toggle('selected', display[field]);
    }
    if (this.item.parent?.sheet) {
      this.item.parent.sheet.render(false);
    }
  }

  async _onRemoveAttackCharacteristic(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = $(event.currentTarget).closest('.attack-char').data('index');
    itemId = parseInt(itemId);
    const AttackCharacteristics = this.item.system.AttackCharacteristics || [];

    let itemName = 'this attack characteristic';

    new Dialog({
      title: `Delete ${itemName}?`,
      content: `<p>Are you sure you want to delete ${itemName}?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Yes",
          callback: () => {
            AttackCharacteristics.splice(itemId, 1);
            this.item.update({ "system.AttackCharacteristics": AttackCharacteristics });
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
  }

  async _onUsedChange(event) {
    event.preventDefault();
    const isUsed = event.currentTarget.checked;

    await this.item.update({ "system.isUsed": isUsed });

    if (isUsed == false) {
      await this.item.update({ "system.isEquiped": isUsed });
    }
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


  _initializeConsumableTypeControls(html) {
    const typeSelect = html.find(".consumable-type-select");
    if (!typeSelect.length) return;

    const updateVisibility = (consumableType) => {
      const hideDamage = consumableType === "Доппинг" || consumableType === "Патроны";
      const hideRange = hideDamage;
      const hideThreshold = consumableType === "Патроны";

      const toggleField = (selector, shouldHide) => {
        const elements = html.find(selector);
        shouldHide ? elements.hide() : elements.show();
      };

      toggleField(".consumable-field--damage", hideDamage);
      toggleField(".consumable-field--range", hideRange);
      toggleField(".consumable-field--threshold", hideThreshold);
    };

    typeSelect.on("change", async (event) => {
      const selectedType = event.currentTarget.value;
      updateVisibility(selectedType);
      await this.item.update({ "system.TypeOfConsumables": selectedType });
    });

    updateVisibility(typeSelect.val() || "");
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

  async _loadDebuffsJson() {
    try {
      const response = await fetch("systems/Order/module/debuffs.json");
      if (!response.ok) throw new Error("Failed to load debuffs.json");
      return await response.json();
    } catch (err) {
      console.error(err);
      ui.notifications.error("Не удалось загрузить debuffs.json.");
      return null;
    }
  }

  async _addWeaponOnHitEffect() {
    // Только для оружия
    if (!["weapon", "meleeweapon", "rangeweapon"].includes(this.item.type)) {
      ui.notifications.warn("Эффекты оружия доступны только для предметов оружия.");
      return;
    }

    const debuffs = await this._loadDebuffsJson();
    if (!debuffs) return;

    const keys = Object.keys(debuffs);
    if (!keys.length) {
      ui.notifications.warn("В debuffs.json нет дебаффов.");
      return;
    }

    const options = keys
      .map(k => `<option value="${k}">${debuffs[k].name || k}</option>`)
      .join("");

    const content = `
    <form>
      <div class="form-group">
        <label>Эффект (debuffKey)</label>
        <select id="debuffKey" style="width:100%">${options}</select>
      </div>

      <div class="form-group">
        <label>Уровень (stateKey)</label>
        <select id="stateKey" style="width:100%">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </div>
    </form>
  `;

    new Dialog({
      title: "Добавить эффект оружия",
      content,
      buttons: {
        ok: {
          label: "Добавить",
          callback: async (html) => {
            const debuffKey = html.find("#debuffKey").val();
            const stateKey = Number(html.find("#stateKey").val()) || 1;

            const arr = Array.isArray(this.item.system.OnHitEffects)
              ? foundry.utils.duplicate(this.item.system.OnHitEffects)
              : [];

            // Чтобы не плодить дубликаты "тот же эффект/тот же уровень"
            const exists = arr.some(e => e?.debuffKey === debuffKey && Number(e?.stateKey) === stateKey);
            if (exists) {
              ui.notifications.warn("Такой эффект уже добавлен.");
              return;
            }

            arr.push({ debuffKey, stateKey });
            await this.item.update({ "system.OnHitEffects": arr });

            this.render(true);
            if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "ok"
    }).render(true);
  }

  async _removeWeaponOnHitEffect(event) {
    event.preventDefault();
    const index = Number($(event.currentTarget).closest(".weapon-effect-row").data("index"));
    const arr = Array.isArray(this.item.system.OnHitEffects)
      ? foundry.utils.duplicate(this.item.system.OnHitEffects)
      : [];

    if (Number.isNaN(index) || index < 0 || index >= arr.length) return;

    arr.splice(index, 1);
    await this.item.update({ "system.OnHitEffects": arr });

    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }


  async _onAddWeaponTag(event, html) {
    event.preventDefault();

    const input = html.find(".order-tag-input");
    let tag = String(input.val() ?? "").trim();
    if (!tag) return;

    tag = tag.toLowerCase();

    const tags = Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : [];

    if (!tags.includes(tag)) tags.push(tag);

    await this.item.update({ "system.tags": tags });
    input.val("");
    this.render(false);
  }

  async _onRemoveWeaponTag(event) {
    event.preventDefault();

    const idx = Number(event.currentTarget?.dataset?.index);
    if (!Number.isFinite(idx)) return;

    const tags = Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : [];
    if (idx < 0 || idx >= tags.length) return;

    tags.splice(idx, 1);

    await this.item.update({ "system.tags": tags });
    this.render(false);
  }

  /**
 * Rangeweapon: добавить пустую строку в system.OnHitEffects (как текстовое описание).
 * Также "нормализует" массив, если в нём вдруг лежали старые объекты.
 */
  async _addAccurateHitEffectText() {
    if (this.item.type !== "rangeweapon") return;

    const raw = Array.isArray(this.item.system.OnHitEffects)
      ? foundry.utils.duplicate(this.item.system.OnHitEffects)
      : [];

    // Нормализация на случай, если там лежат объекты старого формата
    const arr = raw.map(e => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object") {
        if (e.text) return String(e.text);
        if (e.debuffKey) return `${e.debuffKey} (lvl ${e.stateKey ?? "?"})`;
        try { return JSON.stringify(e); } catch { return String(e); }
      }
      return String(e ?? "");
    });

    arr.push("");
    await this.item.update({ "system.OnHitEffects": arr });

    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }

  async _removeAccurateHitEffectText(event) {
    event.preventDefault();
    //if (this.item.type !== "rangeweapon") return;

    const index = Number($(event.currentTarget).closest(".weapon-effect-row").data("index"));
    const arr = Array.isArray(this.item.system.OnHitEffects)
      ? foundry.utils.duplicate(this.item.system.OnHitEffects)
      : [];

    if (!Number.isFinite(index) || index < 0 || index >= arr.length) return;

    arr.splice(index, 1);
    await this.item.update({ "system.OnHitEffects": arr });

    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }

  async _onReloadRangeWeapon(event) {
    event.preventDefault();

    const weapon = this.item;
    const actor = weapon.parent;

    if (!actor) {
      ui.notifications.warn("Перезарядка доступна только если оружие находится на персонаже.");
      return;
    }

    const wSys = weapon.system ?? {};
    const magazine = Number(wSys.Magazine ?? 0) || 0;

    // Ищем расходники типа Consumables с TypeOfConsumables == "Патроны" и Amount > 0
    const ammoItems = actor.items.filter(i => {
      if (!i) return false;
      if (i.type !== "Consumables") return false;

      const s = i.system ?? {};
      const t = String(s.TypeOfConsumables ?? "").trim();
      const Quantity = Number(s.Quantity ?? 0) || 0;

      return t === "Патроны" && Quantity > 0;
    });

    if (!ammoItems.length) {
      ui.notifications.warn("В инвентаре нет патронов (Consumables → Type = 'Патроны' и Amount > 0).");
      return;
    }

    const options = ammoItems
      .map((it) => {
        const Quantity = Number(it.system?.Quantity ?? 0) || 0;
        return `<option value="${it.id}">${it.name} (${Quantity})</option>`;
      })
      .join("");

    const content = `
    <form>
      <div class="form-group">
        <label>Выбери патроны (расходник):</label>
        <select id="ammoItemId">${options}</select>
      </div>

      <div style="font-size:12px; opacity:0.8; margin-top:6px;">
        Текущее значение "Боезапас": <strong>${magazine}</strong><br/>
        При перезарядке боезапас увеличится на количество патронов в выбранном расходнике,
        а количество в расходнике станет 0.
      </div>
    </form>
  `;

    const applyReload = async (html) => {
      const ammoId = html.find("#ammoItemId").val();
      const ammo = actor.items.get(ammoId);
      if (!ammo) {
        ui.notifications.error("Не найден выбранный расходник.");
        return;
      }

      const aSys = ammo.system ?? {};
      const Quantity = Number(aSys.Quantity ?? 0) || 0;

      if (Quantity <= 0) {
        ui.notifications.warn("В выбранном расходнике нет патронов.");
        return;
      }

      // 1) Увеличиваем боезапас оружия
      const currentMag = Number(weapon.system?.Magazine ?? 0) || 0;
      const newMag = currentMag + Quantity;

      // 2) Списываем патроны (Quantity -> 0)
      await weapon.update({ "system.Magazine": newMag });
      await ammo.update({ "system.Quantity": 0 });

      ui.notifications.info(`Перезарядка выполнена: +${Quantity} к боезапасу. "${ammo.name}" теперь 0.`);
    };

    new Dialog({
      title: `Перезарядить: ${weapon.name}`,
      content,
      buttons: {
        reload: {
          label: "Перезарядить",
          callback: applyReload
        },
        cancel: {
          label: "Отмена"
        }
      },
      default: "reload"
    }).render(true);
  }

  _getSpellEffectsArray() {
    const s = this.item.system ?? this.item.data?.system ?? {};
    const raw = s.Effects;

    // Back-compat: если Effects был строкой — превратим в массив текстового эффекта
    if (typeof raw === "string") {
      const txt = raw.trim();
      return txt ? [{ type: "text", text: txt }] : [];
    }
    return Array.isArray(raw) ? raw : [];
  }

  async _onSpellEffectAdd(ev) {
    ev.preventDefault();
    const effects = this._getSpellEffectsArray();
    effects.push({ type: "text", text: "" });
    await this.item.update({ "system.Effects": effects });
  }

  async _onSpellEffectRemove(ev) {
    ev.preventDefault();
    const idx = Number(ev.currentTarget.dataset.effectIndex);
    const effects = this._getSpellEffectsArray();
    if (Number.isNaN(idx) || idx < 0 || idx >= effects.length) return;
    effects.splice(idx, 1);
    await this.item.update({ "system.Effects": effects });
  }

  async _onSpellEffectTypeChange(html, ev) {
    ev.preventDefault();
    const idx = Number(ev.currentTarget.dataset.effectIndex);
    const type = String(ev.currentTarget.value || "text");

    const effects = this._getSpellEffectsArray();
    if (Number.isNaN(idx) || idx < 0 || idx >= effects.length) return;

    // Сбрасываем поля под тип
    if (type === "text") effects[idx] = { type: "text", text: effects[idx]?.text ?? "" };
    if (type === "debuff") effects[idx] = { type: "debuff", debuffKey: effects[idx]?.debuffKey ?? "", stage: Number(effects[idx]?.stage ?? 1) || 1 };

    await this.item.update({ "system.Effects": effects });

    // Переключаем видимость инпутов без re-render (на всякий)
    const row = html.find(`.effect-row[data-effect-index="${idx}"]`);
    row.find(".effect-text").toggle(type === "text");
    row.find(".effect-debuffKey, .effect-stage").toggle(type === "debuff");
  }

  async _onSpellEffectFieldChange(ev) {
    ev.preventDefault();
    const el = ev.currentTarget;
    const idx = Number(el.dataset.effectIndex);
    const effects = this._getSpellEffectsArray();
    if (Number.isNaN(idx) || idx < 0 || idx >= effects.length) return;

    const cls = el.className || "";

    if (cls.includes("effect-text")) {
      effects[idx].text = String(el.value ?? "");
    }
    if (cls.includes("effect-debuffKey")) {
      effects[idx].debuffKey = String(el.value ?? "");
    }
    if (cls.includes("effect-stage")) {
      const n = Number(el.value ?? 1) || 1;
      effects[idx].stage = Math.max(1, Math.floor(n));
    }

    await this.item.update({ "system.Effects": effects });
  }
}