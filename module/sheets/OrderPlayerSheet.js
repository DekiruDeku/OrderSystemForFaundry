import { createMeleeAttackMessage, createMeleeAoEAttackMessage } from "../../scripts/OrderMelee.js";
import { collectWeaponAoETargetIds } from "../../scripts/OrderWeaponAoE.js";
import { startRangedAttack } from "../../scripts/OrderRange.js";
import { startSpellCast } from "../../scripts/OrderSpell.js";
import { startSkillUse } from "../../scripts/OrderSkill.js";
import { getSkillCooldownView } from "../../scripts/OrderSkillCooldown.js";
import { OrderCharacterCreationWizard } from "../../scripts/OrderCharacterCreationWizard.js";
import { OrderRankUpWizard } from "../../scripts/OrderRankUpWizard.js";

export default class OrderPlayerSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player"],
      template: "systems/Order/templates/sheets/Player-sheet.hbs",
      width: 1256,
      height: 715,
      resizable: true,
      // Keep scroll handling predictable in the new layout
      scrollY: [".os-left-content", ".os-meta-scroll", ".os-effects-list"]
    });
  }

  getHeaderButtons() {
    const buttons = super.getHeaderButtons();
    try {
      if (this.actor?.type === "Player" && this.actor.isOwner) {
        buttons.unshift({
          label: "Помощник",
          class: "os-ccw-open",
          icon: "fas fa-hat-wizard",
          onclick: () => new OrderCharacterCreationWizard(this.actor).render(true)
        });
      }
    } catch (err) {
      console.error("[Order] Could not add CCW header button", err);
    }
    return buttons;
  }

  /**
   * Restore last used sheet size (client-side) while keeping the requested default.
   */
  render(force, options = {}) {
    try {
      const saved = game.user?.getFlag("Order", "playerSheetSize");
      if (saved && Number(saved.width) > 200 && Number(saved.height) > 200) {
        options = mergeObject(options, {
          width: Number(saved.width),
          height: Number(saved.height)
        }, { inplace: false });
      }
    } catch (e) {
      // ignore
    }
    return super.render(force, options);
  }

  /**
   * Persist size when user resizes the sheet.
   */
  setPosition(position = {}) {
    const pos = super.setPosition(position);
    if (position.width || position.height) {
      this._debouncedSaveSheetSize();
    }
    return pos;
  }

  _debouncedSaveSheetSize() {
    clearTimeout(this._saveSheetSizeTimeout);
    this._saveSheetSizeTimeout = setTimeout(() => {
      this._saveSheetSize();
    }, 250);
  }

  async _saveSheetSize() {
    try {
      if (!game.user) return;
      const width = Math.round(Number(this.position?.width) || 0);
      const height = Math.round(Number(this.position?.height) || 0);
      if (width < 200 || height < 200) return;
      await game.user.setFlag("Order", "playerSheetSize", { width, height });
    } catch (e) {
      // ignore
    }
  }

  async close(options = {}) {
    await this._saveSheetSize();
    return super.close(options);
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
    const allSkillItems = items.filter(item => item.type === "Skill");
    const perkItems = allSkillItems.filter(it => !!it.system?.isPerk);
    const skillItems = allSkillItems.filter(it => !it.system?.isPerk);

    let sheetData = {
      owner: this.actor.isOwner,
      editable: this.isEditable,
      actor: actorData,
      data: systemData,
      config: CONFIG.Order,
      weapons: items.filter(item => item.type === "weapon" || item.type === "meleeweapon" || item.type === "rangeweapon"),
      Skills: skillItems,
      Perks: perkItems,
      armors: items.filter(item => item.type === "Armor"),
      Spells: items.filter(item => item.type === "Spell"),
      Classes: items.filter(item => item.type === "Class"),
      Races: items.filter(item => item.type === "Race"),
      Consumables: items.filter(item => item.type === "Consumables"),
      RegularItems: items.filter(item => item.type === "RegularItem"),
      effects: activeEffects // Включаем эффекты в данные
    };
    sheetData.Skills = sheetData.Skills.map(sk => {
      sk._cooldownView = getSkillCooldownView({ actor: this.actor, skillItem: sk });
      return sk;
    });

    sheetData.Perks = sheetData.Perks.map(pk => {
      pk._cooldownView = getSkillCooldownView({ actor: this.actor, skillItem: pk });
      return pk;
    });

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
    const flaggedOverItems = inventoryItems.filter(i => i.getFlag("Order", "slotType") === "over" && !isItemUsed(i)); const storageItems = inventoryItems.filter(i => i.getFlag("Order", "slotType") === "storage" && !isItemUsed(i));
    const usedItems = inventoryItems.filter(isItemUsed);
    const slots = [];
    const carrySlots = systemData.inventorySlots || 0;
    const quickSlots = systemData.quickAccessSlots || 0;

    const carryInSlots = carryItems.slice(0, carrySlots);
    const overflowCarryItems = carryItems.slice(carrySlots);
    const quickInSlots = quickItems.slice(0, quickSlots);
    const overflowQuickItems = quickItems.slice(quickSlots);
    const overItems = [...flaggedOverItems, ...overflowCarryItems, ...overflowQuickItems];

    carryInSlots.forEach(it => slots.push({ item: it, slotType: "carry", empty: false }));
    for (let i = carryInSlots.length; i < carrySlots; i++) slots.push({ item: null, slotType: "carry", empty: true });

    quickInSlots.forEach(it => slots.push({ item: it, slotType: "quick", empty: false }));
    for (let i = quickInSlots.length; i < quickSlots; i++) slots.push({ item: null, slotType: "quick", empty: true });

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

    if (!usedSlots.some(slot => slot.empty)) {
      usedSlots.push({ item: null, slotType: "used", empty: true, used: true });
    }

    sheetData.inventoryGrid = slots;
    sheetData.storageGrid = storageSlots;
    sheetData.usedGrid = usedSlots;


    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);
    return sheetData;
  }

  async _promoteOverItemsToSlots(armorItem) {
    const inventorySlots = Number(armorItem?.system?.inventorySlots || 0);
    const quickSlots = Number(armorItem?.system?.quickAccessSlots || 0);
    if (!inventorySlots && !quickSlots) return;

    const inventoryItems = this.actor.items.filter((item) =>
      ["weapon", "meleeweapon", "rangeweapon", "Armor", "Consumables", "RegularItem"].includes(item.type)
    );

    const isItemUsed = (it) => {
      const equipped = it.system?.isEquiped || it.system?.isUsed;
      const weaponUsed = ["weapon", "meleeweapon", "rangeweapon"].includes(it.type) && it.system?.inHand;
      return equipped || weaponUsed;
    };

    const carryItems = inventoryItems.filter(
      (i) => (i.getFlag("Order", "slotType") || "carry") === "carry" && !isItemUsed(i)
    );
    const quickItems = inventoryItems.filter(
      (i) => i.getFlag("Order", "slotType") === "quick" && !isItemUsed(i)
    );
    const overItems = inventoryItems.filter(
      (i) => i.getFlag("Order", "slotType") === "over" && !isItemUsed(i)
    );

    const updates = [];
    const availableCarry = Math.max(0, inventorySlots - carryItems.length);
    overItems.splice(0, availableCarry).forEach((item) => {
      updates.push(item.setFlag("Order", "slotType", "carry"));
    });

    const availableQuick = Math.max(0, quickSlots - quickItems.length);
    overItems.splice(0, availableQuick).forEach((item) => {
      updates.push(item.setFlag("Order", "slotType", "quick"));
    });

    if (updates.length) await Promise.all(updates);
  }

  activateListeners(html) {
    super.activateListeners(html);

    let activeTooltip = null;
    let draggingInventory = false;
    let suppressInventoryTooltip = false;

    $(".active-tooltip").remove();
    $(".inventory-tooltip").hide();

    // Rank-up wizard (arrow button next to Rank)
    html.find('[data-action="rank-up"]').on("click", (event) => {
      event.preventDefault();
      try {
        new OrderRankUpWizard(this.actor).render(true);
      } catch (e) {
        console.error("[Order] Failed to open RankUp wizard", e);
      }
    });


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

      // Skills use the old quick-roll flow.
      if (item.type === "Skill") {
        await startSkillUse({
          actor: this.actor,
          skillItem: item
        });
        return;
      }

      // Spells switch to a proper "cast" flow (dialog + costs).
      if (item.type === "Spell") {
        await startSpellCast({
          actor: this.actor,
          spellItem: item
        });

        return;
      }

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
        ? `<p><strong>Множитель:</strong> ${data.Multiplier ?? "-"}</p>`
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


    // Клик по названию характеристики -> тренировка
    html.find(".train-characteristic").on("click", (ev) => {
      ev.preventDefault();
      const attribute = ev.currentTarget?.dataset?.attribute;
      if (!attribute) return;
      this._openTrainingDialog(attribute);
    });

    // Тренировка навыков/заклинаний (социалка): отдельная иконка "книжка" на карточке.
    html.find(".train-item").on("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const itemId = ev.currentTarget.closest(".item")?.dataset?.itemId;
      if (!itemId) return;
      const item = this.actor.items.get(itemId);
      if (!item) {
        ui.notifications?.warn?.("Элемент не найден.");
        return;
      }
      if (!["Skill", "Spell"].includes(item.type)) return;
      // Перки сюда не пускаем — у них отдельная логика прокачки.
      if (item.type === "Skill" && item.system?.isPerk) return;
      this._openItemTrainingDialog(item);
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
      const fromUsed = slot.classList.contains("used");
      suppressInventoryTooltip = true;
      closeTooltip();

      const dt = ev.originalEvent.dataTransfer;
      if (!dt) return;

      // 1) Foundry-standard Item drag data (so dropping to hotbar works)
      if (id) {
        const item = this.actor.items.get(id);
        if (item) {
          const dragData = (typeof item.toDragData === "function")
            ? item.toDragData()
            : { type: "Item", uuid: item.uuid };
          dt.setData("text/plain", JSON.stringify(dragData));
        }
      }

      // 2) Local inventory relocation payload (so internal DnD keeps working)
      if (id) {
        dt.setData("text/x-order-inventory", JSON.stringify({ id, fromType, fromUsed }));
      }
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
        const dt = ev.originalEvent.dataTransfer;
        const localRaw = dt?.getData("text/x-order-inventory");
        data = localRaw
          ? JSON.parse(localRaw)
          : JSON.parse(dt?.getData("text/plain") || "{}");
      } catch (e) {
        return;
      }
      const { id, fromType, fromUsed } = data || {};
      const targetSlot = ev.currentTarget;
      const targetType = targetSlot.dataset.slotType;
      const targetId = targetSlot.dataset.itemId;
      const targetUsed = targetSlot.classList.contains("used");
      if (!targetType) return;

      if (!id && data?.type === "Item" && data.uuid) {
        const droppedItem = await Item.fromDropData(data);
        if (!droppedItem) return;
        if (["Class", "Race"].includes(droppedItem.type)) {
          return;
        }
        const slotTypeForNew = targetUsed && targetType === "used"
          ? (droppedItem.getFlag("Order", "slotType") || "carry")
          : targetType;
        const itemData = droppedItem.toObject();
        delete itemData._id;
        itemData.flags = foundry.utils.mergeObject(itemData.flags ?? {}, {
          Order: {
            slotType: slotTypeForNew,
          },
        });
        if (targetUsed) {
          itemData.system = {
            ...(itemData.system ?? {}),
            isUsed: true,
          };
        }
        const [createdItem] = await this.actor.createEmbeddedDocuments("Item", [itemData]);
        this.render();
        if (createdItem?.type === "Armor" && targetUsed) {
          await this._promoteOverItemsToSlots(createdItem);
        }
        setTimeout(() => {
          draggingInventory = false;
          suppressInventoryTooltip = false;
          closeTooltip();
        }, 200);
        return;
      }

      if (!id) return;

      const item = this.actor.items.get(id);
      const promises = [];
      if (item) {
        let nextSlotType = targetType;
        if (targetUsed && targetType === "used") {
          nextSlotType = fromType || item.getFlag("Order", "slotType") || "carry";
        }
        promises.push(item.setFlag("Order", "slotType", nextSlotType));
        if (targetUsed) {
          promises.push(item.update({ "system.isUsed": true }));
        } else if (fromUsed) {
          promises.push(item.update({ "system.isUsed": false }));
        }
      }
      if (targetId && targetId !== id) {
        const other = this.actor.items.get(targetId);
        if (other) {
          promises.push(other.setFlag("Order", "slotType", fromType));
          if (fromUsed !== targetUsed) {
            promises.push(other.update({ "system.isUsed": fromUsed }));
          }
        }
      }
      const shouldPromote = item?.type === "Armor" && targetUsed && !fromUsed;
      if (promises.length) await Promise.all(promises);
      this.render();
      if (shouldPromote) {
        await this._promoteOverItemsToSlots(item);
      }
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

    // Textareas (biography + traits etc.)
    html.find('textarea').change(this._onTextAreaChange.bind(this));

    html.find('.item-delete').click(this._onItemDelete.bind(this));
    html.find('input[type="text"]').change(this._onInputChange.bind(this));
    html.find('.weapon-inhand-checkbox').change(this._onWeaponInHandChange.bind(this));
    html.find('.is-equiped-checkbox').change(this._onEquipChange.bind(this));
    html.find('.apply-debuff').click(() => this._openDebuffDialog(this.actor));
    html.find('.remove-effect').click(this._onRemoveEffect.bind(this));
    html.find('.effect-level-increase').click(ev => this._onAdjustEffectLevel(ev, 1));
    html.find('.effect-level-decrease').click(ev => this._onAdjustEffectLevel(ev, -1));

    // Отдельная кнопка и отдельный сценарий для оружия дальнего боя.
    // Логику дальнего боя будем наращивать дальше (пока stub в scripts/OrderRanged.js).
    html.find(".roll-ranged-attack").click(async (ev) => {
      const itemId = $(ev.currentTarget).data("item-id");
      const weapon = this.actor.items.get(itemId);
      if (!weapon) return;

      await startRangedAttack({ attackerActor: this.actor, weapon });
    });

    // --- Drag to hotbar (macros) ---
    // Пользователь тянет ИМЕННО за картинку. Если у <img> стоит draggable=false,
    // то dragstart не срабатывает и хотбар ничего не получает.
    // Поэтому:
    // 1) делаем иконки draggable=true
    // 2) на dragstart руками кладём Foundry-standard dragData Item'а в dataTransfer
    // 3) дополнительно оставляем draggable на .item (на случай если тянут за фон/название)

    const hotbarIconSelector = "img.skill-icon, img.spell-icon, img.os-eq-item-img";
    html.find(hotbarIconSelector)
      .attr("draggable", true)
      .off("dragstart.orderHotbarIcon")
      .on("dragstart.orderHotbarIcon", (ev) => {
        const e = ev?.originalEvent ?? ev;
        const dt = e?.dataTransfer;
        if (!dt) return;

        const itemEl = e?.currentTarget?.closest?.(".item") || ev.currentTarget?.closest?.(".item");
        const itemId = itemEl?.dataset?.itemId;
        if (!itemId) return;

        const item = this.actor.items.get(itemId);
        if (!item) return;

        const dragData = (typeof item.toDragData === "function")
          ? item.toDragData()
          : { type: "Item", uuid: item.uuid };

        dt.setData("text/plain", JSON.stringify(dragData));

        // Чтобы не срабатывал второй dragstart на родительском .item (двойная запись в dataTransfer)
        ev.stopPropagation();
      });

    html.find(".item")
      .not(".inventory-slot")
      .attr("draggable", true)
      .off("dragstart.orderHotbar")
      .on("dragstart.orderHotbar", this._onDragStart.bind(this));

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

  async _rollAttack(weapon, characteristic, applyModifiers = true, customModifier = 0, rollMode = "normal", options = {}) {

    const stealthAttack = !!options.stealthAttack;
    const aoeAttack = !!options.aoeAttack;

    const dice =
      rollMode === "adv" ? "2d20kh1" :
        rollMode === "dis" ? "2d20kl1" :
          "1d20";

    // Attacker token: prefer a controlled token that belongs to this actor.
    const controlled = Array.from(canvas.tokens.controlled || []);
    const attackerToken = controlled.find(t => t.actor?.id === this.actor.id) || controlled[0] || null;
    if (!attackerToken) {
      ui.notifications.warn("Выдели своего токена (controlled), чтобы совершить атаку.");
      return;
    }

    // Targets:
    // - обычная атака: ровно 1 цель (T)
    // - AoE: выбор через шаблон и подтверждение списка
    let defenderToken = null;
    let targetTokens = [];

    if (aoeAttack) {
      const { targetTokenIds } = await collectWeaponAoETargetIds({
        weaponItem: weapon,
        attackerToken,
        dialogTitle: "Цели атаки"
      });

      targetTokens = (Array.isArray(targetTokenIds) ? targetTokenIds : [])
        .map(id => canvas.tokens.get(String(id)))
        .filter(t => !!t);

      if (!targetTokens.length) {
        ui.notifications.warn("В области нет целей для атаки.");
        return;
      }
    } else {
      const targets = Array.from(game.user.targets || []);
      if (targets.length !== 1) {
        ui.notifications.warn("Для атаки ближнего боя выбери ровно одну цель (клавиша T).");
        return;
      }
      defenderToken = targets[0];
    }

    const actorData = this.actor.system;

    const charValue = Number(actorData?.[characteristic]?.value ?? 0) || 0;
    const modifiersArray = applyModifiers ? (actorData?.[characteristic]?.modifiers || []) : [];
    const charMod = applyModifiers
      ? modifiersArray.reduce((acc, m) => acc + (Number(m.value) || 0), 0)
      : 0;

    const attackEffectMod = applyModifiers ? this._getExternalRollModifier("attack") : 0;
    const requirementMod = applyModifiers ? this._getWeaponRequirementPenalty(weapon, characteristic) : 0;

    const totalMod = charMod + attackEffectMod + requirementMod + (Number(customModifier) || 0);

    if (characteristic && (actorData?.[characteristic] == null)) {
      ui.notifications.error(`Characteristic ${characteristic} not found.`);
      return;
    }

    const parts = [dice];
    if (charValue !== 0) {
      parts.push(charValue > 0 ? `+ ${charValue}` : `- ${Math.abs(charValue)}`);
    }
    if (totalMod !== 0) {
      parts.push(totalMod > 0 ? `+ ${totalMod}` : `- ${Math.abs(totalMod)}`);
    }

    const formula = parts.join(" ");
    const roll = await new Roll(formula).roll({ async: true });

    if (typeof AudioHelper !== 'undefined' && CONFIG?.sounds?.dice) {
      AudioHelper.play({ src: CONFIG.sounds.dice });
    }

    const weaponDamage = Number(weapon.system?.Damage ?? 0) || 0;

    if (aoeAttack) {
      await createMeleeAoEAttackMessage({
        attackerActor: this.actor,
        attackerToken,
        targetTokens,
        weapon,
        characteristic,
        applyModifiers,
        customModifier,
        attackRoll: roll,
        damage: weaponDamage,
        rollMode,
        stealthAttack
      });
    } else {
      await createMeleeAttackMessage({
        attackerActor: this.actor,
        attackerToken,
        defenderToken,
        weapon,
        characteristic,
        applyModifiers,
        customModifier,
        attackRoll: roll,
        damage: weaponDamage,
        rollMode,
        stealthAttack
      });
    }
  }

  _getAttackEffectsBonus() {
    return this.actor.effects.reduce((total, effect) => {
      if (!effect || effect.disabled) return total;

      const changes = Array.isArray(effect.changes) ? effect.changes : [];
      const bonus = changes
        .filter(c => c.key === "flags.Order.roll.attack")
        .reduce((sum, c) => sum + (Number(c.value) || 0), 0);

      return total + bonus;
    }, 0);
  }

  _getExternalRollModifier(kind) {
    const key = kind === "attack"
      ? "flags.Order.roll.attack"
      : "flags.Order.roll.defense";

    return this.actor.effects.reduce((total, effect) => {
      if (!effect || effect.disabled) return total;
      const changes = Array.isArray(effect.changes) ? effect.changes : [];
      const bonus = changes
        .filter(c => c.key === key)
        .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
      return total + bonus;
    }, 0);
  }



  _getWeaponRequirementPenalty(weapon, excludeCharacteristic = null) {
    const reqs = weapon.system.RequiresArray || [];
    const exclude = excludeCharacteristic ? String(excludeCharacteristic) : null;
    return reqs.reduce((penalty, r) => {
      const need = Number(r?.Requires) || 0;
      const c1 = String(r?.RequiresCharacteristic ?? "").trim();
      const c2 = String(r?.RequiresCharacteristicAlt ?? r?.RequiresCharacteristic2 ?? "").trim();
      const useOr = Boolean(r?.RequiresOr ?? r?.useOr ?? r?.or);

      if (!c1) return penalty;

      // OR requirement: satisfied if either characteristic meets the threshold.
      if (useOr && c2) {
        const have1 = Number(this.actor.system?.[c1]?.value ?? 0) || 0;
        const have2 = Number(this.actor.system?.[c2]?.value ?? 0) || 0;
        const best = Math.max(have1, have2);
        if (best >= need) return penalty;

        // If the chosen attack characteristic is one of the OR options, its penalty is already in char modifiers.
        if (exclude && (exclude === c1 || exclude === c2)) return penalty;

        return penalty - Math.max(0, need - best);
      }

      // Legacy/simple requirement
      if (exclude && c1 === exclude) return penalty;
      const have = Number(this.actor.system?.[c1]?.value ?? 0) || 0;
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
         <label for="characteristic">Характеристика броска:</label>
         <select id="characteristic">${options}</select>
       </div>`
      : "";

    const hasAoE = Number(weapon.system?.AoESize ?? 0) > 0;
    const aoeBlock = hasAoE ? `
  <div class="form-group">
    <label style="display:flex; gap:8px; align-items:center;">
      <input type="checkbox" id="aoeAttack" />
      Массовая атака (через шаблон области)
    </label>
  </div>
` : "";
    const content = `
    <form>
      ${charSelect}
      ${hasChars ? "" : "<p>Нужно добавить характеристику в оружие</p>"}

      <div class="form-group">
        <label for="modifier">Ручной модификатор:</label>
        <input type="number" id="modifier" value="0" step="1" style="width: 80px;" />
      </div>

      <div class="form-group">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="applyMods" checked />
          Применять активные эффекты (моды характеристики)
        </label>
      </div>
      <div class="form-group" style="display:flex; align-items:center; gap:8px;">
       <label style="display:flex; gap:8px; align-items:center;">
        <input type="checkbox" id="stealthAttack" />
            Скрытная атака (Stealth с помехой vs Knowledge цели)
        </label>
      </div>
      ${aoeBlock}

      <p>Выберите вариант броска:</p>
    </form>
  `;

    const dialog = new Dialog({
      title: `Бросок атаки — ${weapon.name}`,
      content,
      buttons: {
        normal: {
          label: "Обычный",
          callback: html => {
            const characteristic = html.find("#characteristic").val();
            const customMod = html.find("#modifier").val();
            const applyMods = html.find("#applyMods").is(":checked");
            const stealthAttack = html.find("#stealthAttack").is(":checked");
            this._rollAttack(weapon, characteristic, applyMods, customMod, "normal", { stealthAttack, aoeAttack });

          }
        },
        adv: {
          label: "Преимущество",
          callback: html => {
            const characteristic = html.find("#characteristic").val();
            const customMod = html.find("#modifier").val();
            const applyMods = html.find("#applyMods").is(":checked");
            const stealthAttack = html.find("#stealthAttack").is(":checked");
            this._rollAttack(weapon, characteristic, applyMods, customMod, "adv", { stealthAttack, aoeAttack });
          }
        },
        dis: {
          label: "Помеха",
          callback: html => {
            const characteristic = html.find("#characteristic").val();
            const customMod = html.find("#modifier").val();
            const applyMods = html.find("#applyMods").is(":checked");
            const stealthAttack = html.find("#stealthAttack").is(":checked");
            this._rollAttack(weapon, characteristic, applyMods, customMod, "dis", { stealthAttack, aoeAttack });
          }
        },
      },
      default: "normal"
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
    const skills = Array.isArray(item.system?.Skills) ? item.system.Skills : [];
    const selectOne = !!item.system?.selectOneSkill;

    // Add skills from race (all, or one if the flag is enabled)
    if (selectOne && skills.length > 0) {
      const selectedSkill = (skills.length === 1) ? skills[0] : await this._openRaceSkillSelectionDialog(item);
      if (!selectedSkill) {
        // Cancelled: remove the created race to avoid half-applied state
        await this.actor.deleteEmbeddedDocuments('Item', [item.id]);
        return;
      }

      const skillData = foundry.utils.duplicate(selectedSkill);
      delete skillData._id;
      await this.actor.createEmbeddedDocuments('Item', [skillData]);
    } else {
      for (let skill of skills) {
        const skillData = foundry.utils.duplicate(skill);
        delete skillData._id;
        await this.actor.createEmbeddedDocuments('Item', [skillData]);
      }
    }

    const applied = [];
    //Добавляем актёру все бонусы характеристик
    for (let bonus of item.system.additionalAdvantages) {
      if (Array.isArray(bonus?.options) && bonus.options.length) {
        const res = await this._applyAlternativeRaceBonus(bonus);
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


  _formatRaceBonusOption(option) {
    const o = option || {};
    const sign = (v) => (Number(v) >= 0 ? "+" : "");

    if (o.flexible) {
      const value = Number(o.value ?? o.Value ?? 0) || 0;
      const count = Number(o.count ?? 1) || 1;
      const word = count === 1 ? "характеристику" : (count >= 2 && count <= 4 ? "характеристики" : "характеристик");
      return `${sign(value)}${value} к ${count} ${word}`;
    }

    if (Array.isArray(o.characters) && o.characters.length) {
      const value = Number(o.value ?? o.Value ?? 0) || 0;
      const [c1, c2] = o.characters;
      const l1 = game.i18n?.localize?.(c1) ?? c1;
      const l2 = game.i18n?.localize?.(c2) ?? c2;
      return `${sign(value)}${value} к ${l1}${l2 ? ` / ${l2}` : ""}`;
    }

    if (o.Characteristic) {
      const value = Number(o.Value ?? o.value ?? 0) || 0;
      const label = game.i18n?.localize?.(o.Characteristic) ?? o.Characteristic;
      return `${label} ${sign(value)}${value}`;
    }

    return String(o?.label ?? o?.name ?? "Вариант");
  }

  async _applyAlternativeRaceBonus(bonus) {
    const options = Array.isArray(bonus?.options) ? bonus.options : (Array.isArray(bonus?.alternative) ? bonus.alternative : []);
    if (!options.length) return [];

    const content = `<p>Выберите вариант бонуса:</p>`;

    return new Promise(resolve => {
      const buttons = {};
      options.forEach((opt, idx) => {
        buttons[`opt_${idx}`] = {
          label: this._formatRaceBonusOption(opt),
          callback: async () => {
            let res = [];
            if (opt?.flexible) res = await this._applyFlexibleRaceBonus(opt);
            else if (opt?.characters) res = await this._applyFixedPairBonus(opt);
            else if (opt?.Characteristic) {
              const charName = opt.Characteristic;
              const charValue = Number(opt.Value ?? opt.value ?? 0) || 0;
              if (charName && Number.isFinite(charValue)) {
                await this._changeCharacteristic(charName, charValue);
                res = [{ char: charName, value: charValue }];
              }
            }
            resolve(res);
          }
        };
      });

      new Dialog({
        title: "Бонус расы",
        content,
        buttons,
        default: Object.keys(buttons)[0]
      }).render(true);
    });
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
        characteristics
          .map(c => {
            const label = game.i18n?.localize?.(c) ?? c;
            return `<option value="${c}">${label}</option>`;
          })
          .join('') +
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
      title: game.i18n.localize("Select Skill"),
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

  /**
   * Ask player to pick ONE skill from a Race item.
   * Returns the selected Skill source object or null if cancelled.
   */
  async _openRaceSkillSelectionDialog(raceItem) {
    const skills = Array.isArray(raceItem.system?.Skills) ? raceItem.system.Skills : [];
    if (!skills.length) return null;

    const content = `<form>
      <div class="form-group">
        <label for="race-skill">Выберите навык расы</label>
        <select id="race-skill" name="race-skill">
          ${skills.map(s => `<option value="${s._id}">${s.name}</option>`).join('')}
        </select>
      </div>
    </form>`;

    return new Promise(resolve => {
      let resolved = false;
      const dlg = new Dialog({
        title: "Выбор навыка расы",
        content,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: "OK",
            callback: (html) => {
              const selectedId = html.find('select[name="race-skill"]').val();
              const selected = skills.find(s => s._id === selectedId) || null;
              resolved = true;
              resolve(selected);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Отмена",
            callback: () => {
              resolved = true;
              resolve(null);
            }
          }
        },
        default: "ok",
        close: () => {
          if (!resolved) resolve(null);
        }
      });
      dlg.render(true);
    });
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
    const name = input?.name;
    if (!name) return;

    const dtype = (input.dataset?.dtype || input.getAttribute("data-dtype") || "").toLowerCase();

    // Default to string updates; only coerce to number when explicitly asked.
    let value;
    if (dtype === "number") {
      const n = Number(String(input.value).replace(",", "."));
      value = Number.isFinite(n) ? n : 0;
    } else {
      value = input.value;
    }

    await this.actor.update({ [name]: value });
  }

  async _onTextAreaChange(event) {
    const input = event.currentTarget;
    const name = input?.name;
    if (!name) return;

    // Backward compatibility: older templates used "biography" or "data.biography".
    if (name === "biography" || name === "data.biography") {
      await this.actor.update({ "system.biography": input.value });
      return;
    }

    await this.actor.update({ [name]: input.value });
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
      title: `Удалить «${itemName}»?`,
      content: `<p>Вы уверены, что хотите удалить <strong>${itemName}</strong>?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Да",
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


  /* ===========================
     Training system (click on stat name)
     =========================== */

  _trainingFlagScope() {
    return game.system?.id ?? "Order";
  }

  _loadTrainingDialogState(kind) {
    try {
      const scope = this._trainingFlagScope();
      return game.user?.getFlag(scope, `trainingDialog.${kind}`) ?? null;
    } catch (e) {
      return null;
    }
  }

  _saveTrainingDialogState(kind, app) {
    try {
      const scope = this._trainingFlagScope();
      const pos = app?.position ?? {};
      // Best-effort persistence; do not block UI on close.
      return game.user?.setFlag(scope, `trainingDialog.${kind}`, {
        width: pos.width,
        height: pos.height,
        left: pos.left,
        top: pos.top
      });
    } catch (e) {
      return null;
    }
  }

  _getTrainingDiceCount() {
    const k = Number(this.actor?.data?.system?.Knowledge?.value ?? 0) || 0;
    return (k >= 7) ? 4 : 3;
  }

  _computeTrainingBonus(statValue) {
    const v = Number(statValue) || 0;
    if (v <= 3) return v;                 // -10..+3 -> full
    if (v <= 6) return Math.floor(v / 2); // 4..6 -> /2
    return Math.floor(v / 3);             // 7..10 -> /3
  }

  _getCharacteristicLabel(attribute) {
    const map = {
      Strength: "Сила",
      Dexterity: "Ловкость",
      Stamina: "Выносливость",
      Accuracy: "Меткость",
      Will: "Сила духа",
      Knowledge: "Знания",
      Charisma: "Харизма",
      Seduction: "Обольщение",
      Leadership: "Лидерство",
      Faith: "Вера",
      Medicine: "Медицина",
      Magic: "Магия",
      Stealth: "Скрытность"
    };
    return map[attribute] ?? attribute;
  }

  _formatSigned(n) {
    const v = Number(n) || 0;
    if (v === 0) return "+0";
    return v > 0 ? `+${v}` : `${v}`;
  }

  _trainingDialogOptions(kind, defaults) {
    const saved = this._loadTrainingDialogState(kind);

    const rawW = Number(saved?.width) || defaults.width;
    const rawH = Number(saved?.height) || defaults.height;

    // Clamp to reasonable bounds so the dialog never opens "gigantic" by accident.
    const maxW = Math.min(window.innerWidth - 60, 980);
    const maxH = Math.min(window.innerHeight - 80, 760);
    const minW = 440;
    const minH = 240;

    const width = Math.max(minW, Math.min(rawW, maxW));
    const height = Math.max(minH, Math.min(rawH, maxH));

    const opts = {
      classes: ["os-ccw", "os-training"],
      resizable: true,
      width,
      height
    };

    if (Number.isFinite(saved?.left)) opts.left = saved.left;
    if (Number.isFinite(saved?.top)) opts.top = saved.top;

    return opts;
  }

  _openTrainingDialog(attribute) {
    try {
      const label = this._getCharacteristicLabel(attribute);
      const value = Number(this.actor?.data?.system?.[attribute]?.value ?? 0) || 0;
      const filled = Number(this.actor?.data?.system?.[attribute]?.filledSegments ?? 0) || 0;
      const total = this._calculateSegments(value);

      const dc = 10 + Math.max(0, value);
      const bonus = this._computeTrainingBonus(value);
      const diceCount = this._getTrainingDiceCount();

      const bonusStr = this._formatSigned(bonus);
      const chips = `
        <div class="os-ccw-inline" style="margin-top:8px;">
          <span class="os-ccw-chip">Показатель: <strong>${value}</strong></span>
          <span class="os-ccw-chip">Круг: <strong>${filled}/${total}</strong></span>
          <span class="os-ccw-chip">Кубики: <strong>${diceCount}d20</strong></span>
        </div>
      `;

      const content = `
        <form class="os-ccw">
          <header class="os-ccw-header">
            <h2 class="os-ccw-title">Серия бросков</h2>
            <div class="os-ccw-progress">СЛ ${dc} · Бонус ${bonusStr} · ${diceCount} броска</div>
            ${chips}
          </header>

          <section class="os-ccw-body">
            <p style="margin-top:0;">Окей, давай прокачаем <strong>${label}</strong>. Ты делаешь серию бросков, и за удачные попытки получаешь очки обучения (О.О).</p>

            <p class="notes" style="margin-bottom:6px;">
              <strong>Успех</strong> даёт +1 О.О, <strong>чистая 20</strong> даёт +2 О.О, а <strong>чистая 1</strong> — риск: можно потерять О.О или вообще прервать тренировку.
            </p>

            <p class="notes" style="margin:0;">
              Нажми <strong>«Бросить»</strong> — броски улетят в чат, а потом появится окно с итогом и кнопкой <strong>«Применить»</strong>.
            </p>
          </section>

        </form>
      `;

      let dlg;
      dlg = new Dialog({
        title: `Тренировка: ${label}`,
        content,
        buttons: {
          roll: {
            label: "Бросить",
            callback: async () => {
              await this._rollTraining(attribute, { label, value, dc, bonus, diceCount });
            }
          },
          cancel: { label: "Отмена" }
        },
        default: "roll",
        close: () => { this._saveTrainingDialogState("series", dlg); }
      }, this._trainingDialogOptions("series", { width: 620, height: 420 }));

      dlg.render(true);
    } catch (err) {
      console.error("[Order] Training dialog failed", err);
      ui.notifications?.error?.("Не удалось открыть окно тренировки. Проверь консоль (F12).");
    }
  }

  async _rollTraining(attribute, { label, value, dc, bonus, diceCount }) {
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const bonusStr = this._formatSigned(bonus);
    const formula = `1d20${bonus === 0 ? "" : (bonus > 0 ? ` + ${bonus}` : ` - ${Math.abs(bonus)}`)}`;

    const results = [];
    let totalPoints = 0;
    let critFails = 0;

    for (let i = 1; i <= diceCount; i++) {
      const roll = await (new Roll(formula)).evaluate({ async: true });
      const nat = roll?.dice?.[0]?.results?.[0]?.result ?? null;
      const total = Number(roll.total ?? 0) || 0;

      const isCritSuccess = nat === 20;
      const isCritFail = nat === 1;
      const isSuccess = isCritSuccess || (!isCritFail && total >= dc);

      let points = 0;
      if (isCritSuccess) points = 2;
      else if (isSuccess) points = 1;

      if (isCritFail) critFails += 1;

      totalPoints += points;
      results.push({ index: i, nat, total, isCritSuccess, isCritFail, isSuccess, points });

      await roll.toMessage({
        speaker,
        flavor: `Тренировка: ${label} (${i}/${diceCount}) — СЛ ${dc} · Бонус ${bonusStr}`
      });
    }

    await this._openTrainingResultDialog(attribute, { label, dc, bonus, diceCount, results, totalPoints, critFails });
  }

  async _openTrainingResultDialog(attribute, { label, dc, bonus, diceCount, results, totalPoints, critFails }) {
    const value = Number(this.actor?.data?.system?.[attribute]?.value ?? 0) || 0;
    const filled = Number(this.actor?.data?.system?.[attribute]?.filledSegments ?? 0) || 0;
    const total = this._calculateSegments(value);

    const bonusStr = this._formatSigned(bonus);

    const rows = results.map(r => {
      const natStr = (r.nat ?? "?");
      const outcome = r.isCritSuccess
        ? `<span style="color:#77ff77;"><strong>КРИТ. УСПЕХ</strong></span>`
        : (r.isCritFail
          ? `<span style="color:#ff7777;"><strong>КРИТ. ПРОВАЛ</strong></span>`
          : (r.isSuccess
            ? `<span style="color:#77ff77;">Успех</span>`
            : `<span style="color:#bbbbbb;">Провал</span>`));
      const pts = r.points ? `<strong>+${r.points}</strong>` : "0";
      return `<li>Бросок ${r.index}: <code>${natStr} ${bonusStr} = ${r.total}</code> → ${outcome} → О.О: ${pts}</li>`;
    }).join("");

    const critBlock = (critFails > 0) ? `
      <hr style="opacity:0.25;margin:10px 0;" />
      <div class="notes" style="display:flex;flex-direction:column;gap:6px;">
        <div>Выпало критических провалов (чистая 1): <strong>${critFails}</strong>.</div>
        <div>Мастер решает, что происходит:</div>
        <label style="display:flex;gap:8px;align-items:center;">
          <input type="radio" name="critfail-mode" value="lose" checked />
          Потерять <strong>${critFails}</strong> О.О
        </label>
        <label style="display:flex;gap:8px;align-items:center;">
          <input type="radio" name="critfail-mode" value="abort" />
          Прервать тренировку (О.О не получать)
        </label>
      </div>
    ` : `<input type="hidden" name="critfail-mode" value="none" />`;

    const content = `
      <form class="os-ccw">
        <header class="os-ccw-header">
          <h2 class="os-ccw-title">Итог тренировки</h2>
          <div class="os-ccw-progress">СЛ ${dc} · Бонус ${bonusStr} · ${diceCount} броска</div>
          <div class="os-ccw-inline" style="margin-top:8px;">
            <span class="os-ccw-chip">Текущий круг: <strong>${filled}/${total}</strong></span>
            <span class="os-ccw-chip">О.О (до штрафов): <strong>${totalPoints}</strong></span>
          </div>
        </header>

        <section class="os-ccw-body">
          <ol style="margin:0 0 0 18px; padding:0; display:flex; flex-direction:column; gap:4px;">
            ${rows}
          </ol>

          ${critBlock}

          <hr style="opacity:0.25;margin:10px 0;" />
          <p class="notes" style="margin:0;">
            Нажми <strong>«Применить»</strong>, чтобы добавить (или убрать) О.О на круге обучения <strong>${label}</strong>.
          </p>
        </section>

      </form>
    `;

    let dlg;
    dlg = new Dialog({
      title: `Тренировка: результат — ${label}`,
      content,
      buttons: {
        apply: {
          label: "Применить",
          callback: async (html) => {
            const mode = html.find('input[name="critfail-mode"]:checked')?.val?.() || "none";
            if (mode === "abort") {
              ui.notifications?.info?.("Тренировка прервана: очки обучения не применены.");
              return;
            }
            const penaltyLoss = (mode === "lose") ? Number(critFails || 0) : 0;
            const net = Number(totalPoints || 0) - penaltyLoss;

            if (!net) {
              ui.notifications?.info?.("Очки обучения не изменились.");
              return;
            }
            await this._applyTrainingProgress(attribute, net);
          }
        },
        cancel: { label: "Не применять" }
      },
      default: "apply",
      close: () => { this._saveTrainingDialogState("result", dlg); }
    }, this._trainingDialogOptions("result", { width: 620, height: 420 }));

    dlg.render(true);
  }

  async _applyTrainingProgress(attribute, deltaSegments) {
    const delta = Number(deltaSegments || 0);
    if (!Number.isFinite(delta) || delta === 0) return;

    let value = Number(this.actor?.data?.system?.[attribute]?.value ?? 0) || 0;
    let filled = Number(this.actor?.data?.system?.[attribute]?.filledSegments ?? 0) || 0;

    filled += delta;

    // Forward (gain)
    while (filled >= this._calculateSegments(value)) {
      const segs = this._calculateSegments(value);
      filled -= segs;
      value += 1;
    }

    // Backward (loss)
    while (filled < 0) {
      value -= 1;
      const segsPrev = this._calculateSegments(value);
      filled += segsPrev;
    }

    // Clamp filled into [0..segs-1]
    const segsNow = this._calculateSegments(value);
    filled = Math.max(0, Math.min(segsNow - 1, filled));

    await this.actor.update({
      [`data.${attribute}.value`]: value,
      [`data.${attribute}.filledSegments`]: filled
    });

    ui.notifications?.info?.(`О.О применены: ${this._getCharacteristicLabel(attribute)} (${delta > 0 ? "+" : ""}${delta})`);
  }


  /* ===========================
     Training system for Skills/Spells (social phase)
     =========================== */

  _getItemMaxLevelForCircle(circle) {
    const maxLevels = { 0: 3, 1: 5, 2: 7, 3: 9, 4: 11 };
    return maxLevels[Number(circle)] ?? 0;
  }

  _calculateItemSegments(level, circle, item) {
    const c = Number(circle);
    const lvl = Number(level);
    if (!Number.isFinite(c) || !Number.isFinite(lvl) || lvl < 0) return 0;

    const max = this._getItemMaxLevelForCircle(c);
    if (max > 0 && lvl >= max) return 0;

    // Perk override (kept for future safety; perks are not trained via this UI).
    const isPerkSkill = item?.type === "Skill" && !!item?.system?.isPerk;
    if (isPerkSkill && lvl === 0) {
      const raw = Number(item?.system?.perkTrainingPoints ?? 0);
      const custom = Number.isFinite(raw) ? Math.trunc(raw) : 0;
      if (custom > 0) return custom;
    }

    if (c === 0) {
      const table0 = [8, 10, 12];
      return table0[lvl] ?? 0;
    }

    const base = 10 + 2 * c;
    return base + 2 * Math.floor(lvl / 2);
  }

  _getItemTrainingDC(circle, currentLevel) {
    const c = Number(circle);
    const lvl = Number(currentLevel);
    if (!Number.isFinite(c) || !Number.isFinite(lvl) || lvl < 0) return 10;
    const base = 10 + 2 * c; // 1→12, 2→14, 3→16, 4→18 (0→10)
    const targetLevel = lvl + 1; // DC depends on the level you are trying to reach
    return base + 2 * Math.floor(Math.max(0, targetLevel - 1) / 2);
  }

  _getTrainingAttributeKeys() {
    return [
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
  }

  _openItemTrainingDialog(item) {
    try {
      const circle = Number(item?.system?.Circle ?? 0) || 0;
      const level = Number(item?.system?.Level ?? 0) || 0;
      const filled = Number(item?.system?.filledSegments ?? 0) || 0;

      const maxLevel = this._getItemMaxLevelForCircle(circle);
      if (maxLevel > 0 && level >= maxLevel) {
        ui.notifications?.info?.("Максимальный уровень: тренировка не требуется.");
        return;
      }

      const total = this._calculateItemSegments(level, circle, item);
      const dc = this._getItemTrainingDC(circle, level);
      const diceCount = this._getTrainingDiceCount();

      // Build attribute options
      const options = this._getTrainingAttributeKeys().map(k => {
        const val = Number(this.actor?.data?.system?.[k]?.value ?? 0) || 0;
        const b = this._computeTrainingBonus(val);
        const label = this._getCharacteristicLabel(k);
        const valStr = this._formatSigned(val);
        const bStr = this._formatSigned(b);
        const extra = (b !== val) ? ` → бонус ${bStr}` : ` → бонус ${bStr}`;
        return `<option value="${k}">${label} (${valStr}${extra})</option>`;
      }).join("");

      const chips = `
        <div class="os-ccw-inline" style="margin-top:8px;">
          <span class="os-ccw-chip">Круг: <strong>${circle}</strong></span>
          <span class="os-ccw-chip">Уровень: <strong>${level}/${maxLevel}</strong></span>
          <span class="os-ccw-chip">Прогресс: <strong>${filled}/${total || 0}</strong></span>
          <span class="os-ccw-chip">Кубики: <strong>${diceCount}d20</strong></span>
        </div>
      `;

      const content = `
        <form class="os-ccw">
          <header class="os-ccw-header">
            <h2 class="os-ccw-title">Тренировка навыка/заклинания</h2>
            <div class="os-ccw-progress">СЛ ${dc} · ${diceCount} броска</div>
            ${chips}
          </header>

          <section class="os-ccw-body">
            <p style="margin-top:0;">Выбери характеристику для бонуса обучения и сделай серию бросков. За каждый <strong>успех</strong> получаешь +1 О.О, за <strong>чистую 20</strong> — +2 О.О.</p>
            <p class="notes" style="margin:0;">За <strong>чистую 1</strong> мастер решает: либо <em>−1 О.О</em>, либо <em>тренировка прерывается</em>.</p>
            <hr style="opacity:0.25;margin:10px 0;" />
            <div class="form-group" style="display:flex;gap:10px;align-items:center;">
              <label style="flex:0 0 auto;"><strong>Бонус обучения:</strong></label>
              <select name="training-attribute" style="flex:1 1 auto;">${options}</select>
            </div>
          </section>
        </form>
      `;

      let dlg;
      dlg = new Dialog({
        title: `Тренировка: ${item.name}`,
        content,
        buttons: {
          roll: {
            label: "Бросить",
            callback: async (html) => {
              const attr = html.find('select[name="training-attribute"]').val();
              await this._rollItemTraining(item, attr);
            }
          },
          cancel: { label: "Отмена" }
        },
        default: "roll",
        close: () => { this._saveTrainingDialogState("itemSeries", dlg); }
      }, this._trainingDialogOptions("itemSeries", { width: 640, height: 460 }));

      dlg.render(true);
    } catch (err) {
      console.error("[Order] Item training dialog failed", err);
      ui.notifications?.error?.("Не удалось открыть окно тренировки навыка/заклинания. Проверь консоль (F12).");
    }
  }

  async _rollItemTraining(item, attributeKey) {
    const attr = String(attributeKey || "").trim();
    if (!attr) return;

    const attrValue = Number(this.actor?.data?.system?.[attr]?.value ?? 0) || 0;
    const bonus = this._computeTrainingBonus(attrValue);
    const bonusStr = this._formatSigned(bonus);

    const circle = Number(item?.system?.Circle ?? 0) || 0;
    const level = Number(item?.system?.Level ?? 0) || 0;
    const dc = this._getItemTrainingDC(circle, level);
    const diceCount = this._getTrainingDiceCount();

    const formula = `1d20${bonus === 0 ? "" : (bonus > 0 ? ` + ${bonus}` : ` - ${Math.abs(bonus)}`)}`;
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const label = this._getCharacteristicLabel(attr);

    const results = [];
    let totalPoints = 0;
    let critFails = 0;

    for (let i = 1; i <= diceCount; i++) {
      const roll = await (new Roll(formula)).evaluate({ async: true });
      const nat = roll?.dice?.[0]?.results?.[0]?.result ?? null;
      const total = Number(roll.total ?? 0) || 0;

      const isCritSuccess = nat === 20;
      const isCritFail = nat === 1;
      const isSuccess = isCritSuccess || (!isCritFail && total >= dc);

      let points = 0;
      if (isCritSuccess) points = 2;
      else if (isSuccess) points = 1;

      if (isCritFail) critFails += 1;
      totalPoints += points;
      results.push({ index: i, nat, total, isCritSuccess, isCritFail, isSuccess, points });

      await roll.toMessage({
        speaker,
        flavor: `Тренировка: ${item.name} (${i}/${diceCount}) — ${label} · СЛ ${dc} · Бонус ${bonusStr}`
      });
    }

    await this._openItemTrainingResultDialog(item, { label, dc, bonus, diceCount, results, totalPoints, critFails, attributeKey: attr });
  }

  async _openItemTrainingResultDialog(item, { label, dc, bonus, diceCount, results, totalPoints, critFails, attributeKey }) {
    const circle = Number(item?.system?.Circle ?? 0) || 0;
    const level = Number(item?.system?.Level ?? 0) || 0;
    const filled = Number(item?.system?.filledSegments ?? 0) || 0;
    const total = this._calculateItemSegments(level, circle, item);
    const maxLevel = this._getItemMaxLevelForCircle(circle);
    const bonusStr = this._formatSigned(bonus);

    const rows = results.map(r => {
      const natStr = (r.nat ?? "?");
      const outcome = r.isCritSuccess
        ? `<span style="color:#77ff77;"><strong>КРИТ. УСПЕХ</strong></span>`
        : (r.isCritFail
          ? `<span style="color:#ff7777;"><strong>КРИТ. ПРОВАЛ</strong></span>`
          : (r.isSuccess
            ? `<span style="color:#77ff77;">Успех</span>`
            : `<span style="color:#bbbbbb;">Провал</span>`));
      const pts = r.points ? `<strong>+${r.points}</strong>` : "0";
      return `<li>Бросок ${r.index}: <code>${natStr} ${bonusStr} = ${r.total}</code> → ${outcome} → О.О: ${pts}</li>`;
    }).join("");

    const critBlock = (critFails > 0) ? `
      <hr style="opacity:0.25;margin:10px 0;" />
      <div class="notes" style="display:flex;flex-direction:column;gap:6px;">
        <div>Выпало критических провалов (чистая 1): <strong>${critFails}</strong>.</div>
        <div>Мастер решает, что происходит:</div>
        <label style="display:flex;gap:8px;align-items:center;">
          <input type="radio" name="critfail-mode" value="lose" checked />
          Потерять <strong>${critFails}</strong> О.О
        </label>
        <label style="display:flex;gap:8px;align-items:center;">
          <input type="radio" name="critfail-mode" value="abort" />
          Прервать тренировку (О.О не получать)
        </label>
      </div>
    ` : `<input type="hidden" name="critfail-mode" value="none" />`;

    const chips = `
      <div class="os-ccw-inline" style="margin-top:8px;">
        <span class="os-ccw-chip">Круг: <strong>${circle}</strong></span>
        <span class="os-ccw-chip">Уровень: <strong>${level}/${maxLevel}</strong></span>
        <span class="os-ccw-chip">Прогресс: <strong>${filled}/${total || 0}</strong></span>
        <span class="os-ccw-chip">О.О (до штрафов): <strong>${totalPoints}</strong></span>
      </div>
    `;

    const content = `
      <form class="os-ccw">
        <header class="os-ccw-header">
          <h2 class="os-ccw-title">Итог тренировки</h2>
          <div class="os-ccw-progress">СЛ ${dc} · ${diceCount} броска · ${label}</div>
          ${chips}
        </header>
        <section class="os-ccw-body">
          <ol style="margin:0 0 0 18px; padding:0; display:flex; flex-direction:column; gap:4px;">
            ${rows}
          </ol>
          ${critBlock}
          <hr style="opacity:0.25;margin:10px 0;" />
          <p class="notes" style="margin:0;">Нажми <strong>«Применить»</strong>, чтобы добавить (или убрать) О.О к прогрессу <strong>${item.name}</strong>.</p>
        </section>
      </form>
    `;

    let dlg;
    dlg = new Dialog({
      title: `Тренировка: результат — ${item.name}`,
      content,
      buttons: {
        apply: {
          label: "Применить",
          callback: async (html) => {
            const mode = html.find('input[name="critfail-mode"]:checked')?.val?.() || "none";
            if (mode === "abort") {
              ui.notifications?.info?.("Тренировка прервана: очки обучения не применены.");
              return;
            }
            const penaltyLoss = (mode === "lose") ? Number(critFails || 0) : 0;
            const net = Number(totalPoints || 0) - penaltyLoss;
            if (!net) {
              ui.notifications?.info?.("Очки обучения не изменились.");
              return;
            }
            await this._applyItemTrainingProgress(item, net);
          }
        },
        cancel: { label: "Не применять" }
      },
      default: "apply",
      close: () => { this._saveTrainingDialogState("itemResult", dlg); }
    }, this._trainingDialogOptions("itemResult", { width: 680, height: 520 }));

    dlg.render(true);
  }

  _getLevelUpOptionsByCircle(circle) {
    const c = Number(circle) || 0;
    const damage = { 1: 5, 2: 10, 3: 15, 4: 20 };
    const mult = { 1: 1, 2: 1, 3: 2, 4: 2 };
    const range = { 1: 1, 2: 2, 3: 3, 4: 4 };
    const aoe = { 1: 1, 2: 1, 3: 2, 4: 2 };
    const down = { 1: 1, 2: 1, 3: 2, 4: 2 };
    return {
      damage: damage[c] ?? 0,
      mult: mult[c] ?? 0,
      range: range[c] ?? 0,
      aoe: aoe[c] ?? 0,
      down: down[c] ?? 0
    };
  }

  async _applyItemTrainingProgress(item, deltaSegments) {
    const delta = Number(deltaSegments || 0);
    if (!Number.isFinite(delta) || delta === 0) return;

    const circle = Number(item?.system?.Circle ?? 0) || 0;
    const max = this._getItemMaxLevelForCircle(circle);

    let level = Number(item?.system?.Level ?? 0) || 0;
    let filled = Number(item?.system?.filledSegments ?? 0) || 0;
    const oldLevel = level;

    filled += delta;

    // Forward (gain)
    while (filled >= 0 && (max <= 0 || level < max)) {
      const segs = this._calculateItemSegments(level, circle, item);
      if (!segs || segs <= 0) break;
      if (filled < segs) break;
      filled -= segs;
      level += 1;
      if (max > 0 && level >= max) {
        level = max;
        filled = 0;
        break;
      }
    }

    // Backward (loss)
    while (filled < 0) {
      if (level <= 0) {
        level = 0;
        filled = 0;
        break;
      }
      level -= 1;
      const segsPrev = this._calculateItemSegments(level, circle, item);
      filled += (segsPrev || 0);
    }

    // Clamp filled into [0..segs-1] unless max level
    if (max > 0 && level >= max) {
      filled = 0;
    } else {
      const segsNow = this._calculateItemSegments(level, circle, item);
      if (segsNow > 0) filled = Math.max(0, Math.min(segsNow - 1, filled));
      else filled = 0;
    }

    await item.update({
      "system.Level": level,
      "system.filledSegments": filled
    });

    // Rerender sheet to update tooltips/progress
    this.render(false);

    ui.notifications?.info?.(`О.О применены: ${item.name} (${delta > 0 ? "+" : ""}${delta})`);

    // Level-up summary popup is handled globally via hooks (see scripts/OrderLevelUpSummary.js)
    // so it will appear for any level increase, not only from training.
  }

  _openRollDialog(attribute) {
    const characteristicModifiers = this.actor.data.system[attribute]?.modifiers;
    let customMods = [];
    const dialog = new Dialog({
      title: `Бросок кубика на ${attribute}`,
      content: `
       <div class="form-group">
          <label for="modifier">Ручной модификатор:</label>
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
          // Без модификатора = кубик + базовая характеристика (без учёта эффектов/бонусов/штрафов)
          callback: () => this._rollCharacteristic(attribute, [], 0),
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

    const hasLast = lastActiveTab && html.find(`#${lastActiveTab}`).length;

    if (hasLast) {
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


