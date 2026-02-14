import OrderItemSheet from "./OrderItemSheet.js";


export default class OrderClassSheet extends OrderItemSheet {

  get template() {
    // Keep path case-correct for Linux/macOS installs
    return `systems/Order/templates/sheets/class-sheet.hbs`;
  }

  getData() {
    let sheetData = super.getData();
    console.log("OrderClassSheet getData", sheetData);
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Инициализация зоны перетаскивания для Skills
    const skillsDropArea = html.find(".skills-drop");
    skillsDropArea.on("dragenter", this._onDragEnter.bind(this));
    skillsDropArea.on("dragover", this._onDragOver.bind(this));
    skillsDropArea.on("drop", (event) => this._onDrop(event, "Skills"));

    // Инициализация зоны перетаскивания для Base Perks
    const perksDropArea = html.find(".perks-drop");
    perksDropArea.on("dragenter", this._onDragEnter.bind(this));
    perksDropArea.on("dragover", this._onDragOver.bind(this));
    perksDropArea.on("drop", (event) => this._onDrop(event, "basePerks"));

    // Обработчики клика по ссылкам навыков/перков
    html.find(".skill-link").click(this._onSkillLinkClick.bind(this));
    html.find(".perk-link").click(this._onPerkLinkClick.bind(this));

    // Обработчики для кнопок удаления
    html.find(".delete-skill-button").click(this._onDeleteSkillClick.bind(this));
    html.find(".delete-perk-button").click(this._onDeleteSkillClick.bind(this));
  }

  // Обработчик клика по кнопке удаления
  async _onDeleteSkillClick(event) {
    event.preventDefault();

    // Получаем ID предмета и целевой массив из атрибутов кнопки
    const targetArray = event.currentTarget.dataset.array;
    const itemId = event.currentTarget.dataset.id;
    if (!targetArray || !itemId) return;

    const isPerk = targetArray === "basePerks";

    // Подтверждение удаления с использованием диалогового окна
    const confirmed = await Dialog.confirm({
      title: "Подтверждение удаления",
      content: `<p>Вы уверены, что хотите удалить этот ${isPerk ? "перк" : "навык"}?</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    // Получаем массив, который нужно обновить (skills или basePerks)
    const path = `system.${targetArray}`;
    const itemsArray = foundry.utils.getProperty(this.item, path) || [];

    // Фильтруем массив, удаляя элемент с нужным `_id`
    const updatedArray = itemsArray.filter(item => item._id !== itemId);

    // Обновляем соответствующий массив в данных предмета
    await this.item.update({ [path]: updatedArray });

    ui.notifications.info(isPerk ? "Перк успешно удален." : "Навык успешно удален.");
  }

  // Обработка клика по названию скилла для открытия его листа
  async _onSkillLinkClick(event) {
    event.preventDefault();

    // Получаем ID скилла из атрибута `data-skill-id`
    const skillId = event.currentTarget.dataset.skillId;
    if (!skillId) return;
    await this._openLinkedItem(skillId, "Skills", "Навык");
  }

  async _onPerkLinkClick(event) {
    event.preventDefault();
    const perkId = event.currentTarget.dataset.perkId;
    if (!perkId) return;
    await this._openLinkedItem(perkId, "basePerks", "Перк");
  }

  /**
   * Try to open an item sheet by id or by stored sourceUuid (for compendium drops).
   */
  async _openLinkedItem(sourceId, arrayKey, label) {
    // 1) World item or embedded item
    const doc = game.items.get(sourceId) || this.actor?.items.get(sourceId);
    if (doc) {
      doc.sheet.render(true);
      return;
    }

    // 2) Try source UUID (e.g. Compendium) stored on the entry
    const arr = Array.isArray(this.item.system?.[arrayKey]) ? this.item.system[arrayKey] : [];
    const entry = arr.find(e => e?._id === sourceId);
    const uuid = entry?.flags?.Order?.sourceUuid;
    if (uuid) {
      try {
        const from = await fromUuid(uuid);
        if (from?.sheet) {
          from.sheet.render(true);
          return;
        }
      } catch (e) {
        // ignore
      }
    }

    ui.notifications.warn(`${label} не найден.`);
  }

  // Обработчик для dragenter, можно добавить эффекты подсветки
  _onDragEnter(event) {
    event.preventDefault();
    event.currentTarget.classList.add("dragging");
  }

  // Обработчик для dragover, чтобы разрешить сброс предметов
  _onDragOver(event) {
    event.preventDefault();
  }

  // Основной обработчик для drop - добавляем предмет в массив класса
  async _onDrop(event, targetArray) {
    event.preventDefault();
    event.currentTarget.classList.remove("dragging");

    // Получаем данные о перетаскиваемом элементе
    const dt = event.originalEvent?.dataTransfer ?? event.dataTransfer;
    const raw = dt?.getData("text/plain");
    if (!raw) return;

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return ui.notifications.warn("Не удалось прочитать данные перетаскивания.");
    }

    // Проверяем, что это именно предмет
    if (data.type !== "Item") return ui.notifications.warn("Можно перетаскивать только предметы.");

    const droppedItem = await Item.fromDropData(data);
    if (!droppedItem) return;

    if (droppedItem.type !== "Skill") {
      return ui.notifications.warn("Можно перетаскивать только предметы типа 'Skill'.");
    }

    // Для зоны перков — ожидаем, что Skill помечен как perk
    if (targetArray === "basePerks" && !droppedItem.system?.isPerk) {
      return ui.notifications.warn("В секцию 'Перки' можно перетаскивать только навыки с флагом 'Перк'.");
    }

    const target = `system.${targetArray}`;
    const itemsArray = foundry.utils.getProperty(this.item, target) || [];

    // Создаем источник данных и сохраняем UUID оригинала (важно для предметов из компендия)
    const source = droppedItem.toObject();
    if (!source._id) source._id = foundry.utils.randomID();
    source.flags = source.flags || {};
    source.flags.Order = source.flags.Order || {};
    source.flags.Order.sourceUuid = droppedItem.uuid;

    // Не добавляем дубликаты (по uuid оригинала или по _id)
    const isDup = itemsArray.some(e => {
      const eu = e?.flags?.Order?.sourceUuid;
      return (eu && eu === droppedItem.uuid) || e?._id === source._id;
    });
    if (isDup) {
      return ui.notifications.warn("Этот предмет уже добавлен.");
    }

    itemsArray.push(source);
    await this.item.update({ [target]: itemsArray });

    ui.notifications.info(`${droppedItem.name} добавлен в класс.`);
  }
}
