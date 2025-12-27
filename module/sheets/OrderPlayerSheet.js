import { createMeleeAttackMessage } from "../../scripts/OrderMelee.js";


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
    const items = this.actor.items ? Array.from(this.actor.items) : [];
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

    const isItemUsed = (it) => {
      const equipped = it.system?.isEquiped || it.system?.isUsed;
      const weaponUsed = ["weapon", "meleeweapon", "rangeweapon"].includes(it.type) && it.system?.inHand;
      return equipped || weaponUsed;
    };

    const carryItems = inventoryItems.filter(i => (i.getFlag("Order", "slotType") || "carry") === "carry" && !isItemUsed(i));
    const quickItems = inventoryItems.filter(i => i.getFlag("Order", "slotType") === "quick" && !isItemUsed(i));
    const overItems = inventoryItems.filter(i => i.getFlag("Order", "slotType") === "over" && !isItemUsed(i));
    const storageItems = inventoryItems.filter(i => i.getFlag("Order", "slotType") === "storage" && !isItemUsed(i));
    const usedItems = inventoryItems.filter(isItemUsed);
    const slots = [];
    const carrySlots = systemData.inventorySlots || 0;
    const quickSlots = systemData.quickAccessSlots || 0;

    carryItems.forEach(it => slots.push({ item: it, slotType: "carry", empty: false }));
    for (let i = carryItems.length; i < carrySlots; i++) slots.push({ item: null, slotType: "carry", empty: true });

    quickItems.forEach(it => slots.push({ item: it, slotType: "quick", empty: false }));
    for (let i = quickItems.length; i < quickSlots; i++) slots.push({ item: null, slotType: "quick", empty: true });

    overItems.forEach(it => slots.push({ item: it, slotType: "over", empty: false }));

    if (!slots.some(s => s.empty)) {
      slots.push({ item: null, slotType: "over", empty: true });
    }

    const storageSlots = storageItems.map(it => ({ item: it, slotType: "storage", empty: false }));
    storageSlots.push({ item: null, slotType: "storage", empty: true });

    const usedSlots = usedItems.map(it => ({
      item: it,
      slotType: it.getFlag("Order", "slotType") || "carry",
      empty: false,
      used: true
    }));

    if (usedSlots.length === 0) {
      usedSlots.push({ item: null, slotType: "used", empty: true, used: true });
    }

    sheetData.inventoryGrid = slots;
    sheetData.storageGrid = storageSlots;
    sheetData.usedGrid = usedSlots;


    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);

    let activeTooltip = null;
    let draggingInventory = false;
    let suppressInventoryTooltip = false;

    $(".active-tooltip").remove();
    $(".inventory-tooltip").hide();


    // При наведении на ".modifiers-wrapper"
    const bindTooltip = (wrapperSelector, tooltipSelector) => {
      html.find(wrapperSelector).on("mouseenter", (event) => {
        const target = $(event.currentTarget);
        const tooltip = target.find(tooltipSelector);

        if (activeTooltip) {
          activeTooltip.remove();
          activeTooltip = null;
        }

        // Скрываем оригинальный блок, чтобы не ломался верстка
        tooltip.hide();

        const offset = target.offset();
        activeTooltip = tooltip.clone()
          .appendTo("body")
          .addClass("active-tooltip")
          .css({
            top: offset.top + "px",
            left: offset.left + target.outerWidth() + 5 + "px",
            position: "absolute",
            display: "block",
            zIndex: 9999,
          });
      });

      // Когда уходим мышкой
      html.find(wrapperSelector).on("mouseleave", () => {
        if (activeTooltip) {
          activeTooltip.remove();
          activeTooltip = null;
        }
      });
      // Если хотим, чтобы подсказка следовала за мышкой
      html.find(wrapperSelector).on("mousemove", (event) => {
        if (activeTooltip) {
          const mouseX = event.pageX;
          const mouseY = event.pageY;
          activeTooltip.css({
            top: mouseY + "px",
            left: (mouseX + 10) + "px"
          });
        }
      });
    };

    bindTooltip(".modifiers-wrapper", ".modifiers-tooltip");
    bindTooltip(".weapon-penalty-wrapper", ".weapon-penalty-tooltip");

    html.find(".roll-dice").on("click", async (event) => {
      event.preventDefault();
      const itemId = event.currentTarget.closest(".item").dataset.itemId;
      const item = this.actor.items.get(itemId);

      if (!item) {
        ui.notifications.warn("Элемент не найден.");
        return;
      }

      const data = item.system || item.data.system;
      let characteristic = null;

      if (item.type === "Skill") {
        const chars = Array.isArray(data.Characteristics) ? data.Characteristics : [];
        if (chars.length === 1) {
          characteristic = chars[0];
        } else if (chars.length > 1) {
          characteristic = await this._selectCharacteristic(chars);
        }
      } else if (item.type === "Spell") {
        characteristic = "Magic";
      }

      let charValue = 0;
      let modValue = 0;
      if (characteristic) {
        const charData = this.actor.data.system[characteristic] || {};
        charValue = Number(charData.value || 0);
        modValue = (charData.modifiers || []).reduce((acc, m) => acc + (Number(m.value) || 0), 0);
      }

      let formula = "1d20";
      if (charValue !== 0) {
        formula += charValue > 0 ? ` + ${charValue}` : ` - ${Math.abs(charValue)}`;
      }
      if (modValue !== 0) {
        formula += modValue > 0 ? ` + ${modValue}` : ` - ${Math.abs(modValue)}`;
      }

      const roll = await new Roll(formula).roll({ async: true });
      const rollHTML = await roll.render();

      let outcomeText = "";
      if (item.type === "Spell") {
        const threshold = Number(data.UsageThreshold);
        if (!isNaN(threshold) && threshold !== 0) {
          outcomeText = roll.total >= threshold ? "Успех" : "Провал";
        }
      }

      const extraFields = item.type === "Spell"
        ? `<p><strong>Уровень усталости:</strong> ${data.LevelOfFatigue ?? "-"}</p>
           <p><strong>Множитель:</strong> ${data.Multiplier ?? "-"}</p>`
        : `<p><strong>Перезарядка:</strong> ${data.Cooldown ?? "-"}</p>`;

      const messageContent = `
        <div class="chat-item-message">
          <div class="item-header">
            <img src="${item.img}" alt="${item.name}" width="50" height="50">
            <h3>${item.name}</h3>
          </div>
          <div class="item-details">
            <p><strong>Описание:</strong> ${data.Description || "Нет описания"}</p>
            <p><strong>Урон:</strong> ${data.Damage ?? "-"}</p>
            <p><strong>Дистанция:</strong> ${data.Range ?? "-"}</p>
            <p><strong>Порог условия применения:</strong> ${data.UsageThreshold ?? "-"}</p>
            <p><strong>Уровень:</strong> ${data.Level ?? "-"}</p>
            <p><strong>Тип способности:</strong> ${data.TypeOFAbility ?? "-"}</p>
            <p><strong>Круг:</strong> ${data.Circle ?? "-"}</p>
            ${extraFields}
            <p><strong>Результат броска:</strong> ${roll.total}${outcomeText ? ` (${outcomeText})` : ""}</p>
            <div class="inline-roll">${rollHTML}</div>
          </div>
        </div>
      `;

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
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

      const data = item.system || item.data.system;
      const extraFields = item.type === "Spell"
        ? `<p><strong>Уровень усталости:</strong> ${data.LevelOfFatigue ?? "-"}</p>
           <p><strong>Множитель:</strong> ${data.Multiplier ?? "-"}</p>`
        : `<p><strong>Перезарядка:</strong> ${data.Cooldown ?? "-"}</p>`;


      // Формирование HTML для чата
      const messageContent = `
        <div class="chat-item-message">
          <div class="item-header">
            <img src="${item.img}" alt="${item.name}" width="50" height="50">
            <h3>${item.name}</h3>
          </div>
          <div class="item-details">
            <p><strong>Описание:</strong> ${data.Description || "Нет описания"}</p>
            <p><strong>Урон:</strong> ${data.Damage ?? "-"}</p>
            <p><strong>Дистанция:</strong> ${data.Range ?? "-"}</p>
            <p><strong>Порог условия применения:</strong> ${data.UsageThreshold ?? "-"}</p>
            <p><strong>Уровень:</strong> ${data.Level ?? "-"}</p>
            <p><strong>Тип способности:</strong> ${data.TypeOFAbility ?? "-"}</p>
            <p><strong>Круг:</strong> ${data.Circle ?? "-"}</p>
            ${extraFields}
          </div>
        </div>
      `;

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: messageContent,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      });
    });


    // NOTE: Melee damage is no longer applied by an "apply-damage" button.
    // The system now uses a full flow: attack -> defender chooses defense -> resolve -> apply damage.
    // Global handler is registered once in scripts/OrderMelee.js.


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
      if (draggingInventory) return;
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

    // Drag-and-drop relocation of inventory items
    const closeTooltip = () => {
      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }
      $(".active-tooltip").remove();
      $(".inventory-tooltip").hide();
    };

    html.find(".inventory-icon[item-draggable]").on("dragstart", ev => {
      const slot = ev.currentTarget.closest(".inventory-slot");
      const id = slot.dataset.itemId;
      const fromType = slot.dataset.slotType;
      draggingInventory = true;
      suppressInventoryTooltip = true;
      closeTooltip();
      if (id)
        ev.originalEvent.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ id, fromType })
        );
    });
    html.find(".inventory-icon[item-draggable]").on("dragend", () => {
      closeTooltip();
      setTimeout(() => {
        draggingInventory = false;
        suppressInventoryTooltip = false;
        closeTooltip();
      }, 200);
    });
    html.find(".inventory-slot").on("dragover", ev => ev.preventDefault());
    html.find(".inventory-slot").on("drop", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      closeTooltip();
      suppressInventoryTooltip = true;
      let data;
      try {
        data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain"));
      } catch (e) {
        return;
      }
      const { id, fromType } = data || {};
      const targetType = ev.currentTarget.dataset.slotType;
      const targetId = ev.currentTarget.dataset.itemId;
      if (!id || !targetType) return;

      const item = this.actor.items.get(id);
      const promises = [];
      if (item) promises.push(item.setFlag("Order", "slotType", targetType));
      if (targetId && targetId !== id) {
        const other = this.actor.items.get(targetId);
        if (other) promises.push(other.setFlag("Order", "slotType", fromType));
      }
      if (promises.length) await Promise.all(promises);
      this.render();
      setTimeout(() => {
        draggingInventory = false;
        suppressInventoryTooltip = false;
        closeTooltip();
      }, 200);
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

      const characteristics = weapon.system.AttackCharacteristics || [];
      this._showAttackRollDialog(weapon, characteristics);
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
    html.find('.weapon-inhand-checkbox').change(this._onWeaponInHandChange.bind(this));
    html.find('.is-equiped-checkbox').change(this._onEquipChange.bind(this));
    html.find('.apply-debuff').click(() => this._openDebuffDialog(this.actor));
    html.find('.remove-effect').click(this._onRemoveEffect.bind(this));
    html.find('.effect-level-increase').click(ev => this._onAdjustEffectLevel(ev, 1));
    html.find('.effect-level-decrease').click(ev => this._onAdjustEffectLevel(ev, -1));
    this._activateCircleListeners(html);
    this._initializeTabs(html);
  }

  async _onWeaponInHandChange(event) {
    event.preventDefault();

    const checkbox = event.currentTarget;
    const itemElement = checkbox.closest(".item");
    const itemId = itemElement?.dataset.itemId;

    if (!itemId) return;

    const inHand = checkbox.checked;
    const weaponItem = this.actor.items.get(itemId);
    if (!weaponItem) return;

    const updates = [{ _id: itemId, "system.inHand": inHand }];

    // Если оружие берётся в руку, убираем другие оружия того же типа из рук
    if (inHand) {
      const weaponType = weaponItem.system?.weaponType;
      const otherWeapons = this.actor.items.filter(i => (
        ["weapon", "meleeweapon", "rangeweapon"].includes(i.type) &&
        i.id !== itemId &&
        i.system?.inHand &&
        (!weaponType || i.system?.weaponType === weaponType)
      ));

      for (const w of otherWeapons) {
        updates.push({ _id: w.id, "system.inHand": false });
      }
    }

    await this.actor.updateEmbeddedDocuments("Item", updates);
  }

  async _onRemoveEffect(event) {
    let element = event.currentTarget;
    let itemId = element.closest(".effect-item").dataset.effectId;
    let effectToDelete = this.actor.effects.get(itemId);

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

  async _deleteClasses(classID) {
    const classesarr = this.getData().Classes;
    for (const classItem of classesarr) {
      if (classItem._id != classID) {
        await this._revertItemBonuses(classItem);
        await this.actor.deleteEmbeddedDocuments('Item', [classItem._id]);
      }
    }
  }

  _rollAttack(weapon, characteristic, applyModifiers = true, customModifier = 0, rollMode = "normal") {

    const dice =
      rollMode === "adv" ? "2d20kh1" :
        rollMode === "dis" ? "2d20kl1" :
          "1d20";


    const actorData = this.actor.system;
    console.log(actorData);
    const charValue = actorData[characteristic]?.value || 0; // Значение характеристики
    const modifiersArray = applyModifiers ? (actorData[characteristic]?.modifiers || []) : [];
    const charMod = applyModifiers
      ? modifiersArray.reduce((acc, m) => acc + (Number(m.value) || 0), 0)
      : 0;

    const attackEffectMod = applyModifiers ? this._getAttackEffectsBonus() : 0;
    const requirementMod = this._getWeaponRequirementPenalty(weapon);
    const requirementBonus = this._getWeaponRequirementBonus(weapon, characteristic);

    const totalMod = charMod + attackEffectMod + requirementMod + requirementBonus + (Number(customModifier) || 0);
    const weaponDamage = weapon.system.Damage || 0; // Урон оружия

    // Проверка наличия характеристики
    if (charValue === null || charValue === undefined) {
      ui.notifications.error(`Characteristic ${characteristic} not found.`);
      return;
    }

    const parts = [dice]; // базовый бросок
    if (charValue !== 0) {
      parts.push(
        charValue > 0
          ? `+ ${charValue}`
          : `- ${Math.abs(charValue)}`
      );
    }
    if (totalMod !== 0) {
      parts.push(
        totalMod > 0
          ? `+ ${totalMod}`
          : `- ${Math.abs(totalMod)}`
      );
    }
    const formula = parts.join(" ");
    const roll = new Roll(formula);

    roll.roll({ async: true }).then(async (result) => {
      if (typeof AudioHelper !== 'undefined' && CONFIG?.sounds?.dice) {
        AudioHelper.play({ src: CONFIG.sounds.dice });
      }

      // --- Order melee flow ---
      // We bind the attack to a single defender token chosen via T (user targets).
      const targets = Array.from(game.user.targets || []);
      if (targets.length !== 1) {
        ui.notifications.warn("Для атаки ближнего боя выбери ровно одну цель (клавиша T).");
        return;
      }
      const defenderToken = targets[0];

      // Attacker token: prefer a controlled token that belongs to this actor.
      const controlled = Array.from(canvas.tokens.controlled || []);
      const attackerToken = controlled.find(t => t.actor?.id === this.actor.id) || controlled[0] || null;
      if (!attackerToken) {
        ui.notifications.warn("Выдели своего токена (controlled), чтобы совершить атаку.");
        return;
      }

      // Урон оружия
      const weaponDamage = weapon.system?.Damage || 0;

      // создаём сообщение атаки для melee flow (без новых диалогов!)
      await createMeleeAttackMessage({
        attackerActor: this.actor,
        attackerToken,
        defenderToken,
        weapon,
        characteristic,
        applyModifiers,
        customModifier,
        attackRoll: result,
        damage: weaponDamage
      });


    });
  }

  _getAttackEffectsBonus() {
    return this.actor.effects.reduce((total, effect) => {
      if (!Array.isArray(effect.changes)) return total;
      const bonus = effect.changes
        .filter(c => c.key === "data.attributes.attack.mod")
        .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
      return total + bonus;
    }, 0);
  }

  _getWeaponRequirementPenalty(weapon) {
    const reqs = weapon.system.RequiresArray || [];
    return reqs.reduce((penalty, r) => {
      const char = r.RequiresCharacteristic;
      const need = Number(r.Requires) || 0;
      const have = this.actor.system[char]?.value || 0;
      return penalty - Math.max(0, need - have);
    }, 0);
  }

  _getWeaponRequirementBonus(weapon, characteristic) {
    const reqs = weapon.system.RequiresArray || [];
    const req = reqs.find(r => r.RequiresCharacteristic === characteristic);
    if (!req) return 0;

    const need = Number(req.Requires) || 0;
    const have = this.actor.system[characteristic]?.value || 0;
    if (have < need) return 0;

    const bonuses = weapon.system.additionalAdvantages || [];
    const entry = bonuses.find(b => b.Characteristic === characteristic);
    return entry ? Number(entry.Value) || 0 : 0;
  }

  _showAttackRollDialog(weapon, characteristics = []) {
    const chars = Array.isArray(characteristics) ? characteristics : [];
    const hasChars = chars.length > 0;

    if (!hasChars) {
      ui.notifications.warn(`Нужно добавить характеристику в оружие`);
    }

    const options = chars
      .map(char => `<option value="${char}">${game.i18n.localize(char)}</option>`)
      .join("");

    const charSelect = hasChars
      ? `<div class="form-group">
         <label for="characteristic">Choose Characteristic:</label>
         <select id="characteristic">${options}</select>
       </div>`
      : "";

    const content = `
    <form>
      ${charSelect}
      ${hasChars ? "" : "<p>Нужно добавить характеристику в оружие</p>"}

      <div class="form-group">
        <label for="modifier">Custom Modifier:</label>
        <input type="number" id="modifier" value="0" step="1" style="width: 80px;" />
      </div>

      <div class="form-group">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="applyMods" checked />
          Применять активные эффекты (моды характеристики)
        </label>
      </div>

      <p>Выберите вариант броска:</p>
    </form>
  `;

    const dialog = new Dialog({
      title: `Roll Attack for ${weapon.name}`,
      content,
      buttons: {
        normal: {
          label: "Обычный",
          callback: html => {
            const characteristic = html.find("#characteristic").val();
            const customMod = html.find("#modifier").val();
            const applyMods = html.find("#applyMods").is(":checked");
            this._rollAttack(weapon, characteristic, applyMods, customMod, "normal");
          }
        },
        adv: {
          label: "Преимущество",
          callback: html => {
            const characteristic = html.find("#characteristic").val();
            const customMod = html.find("#modifier").val();
            const applyMods = html.find("#applyMods").is(":checked");
            this._rollAttack(weapon, characteristic, applyMods, customMod, "adv");
          }
        },
        dis: {
          label: "Помеха",
          callback: html => {
            const characteristic = html.find("#characteristic").val();
            const customMod = html.find("#modifier").val();
            const applyMods = html.find("#applyMods").is(":checked");
            this._rollAttack(weapon, characteristic, applyMods, customMod, "dis");
          }
        }
      }
    });

    if (!hasChars) {
      Hooks.once("renderDialog", (app, html) => {
        if (app === dialog) {
          html.find('button[data-button="normal"]').prop("disabled", true);
          html.find('button[data-button="adv"]').prop("disabled", true);
          html.find('button[data-button="dis"]').prop("disabled", true);
        }
      });
    }

    dialog.render(true);
  }


  async _deleteRaces(raceID) {
    const racesarr = this.getData().Races;
    for (const raceItem of racesarr) {
      if (raceItem._id != raceID) {
        await this._revertItemBonuses(raceItem);
        await this.actor.deleteEmbeddedDocuments('Item', [raceItem._id]);
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
        await this._deleteClasses(existingClass.id);
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
        await this._deleteRaces(existingRace.id);
        ui.notifications.warn("This character already has a race.");
        return;
      }

      const itemData = foundry.utils.duplicate(item);
      delete itemData._id;
      const [createdItem] = await this.actor.createEmbeddedDocuments('Item', [itemData]);

      await this._applyRaceBonuses(createdItem);
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

    const applied = [];
    //Добавляем актёру все бонусы характеристик
    for (let bonus of item.system.additionalAdvantages) {
      if (bonus.flexible) {
        const res = await this._applyFlexibleRaceBonus(bonus);
        applied.push(...res);
        continue;
      }

      if (bonus.characters) {
        const res = await this._applyFixedPairBonus(bonus);
        applied.push(...res);
        continue;
      }

      const charName = bonus.Characteristic;
      const charValue = bonus.Value;
      if (!charName) continue;
      await this._changeCharacteristic(charName, charValue);
      applied.push({ char: charName, value: charValue });
    }

    await item.update({ "system.appliedBonuses": applied });
  }

  async _applyFlexibleRaceBonus(bonus) {
    const count = bonus.count || 1;
    const value = bonus.value || 0;
    const characteristics = [
      "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge",
      "Charisma", "Seduction", "Leadership", "Faith", "Medicine", "Magic", "Stealth"
    ];

    let selects = "";
    for (let i = 0; i < count; i++) {
      selects += `<select class="flex-char" data-index="${i}">` +
        characteristics.map(c => `<option value="${c}">${c}</option>`).join('') +
        `</select>`;
    }

    const action = value >= 0 ? "бонус" : "штраф";
    const content = `<form><p>Выберите характеристики, на которые будет применён ${action}:</p>${selects}</form>`;

    return new Promise(resolve => {
      new Dialog({
        title: "Выбор характеристик",
        content,
        buttons: {
          ok: {
            label: "OK",
            callback: async html => {
              const result = [];
              const chosen = [];
              for (let i = 0; i < count; i++) {
                const char = html.find(`select[data-index='${i}']`).val();
                if (chosen.includes(char)) {
                  ui.notifications.warn("Выберите разные характеристики.");
                  return false;
                }
                chosen.push(char);
              }

              for (const char of chosen) {
                await this._changeCharacteristic(char, value);
                result.push({ char, value });
              }
              resolve(result);
            }
          }
        },
        default: "ok"
      }).render(true);
    });
  }

  async _applyFixedPairBonus(bonus) {
    const [c1, c2] = bonus.characters;
    const value = bonus.value || 0;

    if (!c1 || !c2) return;

    return new Promise(resolve => {
      new Dialog({
        title: "Бонус расы",
        content: `<p>Выберите распределение бонуса:</p>`,
        buttons: {
          first: {
            label: `${value >= 0 ? '+' : ''}${value} к ${c1}`,
            callback: async () => { await this._changeCharacteristic(c1, value); resolve([{ char: c1, value }]); }
          },
          second: {
            label: `${value >= 0 ? '+' : ''}${value} к ${c2}`,
            callback: async () => { await this._changeCharacteristic(c2, value); resolve([{ char: c2, value }]); }
          },
          both: {
            label: `${value >= 0 ? '+' : ''}${value / 2} к ${c1} и ${c2}`,
            callback: async () => {
              await this._changeCharacteristic(c1, value / 2);
              await this._changeCharacteristic(c2, value / 2);
              resolve([{ char: c1, value: value / 2 }, { char: c2, value: value / 2 }]);
            }
          }
        },
        default: "first"
      }).render(true);
    });
  }

  async _changeCharacteristic(charName, delta) {
    const current = this.actor.data.system[charName]?.value || 0;
    await this.actor.update({ [`data.${charName}.value`]: current + delta });
  }

  async _revertItemBonuses(item) {
    const applied = item.system.appliedBonuses;
    if (Array.isArray(applied)) {
      for (const b of applied) {
        await this._changeCharacteristic(b.char, -b.value);
      }
      return;
    }

    // fallback for old data
    for (let bonus of item.system.additionalAdvantages || []) {
      const charName = bonus.Characteristic;
      const charValue = bonus.Value;
      if (!charName) continue;
      await this._changeCharacteristic(charName, -charValue);
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
          callback: async () => await this._deleteClasses(classItem.id)
        }
      },
      default: "ok"
    }).render(true);
  }

  async _applyClassBonuses(html, classItem) {
    const selectedSkillId = html.find('select[name="skills"]').val();
    const selectedSkill = classItem.system.Skills.find(skill => skill._id === selectedSkillId);

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
          callback: async () => {
            // Если это не Class и не Race — просто удаляем.
            if (itemToDelete.type !== "Class" && itemToDelete.type !== "Race") {
              this.actor.deleteEmbeddedDocuments("Item", [itemId]);
            } else {
              // Если Class или Race

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
    let customMods = [];
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
           <div id="custom-mod-list" style="margin-top:5px;"></div>
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
          callback: (html) => {
            const totalCustom = customMods.reduce((acc, m) => acc + (Number(m.value) || 0), 0);
            this._rollCharacteristic(attribute, characteristicModifiers, totalCustom);
          }
        },
      },
      render: html => {
        html.find('#add-modifier').click(ev => {
          ev.preventDefault();
          const val = parseInt(html.find('#modifier').val() || 0, 10);
          const type = html.find('#modifier-type').val();
          if (!isNaN(val) && val !== 0) {
            customMods.push({ value: val, type });
            const modList = html.find('#custom-mod-list');
            modList.append(`<div>${type}: ${val > 0 ? '+' : ''}${val}</div>`);
          }
          html.find('#modifier').val(0);
        });
      }
    });
    dialog.render(true);
  }

  _rollCharacteristic(attribute, baseArray = [], customTotal = 0) {
    const characteristicValue = this.actor.data.system[attribute]?.value || 0;

    // Берём массив
    const modifiersArray = Array.isArray(baseArray)
      ? baseArray
      : this.actor.data.system[attribute]?.modifiers || [];

    // Суммируем
    const baseModifiers = modifiersArray.reduce((acc, m) => acc + (Number(m.value) || 0), 0);
    const totalModifiers = baseModifiers + Number(customTotal || 0);

    // Формируем формулу броска динамически, исключая нулевые значения
    const parts = ["1d20"]; // базовый бросок
    if (characteristicValue !== 0) {
      parts.push(
        characteristicValue > 0
          ? `+ ${characteristicValue}`
          : `- ${Math.abs(characteristicValue)}`
      );
    }
    if (totalModifiers !== 0) {
      parts.push(
        totalModifiers > 0
          ? `+ ${totalModifiers}`
          : `- ${Math.abs(totalModifiers)}`
      );
    }
    const diceFormula = parts.join(" ");

    const roll = new Roll(diceFormula);
    roll.roll({ async: true }).then(result => {
      result.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: totalModifiers !== 0 ? `Бросок с бонусами (${totalModifiers})` : "Бросок без бонусов",
      });
    });
  }

  async _selectCharacteristic(options = []) {
    return await new Promise(resolve => {
      const opts = options.map(o => `<option value="${o}">${o}</option>`).join('');
      new Dialog({
        title: "Выбор характеристики",
        content: `<div class="form-group"><select id="char-select">${opts}</select></div>`,
        buttons: {
          ok: { label: "OK", callback: html => resolve(html.find('#char-select').val()) },
          cancel: { label: "Отмена", callback: () => resolve(null) }
        },
        default: "ok",
        close: () => resolve(null)
      }).render(true);
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
    const systemStates = await this._fetchDebuffData();
    if (!systemStates) return;

    // Получаем ключи дебаффов
    const debuffKeys = Object.keys(systemStates);

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
    const systemStates = await this._fetchDebuffData();
    if (!systemStates) return;

    const debuff = systemStates[debuffKey];
    if (!debuff || !debuff.states[stateKey]) {
      ui.notifications.error("Invalid debuff or state");
      return;
    }
    const stageChanges = Array.isArray(debuff.changes?.[stateKey])
      ? debuff.changes[stateKey].map(change => ({ ...change }))
      : [];

    const maxState = Object.keys(debuff.states || {}).length;
    const existingEffect = actor.effects.find(e => e.getFlag("Order", "debuffKey") === debuffKey);
    const updateData = {
      changes: stageChanges,
      label: `${debuff.name}`,
      icon: debuff.icon || "icons/svg/skull.svg",
      'flags.description': debuff.states[stateKey],
      'flags.Order.debuffKey': debuffKey,
      'flags.Order.stateKey': Number(stateKey),
      'flags.Order.maxState': maxState
    };

    if (existingEffect) {
      await existingEffect.update(updateData);
    } else {
      const effectData = {
        label: `${debuff.name}`,
        icon: debuff.icon || "icons/svg/skull.svg",
        changes: stageChanges,
        duration: {
          rounds: 1 // Пример длительности
        },
        flags: {
          description: debuff.states[stateKey],
          Order: {
            debuffKey,
            stateKey: Number(stateKey),
            maxState
          }
        }
      };

      await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    }
  }


  async _onAdjustEffectLevel(event, delta) {
    event.preventDefault();

    const effectElement = event.currentTarget.closest(".effect-item");
    const effectId = effectElement?.dataset.effectId;
    if (!effectId) return;

    const effect = this.actor.effects.get(effectId);
    if (!effect) return;

    const debuffKey = effect.getFlag("Order", "debuffKey");
    if (!debuffKey) {
      ui.notifications.warn("Этот эффект нельзя изменить таким образом.");
      return;
    }
    const systemStates = await this._fetchDebuffData();
    if (!systemStates) return;
    const debuff = systemStates[debuffKey];
    if (!debuff) {
      ui.notifications.error("Не удалось найти данные дебаффа.");
      return;
    }
    const maxState = Object.keys(debuff.states || {}).length || effect.getFlag("Order", "maxState") || 1;
    const currentState = Number(effect.getFlag("Order", "stateKey")) || 1;
    const newState = Math.min(Math.max(currentState + delta, 1), maxState);

    if (newState === currentState) return;

    const stageChanges = Array.isArray(debuff.changes?.[newState])
      ? debuff.changes[newState].map(change => ({ ...change }))
      : [];

    await effect.update({
      changes: stageChanges,
      'flags.description': debuff.states[newState],
      'flags.Order.stateKey': newState,
      'flags.Order.maxState': maxState
    });
  }

  async _fetchDebuffData() {
    try {
      const response = await fetch("systems/Order/module/debuffs.json");
      if (!response.ok) throw new Error("Failed to load debuffs.json");
      return await response.json();
    } catch (err) {
      console.error(err);
      ui.notifications.error("Не удалось загрузить состояния дебаффов.");
      return null;
    }
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

Handlebars.registerHelper("add", function (a, b) {
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
      await handleCustomEffectChange(actor, effect, change, /* isDelete=*/false);
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
    await removeCustomEffectEntries(actor, effect);

    // 2) Применим заново
    for (const change of effect.changes) {
      if (change.mode === 0 && change.key?.startsWith("myCustomEffect.")) {
        await handleCustomEffectChange(actor, effect, change, /* isDelete=*/false);
      }
    }
  }
});

async function handleCustomEffectChange(actor, effect, change, isDelete = false) {
  // Пример: key = "myCustomEffect.strengthMod"
  // => Нужно извлечь "strength" из ключа, чтобы понять, куда писать
  // Разделим строку по точке:
  // "myCustomEffect" [0], "strengthMod" [1]
  const [prefix, charKeyAndSuffix] = change.key.split(".");

  const charKey = charKeyAndSuffix.replace("Mod", ""); // strength
  const movementValue = Number(actor.system?.Movement?.value) || 0;
  let modValue;

  if (change.value === "@halfMovement") {
    modValue = -movementValue / 2;
  } else if (change.value === "@fullMovement") {
    modValue = -movementValue;
  } else {
    const numericValue = Number(change.value);
    modValue = Number.isNaN(numericValue) ? 0 : numericValue;
  }

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
  await actor.update({ [path]: currentArray });
}


async function removeCustomEffectEntries(actor, effect) {
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
    await actor.update(updates);
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
  await removeCustomEffectEntries(actor, effect);
});


